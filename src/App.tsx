import { useState, useEffect } from 'react';
import Notes from './components/Notes';
import Vault from './components/Vault';
import Files from './components/Files';
import Settings from './components/Settings';
import GoogleDrive from './components/GoogleDrive';
import OneDrive from './components/OneDrive';
import SyncButton from './components/SyncButton';
import logoImg from './assets/logo.png';
import { db } from './db/db';
import { deriveMasterKey, decryptPayload, base64ToArrayBuffer } from './utils/crypto';
import { verifyLocalBiometrics } from './utils/biometrics';
import { triggerHapticLight } from './utils/haptics';
import { useSyncContext } from './contexts/SyncContext';


type ActiveTab = 'notes' | 'passwords' | 'cards' | 'files' | 'settings' | 'gdrive' | 'onedrive';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('notes');
  const [isVaultLocked, setIsVaultLocked] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [isAppLocked, setIsAppLocked] = useState(false);
  const [globalLockPassword, setGlobalLockPassword] = useState('');
  const [isPrivacyScreenActive, setIsPrivacyScreenActive] = useState(false);

  const { triggerAutoSync } = useSyncContext();

  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const isClickable = target.closest('button') || target.closest('a') || target.closest('.item-card') || target.closest('input[type="checkbox"]') || target.closest('.mobile-menu-item');
      if (isClickable) {
        triggerHapticLight();
      }
    };
    
    const handleDbChange = () => {
      triggerAutoSync();
    };

    document.addEventListener('click', handleGlobalClick, true);
    window.addEventListener('one-vault-updated', handleDbChange);
    
    return () => {
      document.removeEventListener('click', handleGlobalClick, true);
      window.removeEventListener('one-vault-updated', handleDbChange);
    };
  }, [triggerAutoSync]);  useEffect(() => {
    const checkAppLock = async () => {
      const lockSetting = await db.settings.get('app_level_lock');
      const hasPwd = await db.settings.get('vault_salt');
      if (lockSetting?.value === 'true' && hasPwd) {
        setAppLockEnabled(true);
        // By default, lock it on fresh startup
        setIsAppLocked(true);
      }
    };
    checkAppLock();
  }, []);

  useEffect(() => {
    // Implement PWA Privacy Screen for Web (Native apps already use the Capacitor plugin)
    const isNative = (window as any).Capacitor?.isNativePlatform?.();
    
    let hiddenTime: number | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTime = Date.now();
        if (!isNative) setIsPrivacyScreenActive(true);
      } else if (document.visibilityState === 'visible') {
        if (!isNative) setIsPrivacyScreenActive(false);
        if (appLockEnabled && hiddenTime && Date.now() - hiddenTime > 60000) {
          setIsAppLocked(true);
          setIsVaultLocked(true);
        }
        hiddenTime = null;
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [appLockEnabled]);

  const handleGlobalUnlock = async () => {
    if (!globalLockPassword) return;
    try {
      const saltRec = await db.settings.get('vault_salt');
      const verifierRec = await db.settings.get('vault_verifier');
      if (!saltRec || !verifierRec) return;

      const salt = new Uint8Array(base64ToArrayBuffer(saltRec.value));
      const key = await deriveMasterKey(globalLockPassword, salt);
      const dec = await decryptPayload(verifierRec.value, key);

      if (dec === 'VALID_VAULT_KEY') {
        setIsAppLocked(false);
        setGlobalLockPassword('');
      } else {
        alert('Incorrect Master Password');
      }
    } catch (e) {
      alert('Incorrect Master Password');
    }
  };

  const handleGlobalBiometricUnlock = async () => {
    try {
      const cred = await db.settings.get('vault_biometric_credential');
      if (!cred) {
        alert('Biometrics not enrolled for this vault.');
        return;
      }
      const success = await verifyLocalBiometrics(cred.value);
      if (success) {
        setIsAppLocked(false);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Initialize theme from localStorage on mount
  useEffect(() => {
    const savedTheme = localStorage.getItem('app-theme') || 'system';
    if (savedTheme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }
  }, []);

  // Determine whether to shift accent colors to Indigo Vault Mode
  const isVaultThemeActive = (activeTab === 'passwords' || activeTab === 'cards') && !isVaultLocked;

  const renderActiveScreen = () => {
    switch (activeTab) {
      case 'notes':
        return <Notes />;
      case 'passwords':
      case 'cards':
        return <Vault key={activeTab} activeSubTab={activeTab} onVaultLockChange={(locked) => setIsVaultLocked(locked)} />;
      case 'files':
        return <Files />;
      case 'settings':
        return <Settings />;
      case 'gdrive':
        return <GoogleDrive />;
      case 'onedrive':
        return <OneDrive />;
      default:
        return <Notes />;
    }
  };

  const getScreenTitle = () => {
    switch (activeTab) {
      case 'notes':
        return 'Notes';
      case 'passwords':
        return 'Passwords';
      case 'cards':
        return 'Cards';
      case 'files':
        return 'Files';
      case 'settings':
        return 'Suite Settings & Backups';
      case 'gdrive':
        return 'Google Drive Explorer';
      case 'onedrive':
        return 'Microsoft OneDrive';
      default:
        return 'One Web';
    }
  };

  if (isAppLocked) {
    return (
      <div className="app-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100dvh', backgroundColor: 'var(--bg-base)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px', padding: '40px', backgroundColor: 'var(--bg-surface)', borderRadius: 'var(--border-radius-lg)', border: '1px solid var(--border)', maxWidth: '400px', width: '100%', textAlign: 'center', boxShadow: 'var(--shadow-lg)' }}>
          <div style={{ fontSize: '48px' }}>🛡️</div>
          <h2 style={{ fontFamily: 'var(--font-heading)', margin: 0 }}>App Locked</h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '14px', margin: 0 }}>
            App level lock is enabled. Please enter your Master Password or use Biometrics to continue.
          </p>
          <input 
            type="password" 
            placeholder="Master Password" 
            value={globalLockPassword}
            onChange={(e) => setGlobalLockPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleGlobalUnlock()}
            style={{ padding: '14px', borderRadius: 'var(--border-radius-md)', border: '1px solid var(--border)', backgroundColor: 'var(--bg-base)', width: '100%', boxSizing: 'border-box' }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <button className="btn-primary" onClick={handleGlobalUnlock} style={{ padding: '14px' }}>Unlock App</button>
            <button className="btn-secondary" onClick={handleGlobalBiometricUnlock} style={{ padding: '14px' }}>FaceID / TouchID</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container" data-vault-theme={isVaultThemeActive ? 'true' : 'false'}>
      {/* PWA Privacy Screen Overlay (Obscures recent apps view) */}
      {isPrivacyScreenActive && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'var(--bg-base)', zIndex: 9999999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div style={{ fontSize: '80px', animation: 'pulse 2s infinite' }}>🛡️</div>
        </div>
      )}

      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}
      
      {/* Navigation Sidebar */}
      <aside className={`app-sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="brand-section">
          <img src={logoImg} alt="One Logo" className="brand-logo-img" />
          <span className="brand-name">One Web</span>
        </div>

        <nav className="navigation-menu">
          <button 
            className={`nav-item ${activeTab === 'notes' ? 'active' : ''}`}
            onClick={() => { setActiveTab('notes'); setIsMobileMenuOpen(false); }}
          >
            <span className="nav-icon">📝</span>
            <span>Notes</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'passwords' ? 'active' : ''}`}
            onClick={() => { setActiveTab('passwords'); setIsMobileMenuOpen(false); }}
          >
            <span className="nav-icon">🔑</span>
            <span>Passwords</span>
          </button>
          
          <button 
            className={`nav-item ${activeTab === 'cards' ? 'active' : ''}`}
            onClick={() => { setActiveTab('cards'); setIsMobileMenuOpen(false); }}
          >
            <span className="nav-icon">💳</span>
            <span>Cards</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'files' ? 'active' : ''}`}
            onClick={() => { setActiveTab('files'); setIsMobileMenuOpen(false); }}
          >
            <span className="nav-icon">📂</span>
            <span>Files</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'gdrive' ? 'active' : ''}`}
            onClick={() => { setActiveTab('gdrive'); setIsMobileMenuOpen(false); }}
          >
            <span className="nav-icon">☁️</span>
            <span>Google Drive</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'onedrive' ? 'active' : ''}`}
            onClick={() => { setActiveTab('onedrive'); setIsMobileMenuOpen(false); }}
          >
            <span className="nav-icon">☁️</span>
            <span>OneDrive</span>
          </button>

          <button 
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
            onClick={() => { setActiveTab('settings'); setIsMobileMenuOpen(false); }}
          >
            <span className="nav-icon">⚙️</span>
            <span>Settings</span>
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className="sync-pill synced">
            <span>🟢</span> Synced Locally
          </div>
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <span>One Web v1.0.0 (Offline)</span>
            <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none', fontWeight: 500 }}>One Web Privacy Policy</a>
          </div>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <main className="app-content">
        <header className="content-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
          <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '16px', flex: 1, minWidth: 0 }}>
            <button className="hamburger-btn" onClick={() => setIsMobileMenuOpen(true)} style={{ flexShrink: 0 }}>
              ☰
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flex: 1, minWidth: 0 }}>
              <h1 className="header-title" style={{ margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, minWidth: 0 }}>{getScreenTitle()}</h1>
              <div id="header-actions" style={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}></div>
            </div>
          </div>
          <div className="header-right" style={{ display: 'flex', alignItems: 'center', gap: '12px', paddingRight: '16px', flexShrink: 0 }}>
            {activeTab !== 'gdrive' && activeTab !== 'onedrive' && <SyncButton />}
          </div>
        </header>

        {/* Dynamic Inner Panel */}
        <div className="screen-wrapper">
          {renderActiveScreen()}
        </div>
      </main>
    </div>
  );
}
