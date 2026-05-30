import sys

with open('src/App.tsx', 'r') as f:
    content = f.read()

# 1. Update ActiveTab type
content = content.replace(
    "type ActiveTab = 'notes' | 'vault' | 'files' | 'settings' | 'gdrive' | 'onedrive';",
    "type ActiveTab = 'notes' | 'passwords' | 'cards' | 'files' | 'settings' | 'gdrive' | 'onedrive';"
)

# 2. Update isVaultThemeActive
content = content.replace(
    "const isVaultThemeActive = activeTab === 'vault' && !isVaultLocked;",
    "const isVaultThemeActive = (activeTab === 'passwords' || activeTab === 'cards') && !isVaultLocked;"
)

# 3. Update renderActiveScreen
old_render = """      case 'vault':
        return <Vault onVaultLockChange={(locked) => setIsVaultLocked(locked)} />;"""
new_render = """      case 'passwords':
      case 'cards':
        return <Vault activeSubTab={activeTab} onVaultLockChange={(locked) => setIsVaultLocked(locked)} />;"""
content = content.replace(old_render, new_render)

# 4. Update getScreenTitle
old_title = """      case 'vault':
        return isVaultLocked ? 'Secure Credentials Vault' : 'Vault';"""
new_title = """      case 'passwords':
        return isVaultLocked ? 'Secure Passwords Vault' : 'Passwords Vault';
      case 'cards':
        return isVaultLocked ? 'Secure Cards Vault' : 'Cards Vault';"""
content = content.replace(old_title, new_title)

# 5. Update Navigation Menu
old_nav = """          <button 
            className={`nav-item ${activeTab === 'vault' ? 'active' : ''}`}
            onClick={() => { setActiveTab('vault'); setIsMobileMenuOpen(false); }}
          >
            <span className="nav-icon">🔒</span>
            <span>Secure Vault</span>
          </button>"""
new_nav = """          <button 
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
          </button>"""
content = content.replace(old_nav, new_nav)

with open('src/App.tsx', 'w') as f:
    f.write(content)

print("App.tsx tabs updated.")
