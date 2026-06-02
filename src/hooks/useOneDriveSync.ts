import { useState, useCallback } from 'react';
import { db } from '../db/db';
import { getEncryptionKeyForBackup, encryptPayload, decryptPayload } from '../utils/crypto';
import { useMsal } from '@azure/msal-react';

// Helper to merge collections with ++id primary keys
async function syncIdCollection(localItems: any[], cloudItems: any[], dbTable: any) {
  const cloudMap = new Map<string, any>();
  for (const c of cloudItems) {
    if (c.uuid) cloudMap.set(c.uuid, c);
  }
  
  for (const l of localItems) {
    if (!l.uuid) continue;
    const c = cloudMap.get(l.uuid);
    if (c && c.lastModified > l.lastModified) {
       const merged = { ...c, id: l.id };
       await dbTable.put(merged);
       cloudMap.delete(c.uuid);
    } else if (c) {
       cloudMap.delete(c.uuid);
    }
  }
  
  for (const c of cloudMap.values()) {
     const newRecord = { ...c };
     delete newRecord.id;
     await dbTable.add(newRecord);
  }
  return await dbTable.toArray();
}

// Helper for UUID primary keys
async function syncUuidCollection(localItems: any[], cloudItems: any[], dbTable: any) {
  const cloudMap = new Map<string, any>();
  for (const c of cloudItems) {
    if (c.uuid) cloudMap.set(c.uuid, c);
  }
  
  for (const l of localItems) {
    if (!l.uuid) continue;
    const c = cloudMap.get(l.uuid);
    if (c && c.lastModified > l.lastModified) {
       await dbTable.put(c);
       cloudMap.delete(c.uuid);
    } else if (c) {
       cloudMap.delete(c.uuid);
    }
  }
  
  for (const c of cloudMap.values()) {
     await dbTable.put(c);
  }
  return await dbTable.toArray();
}

// Helper to prune tombstones older than 6 months
async function pruneTombstones(items: any[], dbTable: any, pkField: string) {
  const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const pruned = [];
  
  for (const item of items) {
    if (item.deleted === 1 && (now - item.lastModified > SIX_MONTHS_MS)) {
      const pk = item[pkField];
      if (pk !== undefined) await dbTable.delete(pk);
    } else {
      pruned.push(item);
    }
  }
  return pruned;
}

