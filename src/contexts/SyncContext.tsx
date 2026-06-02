import { createContext, useContext, type ReactNode } from 'react';
import { useOneDriveSync } from '../hooks/useOneDriveSync';

interface SyncContextType {
  runOneDriveSync: (silent?: boolean) => Promise<void>;
  restoreFromOneDrive: () => Promise<void>;
  triggerAutoSync: () => void;
  isSyncing: boolean;
  syncStatus: string;
}

const SyncContext = createContext<SyncContextType | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const sync = useOneDriveSync();
  return (
    <SyncContext.Provider value={sync}>
      {children}
    </SyncContext.Provider>
  );
}

export function useSyncContext() {
  const context = useContext(SyncContext);
  if (!context) {
    throw new Error('useSyncContext must be used within a SyncProvider');
  }
  return context;
}
