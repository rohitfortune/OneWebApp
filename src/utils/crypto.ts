/**
 * Zero-Knowledge Cryptography helpers using the native Web Cryptography API.
 */
import { db } from '../db/db';
import { globalAlert, globalPrompt } from './dialogs';

// Helper: Convert string to Uint8Array
export function stringToBytes(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

// Helper: Convert Uint8Array to string
export function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

// Helper: Convert ArrayBuffer to Base64
export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// Helper: Convert Base64 to ArrayBuffer
export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer as ArrayBuffer;
}

// Helper: Generate a random salt/IV
export function generateRandomBytes(length: number): Uint8Array {
  const array = new Uint8Array(length);
  window.crypto.getRandomValues(array);
  return array;
}

/**
 * Derives an AES-256 encryption key from a master password and salt using PBKDF2.
 */
export async function deriveMasterKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await window.crypto.subtle.importKey(
    'raw',
    stringToBytes(password) as any,
    'PBKDF2',
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as any,
      iterations: 100000,
      hash: 'SHA-256'
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    true, // key is exportable (needed for biometrics unlock session storage)
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts cleartext data using an AES-GCM derived key.
 * Returns a Base64-encoded string containing both IV and ciphertext.
 */
export async function encryptPayload(plainText: string, key: CryptoKey): Promise<string> {
  const iv = generateRandomBytes(12); // Standard GCM IV length is 12 bytes
  const encryptedBuffer = await window.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: iv as any
    },
    key,
    stringToBytes(plainText) as any
  );

  // Store structure: 4 bytes IV length | IV bytes | CipherBytes
  const payload = new Uint8Array(4 + iv.length + encryptedBuffer.byteLength);
  const view = new DataView(payload.buffer as ArrayBuffer);
  
  view.setInt32(0, iv.length);
  payload.set(iv, 4);
  payload.set(new Uint8Array(encryptedBuffer), 4 + iv.length);

  return arrayBufferToBase64(payload.buffer as ArrayBuffer);
}

/**
 * Decrypts a Base64-encoded encrypted payload using an AES-GCM derived key.
 */
export async function decryptPayload(encryptedBase64: string, key: CryptoKey): Promise<string> {
  const payloadBuffer = base64ToArrayBuffer(encryptedBase64);
  const payload = new Uint8Array(payloadBuffer);
  const view = new DataView(payloadBuffer);
  
  const ivLength = view.getInt32(0);
  if (ivLength < 12 || ivLength > 16) {
    throw new Error('Invalid initialization vector length');
  }

  const iv = payload.subarray(4, 4 + ivLength);
  const cipherBytes = payload.subarray(4 + ivLength);

  const decryptedBuffer = await window.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv
    },
    key,
    cipherBytes
  );

  return bytesToString(new Uint8Array(decryptedBuffer));
}

/**
 * Global helper to retrieve the vault encryption key, prompting for biometric or password auth if needed.
 */
export async function getEncryptionKeyForBackup(silent: boolean = false): Promise<CryptoKey | null> {
  const saltRec = await db.settings.get('vault_salt');
  const verifierRec = await db.settings.get('vault_verifier');
  
  if (!saltRec || !verifierRec) return null;

  // 1. If we have the session key in memory, use it directly! No need to ask for password again.
  const storedKey = sessionStorage.getItem('vault_unlocked_session_key');
  if (storedKey) {
    try {
      const decoded = new Uint8Array(base64ToArrayBuffer(storedKey));
      return await window.crypto.subtle.importKey(
        'raw',
        decoded,
        'AES-GCM',
        false,
        ['encrypt', 'decrypt']
      );
    } catch (e) {
      console.error(e);
    }
  }

  // 2. If it's a silent background sync and we don't have the key, abort quietly.
  if (silent) return null;

  const pwd = await globalPrompt("Enter Master Password to authorize this cloud sync action:", "Authorization Required");
  if (!pwd) return null;

  try {
    const salt = new Uint8Array(base64ToArrayBuffer(saltRec.value));
    const derivedKey = await deriveMasterKey(pwd, salt);
    const decryptedVerifier = await decryptPayload(verifierRec.value, derivedKey);
    if (decryptedVerifier === 'VALID_VAULT_KEY') {
      return derivedKey;
    }
  } catch (e) {
    console.error(e);
  }
  
  await globalAlert('Invalid Master Password', 'Authentication Failed');
  return null;
}
