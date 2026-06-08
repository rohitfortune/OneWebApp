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
  // If we are in a popup or iframe returning from MSAL authentication,
  // we must initialize MSAL and let it process the hash to send a postMessage 
  // back to the parent window. We DO NOT render the React app here to prevent 
  // MsalProvider from trying to process the same hash and causing a race condition.
  document.getElementById('root')!.innerHTML = '<div style="display:flex;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;color:#888;">Completing authentication...</div>';
  
  msalInstance.initialize().then(() => {
    msalInstance.handleRedirectPromise().catch(console.error);
  });
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
