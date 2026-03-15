// TKO E2E Encryption — Web Crypto API
// All messages use v2 format: one AES key per message, encrypted per recipient by userId
// This means both sender and receiver can always decrypt using their own userId

const PBKDF2_ITERATIONS = 100000;

// ── Private key cache — imported once per session
let _cachedPrivateKey = null;
let _cachedPrivateKeyB64 = null;

async function getPrivateKey(privateKeyB64) {
  if (_cachedPrivateKey && _cachedPrivateKeyB64 === privateKeyB64) return _cachedPrivateKey;
  const keyData = base64ToArrayBuffer(privateKeyB64);
  _cachedPrivateKey = await window.crypto.subtle.importKey(
    'pkcs8', keyData, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['decrypt']
  );
  _cachedPrivateKeyB64 = privateKeyB64;
  return _cachedPrivateKey;
}

// ── Public key cache
const _pubKeyCache = new Map();

async function getPublicKey(publicKeyB64) {
  if (_pubKeyCache.has(publicKeyB64)) return _pubKeyCache.get(publicKeyB64);
  const keyData = base64ToArrayBuffer(publicKeyB64);
  const key = await window.crypto.subtle.importKey(
    'spki', keyData, { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']
  );
  _pubKeyCache.set(publicKeyB64, key);
  return key;
}

export function clearKeyCache() {
  _cachedPrivateKey = null;
  _cachedPrivateKeyB64 = null;
  _pubKeyCache.clear();
}

// ── Generate RSA-2048 key pair
export async function generateKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    { name: 'RSA-OAEP', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['encrypt', 'decrypt']
  );
  const publicKeyExported = await window.crypto.subtle.exportKey('spki', keyPair.publicKey);
  const privateKeyExported = await window.crypto.subtle.exportKey('pkcs8', keyPair.privateKey);
  return {
    publicKeyB64: arrayBufferToBase64(publicKeyExported),
    privateKeyB64: arrayBufferToBase64(privateKeyExported),
  };
}

// ── Derive AES key from password (protects stored private key)
async function deriveKeyFromPassword(password, salt) {
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']
  );
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, ['encrypt', 'decrypt']
  );
}

// ── Encrypt private key with password for localStorage
export async function encryptPrivateKey(privateKeyB64, password) {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKeyFromPassword(password, salt);
  const encrypted = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, key, new TextEncoder().encode(privateKeyB64)
  );
  return {
    encrypted: arrayBufferToBase64(encrypted),
    salt: arrayBufferToBase64(salt),
    iv: arrayBufferToBase64(iv),
  };
}

// ── Decrypt private key with password
export async function decryptPrivateKey(encryptedData, password) {
  const key = await deriveKeyFromPassword(password, base64ToArrayBuffer(encryptedData.salt));
  const decrypted = await window.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: base64ToArrayBuffer(encryptedData.iv) },
    key, base64ToArrayBuffer(encryptedData.encrypted)
  );
  return new TextDecoder().decode(decrypted);
}

// ── Encrypt message for one or more recipients (always v2 format)
// Pass recipients as { userId: publicKeyB64 } — include BOTH sender and receiver for direct chats
export async function encryptForRecipients(plaintext, recipients) {
  // recipients = { [userId]: publicKeyB64, ... }
  const aesKey = await window.crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']
  );
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encryptedContent = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv }, aesKey, new TextEncoder().encode(plaintext)
  );
  const aesKeyRaw = await window.crypto.subtle.exportKey('raw', aesKey);

  const encryptedKeys = {};
  for (const [userId, publicKeyB64] of Object.entries(recipients)) {
    if (!publicKeyB64) continue;
    const pubKey = await getPublicKey(publicKeyB64);
    const encKey = await window.crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, aesKeyRaw);
    encryptedKeys[userId] = arrayBufferToBase64(encKey);
  }

  return JSON.stringify({
    encryptedContent: arrayBufferToBase64(encryptedContent),
    encryptedKeys, // { userId: encryptedAesKey }
    iv: arrayBufferToBase64(iv),
    version: 2,
  });
}

