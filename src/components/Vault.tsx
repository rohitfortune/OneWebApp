import { useState, useEffect } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type PasswordRecord, type CreditCardRecord } from '../db/db';
import { 
  deriveMasterKey, 
  encryptPayload, 
  decryptPayload, 
  generateRandomBytes, 
  arrayBufferToBase64 
} from '../utils/crypto';
import { isBiometricsAvailable, verifyLocalBiometrics } from '../utils/biometrics';

interface VaultProps {
  onVaultLockChange: (locked: boolean) => void;
}

export default function Vault({ onVaultLockChange }: VaultProps) {
  // Vault session decryption key (stored strictly in-memory)
  const [vaultKey, setVaultKey] = useState<CryptoKey | null>(null);
  
  // Settings checks
  const [hasMasterPassword, setHasMasterPassword] = useState<boolean>(false);
  const [biometricsEnrolled, setBiometricsEnrolled] = useState<boolean>(false);
  const [biometricsSupported, setBiometricsSupported] = useState<boolean>(false);

  // Lock inputs
  const [masterPasswordInput, setMasterPasswordInput] = useState('');
  const [newMasterPassword, setNewMasterPassword] = useState('');
  const [confirmMasterPassword, setConfirmMasterPassword] = useState('');

  // Unlocked panel tabs & selection
  const [activeTab, setActiveTab] = useState<'passwords' | 'cards'>('passwords');
  const [searchQuery, setSearchQuery] = useState('');

  // Lists
  const dbPasswords = useLiveQuery(() => db.passwords.toArray()) || [];
  const dbCards = useLiveQuery(() => db.creditCards.toArray()) || [];

  const [decryptedPasswords, setDecryptedPasswords] = useState<any[]>([]);
  const [decryptedCards, setDecryptedCards] = useState<any[]>([]);
  const [selectedItem, setSelectedItem] = useState<any | null>(null);

  // Form fields
  const [editingItemType, setEditingItemType] = useState<'password' | 'card' | null>(null);
  const [pwTitle, setPwTitle] = useState('');
  const [pwUsername, setPwUsername] = useState('');
  const [pwPassword, setPwPassword] = useState('');
  const [pwUrl, setPwUrl] = useState('');
  const [pwNotes, setPwNotes] = useState('');

  const [cardHolder, setCardHolder] = useState('');
  const [cardNumber, setCardNumber] = useState('');
  const [cardBrand, setCardBrand] = useState('Visa');
  const [cardExpiry, setCardExpiry] = useState('');
  const [cardCvv, setCardCvv] = useState('');
  const [cardPin, setCardPin] = useState('');
  const [cardNotes, setCardNotes] = useState('');

  // Card Visual Flip state
  const [isCardFlipped, setIsCardFlipped] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [copiedField, setCopiedField] = useState<'username' | 'password' | null>(null);

  const handleCopy = (text: string, field: 'username' | 'password') => {
    navigator.clipboard.writeText(text);
    setCopiedField(field);
    setTimeout(() => setCopiedField(null), 2000);
  };

  useEffect(() => {
    setShowPassword(false);
    setShowPin(false);
    setIsCardFlipped(false);
    setCopiedField(null);
  }, [selectedItem]);

  // Initial setup checks
  useEffect(() => {
    const checkSettings = async () => {
      const saltRec = await db.settings.get('vault_salt');
      const verifierRec = await db.settings.get('vault_verifier');
      setHasMasterPassword(!!(saltRec && verifierRec));

      const bioCredRec = await db.settings.get('vault_biometric_credential');
      setBiometricsEnrolled(!!bioCredRec);

      const bioAvail = await isBiometricsAvailable();
      setBiometricsSupported(bioAvail);
    };
    checkSettings();
  }, [vaultKey]);

  // Lock changes trigger background style overrides
  useEffect(() => {
    onVaultLockChange(!vaultKey);
  }, [vaultKey, onVaultLockChange]);

  // Decrypt items when vault is unlocked or items list updates
  useEffect(() => {
    if (!vaultKey) {
      setDecryptedPasswords([]);
      setDecryptedCards([]);
      return;
    }

    const decryptAll = async () => {
      try {
        const decryptedPws = await Promise.all(
          dbPasswords.map(async (p) => {
            const rawStr = await decryptPayload(p.encryptedData, vaultKey);
            const data = JSON.parse(rawStr);
            return { uuid: p.uuid, lastModified: p.lastModified, ...data };
          })
        );
        setDecryptedPasswords(decryptedPws);

        const decryptedCds = await Promise.all(
          dbCards.map(async (c) => {
            const rawStr = await decryptPayload(c.encryptedData, vaultKey);
            const data = JSON.parse(rawStr);
            return { uuid: c.uuid, lastModified: c.lastModified, ...data };
          })
        );
        setDecryptedCards(decryptedCds);
      } catch (err) {
        console.error('Decryption failed, lock database.', err);
        setVaultKey(null);
      }
    };
    decryptAll();
  }, [vaultKey, dbPasswords, dbCards]);

  // Helper: Securely cache derived key in session storage (tab memory only)
  const saveKeyToSession = async (key: CryptoKey) => {
    try {
      const rawBytes = await window.crypto.subtle.exportKey('raw', key);
      const base64 = arrayBufferToBase64(rawBytes);
      sessionStorage.setItem('vault_unlocked_session_key', base64);
    } catch (e) {
      console.error('Failed to export key to session storage:', e);
    }
  };

  // Handle setting up a new master password
  const handleSetupMasterPassword = async () => {
    if (!newMasterPassword) return;
    if (newMasterPassword !== confirmMasterPassword) {
      alert('Passwords do not match');
      return;
    }

    try {
      const salt = generateRandomBytes(16);
      const saltBase64 = arrayBufferToBase64(salt.buffer as ArrayBuffer);
      
      const key = await deriveMasterKey(newMasterPassword, salt);
      const verifier = await encryptPayload('VALID_VAULT_KEY', key);

      await db.settings.put({ key: 'vault_salt', value: saltBase64 });
      await db.settings.put({ key: 'vault_verifier', value: verifier });

      await saveKeyToSession(key);
      setVaultKey(key);
      alert('Master password successfully created! Vault unlocked.');
    } catch (err) {
      console.error(err);
      alert('Failed to set up master password');
    }
  };

  // Unlock using Master Password
  const handleUnlockWithPassword = async () => {
    try {
      const saltRec = await db.settings.get('vault_salt');
      const verifierRec = await db.settings.get('vault_verifier');
      if (!saltRec || !verifierRec) return;

      const salt = new Uint8Array(base64ToArrayBuffer(saltRec.value));
      const key = await deriveMasterKey(masterPasswordInput, salt);

      const decryptedVerifier = await decryptPayload(verifierRec.value, key);
      if (decryptedVerifier === 'VALID_VAULT_KEY') {
        // Vault Decrypted!
        await saveKeyToSession(key);
        setVaultKey(key);
        setMasterPasswordInput('');
      } else {
        alert('Invalid master password. Please try again.');
      }
    } catch {
      alert('Invalid password or verification failure');
    }
  };

  // Unlock using Biometrics (Touch ID / Face ID)
  const handleUnlockWithBiometrics = async () => {
    try {
      const bioCredRec = await db.settings.get('vault_biometric_credential');
      const saltRec = await db.settings.get('vault_salt');
      if (!bioCredRec || !saltRec) return;

      // Trigger WebAuthn verification
      const success = await verifyLocalBiometrics(bioCredRec.value);
      if (!success) {
        alert('Biometric verification failed');
        return;
      }

      // If biometric succeeds: recover the derived vault key cached in tab session storage!
      const storedKey = sessionStorage.getItem('vault_unlocked_session_key');
      if (storedKey) {
        const decoded = new Uint8Array(base64ToArrayBuffer(storedKey));
        const key = await window.crypto.subtle.importKey(
          'raw',
          decoded,
          'AES-GCM',
          false,
          ['encrypt', 'decrypt']
        );
        setVaultKey(key);
      } else {
        alert('First login since browser start requires master password to initialize session.');
      }
    } catch (e) {
      console.error(e);
      alert('Biometric lock recovery failed.');
    }
  };

  // Lock Vault
  const handleLockVault = () => {
    setVaultKey(null);
    setSelectedItem(null);
    setEditingItemType(null);
  };

  // Add / Save Credential Item
  const handleSavePassword = async () => {
    if (!pwTitle || !pwUsername || !pwPassword || !vaultKey) return;

    const payload = JSON.stringify({
      title: pwTitle,
      username: pwUsername,
      password: pwPassword,
      url: pwUrl,
      notes: pwNotes
    });

    const encrypted = await encryptPayload(payload, vaultKey);
    const uuid = selectedItem?.uuid || crypto.randomUUID();

    const record: PasswordRecord = {
      uuid,
      encryptedData: encrypted,
      lastModified: Date.now()
    };

    await db.passwords.put(record);
    
    // Clear forms
    setPwTitle('');
    setPwUsername('');
    setPwPassword('');
    setPwUrl('');
    setPwNotes('');
    setEditingItemType(null);
    setSelectedItem(null);
  };

  const handleSaveCard = async () => {
    if (!cardHolder || !cardNumber || !vaultKey) return;

    const payload = JSON.stringify({
      cardHolder,
      cardNumber,
      brand: cardBrand,
      expiry: cardExpiry,
      cvv: cardCvv,
      pin: cardPin,
      notes: cardNotes
    });

    const encrypted = await encryptPayload(payload, vaultKey);
    const uuid = selectedItem?.uuid || crypto.randomUUID();

    const record: CreditCardRecord = {
      uuid,
      encryptedData: encrypted,
      lastModified: Date.now()
    };

    await db.creditCards.put(record);

    // Clear forms
    setCardHolder('');
    setCardNumber('');
    setCardBrand('Visa');
    setCardExpiry('');
    setCardCvv('');
    setCardPin('');
    setCardNotes('');
    setEditingItemType(null);
    setSelectedItem(null);
  };

  const handleDeleteItem = async (uuid: string) => {
    if (window.confirm('Delete this item permanently from your vault?')) {
      if (activeTab === 'passwords') {
        await db.passwords.delete(uuid);
      } else {
        await db.creditCards.delete(uuid);
      }
      setSelectedItem(null);
    }
  };

  const handleGeneratePassword = () => {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+=-';
    let pass = '';
    for (let i = 0; i < 16; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setPwPassword(pass);
  };

  // Safe conversions
  function base64ToArrayBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer as ArrayBuffer;
  }

  // Filter items
  const filteredPasswords = decryptedPasswords.filter(p => 
    p.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
    p.username.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredCards = decryptedCards.filter(c => 
    c.cardHolder.toLowerCase().includes(searchQuery.toLowerCase()) || 
    c.cardNumber.includes(searchQuery)
  );

  // If Vault is locked
  if (!vaultKey) {
    return (
      <div className="lock-screen-overlay" style={{ position: 'relative', height: 'calc(100vh - 160px)', background: 'transparent' }}>
        <div className="lock-card">
          <div className="lock-icon-container">🔑</div>
          
          {!hasMasterPassword ? (
            // No Master Password Set Up Yet
            <>
              <h2 style={{ fontFamily: 'var(--font-heading)' }}>Set Up Cryptography Vault</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                Establish a master unlock password. Your data is encrypted locally using AES-256 and cannot be recovered if password is forgotten.
              </p>
              <input
                type="password"
                placeholder="New Master Password"
                className="lock-pin-input"
                value={newMasterPassword}
                onChange={(e) => setNewMasterPassword(e.target.value)}
                style={{ fontSize: '16px', letterSpacing: '1px' }}
              />
              <input
                type="password"
                placeholder="Confirm Master Password"
                className="lock-pin-input"
                value={confirmMasterPassword}
                onChange={(e) => setConfirmMasterPassword(e.target.value)}
                style={{ fontSize: '16px', letterSpacing: '1px' }}
              />
              <button className="lock-btn" onClick={handleSetupMasterPassword}>
                Initialize Vault & Unlock
              </button>
            </>
          ) : (
            // Enter Password to Unlock
            <>
              <h2 style={{ fontFamily: 'var(--font-heading)' }}>Vault Locked</h2>
              <p style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
                Enter your Master Password to decrypt your secure credentials.
              </p>
              <input
                type="password"
                placeholder="Master Password"
                className="lock-pin-input"
                value={masterPasswordInput}
                onChange={(e) => setMasterPasswordInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleUnlockWithPassword()}
                style={{ fontSize: '16px', letterSpacing: '2px' }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', width: '100%', gap: '12px' }}>
                <button className="lock-btn" onClick={handleUnlockWithPassword}>
                  Decrypt & Unlock
                </button>
                {biometricsEnrolled && biometricsSupported && (
                  <button className="biometric-btn" onClick={handleUnlockWithBiometrics}>
                    ⚡ Quick Unlock with Biometrics
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // If Vault is UNLOCKED
  const showDetailView = !!(selectedItem || editingItemType);

  return (
    <div style={{ height: 'calc(100vh - 160px)' }}>
      {/* Side Item list */}
      {!showDetailView && (
      <div className="vault-sidebar-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', paddingBottom: '20px' }}>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            className={`btn-secondary ${activeTab === 'passwords' ? 'btn-primary' : ''}`} 
            onClick={() => { setActiveTab('passwords'); setSelectedItem(null); setEditingItemType(null); }}
            style={{ flexGrow: 1, padding: '10px' }}
          >
            Passwords
          </button>
          <button 
            className={`btn-secondary ${activeTab === 'cards' ? 'btn-primary' : ''}`} 
            onClick={() => { setActiveTab('cards'); setSelectedItem(null); setEditingItemType(null); }}
            style={{ flexGrow: 1, padding: '10px' }}
          >
            Cards
          </button>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <input
            type="text"
            placeholder={`Search ${activeTab}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flexGrow: 1,
              padding: '12px 16px',
              borderRadius: 'var(--border-radius-md)',
              border: '1px solid var(--border)',
              backgroundColor: 'var(--bg-surface)'
            }}
          />
          <button 
            className="btn-primary" 
            onClick={() => {
              setSelectedItem(null);
              setEditingItemType(activeTab === 'passwords' ? 'password' : 'card');
              // Clear forms
              setPwTitle(''); setPwUsername(''); setPwPassword(''); setPwUrl(''); setPwNotes('');
              setCardHolder(''); setCardNumber(''); setCardBrand('Visa'); setCardExpiry(''); setCardCvv(''); setCardPin(''); setCardNotes('');
            }}
            style={{ padding: '12px 14px' }}
          >
            +
          </button>
        </div>

        <div className="items-list">
          {activeTab === 'passwords' ? (
            filteredPasswords.map((p) => (
              <div 
                key={p.uuid} 
                className={`item-card ${selectedItem?.uuid === p.uuid ? 'active' : ''}`}
                onClick={() => { setSelectedItem(p); setEditingItemType(null); }}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{p.title}</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>{p.username}</span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteItem(p.uuid); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>🗑️</button>
              </div>
            ))
          ) : (
            filteredCards.map((c) => (
              <div 
                key={c.uuid} 
                className={`item-card ${selectedItem?.uuid === c.uuid ? 'active' : ''}`}
                onClick={() => { setSelectedItem(c); setEditingItemType(null); }}
                style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                  <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{c.cardHolder}</span>
                  <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
                    {c.brand} (•••• {c.cardNumber.slice(-4)})
                  </span>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteItem(c.uuid); }} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>🗑️</button>
              </div>
            ))
          )}

          {activeTab === 'passwords' && filteredPasswords.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '40px 0' }}>No credentials</div>
          )}
          {activeTab === 'cards' && filteredCards.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '40px 0' }}>No cards</div>
          )}
        </div>

        <button className="btn-secondary" onClick={handleLockVault} style={{ width: '100%', borderStyle: 'dashed', color: 'var(--accent)' }}>
          🔒 Lock Secure Vault
        </button>
      </div>
      )}

      {/* Main detail pane */}
      {showDetailView && (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '10px' }}>
        <button 
          className="btn-secondary" 
          onClick={() => { setSelectedItem(null); setEditingItemType(null); }}
          style={{ alignSelf: 'flex-start', marginBottom: '20px', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}
        >
          <span>←</span> Back
        </button>

        {editingItemType === 'password' && (
          // Add/Edit Password Form
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px' }}>
            <h2 style={{ fontFamily: 'var(--font-heading)' }}>{selectedItem ? 'Edit Credential' : 'Secure New Password'}</h2>
            <input type="text" placeholder="Title" value={pwTitle} onChange={(e) => setPwTitle(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)' }} />
            <input type="text" placeholder="Username / Email" value={pwUsername} onChange={(e) => setPwUsername(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)' }} />
            
            <div style={{ display: 'flex', gap: '10px' }}>
              <input type="text" placeholder="Password" value={pwPassword} onChange={(e) => setPwPassword(e.target.value)} style={{ flexGrow: 1, padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)' }} />
              <button className="btn-secondary" onClick={handleGeneratePassword}>⚡ Generate</button>
            </div>
            
            <input type="text" placeholder="URL" value={pwUrl} onChange={(e) => setPwUrl(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)' }} />
            <textarea placeholder="Secure notes..." value={pwNotes} onChange={(e) => setPwNotes(e.target.value)} style={{ padding: '12px', height: '120px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)', resize: 'none' }} />
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn-primary" onClick={handleSavePassword}>Save Secure Credential</button>
              <button className="btn-secondary" onClick={() => setEditingItemType(null)}>Cancel</button>
            </div>
          </div>
        )}

        {editingItemType === 'card' && (
          // Add/Edit Card Form
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px' }}>
            <h2 style={{ fontFamily: 'var(--font-heading)' }}>{selectedItem ? 'Edit Secure Card' : 'Secure New Card'}</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)' }}>Cardholder Name</label>
              <input type="text" placeholder="Cardholder Name" value={cardHolder} onChange={(e) => setCardHolder(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)' }}>Card Number</label>
              <input type="text" placeholder="0000 0000 0000 0000" value={cardNumber} onChange={(e) => setCardNumber(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)' }} />
            </div>
            
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flexGrow: 1 }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)' }}>Card Type</label>
                <select value={cardBrand} onChange={(e) => setCardBrand(e.target.value)} style={{ width: '100%', padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)' }}>
                  <option value="Visa">Visa</option>
                  <option value="Mastercard">Mastercard</option>
                  <option value="Amex">American Express</option>
                  <option value="Discover">Discover</option>
                </select>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)' }}>Exp Date</label>
                <input type="text" placeholder="MM/YY" value={cardExpiry} onChange={(e) => setCardExpiry(e.target.value)} style={{ width: '100px', padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)' }} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)' }}>CVV</label>
                <input type="password" placeholder="***" maxLength={4} value={cardCvv} onChange={(e) => setCardCvv(e.target.value)} style={{ width: '80px', padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)', textAlign: 'center' }} />
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-tertiary)' }}>ATM PIN</label>
              <input type="password" placeholder="****" maxLength={6} value={cardPin} onChange={(e) => setCardPin(e.target.value)} style={{ padding: '12px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)' }} />
            </div>
            <textarea placeholder="Secure notes..." value={cardNotes} onChange={(e) => setCardNotes(e.target.value)} style={{ padding: '12px', height: '100px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--bg-surface)', resize: 'none' }} />
            <div style={{ display: 'flex', gap: '12px' }}>
              <button className="btn-primary" onClick={handleSaveCard}>Secure Card</button>
              <button className="btn-secondary" onClick={() => setEditingItemType(null)}>Cancel</button>
            </div>
          </div>
        )}

        {selectedItem && !editingItemType && (
          // View Mode details
          <div style={{ display: 'flex', flexDirection: 'column', gap: '30px', padding: '20px' }}>
            {activeTab === 'passwords' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h1 style={{ fontSize: '32px', fontFamily: 'var(--font-heading)', margin: 0 }}>{selectedItem.title}</h1>
                  <button 
                    className="btn-secondary" 
                    onClick={() => {
                      setEditingItemType('password');
                      setPwTitle(selectedItem.title);
                      setPwUsername(selectedItem.username);
                      setPwPassword(selectedItem.password);
                      setPwUrl(selectedItem.url || '');
                      setPwNotes(selectedItem.notes || '');
                    }}
                  >
                    ✏️ Edit
                  </button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '24px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-lg)', backgroundColor: 'var(--bg-surface)' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Username</label>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 600, flexWrap: 'wrap', gap: '8px' }}>
                      <span style={{ wordBreak: 'break-all' }}>{selectedItem.username}</span>
                      <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', minWidth: '65px' }} onClick={() => handleCopy(selectedItem.username, 'username')}>{copiedField === 'username' ? 'Copied!' : 'Copy'}</button>
                    </div>
                  </div>
                  <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Password</label>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'var(--font-mono)', flexWrap: 'wrap', gap: '8px' }}>
                      <span style={{ wordBreak: 'break-all' }}>{showPassword ? selectedItem.password : '••••••••••••••••'}</span>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Hide' : 'Show'}</button>
                        <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px', minWidth: '65px' }} onClick={() => handleCopy(selectedItem.password, 'password')}>{copiedField === 'password' ? 'Copied!' : 'Copy'}</button>
                      </div>
                    </div>
                  </div>
                  {selectedItem.url && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Website</label>
                      <div>
                        <a href={selectedItem.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 600 }}>{selectedItem.url}</a>
                      </div>
                    </div>
                  )}
                  {selectedItem.notes && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Notes</label>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', whiteSpace: 'pre-wrap' }}>{selectedItem.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              // Payment Card View With flipping 3D interactive graphics
              <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <h2 style={{ fontFamily: 'var(--font-heading)', margin: 0 }}>Card</h2>
                  <button 
                    className="btn-secondary"
                    onClick={() => {
                      setEditingItemType('card');
                      setCardHolder(selectedItem.cardHolder);
                      setCardNumber(selectedItem.cardNumber);
                      setCardBrand(selectedItem.brand);
                      setCardExpiry(selectedItem.expiry || '');
                      setCardCvv(selectedItem.cvv || '');
                      setCardPin(selectedItem.pin || '');
                      setCardNotes(selectedItem.notes || '');
                    }}
                  >
                    ✏️ Edit
                  </button>
                </div>
                
                {/* 3D Interactive Card Visualizer */}
                <div className="credit-card-wrapper" onClick={() => setIsCardFlipped(!isCardFlipped)}>
                  <div className={`credit-card-visual ${isCardFlipped ? 'flipped' : ''}`}>
                    {/* Front */}
                    <div className="card-face card-face-front">
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div className="card-chip"></div>
                        <span style={{ fontWeight: 800, fontSize: '20px', fontFamily: 'var(--font-heading)', fontStyle: 'italic' }}>
                          {selectedItem.brand}
                        </span>
                      </div>
                      <div className="card-number">
                        {selectedItem.cardNumber.replace(/\s?/g, '').replace(/(\d{4})/g, '$1 ').trim()}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', textTransform: 'uppercase' }}>
                        <div>
                          <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>Card Holder</div>
                          <span style={{ fontWeight: 600 }}>{selectedItem.cardHolder}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '8px', color: 'var(--text-secondary)' }}>Expires</div>
                          <span style={{ fontWeight: 600 }}>{selectedItem.expiry || 'MM/YY'}</span>
                        </div>
                      </div>
                    </div>

                    {/* Back */}
                    <div className="card-face card-face-back">
                      <div style={{ height: '40px', background: '#000', margin: '0 -24px', marginTop: '8px' }}></div>
                      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '10px' }}>
                        <span style={{ fontSize: '9px', textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Authorized Signature</span>
                        <div style={{ background: '#fff', color: '#000', padding: '6px 12px', borderRadius: '4px', fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: '14px', fontStyle: 'italic' }}>
                          {selectedItem.cvv || '***'}
                        </div>
                      </div>
                      <div style={{ fontSize: '8px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
                        This secure card is protected by client-side local Zero-Knowledge cryptography.
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ color: 'var(--text-tertiary)', fontSize: '12px', textAlign: 'center' }}>
                  💡 Click the card to flip it over and inspect the secure CVV signature block.
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '24px', border: '1px solid var(--border)', borderRadius: 'var(--border-radius-lg)', backgroundColor: 'var(--bg-surface)' }}>
                  <div>
                    <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>ATM PIN</label>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontWeight: 600 }}>{showPin ? (selectedItem.pin || 'None') : '••••'}</span>
                      <button className="btn-secondary" style={{ padding: '4px 10px', fontSize: '12px' }} onClick={() => setShowPin(!showPin)}>{showPin ? 'Hide' : 'Show'}</button>
                    </div>
                  </div>
                  {selectedItem.notes && (
                    <div style={{ borderTop: '1px solid var(--border)', paddingTop: '12px' }}>
                      <label style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Secure Notes</label>
                      <p style={{ color: 'var(--text-secondary)', fontSize: '14px', whiteSpace: 'pre-wrap' }}>{selectedItem.notes}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
      )}
    </div>
  );
}
