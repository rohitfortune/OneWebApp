import React, { useState, useEffect } from 'react';

import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider, useMsal } from '@azure/msal-react';

function OneDriveExplorer({ accessToken }: { accessToken: string }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchFiles();
  }, [accessToken]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('https://graph.microsoft.com/v1.0/me/drive/root/children', {
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

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this file permanently from OneDrive?')) return;
    try {
      await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      fetchFiles();
    } catch (e) {
      alert('Delete failed');
    }
  };

  const handleDownload = async (file: any) => {
    const downloadUrl = file['@microsoft.graph.downloadUrl'];
    if (downloadUrl) {
      window.open(downloadUrl, '_blank');
    } else {
      alert('Download URL not found for this file.');
    }
  };

  const handleRename = async (file: any) => {
    const newName = window.prompt('Enter new name:', file.name);
    if (!newName || newName === file.name) return;
    try {
      await fetch(`https://graph.microsoft.com/v1.0/me/drive/items/${file.id}`, {
        method: 'PATCH',
        headers: { 
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name: newName })
      });
      fetchFiles();
    } catch (e) {
      alert('Rename failed');
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);

    try {
      // For files < 4MB we can do a simple PUT. For simplicity, we'll use PUT here.
      await fetch(`https://graph.microsoft.com/v1.0/me/drive/root:/${file.name}:/content`, {
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '10px' }}>
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

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Syncing with Microsoft OneDrive...</div>
      ) : (
        <div className="items-list">
          {files.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>No files found in OneDrive root.</div>
          ) : (
            files.map(f => (
              <div key={f.id} className="item-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: '200px' }}>
                  <span style={{ fontWeight: 600 }}>{f.name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{f.file ? 'File' : 'Folder'}</span>
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button className="btn-secondary" style={{ padding: '6px 10px' }} onClick={() => handleDownload(f)}>⬇️</button>
                  <button className="btn-secondary" style={{ padding: '6px 10px' }} onClick={() => handleRename(f)}>✏️</button>
                  <button className="btn-secondary" style={{ padding: '6px 10px', color: '#ef4444', borderColor: '#fca5a5' }} onClick={() => handleDelete(f.id)}>🗑️</button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function OneDriveAuthWrapper({ onToken }: { onToken: (token: string) => void }) {
  const { instance } = useMsal();

  const handleLogin = async () => {
    try {
      const response = await instance.loginPopup({ scopes: ['Files.ReadWrite.All'] });
      if (response && response.accessToken) {
        onToken(response.accessToken);
      }
    } catch (e) {
      console.error(e);
      alert('Login Failed');
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
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [msalInstance, setMsalInstance] = useState<PublicClientApplication | null>(null);
  const clientId = import.meta.env.VITE_MICROSOFT_CLIENT_ID;

  useEffect(() => {
    const initMsal = async () => {
      if (clientId) {
        const msalConfig = {
          auth: {
            clientId: clientId,
            authority: "https://login.microsoftonline.com/common",
            redirectUri: window.location.origin
          }
        };
        const pca = new PublicClientApplication(msalConfig);
        await pca.initialize();
        setMsalInstance(pca);
      }
    };
    initMsal();
  }, [clientId]);

  if (!clientId || !msalInstance) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>OneDrive Not Configured</h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '500px' }}>
          Please set the <b>VITE_MICROSOFT_CLIENT_ID</b> environment variable to enable the OneDrive Explorer.
        </p>
      </div>
    );
  }

  return (
    <MsalProvider instance={msalInstance}>
      {accessToken ? (
        <OneDriveExplorer accessToken={accessToken} />
      ) : (
        <OneDriveAuthWrapper onToken={setAccessToken} />
      )}
    </MsalProvider>
  );
}
