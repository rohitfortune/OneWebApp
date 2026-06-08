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
let isMsalPopup = !!window.opener && window.opener !== window;
const hasAuthHash = window.location.hash.includes('code=') || window.location.hash.includes('state=') || window.location.hash.includes('error=');

let decodedState: any = null;

if (hasAuthHash) {
  try {
    const hashContent = window.location.hash.substring(1);
    const params = new URLSearchParams(hashContent);
    const state = params.get("state");
    if (state) {
      const base64State = state.split('|')[0];
      const base64 = base64State.replace(/-/g, '+').replace(/_/g, '/');
      const padded = base64.padEnd(base64.length + (4 - base64.length % 4) % 4, '=');
      decodedState = JSON.parse(atob(padded));
      
      // Crucial for Mobile PWAs: window.opener is often null in custom tabs,
      // but the state meta explicitly tells us it's a popup flow!
      if (decodedState?.meta?.interactionType === "popup") {
        isMsalPopup = true;
      }
    }
  } catch (e) {
    console.error("Failed to decode MSAL state", e);
  }
}

if ((isIframe || isMsalPopup) && hasAuthHash) {
  // Show a success message in case the mobile browser prevents window.close()
  document.getElementById('root')!.innerHTML = `
    <div style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;color:var(--text-primary);background:var(--bg-base);text-align:center;padding:20px;">
      <div style="font-size: 48px; margin-bottom: 16px;">✅</div>
      <h2 style="margin:0 0 8px 0;font-family:var(--font-heading);">Authentication Complete</h2>
      <p style="color:var(--text-secondary);margin:0;">You can now safely close this screen and return to the app.</p>
    </div>
  `;
  
  try {
    const hashContent = window.location.hash.substring(1);
    const id = decodedState?.id || decodedState?.libraryState?.id;
    if (id) {
      const channel = new BroadcastChannel(id);
      channel.postMessage({ v: 1, payload: hashContent });
      channel.close();
    }
  } catch (e) {
    console.error("Failed to broadcast MSAL response", e);
  }
  
  // Attempt to close automatically, though mobile Custom Tabs often ignore this
  setTimeout(() => window.close(), 500);
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