// Kept for backward compatibility — direct message
export async function encryptMessage(plaintext, recipientPublicKeyB64, senderPublicKeyB64, recipientUserId, senderUserId) {
  const recipients = {};
  if (recipientUserId && recipientPublicKeyB64) recipients[recipientUserId] = recipientPublicKeyB64;
  if (senderUserId && senderPublicKeyB64) recipients[senderUserId] = senderPublicKeyB64;
  // Fallback if no userIds provided — use old keys directly
  if (Object.keys(recipients).length === 0) {
    recipients['recipient'] = recipientPublicKeyB64;
    if (senderPublicKeyB64) recipients['sender'] = senderPublicKeyB64;
  }
  return encryptForRecipients(plaintext, recipients);
}

// Group message
export async function encryptMessageForGroup(plaintext, recipientPublicKeys) {
  return encryptForRecipients(plaintext, recipientPublicKeys);
}

// ── Decrypt a message — looks up this user's key entry by userId
export async function decryptMessage(encryptedData, privateKeyB64, userId) {
  try {
    const data = JSON.parse(encryptedData);
    const privateKey = await getPrivateKey(privateKeyB64);

    let encryptedAesKeyB64 = null;

    if (data.version === 2 && data.encryptedKeys) {
      // Look up by userId first
      encryptedAesKeyB64 = data.encryptedKeys[userId] || null;

      // Fallback: if not found by userId, try all keys until one works
      // (handles messages sent before userId-keyed encryption)
      if (!encryptedAesKeyB64) {
        for (const keyB64 of Object.values(data.encryptedKeys)) {
          try {
            const aesKeyRaw = await window.crypto.subtle.decrypt(
              { name: 'RSA-OAEP' }, privateKey, base64ToArrayBuffer(keyB64)
            );
            const aesKey = await window.crypto.subtle.importKey(
              'raw', aesKeyRaw, { name: 'AES-GCM' }, false, ['decrypt']
            );
            const decrypted = await window.crypto.subtle.decrypt(
              { name: 'AES-GCM', iv: base64ToArrayBuffer(data.iv) },
              aesKey, base64ToArrayBuffer(data.encryptedContent)
            );
            return new TextDecoder().decode(decrypted);
          } catch { continue; }
        }
        return '[encrypted]';
      }
    } else if (data.version === 1) {
      // Legacy v1 — try both keys
      const keysToTry = [data.encryptedAesKey, data.selfKey].filter(Boolean);
      for (const keyB64 of keysToTry) {
        try {
          const aesKeyRaw = await window.crypto.subtle.decrypt(
            { name: 'RSA-OAEP' }, privateKey, base64ToArrayBuffer(keyB64)
          );
          const aesKey = await window.crypto.subtle.importKey(
            'raw', aesKeyRaw, { name: 'AES-GCM' }, false, ['decrypt']
          );
          const decrypted = await window.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: base64ToArrayBuffer(data.iv) },
            aesKey, base64ToArrayBuffer(data.encryptedContent)
          );
          return new TextDecoder().decode(decrypted);
        } catch { continue; }
      }
      return '[encrypted]';
    } else {
      return '[encrypted]';
    }

    // Decrypt using the found key
    const aesKeyRaw = await window.crypto.subtle.decrypt(
      { name: 'RSA-OAEP' }, privateKey, base64ToArrayBuffer(encryptedAesKeyB64)
    );
    const aesKey = await window.crypto.subtle.importKey(
      'raw', aesKeyRaw, { name: 'AES-GCM' }, false, ['decrypt']
    );
    const decrypted = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToArrayBuffer(data.iv) },
      aesKey, base64ToArrayBuffer(data.encryptedContent)
    );
    return new TextDecoder().decode(decrypted);
  } catch {
    return '[unable to decrypt]';
  }
}

// ── Helpers
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return window.btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export { getPrivateKey as importPrivateKey, getPublicKey as importPublicKey };
