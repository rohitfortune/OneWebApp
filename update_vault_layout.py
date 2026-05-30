import sys

with open('src/components/Vault.tsx', 'r') as f:
    content = f.read()

# 1. Update vault-sidebar-container
old_sidebar_container = """      <div className="vault-sidebar-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', overflowY: 'auto', paddingBottom: '20px' }}>"""
new_sidebar_container = """      <div className="vault-sidebar-container" style={{ display: 'flex', flexDirection: 'column', gap: '20px', paddingBottom: '20px', height: '100%', overflow: 'hidden' }}>"""
content = content.replace(old_sidebar_container, new_sidebar_container)

# 2. Extract the controls
controls_start = """        <div style={{ display: 'flex', gap: '10px' }}>
          <button 
            className={`btn-secondary ${activeTab === 'passwords' ? 'btn-primary' : ''}`} """
controls_end_pattern = """            +
          </button>
        </div>"""

import re
controls_match = re.search(r'(        <div style={{ display: \'flex\', gap: \'10px\' }}>\n          <button \n            className=\{`btn-secondary.*?            \+\n          </button>\n        </div>\n)', content, re.DOTALL)

if not controls_match:
    print("Could not find controls to move.")
    sys.exit(1)

controls_text = controls_match.group(1)

# Remove the controls from their original location
content = content.replace(controls_text, "")

# 3. Update items-list
old_items_list = """        <div className="items-list">"""
new_items_list = """        <div className="items-list" style={{ flexGrow: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px', paddingRight: '4px' }}>"""
content = content.replace(old_items_list, new_items_list)

# 4. Insert the controls at the bottom, just before the closing div of vault-sidebar-container
bottom_target = """          {activeTab === 'cards' && filteredCards.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '40px 0' }}>No cards</div>
          )}
        </div>
      </div>"""

new_bottom = f"""          {{activeTab === 'cards' && filteredCards.length === 0 && (
            <div style={{ textAlign: 'center', color: 'var(--text-tertiary)', padding: '40px 0' }}>No cards</div>
          )}}
        </div>

        <div style={{{{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: 'auto', paddingTop: '8px' }}}}>
{controls_text}
        </div>
      </div>"""

content = content.replace(bottom_target, new_bottom)

with open('src/components/Vault.tsx', 'w') as f:
    f.write(content)

print("Vault layout updated.")
