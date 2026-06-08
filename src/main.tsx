import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { PublicClientApplication } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';

import { SyncProvider } from './contexts/SyncContext.tsx';

const msalConfig = {
  auth: {
    clientId: import.meta.env.VITE_MICROSOFT_CLIENT_ID || '',
    authority: 'https://login.microsoftonline.com/common',
    redirectUri: window.location.origin + '/OneWebApp/'
  },
  cache: { cacheLocation: 'localStorage', storeAuthStateInCookie: false }
};

const msalInstance = new PublicClientApplication(msalConfig);

const isIframe = window !== window.parent;
const isPopup = window.opener && window.opener !== window;
const hasAuthHash = window.location.hash.includes('code=') || window.location.hash.includes('state=') || window.location.hash.includes('error=');

if ((isIframe || isPopup) && hasAuthHash) {
  document.getElementById('root')!.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;color:#888;">Completing authentication...</div>';
  
  // MSAL v3 relies on BroadcastChannel for popup communication. However, initializing MSAL
  // in the popup when cacheLocation is localStorage clears the parent's transaction cache,
  // causing a timeout. We manually replicate MSAL's BroadcastChannel message to fix this safely.
  try {
    const hashContent = window.location.hash.substring(1);
    const params = new URLSearchParams(hashContent);
    const state = params.get("state");
    if (state) {
      // Decode Base64URL MSAL state (handle optional user state separated by |)
      const base64State = state.split('|')[0];
      const base64 = base64State.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
      
      const decodedState = JSON.parse(atob(padded));
      // MSAL state JSON usually has the ID at the root, or nested under libraryState
      const id = decodedState.id || decodedState.libraryState?.id;
      if (id) {
        const channel = new BroadcastChannel(id);
        channel.postMessage({ v: 1, payload: hashContent });
        channel.close();
      }
    }
  } catch (e) {
    console.error("Failed to broadcast MSAL response", e);
  }
} else {
  msalInstance.initialize().then(() => {
    msalInstance.handleRedirectPromise().then(() => {
    createRoot(document.getElementById('root')!).render(
      <StrictMode>
        <MsalProvider instance={msalInstance}>
          <SyncProvider>
            <App />
          </SyncProvider>
        </MsalProvider>
      </StrictMode>,
    )
  }).catch(e => {
    console.error("MSAL redirect error", e);
  });
});
}
