/**
 * WebAuthn (Biometrics / Touch ID / Face ID) local verification helpers.
 */

import { generateRandomBytes, arrayBufferToBase64 } from './crypto';

// Check if biometrics (Platform Authenticator) is supported by device/browser
export async function isBiometricsAvailable(): Promise<boolean> {
  if (!window.PublicKeyCredential) return false;
  
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Enrolls device biometrics (Touch ID / Face ID) locally by creating a credential.
 * Returns the Credential ID as a base64 string on success.
 */
export async function enrollLocalBiometrics(username: string): Promise<string> {
  const challenge = generateRandomBytes(32);
  const userId = generateRandomBytes(16);

  const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
    challenge: challenge as any,
    rp: {
      name: 'One Web Suite',
      id: window.location.hostname
    },
    user: {
      id: userId as any,
      name: username,
      displayName: username
    },
    pubKeyCredParams: [
      {
        type: 'public-key',
        alg: -7 // ES256 (ECDSA with SHA-256) - widely supported
      },
      {
        type: 'public-key',
        alg: -257 // RS256 (RSA Signature with SHA-256)
      }
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform', // Enforce on-device Touch ID / Face ID
      userVerification: 'required'
    },
    timeout: 60000,
    attestation: 'none'
  };

  const credential = (await navigator.credentials.create({
    publicKey: publicKeyCredentialCreationOptions
  })) as PublicKeyCredential;

  if (!credential) {
    throw new Error('Biometric enrollment cancelled or failed');
  }

  // Return base64 credential ID to identify this biometric credential in subsequent logins
  return arrayBufferToBase64(credential.rawId);
}

/**
 * Validates biometrics using a previously enrolled Credential ID.
 */
export async function verifyLocalBiometrics(credentialIdBase64: string): Promise<boolean> {
  const challenge = generateRandomBytes(32);
  const rawId = new Uint8Array(challenge.buffer as ArrayBuffer); // simple conversion for challenge

  // Convert Base64 credential ID back to ArrayBuffer
  const binary = atob(credentialIdBase64);
  const credIdBytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    credIdBytes[i] = binary.charCodeAt(i);
  }

  const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
    challenge: rawId as any,
    rpId: window.location.hostname,
    allowCredentials: [
      {
        type: 'public-key',
        id: credIdBytes.buffer as ArrayBuffer
      }
    ],
    userVerification: 'required',
    timeout: 60000
  };

  const assertion = (await navigator.credentials.get({
    publicKey: publicKeyCredentialRequestOptions
  })) as PublicKeyCredential;

  return !!assertion;
}
