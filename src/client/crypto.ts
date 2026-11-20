// Client-side encryption utilities (Web Crypto) for FOREVER / browser-encrypted user data mode.
// Used by browser storage adapter when no OIDC cloud session is active.

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return buf as ArrayBuffer;
}

function fromBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function deriveKeyFromPassphrase(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const baseKey = await crypto.subtle.importKey('raw', enc.encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 200_000, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function generateRandomKey(): Promise<string> {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  return toBase64(raw);
}

export async function encryptJSON(payload: unknown, passphraseOrKeyBase64: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyBytes = fromBase64(passphraseOrKeyBase64);
  // Use the random base64 string as the passphrase seed
  const key = await deriveKeyFromPassphrase(toBase64(keyBytes), salt);
  const enc = new TextEncoder();
  const plaintext = enc.encode(JSON.stringify(payload));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    data: toBase64(ciphertext),
  };
}

export async function decryptJSON(cipher: { salt: string; iv: string; data: string }, passphraseOrKeyBase64: string) {
  const salt = fromBase64(cipher.salt);
  const iv = fromBase64(cipher.iv);
  const data = fromBase64(cipher.data);
  const keyBytes = fromBase64(passphraseOrKeyBase64);
  const key = await deriveKeyFromPassphrase(toBase64(keyBytes), salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, key, toArrayBuffer(data));
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(new Uint8Array(decrypted)));
}
