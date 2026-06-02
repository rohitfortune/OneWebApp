import { useSyncContext } from '../contexts/SyncContext';

export default function SyncButton() {
  const { runOneDriveSync, isSyncing } = useSyncContext();

  const clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID;

  if (!clientId) return null;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <button 
        className="btn-secondary"
        onClick={() => runOneDriveSync(false)}
        disabled={isSyncing}
        style={{ 
          padding: '8px 16px', 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center',
          gap: '8px',
          opacity: isSyncing ? 0.7 : 1,
          cursor: isSyncing ? 'not-allowed' : 'pointer',
          backgroundColor: isSyncing ? 'var(--bg-surface)' : undefined,
          transition: 'all 0.2s ease',
          minWidth: '100px'
        }}
        title="Sync across devices"
      >
        <svg 
          width="18" 
          height="18" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          strokeWidth="2.5" 
          strokeLinecap="round" 
          strokeLinejoin="round"
          style={{
             animation: isSyncing ? 'spin 1s linear infinite' : 'none',
             transformOrigin: 'center'
          }}
        >
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
        <span style={{ fontWeight: 600 }}>{isSyncing ? 'Syncing...' : 'Sync'}</span>
      </button>

      <style>{`
        @keyframes spin {
          100% { transform: rotate(360deg); }
        }
        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
