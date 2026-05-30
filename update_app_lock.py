import sys

with open('src/App.tsx', 'r') as f:
    content = f.read()

imports_to_add = """import { db } from './db/db';
import { deriveMasterKey, decryptPayload, base64ToArrayBuffer } from './utils/crypto';
import { verifyLocalBiometrics } from './utils/biometrics';
"""

# 1. Add imports after existing imports
if "import { db }" not in content:
    content = content.replace(
        "import OneDrive from './components/OneDrive';",
        "import OneDrive from './components/OneDrive';\n" + imports_to_add
    )

# 2. Add state inside App component
state_insertion_point = "  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);"
state_to_add = """
  const [appLockEnabled, setAppLockEnabled] = useState(false);
  const [isAppLocked, setIsAppLocked] = useState(false);
  const [globalLockPassword, setGlobalLockPassword] = useState('');
"""

if "const [appLockEnabled" not in content:
    content = content.replace(state_insertion_point, state_insertion_point + state_to_add)

# 3. Add useEffects and unlock logic
logic_insertion_point = "  // Initialize theme from localStorage on mount"
logic_to_add = """
  useEffect(() => {
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
    if (!appLockEnabled) return;

    let hiddenTime: number | null = null;

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        hiddenTime = Date.now();
      } else if (document.visibilityState === 'visible') {
        if (hiddenTime && Date.now() - hiddenTime > 60000) {
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

"""

if "const checkAppLock = async ()" not in content:
    content = content.replace(logic_insertion_point, logic_to_add + "  // Initialize theme from localStorage on mount")

# 4. Add Global Lock UI intercept
ui_insertion_point = "  return (\n    <div className=\"app-container\""
ui_to_add = """  if (isAppLocked) {
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

"""

if "if (isAppLocked) {" not in content:
    content = content.replace(ui_insertion_point, ui_to_add + ui_insertion_point)

with open('src/App.tsx', 'w') as f:
    f.write(content)

print("App.tsx global lock injected.")