export function useOneDriveSync() {
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState<string>('');
  const { instance, accounts } = useMsal();

  const acquireToken = async () => {
    if (accounts.length === 0) {
      const res = await instance.loginPopup({ scopes: ['Files.ReadWrite.AppFolder'] });
      return res.accessToken;
    }
    try {
      const res = await instance.acquireTokenSilent({
        scopes: ['Files.ReadWrite.AppFolder'],
        account: accounts[0]
      });
      return res.accessToken;
    } catch (e) {
      console.warn("Silent token acquisition failed, popping up...", e);
      const res = await instance.loginPopup({ scopes: ['Files.ReadWrite.AppFolder'] });
      return res.accessToken;
    }
  };

  const runOneDriveSync = useCallback(async (silent = false) => {
    if (isSyncing) return;
    setIsSyncing(true);
    setSyncStatus('Starting Sync...');

    try {
      const token = await acquireToken();
      const key = await getEncryptionKeyForBackup(silent);
      if (!key) {
        if (!silent) alert('Sync failed: Could not unlock vault encryption key.');
        setIsSyncing(false);
        setSyncStatus('');
        return;
      }

      setSyncStatus('Fetching cloud state...');
      let cloudData: any = { notes: [], passwords: [], cards: [], localFolders: [], fileMetadata: [] };
      try {
        const dbRes = await fetch('https://graph.microsoft.com/v1.0/me/drive/special/approot:/database_sync.enc:/content', {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (dbRes.ok) {
          const encryptedText = await dbRes.text();
          const decryptedText = await decryptPayload(encryptedText, key);
          const backupBundle = JSON.parse(decryptedText);
          if (backupBundle.data) {
            cloudData = backupBundle.data;
          }
          
          // Verify vault salt matches
          const saltRec = await db.settings.get('vault_salt');
          if (saltRec && backupBundle.vault && saltRec.value !== backupBundle.vault.salt) {
             throw new Error("Vault credentials mismatch.");
          }
        }
      } catch (e) {
        console.warn('No valid cloud state found or mismatch, proceeding with local push only.');
      }

      setSyncStatus('Merging State (Merge-On-Sync)...');
      
      const localNotes = await db.notes.toArray();
      const localPasswords = await db.passwords.toArray();
      const localCards = await db.creditCards.toArray();
      const localFolders = await db.localFolders.toArray();
      const localFiles = await db.localFiles.toArray();

      const mergedNotes = await syncIdCollection(localNotes, cloudData.notes || [], db.notes);
      const mergedPasswords = await syncUuidCollection(localPasswords, cloudData.passwords || [], db.passwords);
      const mergedCards = await syncUuidCollection(localCards, cloudData.cards || [], db.creditCards);
      const mergedFolders = await syncIdCollection(localFolders, cloudData.localFolders || [], db.localFolders);
      
      // File metadata merge is special because we don't sync the blobs in the JSON
      const localFileMetadata = localFiles.map(f => ({
        id: f.id,
        uuid: f.uuid,
        folderId: f.folderId,
        displayName: f.displayName,
        mimeType: f.mimeType,
        deleted: f.deleted,
        lastModified: f.lastModified
      }));
      
      const mergedFileMetadata = await syncIdCollection(localFileMetadata, cloudData.fileMetadata || [], db.localFiles);

      setSyncStatus('Pruning old tombstones...');
      const finalNotes = await pruneTombstones(mergedNotes, db.notes, 'id');
      const finalPasswords = await pruneTombstones(mergedPasswords, db.passwords, 'uuid');
      const finalCards = await pruneTombstones(mergedCards, db.creditCards, 'uuid');
      const finalFolders = await pruneTombstones(mergedFolders, db.localFolders, 'id');
      const finalFileMetadata = await pruneTombstones(mergedFileMetadata, db.localFiles, 'id');

      const saltRec = await db.settings.get('vault_salt');
      const verifierRec = await db.settings.get('vault_verifier');
      if (!saltRec || !verifierRec) {
        throw new Error('Vault not initialized');
      }

      setSyncStatus('Uploading merged database...');
      const backupBundle = {
        version: 3,
        createdAt: Date.now(),
        vault: {
          salt: saltRec.value,
          verifier: verifierRec.value,
        },
        data: {
          notes: finalNotes,
          passwords: finalPasswords,
          cards: finalCards,
          localFolders: finalFolders,
          fileMetadata: finalFileMetadata.map((f: any) => ({
            uuid: f.uuid,
            folderId: f.folderId,
            displayName: f.displayName,
            mimeType: f.mimeType,
            deleted: f.deleted,
            lastModified: f.lastModified
          }))
        }
      };

      const dbStr = JSON.stringify(backupBundle);
      const encryptedDb = await encryptPayload(dbStr, key);
      const dbBlob = new Blob([encryptedDb], { type: 'text/plain' });

      await fetch('https://graph.microsoft.com/v1.0/me/drive/special/approot:/database_sync.enc:/content', {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/plain' },
        body: dbBlob
      });

      // Incremental File Sync (Blobs)
      setSyncStatus('Checking file attachments...');
      const listRes = await fetch('https://graph.microsoft.com/v1.0/me/drive/special/approot/children', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const listData = await listRes.json();
      const cloudFiles = listData.value || [];

      setSyncStatus('Syncing File Blobs...');
      const allLocalFiles = await db.localFiles.toArray();
      
      for (const localFile of allLocalFiles) {
        if (!localFile.uuid) continue;
        const cloudFileName = `file_${localFile.uuid}.enc`;
        const existsInCloud = cloudFiles.find((c: any) => c.name === cloudFileName);

        if (localFile.deleted === 1) {
          if (existsInCloud) {
            await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${cloudFileName}`, {
              method: 'DELETE',
              headers: { 'Authorization': `Bearer ${token}` }
            });
          }
          continue;
        }

        // Upload if missing
        if (!existsInCloud && localFile.blob && localFile.blob.size > 0) {
          setSyncStatus(`Uploading ${localFile.displayName}...`);
          const arrayBuffer = await localFile.blob.arrayBuffer();
          const base64Str = btoa(new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
          const encryptedBlobData = await encryptPayload(base64Str, key);
          const uploadBlob = new Blob([encryptedBlobData], { type: 'text/plain' });
          await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${cloudFileName}:/content`, {
            method: 'PUT',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'text/plain' },
            body: uploadBlob
          });
        }
        
        // Download if we have an empty blob (meaning we got the metadata from the cloud pull, but we don't have the binary yet)
        if (existsInCloud && (!localFile.blob || localFile.blob.size === 0)) {
           setSyncStatus(`Downloading ${localFile.displayName}...`);
           try {
             const fRes = await fetch(`https://graph.microsoft.com/v1.0/me/drive/special/approot:/${cloudFileName}:/content`, {
               headers: { 'Authorization': `Bearer ${token}` }
             });
             if (fRes.ok) {
               const encryptedBlobText = await fRes.text();
               const base64Str = await decryptPayload(encryptedBlobText, key);
               const binary = atob(base64Str);
               const array = new Uint8Array(binary.length);
               for (let i = 0; i < binary.length; i++) array[i] = binary.charCodeAt(i);
               const blob = new Blob([array], { type: localFile.mimeType });
               await db.localFiles.update(localFile.id!, { blob });
             }
           } catch (e) {
             console.error('Failed to download file', e);
           }
        }
      }

      setSyncStatus('');
      if (!silent) alert('Sync Complete!');
    } catch (error: any) {
      console.error('Sync failed:', error);
      if (!silent) alert(`Sync failed: ${error.message}`);
      setSyncStatus('');
    } finally {
      setIsSyncing(false);
    }
  }, [isSyncing]);

  const triggerAutoSync = useCallback(() => {
    // Basic debounce logic (3 seconds) to prevent spamming cloud
    if ((window as any)._syncDebounceTimer) {
      clearTimeout((window as any)._syncDebounceTimer);
    }
    (window as any)._syncDebounceTimer = setTimeout(() => {
      runOneDriveSync(true); // silent
    }, 3000);
  }, [runOneDriveSync]);

  const restoreFromOneDrive = useCallback(async () => {
     await runOneDriveSync(false);
  }, [runOneDriveSync]);

  return { isSyncing, syncStatus, runOneDriveSync, restoreFromOneDrive, triggerAutoSync };
}
