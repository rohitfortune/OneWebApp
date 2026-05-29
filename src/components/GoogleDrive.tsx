import React, { useState, useEffect } from 'react';
import { db } from '../db/db';
import { GoogleOAuthProvider, useGoogleLogin } from '@react-oauth/google';

function GoogleDriveExplorer({ accessToken }: { accessToken: string }) {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchFiles();
  }, [accessToken]);

  const fetchFiles = async () => {
    setLoading(true);
    try {
      const res = await fetch('https://www.googleapis.com/drive/v3/files?fields=files(id,name,mimeType,size,modifiedTime)&q=trashed=false', {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      const data = await res.json();
      if (data.error) {
        alert('API Error: ' + data.error.message);
        return;
      }
      if (data.files) setFiles(data.files);
    } catch (e) {
      console.error(e);
      alert('Failed to fetch Google Drive files');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Delete this file permanently from Google Drive?')) return;
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      fetchFiles();
    } catch (e) {
      alert('Delete failed');
    }
  };

  const handleDownload = async (file: any) => {
    try {
      const res = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
        headers: { Authorization: `Bearer ${accessToken}` }
      });
      if (!res.ok) {
        alert('Download failed. (Google Workspace documents cannot be downloaded directly via alt=media).');
        return;
      }
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.name;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      alert('Download failed.');
    }
  };

  const handleRename = async (file: any) => {
    const newName = window.prompt('Enter new name:', file.name);
    if (!newName || newName === file.name) return;
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}`, {
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
    const metadata = { name: file.name, mimeType: file.type || 'application/octet-stream' };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', file);

    try {
      await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form
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
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>Google Drive Files</h2>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button className="btn-secondary" onClick={fetchFiles}>🔄 Refresh</button>
          <label className="btn-primary" style={{ cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            ☁️ Upload
            <input type="file" style={{ display: 'none' }} onChange={handleUpload} />
          </label>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)' }}>Syncing with Google Drive...</div>
      ) : (
        <div className="items-list">
          {files.length === 0 ? (
            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-tertiary)' }}>No files found in Drive.</div>
          ) : (
            files.map(f => (
              <div key={f.id} className="item-card" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', flexGrow: 1, minWidth: '200px' }}>
                  <span style={{ fontWeight: 600 }}>{f.name}</span>
                  <span style={{ fontSize: '12px', color: 'var(--text-tertiary)' }}>{f.mimeType}</span>
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

function GoogleAuthWrapper({ onToken }: { onToken: (token: string) => void }) {
  const login = useGoogleLogin({
    onSuccess: (codeResponse) => onToken(codeResponse.access_token),
    scope: 'https://www.googleapis.com/auth/drive',
    onError: (error) => alert('Login Failed: ' + error)
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: '20px', padding: '40px' }}>
      <h2 style={{ fontFamily: 'var(--font-heading)', textAlign: 'center' }}>Connect Google Drive</h2>
      <p style={{ color: 'var(--text-secondary)', textAlign: 'center', maxWidth: '400px' }}>
        Authorize access to view, upload, and manage your Google Drive files securely from your workspace.
      </p>
      <button className="btn-primary" onClick={() => login()}>Authenticate with Google</button>
    </div>
  );
}

export default function GoogleDrive() {
  const [clientId, setClientId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const fetchId = async () => {
      const rec = await db.settings.get('google_client_id');
      if (rec?.value) setClientId(rec.value);
    };
    fetchId();
  }, []);

  if (!clientId) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '20px', alignItems: 'center' }}>
        <h2 style={{ fontFamily: 'var(--font-heading)' }}>Google Drive Not Configured</h2>
        <p style={{ color: 'var(--text-secondary)', maxWidth: '500px' }}>
          Please configure your <b>Google OAuth Web Client ID</b> in the Settings menu to enable the Drive Explorer.
        </p>
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId}>
      {accessToken ? (
        <GoogleDriveExplorer accessToken={accessToken} />
      ) : (
        <GoogleAuthWrapper onToken={setAccessToken} />
      )}
    </GoogleOAuthProvider>
  );
}
