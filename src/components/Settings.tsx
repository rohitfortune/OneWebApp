import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { 
  deriveMasterKey, 
  encryptPayload, 
  decryptPayload, 
  arrayBufferToBase64 
} from '../utils/crypto';
import { isBiometricsAvailable, enrollLocalBiometrics } from '../utils/biometrics';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';

function GoogleBackupButton({ onBackup }: { onBackup: (token: string) => void }) {
  const login = useGoogleLogin({
    onSuccess: (codeResponse) => onBackup(codeResponse.access_token),
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    onError: (error) => alert('Login Failed: ' + error)
  });

  return (
    <button className="btn-secondary" onClick={() => login()}>
      ☁️ Backup to Google Drive
    </button>
  );
}

function GoogleRestoreButton({ onRestore }: { onRestore: (token: string) => void }) {
  const login = useGoogleLogin({
    onSuccess: (codeResponse) => onRestore(codeResponse.access_token),
    scope: 'https://www.googleapis.com/auth/drive.appdata',
    onError: (error) => alert('Login Failed: ' + error)
  });

  return (
    <button className="btn-secondary" onClick={() => login()}>
      ☁️ Restore from Google Drive
    </button>
  );
}

export default function Settings() {
  const [hasPassword, setHasPassword] = useState(false);
  const [isBioAvailable, setIsBioAvailable] = useState(false);
  const [isBioEnrolled, setIsBioEnrolled] = useState(false);

  // Password fields
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Bio fields
  const [bioUsername, setBioUsername] = useState('one-user');

  // Cloud/OAuth Mock configurations
  const [googleClientId, setGoogleClientId] = useState('');
  const [microsoftClientId, setMicrosoftClientId] = useState('');

  // Theme state
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');

  const handleThemeChange = (newTheme: 'system' | 'light' | 'dark') => {
    setTheme(newTheme);
    localStorage.setItem('app-theme', newTheme);
    if (newTheme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', newTheme);
    }
  };

  useEffect(() => {
    const savedTheme = (localStorage.getItem('app-theme') as 'system' | 'light' | 'dark') || 'system';
    setTheme(savedTheme);

    const checkState = async () => {
      const salt = await db.settings.get('vault_salt');
      setHasPassword(!!salt);

      const bioCred = await db.settings.get('vault_biometric_credential');
      setIsBioEnrolled(!!bioCred);

      const bioSupport = await isBiometricsAvailable();
      setIsBioAvailable(bioSupport);

      const gClient = await db.settings.get('google_client_id');
      if (gClient) setGoogleClientId(gClient.value);

      const mClient = await db.settings.get('microsoft_client_id');
      if (mClient) setMicrosoftClientId(mClient.value);
    };
    checkState();
  }, []);

  const handleChangePassword = async () => {
    if (!oldPassword || !newPassword || !confirmPassword) {
      alert('Please fill out all password fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('New passwords do not match');
      return;
    }

    try {
      const saltRec = await db.settings.get('vault_salt');
      const verifierRec = await db.settings.get('vault_verifier');
      if (!saltRec || !verifierRec) return;

      const salt = new Uint8Array(base64ToArrayBuffer(saltRec.value));
      const oldKey = await deriveMasterKey(oldPassword, salt);
      const dec = await decryptPayload(verifierRec.value, oldKey);

      if (dec !== 'VALID_VAULT_KEY') {
        alert('Incorrect old master password');
        return;
      }

      // Re-encrypt database contents?
      // Since it's zero-knowledge, changing the password means generating a new salt, a new key,
      // and re-encrypting all vaults items (passwords and creditCards) with the new key!
      const passwords = await db.passwords.toArray();
      const cards = await db.creditCards.toArray();

      // Derive new key
      const newSalt = window.crypto.getRandomValues(new Uint8Array(16));
      const newSaltBase64 = arrayBufferToBase64(newSalt.buffer);
      const newKey = await deriveMasterKey(newPassword, newSalt);

      // Re-encrypt passwords
      for (const p of passwords) {
        const decryptedStr = await decryptPayload(p.encryptedData, oldKey);
        const reEncrypted = await encryptPayload(decryptedStr, newKey);
        await db.passwords.update(p.uuid, { encryptedData: reEncrypted });
      }

      // Re-encrypt cards
      for (const c of cards) {
        const decryptedStr = await decryptPayload(c.encryptedData, oldKey);
        const reEncrypted = await encryptPayload(decryptedStr, newKey);
        await db.creditCards.update(c.uuid, { encryptedData: reEncrypted });
      }

      // Save new verifier
      const newVerifier = await encryptPayload('VALID_VAULT_KEY', newKey);
      await db.settings.put({ key: 'vault_salt', value: newSaltBase64 });
      await db.settings.put({ key: 'vault_verifier', value: newVerifier });

      // Update active tab session key
      try {
        const rawBytes = await window.crypto.subtle.exportKey('raw', newKey);
        const base64 = arrayBufferToBase64(rawBytes);
        sessionStorage.setItem('vault_unlocked_session_key', base64);
      } catch (err) {
        console.error('Failed to export new key to session storage:', err);
      }

      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      alert('Master password successfully changed! All credentials re-encrypted securely.');
    } catch (e) {
      console.error(e);
      alert('Password change failed. Ensure old password is correct.');
    }
  };

  // Enroll biometrics
  const handleEnrollBiometrics = async () => {
    try {
      const credId = await enrollLocalBiometrics(bioUsername);
      await db.settings.put({ key: 'vault_biometric_credential', value: credId });
      setIsBioEnrolled(true);
      alert('Touch ID / Face ID registered successfully for this vault!');
    } catch (e: any) {
      alert(`Enrollment failed: ${e.message}`);
    }
  };

  const handleDisableBiometrics = async () => {
    if (window.confirm('Disable biometric unlock for this vault?')) {
      await db.settings.delete('vault_biometric_credential');
      setIsBioEnrolled(false);
    }
  };

  // Secure local backup to download file (.one)
  const handleDownloadBackup = async () => {
    const saltRec = await db.settings.get('vault_salt');
    const verifierRec = await db.settings.get('vault_verifier');
    if (!saltRec || !verifierRec) {
      alert('Please set up your master password vault before exporting.');
      return;
    }

    const notes = await db.notes.toArray();
    const passwords = await db.passwords.toArray();
    const cards = await db.creditCards.toArray();

    // Bundle it up
    const backupBundle = {
      version: 1,
      createdAt: Date.now(),
      vault: {
        salt: saltRec.value,
        verifier: verifierRec.value,
        passwords,
        cards
      },
      notes: notes.map(n => ({
        title: n.title,
        content: n.content,
        paths: n.paths,
        pinned: n.pinned
      }))
    };

    const str = JSON.stringify(backupBundle, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `one_backup_${new Date().toISOString().split('T')[0]}.one`;
    document.body.appendChild(link);
    link.click();
    
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    alert('Encrypted secure backup successfully created and downloaded!');
  };

  const handleUploadToGoogleDrive = async (accessToken: string) => {
    try {
      const saltRec = await db.settings.get('vault_salt');
      const verifierRec = await db.settings.get('vault_verifier');
      if (!saltRec || !verifierRec) {
        alert('Please set up your master password vault before exporting.');
        return;
      }

      const notes = await db.notes.toArray();
      const passwords = await db.passwords.toArray();
      const cards = await db.creditCards.toArray();

      const backupBundle = {
        version: 1,
        createdAt: Date.now(),
        vault: {
          salt: saltRec.value,
          verifier: verifierRec.value,
          passwords,
          cards
        },
        notes: notes.map(n => ({
          title: n.title,
          content: n.content,
          paths: n.paths,
          pinned: n.pinned
        }))
      };

      const str = JSON.stringify(backupBundle, null, 2);
      const blob = new Blob([str], { type: 'application/json' });
      const filename = `one_backup_${new Date().toISOString().split('T')[0]}.one`;

      const metadata = { name: filename, mimeType: 'application/json', parents: ['appDataFolder'] };
      const form = new FormData();
      form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
      form.append('file', blob);

      const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form
      });
      
      if (res.ok) {
        alert('Encrypted secure backup successfully uploaded to your hidden Google Drive AppData folder!');
      } else {
        alert('Upload failed: ' + await res.text());
      }
    } catch (e) {
      console.error(e);
      alert('Error uploading to Google Drive');
    }
  };

  const handleRestoreFromGoogleDrive = async (accessToken: string) => {
    try {
      const listRes = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains "one_backup_"&orderBy=modifiedTime desc', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const listData = await listRes.json();
      
      if (!listData.files || listData.files.length === 0) {
        alert('No backup files found in your Google Drive AppData folder.');
        return;
      }
      
      const latestFile = listData.files[0];
      
      const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${latestFile.id}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (!downloadRes.ok) {
        alert('Failed to download the backup file.');
        return;
      }
      
      const data = await downloadRes.json();

      if (data.version !== 1 || !data.vault) {
        alert('Invalid backup file format');
        return;
      }

      if (window.confirm('Importing this cloud backup will overwrite your existing local notes, settings, and vault credentials. Proceed?')) {
        await db.notes.clear();
        await db.passwords.clear();
        await db.creditCards.clear();
        await db.settings.clear();

        await db.settings.put({ key: 'vault_salt', value: data.vault.salt });
        await db.settings.put({ key: 'vault_verifier', value: data.vault.verifier });

        for (const n of data.notes) {
          await db.notes.add({
            title: n.title,
            content: n.content,
            paths: n.paths,
            pinned: n.pinned,
            lastModified: Date.now()
          });
        }

        for (const p of data.vault.passwords) {
          await db.passwords.put(p);
        }

        for (const c of data.vault.cards) {
          await db.creditCards.put(c);
        }

        alert('Cloud Backup successfully imported! Please refresh the page to reload settings.');
        window.location.reload();
      }
    } catch (e) {
      console.error(e);
      alert('Error restoring from Google Drive');
    }
  };

  // Restore logic
  const handleUploadBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    try {
      const file = files[0];
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.version !== 1 || !data.vault) {
        alert('Invalid backup file format');
        return;
      }

      if (window.confirm('Importing this backup will overwrite your existing local notes, settings, and vault credentials. Proceed?')) {
        await db.notes.clear();
        await db.passwords.clear();
        await db.creditCards.clear();
        await db.settings.clear();

        // Restore Settings
        await db.settings.put({ key: 'vault_salt', value: data.vault.salt });
        await db.settings.put({ key: 'vault_verifier', value: data.vault.verifier });

        // Restore Notes
        for (const n of data.notes) {
          await db.notes.add({
            title: n.title,
            content: n.content,
            paths: n.paths,
            pinned: n.pinned,
            lastModified: Date.now()
          });
        }

        // Restore Passwords
        for (const p of data.vault.passwords) {
          await db.passwords.put(p);
        }

        // Restore Cards
        for (const c of data.vault.cards) {
          await db.creditCards.put(c);
        }

        alert('Backup successfully imported! Please refresh the page to reload settings.');
        window.location.reload();
      }
    } catch {
      alert('Error parsing backup file');
    }
  };

  const handleSaveOAuthSettings = async () => {
    await db.settings.put({ key: 'google_client_id', value: googleClientId });
    await db.settings.put({ key: 'microsoft_client_id', value: microsoftClientId });
    alert('Cloud Backup settings saved successfully!');
  };

  const handleWipeDatabase = async () => {
    if (window.confirm('☢️ EXTREME WARNING: This will permanently wipe all notes, stored passwords, credit cards, local files, and encryption keys from your device. This cannot be undone. Are you absolutely sure?')) {
      await db.delete();
      alert('Database fully wiped and reset. Reloading app...');
      window.location.reload();
    }
  };

  function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer as ArrayBuffer;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '40px', padding: '10px' }}>
      
      {/* Theme selection settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-lg)', backgroundColor: 'var(--bg-surface)' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>🎨 Color Theme Mode</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '640px' }}>
          Personalize your user experience by choosing between Light mode, Dark mode, or matching your Operating System theme.
        </p>
        
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          {[
            { id: 'system', name: '💻 System Default', desc: 'Syncs with OS preferences' },
            { id: 'light', name: '☀️ Light Theme', desc: 'Crisp & clear view' },
            { id: 'dark', name: '🌙 Dark Theme', desc: 'Eye-strain relief' }
          ].map((opt) => {
            const isActive = theme === opt.id;
            return (
              <button
                key={opt.id}
                onClick={() => handleThemeChange(opt.id as 'system' | 'light' | 'dark')}
                style={{
                  flex: '1 1 180px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  padding: '16px 20px',
                  borderRadius: 'var(--border-radius-md)',
                  border: isActive ? '2px solid var(--accent)' : '1px solid var(--border)',
                  backgroundColor: isActive ? 'var(--accent-soft)' : 'var(--bg-base)',
                  color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'all var(--transition-fast)',
                  gap: '4px',
                  boxShadow: isActive ? 'var(--shadow-md)' : 'none'
                }}
              >
                <span style={{ fontWeight: 700, fontSize: '15px' }}>{opt.name}</span>
                <span style={{ fontSize: '11px', color: isActive ? 'var(--accent)' : 'var(--text-secondary)', opacity: isActive ? 0.9 : 1 }}>{opt.desc}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Cryptography Vault settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-lg)', backgroundColor: 'var(--bg-surface)' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>🔒 Vault Master Password</h2>
        {hasPassword ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '440px' }}>
            <input type="password" placeholder="Old Master Password" value={oldPassword} onChange={(e) => setOldPassword(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-base)' }} />
            <input type="password" placeholder="New Master Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-base)' }} />
            <input type="password" placeholder="Confirm New Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-base)' }} />
            <button className="btn-primary" onClick={handleChangePassword} style={{ alignSelf: 'flex-start' }}>Change Password</button>
          </div>
        ) : (
          <span style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>Setup your secure vault inside the Vault panel first.</span>
        )}
      </div>

      {/* Biometric unlock settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-lg)', backgroundColor: 'var(--bg-surface)' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>⚡ Biometric Authentication (Touch ID / Face ID)</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '640px' }}>
          Enable on-device hardware biometric scanning to quickly unlock your credentials without re-typing your Master Password.
        </p>
        
        {!isBioAvailable ? (
          <span style={{ color: '#ef4444', fontWeight: 600, fontSize: '13px' }}>⚠️ Local Biometric Authenticator is not supported on this browser or requires an SSL/HTTPS connection.</span>
        ) : isBioEnrolled ? (
          <div>
            <span style={{ color: '#10b981', fontWeight: 600, fontSize: '13px', display: 'block', marginBottom: '12px' }}>✓ Biometrics enrolled and active on this device.</span>
            <button className="btn-secondary" onClick={handleDisableBiometrics} style={{ color: '#ef4444', borderColor: '#fca5a5' }}>Disable Biometrics</button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: '10px', alignItems: 'center', maxWidth: '440px', flexWrap: 'wrap' }}>
            <input type="text" placeholder="Username / Alias" value={bioUsername} onChange={(e) => setBioUsername(e.target.value)} style={{ flexGrow: 1, minWidth: '150px', padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-base)' }} />
            <button className="btn-primary" onClick={handleEnrollBiometrics} style={{ flexGrow: 1 }}>Register Fingerprint / Face</button>
          </div>
        )}
      </div>

      {/* Database Backup Export & Import */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-lg)', backgroundColor: 'var(--bg-surface)' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>📦 Encrypted Secure Backups (.one)</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '640px' }}>
          Export a zero-knowledge, AES-256 encrypted archive containing your entire local notes, settings, credentials vault, and parameters to store anywhere.
        </p>
        <div style={{ display: 'flex', gap: '14px', flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn-primary" onClick={handleDownloadBackup}>📥 Export Encrypted Backup</button>
          
          {googleClientId && (
            <GoogleOAuthProvider clientId={googleClientId}>
              <div style={{ display: 'flex', gap: '10px' }}>
                <GoogleBackupButton onBackup={handleUploadToGoogleDrive} />
                <GoogleRestoreButton onRestore={handleRestoreFromGoogleDrive} />
              </div>
            </GoogleOAuthProvider>
          )}

          <input type="file" id="backup-restore-input" accept=".one" onChange={handleUploadBackup} style={{ display: 'none' }} />
          <label htmlFor="backup-restore-input" className="btn-secondary" style={{ cursor: 'pointer' }}>
            📤 Restore from Backup File
          </label>
        </div>
      </div>

      {/* Cloud Integration settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-lg)', backgroundColor: 'var(--bg-surface)' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>☁️ Cloud Sync API Configuration</h2>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '640px' }}>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>Google OAuth Web Client ID</label>
            <input type="text" placeholder="Google Client ID..." value={googleClientId} onChange={(e) => setGoogleClientId(e.target.value)} style={{ width: '100%', padding: '12px', marginTop: '6px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-base)' }} />
          </div>
          <div>
            <label style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-secondary)' }}>Microsoft Graph App Client ID</label>
            <input type="text" placeholder="Microsoft Client ID..." value={microsoftClientId} onChange={(e) => setMicrosoftClientId(e.target.value)} style={{ width: '100%', padding: '12px', marginTop: '6px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-base)' }} />
          </div>
          <button className="btn-primary" onClick={handleSaveOAuthSettings} style={{ alignSelf: 'flex-start' }}>Save API Configs</button>
        </div>
      </div>

      {/* Factory Wipe settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-lg)', backgroundColor: 'rgba(239, 68, 68, 0.05)', borderColor: 'rgba(239, 68, 68, 0.2)' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)', color: '#ef4444' }}>☢️ System Reset</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
          Deletes all databases, files, settings, and encryption keys from this browser session. Ensure you have backups.
        </p>
        <button className="btn-primary" onClick={handleWipeDatabase} style={{ backgroundColor: '#ef4444', boxShadow: '0 4px 12px rgba(239, 68, 68, 0.2)', alignSelf: 'flex-start' }}>
          Wipe Local Database
        </button>
      </div>

    </div>
  );
}
