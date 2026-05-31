import React, { useState, useEffect, useRef } from 'react';
import { db, type FileRecord } from '../db/db';
import { useMsal } from '@azure/msal-react';

function OneDriveExplorer({ accessToken }: { accessToken: string }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  // Selection Mode State
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);

  // Main View Folder Stack
  const [currentFolderStack, setCurrentFolderStack] = useState<{id: string, name: string}[]>([{id: 'root', name: 'OneDrive Root'}]);

  // Custom Prompts
  type DialogState = {
    title: string;
    message?: string;
    type: 'alert' | 'confirm' | 'prompt' | 'move_picker' | 'share_picker';
    confirmText?: string;
    onConfirm: (val?: any) => void;
  };
  const [dialog, setDialog] = useState<DialogState | null>(null);

  // Move Picker State
  const [movePickerStack, setMovePickerStack] = useState<{id: string, name: string}[]>([{id: 'root', name: 'OneDrive Root'}]);
  const [movePickerFolders, setMovePickerFolders] = useState<any[]>([]);
  const [pickerLoading, setPickerLoading] = useState(false);

  useEffect(() => {
    fetchFiles();
  }, [accessToken, currentFolderStack]);

  const fetchFiles = async () => {
    setLoading(true);
    const currentFolderId = currentFolderStack[currentFolderStack.length - 1].id;
    try {
      const url = currentFolderId === 'root'
        ? 'https://graph.microsoft.com/v1.0/me/drive/root/children?$expand=thumbnails'
        : `https://graph.microsoft.com/v1.0/me/drive/items/${currentFolderId}/children?$expand=thumbnails`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (data.error) {
        alert('API Error: ' + data.error.message);
        return;
      }
      if (data.value) setFiles(data.value);
    } catch (e) {
      console.error(e);
      alert('Failed to fetch OneDrive files');
    } finally {
      setLoading(false);
    }
  };

  const handlePointerDown = (idStr: string) => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = setTimeout(() => {
      if (!selectionMode) {
        setSelectionMode(true);
        setSelectedItemIds(new Set([idStr]));
      } else {
        toggleSelection(idStr);
      }
    }, 500);
  };

  const handlePointerUp = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  };

  const toggleSelection = (idStr: string) => {
    const newSel = new Set(selectedItemIds);
    if (newSel.has(idStr)) newSel.delete(idStr);
    else newSel.add(idStr);
    setSelectedItemIds(newSel);
  };

  const clearSelection = () => {
    setSelectionMode(false);
    setSelectedItemIds(new Set());
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);

    try {
      const currentFolderId = currentFolderStack[currentFolderStack.length - 1].id;
      const url = currentFolderId === 'root'
        ? `https://graph.microsoft.com/v1.0/me/drive/root:/${file.name}:/content`
        : `https://graph.microsoft.com/v1.0/me/drive/items/${currentFolderId}:/${file.name}:/content`;
        
      await fetch(url, {
        method: 'PUT',
        headers: { 
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': file.type || 'application/octet-stream'
        },
        body: file
      });
      fetchFiles();
    } catch (err) {
      alert('Upload failed');
    } finally {
      setLoading(false);
      if (e.target) e.target.value = '';
    }
  };

  const handleDownloadSelected = async () => {
    for (const id of selectedItemIds) {
      const file = files.find(f => f.id === id);
      if (!file) continue;
      const downloadUrl = file['@microsoft.graph.downloadUrl'];
      if (downloadUrl) {
         window.open(downloadUrl, '_blank');
      }
    }
    clearSelection();
  };

  const handleDeleteSelected = () => {
    setDialog({
      title: 'Delete Files',
      message: `Are you sure you want to permanently delete ${selectedItemIds.size} files from OneDrive?`,
      type: 'confirm',
      confirmText: 'Delete',
      onConfirm: async () => {
        for (const id of selectedItemIds) {
          try {
            await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${id}`, {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${accessToken}` }
            });
          } catch (e) {}
        }
        fetchFiles();
        clearSelection();
        setDialog(null);
      }
    });
  };

  const handleRenameSelected = () => {
    if (selectedItemIds.size !== 1) return;
    const id = Array.from(selectedItemIds)[0];
    const file = files.find(f => f.id === id);
    if (!file) return;

    setTimeout(() => {
      setDialog({
        title: 'Rename File',
        type: 'prompt',
        confirmText: 'Rename',
        onConfirm: async (newName: string) => {
          if (newName && newName.trim() && newName !== file.name) {
            try {
              await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${file.id}`, {
                method: 'PATCH',
                headers: { 
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name: newName.trim() })
              });
              fetchFiles();
            } catch (e) {}
          }
          clearSelection();
          setDialog(null);
        }
      });
    }, 50);
  };

  const downloadFileBlob = async (file: any): Promise<Blob | null> => {
    const downloadUrl = file['@microsoft.graph.downloadUrl'];
    if (!downloadUrl) return null;
    try {
      const res = await fetch(downloadUrl);
      if (!res.ok) return null;
      return await res.blob();
    } catch { return null; }
  };

  const handleMakeOffline = async () => {
    for (const id of selectedItemIds) {
      const file = files.find(f => f.id === id);
      if (!file) continue;
      const blob = await downloadFileBlob(file);
      if (blob) {
        const record: FileRecord = {
          displayName: file.name,
          mimeType: file.file?.mimeType || 'application/octet-stream',
          blob: blob,
          lastModified: Date.now()
        };
        await db.localFiles.add(record);
      }
    }
    alert('Files successfully downloaded to your local offline vault!');
    clearSelection();
  };

  const handleShareSelected = () => {
    setDialog({
      title: 'Share Files',
      message: 'How would you like to share these files?',
      type: 'share_picker',
      onConfirm: async (method: 'link' | 'file') => {
        setDialog(null);
        if (method === 'link') {
          const id = Array.from(selectedItemIds)[0];
          const file = files.find(f => f.id === id);
          if (file) {
            try {
              const res = await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${id}/createLink`, {
                method: 'POST',
                headers: { 
                  Authorization: `Bearer ${accessToken}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ type: 'view', scope: 'anonymous' })
              });
              const data = await res.json();
              if (data.link?.webUrl) {
                await navigator.share({ title: file.name, url: data.link.webUrl });
              } else {
                alert('Could not generate sharing link');
              }
            } catch (e) {}
          }
        } else {
          const fileObjects: File[] = [];
          for (const id of selectedItemIds) {
            const file = files.find(f => f.id === id);
            if (!file) continue;
            const blob = await downloadFileBlob(file);
            if (blob) fileObjects.push(new File([blob], file.name, { type: file.file?.mimeType || 'application/octet-stream' }));
          }
          if (fileObjects.length > 0 && navigator.canShare && navigator.canShare({ files: fileObjects })) {
            try { await navigator.share({ title: 'Shared Files', files: fileObjects }); } catch (e) {}
          } else {
            alert('Your browser does not support sharing actual files.');
          }
        }
        clearSelection();
      }
    });
  };

  const loadMovePickerFolders = async (folderId: string) => {
    setPickerLoading(true);
    try {
      const url = folderId === 'root' 
        ? 'https://graph.microsoft.com/v1.0/me/drive/root/children?$filter=folder ne null&$select=id,name'
        : `https://graph.microsoft.com/v1.0/me/drive/items/${folderId}/children?$filter=folder ne null&$select=id,name`;
        
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      setMovePickerFolders(data.value || []);
    } catch (e) {
      console.error(e);
    } finally {
      setPickerLoading(false);
    }
  };

  const openMovePicker = () => {
    setMovePickerStack([{id: 'root', name: 'OneDrive Root'}]);
    loadMovePickerFolders('root');
    setDialog({
      title: 'Move To...',
      type: 'move_picker',
      onConfirm: async (targetFolderId: string) => {
        for (const id of selectedItemIds) {
          const file = files.find(f => f.id === id);
          if (!file) continue;
          try {
            await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${id}`, {
              method: 'PATCH',
              headers: { 
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                parentReference: { id: targetFolderId }
              })
            });
          } catch (e) {}
        }
        fetchFiles();
        clearSelection();
        setDialog(null);
      }
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px', flexGrow: 1, overflowY: 'auto', paddingBottom: selectionMode ? '140px' : '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
          <h2 style={{ fontFamily: 'var(--font-heading)' }}>OneDrive Files</h2>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button className="btn-secondary" onClick={fetchFiles}>🔄 Refresh</button>
            <label className="btn-primary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
              ☁️ Upload
              <input type="file" style={{ display: 'none' }} onChange={handleUpload} />
            </label>
          </div>
        </div>

        <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', paddingBottom: '10px' }}>
          {currentFolderStack.map((level, i) => (
            <button 
              key={level.id}
              onClick={() => {
                const newStack = currentFolderStack.slice(0, i + 1);
                setCurrentFolderStack(newStack);
                clearSelection();
              }}
              style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap' }}
            >
              {level.name} {i < currentFolderStack.length - 1 ? ' > ' : ''}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Syncing with Microsoft OneDrive...</div>
        ) : (
          <div className="items-list">
            {files.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>No files found in this folder.</div>
            ) : (
              files.map(f => {
                const isSelected = selectedItemIds.has(f.id);
                return (
                  <div 
                    key={f.id} 
                    className="item-card" 
                    style={{ 
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px',
                      border: isSelected ? '2px solid var(--accent)' : '1px solid var(--border)',
                      backgroundColor: isSelected ? 'var(--accent-soft)' : 'var(--bg-base)',
                      cursor: 'pointer'
                    }}
                    onPointerDown={(e) => { if (e.button !== 2) handlePointerDown(f.id); }}
                    onPointerUp={handlePointerUp}
                    onPointerLeave={handlePointerUp}
                    onClick={() => {
                      if (selectionMode) {
                        toggleSelection(f.id);
                      } else if (f.folder) {
                        setCurrentFolderStack([...currentFolderStack, { id: f.id, name: f.name }]);
                        clearSelection();
                      }
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '36px', height: '36px', flexShrink: 0 }}>
                      {f.thumbnails && f.thumbnails[0] && f.thumbnails[0].small ? (
                        <img src={f.thumbnails[0].small.url} alt="thumbnail" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '4px' }} />
                      ) : (
                        <span style={{ fontSize: '24px' }}>{f.folder ? '📁' : '📄'}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: 0 }}>
                      <span style={{ 
                        fontWeight: 600, 
                        color: f.folder ? 'var(--accent)' : 'var(--text-primary)',
                        whiteSpace: isSelected ? 'normal' : 'nowrap',
                        overflow: isSelected ? 'visible' : 'hidden',
                        textOverflow: isSelected ? 'clip' : 'ellipsis',
                        wordBreak: 'break-word'
                      }}>
                        {f.name}
                      </span>
                      <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>
                        {f.lastModifiedDateTime ? new Date(f.lastModifiedDateTime).toLocaleDateString() : (f.file ? 'File' : 'Folder')}
                      </span>
                    </div>
                    {selectionMode && (
                      <span style={{ fontSize: '20px', marginLeft: '10px', flexShrink: 0 }}>
                        {isSelected ? '☑️' : '◻️'}
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {selectionMode && (() => {
        const hasFolderSelected = Array.from(selectedItemIds).some(id => {
          const f = files.find(f => f.id === id);
          return f && f.folder !== undefined;
        });
        return (
        <div style={{
          position: 'sticky', bottom: 0, marginTop: 'auto',
          backgroundColor: 'var(--bg-surface)', padding: '16px', 
          boxShadow: '0 -4px 16px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', zIndex: 100, borderTop: '1px solid var(--border)',
          width: '100%'
        }}>
          <span style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: '14px' }}>{selectedItemIds.size} Items Selected</span>
          <div style={{ display: 'flex', gap: '8px', width: '100%', overflowX: 'auto', paddingBottom: '4px' }}>
            {selectedItemIds.size === 1 && (
              <button className="btn-secondary" style={{ flex: '0 0 auto', padding: '10px 14px', fontSize: '13px' }} onClick={handleRenameSelected}>✏️ Rename</button>
            )}
            {!hasFolderSelected && (
              <>
                <button className="btn-secondary" style={{ flex: '0 0 auto', padding: '10px 14px', fontSize: '13px' }} onClick={handleDownloadSelected}>⬇️ Download</button>
                <button className="btn-primary" style={{ flex: '0 0 auto', padding: '10px 14px', fontSize: '13px' }} onClick={handleShareSelected}>🔗 Share</button>
                <button className="btn-primary" style={{ flex: '0 0 auto', padding: '10px 14px', fontSize: '13px' }} onClick={handleMakeOffline}>💾 Make Offline</button>
              </>
            )}
            <button className="btn-secondary" style={{ flex: '0 0 auto', padding: '10px 14px', fontSize: '13px' }} onClick={openMovePicker}>➡️ Move</button>
            <button className="btn-secondary" style={{ flex: '0 0 auto', padding: '10px 14px', fontSize: '13px', color: '#ff4444' }} onClick={handleDeleteSelected}>🗑️ Delete</button>
            <button className="btn-secondary" style={{ flex: '0 0 auto', padding: '10px 14px', fontSize: '13px' }} onClick={clearSelection}>Cancel</button>
          </div>
        </div>
        );
      })()}

      {dialog && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0, 0, 0, 0.5)', zIndex: 1000,
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          backdropFilter: 'blur(4px)'
        }}>
          <div style={{
            backgroundColor: 'var(--bg-surface)', padding: '24px', borderRadius: '16px',
            width: '100%', maxWidth: '400px', boxShadow: '0 16px 40px rgba(0,0,0,0.5)',
            display: 'flex', flexDirection: 'column', gap: '16px', border: '1px solid var(--border)'
          }}>
            <h3 style={{ margin: 0, fontSize: '18px', color: 'var(--text-primary)' }}>{dialog.title}</h3>
            {dialog.message && (
              <p style={{ margin: 0, fontSize: '15px', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {dialog.message}
              </p>
            )}
            
            {dialog.type === 'prompt' && (
              <input 
                type="text" 
                autoFocus 
                placeholder="New name..."
                id="dialog-prompt-input"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    const val = (e.target as HTMLInputElement).value;
                    dialog.onConfirm(val);
                  }
                }}
                style={{
                  padding: '10px 14px', borderRadius: '8px', border: '1px solid var(--border)',
                  backgroundColor: 'var(--bg-default)', color: 'var(--text-primary)',
                  fontSize: '15px'
                }}
              />
            )}
            
            {dialog.type === 'share_picker' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <button className="btn-primary" onClick={() => dialog.onConfirm('link')}>🔗 Share Web Link</button>
                <button className="btn-primary" onClick={() => dialog.onConfirm('file')}>📁 Download & Share Actual File</button>
              </div>
            )}
            
            {dialog.type === 'move_picker' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxHeight: '400px' }}>
                <div style={{ display: 'flex', gap: '4px', overflowX: 'auto', padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                  {movePickerStack.map((level, i) => (
                    <button 
                      key={level.id}
                      onClick={() => {
                        const newStack = movePickerStack.slice(0, i + 1);
                        setMovePickerStack(newStack);
                        loadMovePickerFolders(level.id);
                      }}
                      style={{ background: 'none', border: 'none', color: 'var(--accent)', cursor: 'pointer', fontWeight: 600, fontSize: '14px', whiteSpace: 'nowrap' }}
                    >
                      {level.name} {i < movePickerStack.length - 1 ? ' > ' : ''}
                    </button>
                  ))}
                </div>
                
                <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', padding: '4px 0', flexGrow: 1, minHeight: '150px' }}>
                  {pickerLoading ? (
                    <span style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '20px' }}>Loading folders...</span>
                  ) : movePickerFolders.length === 0 ? (
                    <span style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '20px' }}>No folders here</span>
                  ) : (
                    movePickerFolders.map(f => (
                      <button 
                        key={f.id}
                        style={{ padding: '12px', background: 'var(--bg-base)', border: '1px solid var(--border)', borderRadius: '8px', cursor: 'pointer', textAlign: 'left', color: 'var(--text-primary)', display: 'flex', justifyContent: 'space-between' }}
                        onClick={() => {
                          setMovePickerStack([...movePickerStack, {id: f.id, name: f.name}]);
                          loadMovePickerFolders(f.id);
                        }}
                      >
                        <span>📁 {f.name}</span>
                        <span style={{ color: 'var(--accent)', fontSize: '12px' }}>Open ➡️</span>
                      </button>
                    ))
                  )}
                </div>
                
                <button className="btn-primary" style={{ marginTop: '10px' }} onClick={() => dialog.onConfirm(movePickerStack[movePickerStack.length - 1].id)}>
                  Move to Current Folder
                </button>
              </div>
            )}
            
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px', marginTop: '8px' }}>
              {dialog.type !== 'alert' && (
                <button className="btn-secondary" onClick={() => setDialog(null)}>Cancel</button>
              )}
              {(dialog.type === 'confirm' || dialog.type === 'prompt') && (
                <button 
                  className="btn-primary" 
                  style={dialog.confirmText === 'Delete' ? { backgroundColor: '#ff4444' } : {}}
                  onClick={() => {
                    if (dialog.type === 'prompt') {
                      const input = document.getElementById('dialog-prompt-input') as HTMLInputElement;
                      dialog.onConfirm(input?.value);
                    } else {
                      dialog.onConfirm();
                    }
                  }}
                >
                  {dialog.confirmText || 'OK'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function OneDriveAuthWrapper({ onToken }: { onToken: (token: string) => void }) {
  const { instance, accounts } = useMsal();

  useEffect(() => {
    // If we already have an active account session, silently acquire token
    if (accounts.length > 0) {
      instance.acquireTokenSilent({
        scopes: ['Files.ReadWrite.All'],
        account: accounts[0]
      }).then((response) => {
        if (response && response.accessToken) onToken(response.accessToken);
      }).catch(e => console.error(e));
    }
  }, [instance, accounts, onToken]);

  const handleLogin = async () => {
    try {
      await instance.loginRedirect({ scopes: ['Files.ReadWrite.All'] });
    } catch (e: any) {
      console.error(e);
      alert('Login Failed: ' + (e?.message || 'Unknown error'));
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '20px', padding: '40px' }}>
      <h2 style={{ fontFamily: 'var(--font-heading)', textAlign: 'center' }}>Connect Microsoft OneDrive</h2>
      <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '400px' }}>
        Authorize access to view, upload, and manage your OneDrive files securely from your workspace.
      </p>
      <button className="btn-primary" onClick={handleLogin}>Authenticate with Microsoft</button>
    </div>
  );
}

export default function OneDrive() {
  const clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID;

  if (!clientId) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>Microsoft OneDrive Not Configured</h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '500px' }}>
          Please set the <b>VITE_MICROSOFT_CLIENT_ID</b> environment variable to enable the OneDrive Explorer.
        </p>
      </div>
    );
  }

  return <OneDriveInner />;
}

function OneDriveInner() {
  const [accessToken, setAccessToken] = useState<string | null>(null);
  
  return accessToken ? (
    <OneDriveExplorer accessToken={accessToken} />
  ) : (
    <OneDriveAuthWrapper onToken={setAccessToken} />
  );
}
