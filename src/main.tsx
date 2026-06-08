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
  
  // Robust fallback: Manually send the hash to the parent window to ensure MSAL receives it.
  // This bypasses any MSAL internal polling issues or initialization race conditions.
  try {
    const target = isPopup ? window.opener : window.parent;
    if (target && target !== window) {
      const hash = window.location.hash;
      const origin = window.location.origin;
      // MSAL v2 standard string format
      target.postMessage(hash, origin);
      // MSAL v3 object format
      target.postMessage({ type: "msal:popup:response", payload: hash }, origin);
    }
  } catch (e) {
    console.error("Failed to post message to parent:", e);
  }

  // Also initialize MSAL normally as a fallback mechanism
  msalInstance.initialize().then(() => {
    return msalInstance.handleRedirectPromise();
  }).then(() => {
    if (isPopup) window.close();
  }).catch(console.error);
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
