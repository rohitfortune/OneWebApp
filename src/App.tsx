import { useState, useEffect } from 'react';
import Notes from './components/Notes';
import Vault from './components/Vault';
import Files from './components/Files';
import Settings from './components/Settings';
import GoogleDrive from './components/GoogleDrive';
import OneDrive from './components/OneDrive';

type ActiveTab = 'notes' | 'vault' | 'files' | 'settings' | 'gdrive' | 'onedrive';

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('notes');
  const [isVaultLocked, setIsVaultLocked] = useState(true);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

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
  const isVaultThemeActive = activeTab === 'vault' && !isVaultLocked;

  const renderActiveScreen = () => {
    switch (activeTab) {
      case 'notes':
        return <Notes />;
      case 'vault':
        return <Vault onVaultLockChange={(locked) => setIsVaultLocked(locked)} />;
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
        return 'Personal Notes & Sketches';
      case 'vault':
        return isVaultLocked ? 'Secure Credentials Vault' : 'Vault';
      case 'files':
        return 'Files';
      case 'settings':
        return 'Suite Settings & Backups';
      case 'gdrive':
        return 'Google Drive Explorer';
      case 'onedrive':
        return 'Microsoft OneDrive';
      default:
        return 'One';
    }
  };

  return (
    <div className="app-container" data-vault-theme={isVaultThemeActive ? 'true' : 'false'}>
      {/* Mobile Menu Overlay */}
      {isMobileMenuOpen && (
        <div className="mobile-menu-overlay" onClick={() => setIsMobileMenuOpen(false)}></div>
      )}
      
      {/* Navigation Sidebar */}
      <aside className={`app-sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="brand-section">
          <div className="brand-logo">1</div>
          <span className="brand-name">One</span>
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
            className={`nav-item ${activeTab === 'vault' ? 'active' : ''}`}
            onClick={() => { setActiveTab('vault'); setIsMobileMenuOpen(false); }}
          >
            <span className="nav-icon">🔒</span>
            <span>Secure Vault</span>
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
          <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', textAlign: 'center' }}>
            One Web v1.0.0 (Offline)
          </div>
        </div>
      </aside>

      {/* Main Content Workspace */}
      <main className="app-content">
        <header className="content-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="header-left" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button className="hamburger-btn" onClick={() => setIsMobileMenuOpen(true)}>
              ☰
            </button>
            <h1 className="header-title">{getScreenTitle()}</h1>
          </div>
          <div id="header-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}></div>
        </header>

        {/* Dynamic Inner Panel */}
        <div className="screen-wrapper">
          {renderActiveScreen()}
        </div>
      </main>
    </div>
  );
}
