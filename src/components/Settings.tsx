import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { 
  deriveMasterKey, 
  encryptPayload, 
  decryptPayload, 
  arrayBufferToBase64,
  generateRandomBytes
} from '../utils/crypto';
import { isBiometricsAvailable, enrollLocalBiometrics } from '../utils/biometrics';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';

function GoogleBackupButton({ onBackup }: { onBackup: (token: string) => void }) {
  const login = useGoogleLogin({
    onSuccess: (codeResponse) => onBackup(codeResponse.access_token),
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.appdata',
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
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.appdata',
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
  const [appLockEnabled, setAppLockEnabled] = useState(false);

  // Password fields
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Bio fields
  const [bioUsername, setBioUsername] = useState('one-user');



  // Theme state
  const [theme, setTheme] = useState<'system' | 'light' | 'dark'>('system');

  // Custom Modal State
  const [modalState, setModalState] = useState<{ type: 'success' | 'error', message: string, action?: () => void } | null>(null);

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

      const appLock = await db.settings.get('app_level_lock');
      setAppLockEnabled(appLock?.value === 'true');

      const bioCred = await db.settings.get('vault_biometric_credential');
      setIsBioEnrolled(!!bioCred);

      const bioSupport = await isBiometricsAvailable();
      setIsBioAvailable(bioSupport);

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

  const handleSetupMasterPassword = async () => {
    if (!newPassword || !confirmPassword) {
      alert('Please fill out both password fields');
      return;
    }
    if (newPassword !== confirmPassword) {
      alert('Passwords do not match');
      return;
    }

    try {
      const salt = generateRandomBytes(16);
      const saltBase64 = arrayBufferToBase64(salt.buffer as ArrayBuffer);
      
      const key = await deriveMasterKey(newPassword, salt);
      const verifier = await encryptPayload('VALID_VAULT_KEY', key);

      await db.settings.put({ key: 'vault_salt', value: saltBase64 });
      await db.settings.put({ key: 'vault_verifier', value: verifier });

      // Save to session so other tabs know it's unlocked
      try {
        const rawBytes = await window.crypto.subtle.exportKey('raw', key);
        const base64 = arrayBufferToBase64(rawBytes);
        sessionStorage.setItem('vault_unlocked_session_key', base64);
      } catch (err) {
        console.error('Failed to export new key to session storage:', err);
      }

      setHasPassword(true);
      setNewPassword('');
      setConfirmPassword('');
      alert('Master password successfully created! Vault initialized.');
    } catch (err) {
      console.error(err);
      alert('Failed to set up master password');
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
      setModalState({ type: 'error', message: 'Please set up your master password vault before exporting.' });
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
    setModalState({ type: 'success', message: 'Encrypted secure backup successfully created and downloaded!' });
  };

  const handleUploadToGoogleDrive = async (accessToken: string) => {
    try {
      const saltRec = await db.settings.get('vault_salt');
      const verifierRec = await db.settings.get('vault_verifier');
      if (!saltRec || !verifierRec) {
        setModalState({ type: 'error', message: 'Please set up your master password vault before exporting.' });
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
        setModalState({ type: 'success', message: 'Encrypted secure backup successfully uploaded to your hidden Google Drive AppData folder!' });
      } else {
        setModalState({ type: 'error', message: 'Upload failed: ' + await res.text() });
      }
    } catch (e) {
      console.error(e);
      setModalState({ type: 'error', message: 'Error uploading to Google Drive' });
    }
  };

  const handleRestoreFromGoogleDrive = async (accessToken: string) => {
    try {
      const listRes = await fetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name contains "one_backup_"&orderBy=modifiedTime desc', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const listData = await listRes.json();
      
      if (!listData.files || listData.files.length === 0) {
        setModalState({ type: 'error', message: 'No backup files found in your Google Drive AppData folder.' });
        return;
      }
      
      const latestFile = listData.files[0];
      
      const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${latestFile.id}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      
      if (!downloadRes.ok) {
        setModalState({ type: 'error', message: 'Failed to download the backup file.' });
        return;
      }
      
      const data = await downloadRes.json();

      if (!data.version || !data.vault) {
        setModalState({ type: 'error', message: 'Invalid backup file format' });
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

        setModalState({
          type: 'success',
          message: 'Cloud Backup successfully imported! Please refresh the page to reload settings.',
          action: () => window.location.reload()
        });
      }
    } catch (e) {
      console.error(e);
      setModalState({ type: 'error', message: 'Error restoring from Google Drive' });
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

      if (!data.version || !data.vault) {
        setModalState({ type: 'error', message: 'Invalid backup file format' });
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

        setModalState({
          type: 'success',
          message: 'Backup successfully imported! Please refresh the page to reload settings.',
          action: () => window.location.reload()
        });
      }
    } catch {
      setModalState({ type: 'error', message: 'Error parsing backup file' });
    }
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '440px' }}>
            <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>
              You haven't initialized your secure vault yet. Create a Master Password now to enable encrypted password and credit card storage.
            </p>
            <input type="password" placeholder="New Master Password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-base)' }} />
            <input type="password" placeholder="Confirm Master Password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-base)' }} />
            <button className="btn-primary" onClick={handleSetupMasterPassword} style={{ alignSelf: 'flex-start' }}>Create Master Password</button>
          </div>
        )}
      </div>

      {/* App Level Lock Settings */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '24px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-lg)', backgroundColor: 'var(--bg-surface)' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>🛡️ Global App Lock</h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '14px', maxWidth: '640px' }}>
          When enabled, the entire application will lock behind your Master Password (and Biometrics) whenever you switch tabs or minimize the window. A 1-minute grace period applies.
        </p>
        
        <label style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', maxWidth: 'max-content' }}>
          <input 
            type="checkbox" 
            checked={appLockEnabled}
            onChange={async (e) => {
              const checked = e.target.checked;
              setAppLockEnabled(checked);
              await db.settings.put({ key: 'app_level_lock', value: checked ? 'true' : 'false' });
            }}
            disabled={!hasPassword}
            style={{ width: '18px', height: '18px', accentColor: 'var(--accent)' }}
          />
          <span style={{ fontWeight: 600, color: hasPassword ? 'var(--text-primary)' : 'var(--text-tertiary)' }}>
            Require authentication to open app
          </span>
        </label>
        {!hasPassword && <span style={{ color: '#ef4444', fontSize: '12px' }}>You must setup a Master Password first.</span>}
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
          
          {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
            <GoogleOAuthProvider clientId={import.meta.env.VITE_GOOGLE_CLIENT_ID}>
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

      {/* Central Success Modal */}
      {modalState && (
        <div style={{
          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
          backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 9999,
          padding: '20px'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)', padding: '40px 32px', borderRadius: 'var(--border-radius-lg)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)', maxWidth: '440px', textAlign: 'center',
            display: 'flex', flexDirection: 'column', gap: '20px', border: '1px solid var(--border)',
            animation: 'fadeIn 0.2s ease-out'
          }}>
            <div style={{ fontSize: '56px', lineHeight: 1 }}>
              {modalState.type === 'success' ? '✅' : '⚠️'}
            </div>
            <h3 style={{ fontFamily: 'var(--font-heading)', margin: 0, fontSize: '24px', color: modalState.type === 'error' ? '#ef4444' : 'inherit' }}>
              {modalState.type === 'success' ? 'Success' : 'Error'}
            </h3>
            <p style={{ color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6, fontSize: '15px' }}>
              {modalState.message}
            </p>
            <button className={modalState.type === 'success' ? 'btn-primary' : 'btn-secondary'} 
              onClick={() => {
                const action = modalState.action;
                setModalState(null);
                if (action) action();
              }} 
              style={{ marginTop: '16px', padding: '14px', fontSize: '16px', ...(modalState.type === 'error' ? { borderColor: '#ef4444', color: '#ef4444' } : {}) }}>
              {modalState.action ? 'Reload Now' : (modalState.type === 'success' ? 'Awesome!' : 'Dismiss')}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
