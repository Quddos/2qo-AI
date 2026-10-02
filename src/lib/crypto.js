// End-to-end encryption with WebCrypto.
// Each device holds an ECDH P-256 key pair; the private key is non-extractable
// and never leaves IndexedDB. Pairwise AES-GCM keys are derived per contact.
import { kv } from './db.js';

const subtle = globalThis.crypto.subtle;
const ECDH = { name: 'ECDH', namedCurve: 'P-256' };
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  from: (buf) => {
    const bytes = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  to: (str) => Uint8Array.from(atob(str), (c) => c.charCodeAt(0)),
};

export function uid(n = 16) {
  const a = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(a, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Short, human-friendly id derived from the public key (also acts as a safety number). */
export async function fingerprint(jwk) {
  const h = await subtle.digest('SHA-256', enc.encode(jwk.x + '.' + jwk.y));
  const hex = Array.from(new Uint8Array(h), (x) => x.toString(16).padStart(2, '0')).join('');
  return hex.slice(0, 20);
}

export async function safetyNumber(jwkA, jwkB) {
  const [a, b] = [await fingerprint(jwkA), await fingerprint(jwkB)].sort();
  const h = new Uint8Array(await subtle.digest('SHA-256', enc.encode(a + b)));
  const digits = Array.from(h.slice(0, 15), (x) => String(x % 100).padStart(2, '0')).join('');
  return digits.match(/.{5}/g).join(' ');
}

export async function loadOrCreateKeys() {
  let keys = await kv.get('keys');
  if (!keys) {
    const pair = await subtle.generateKey(ECDH, false, ['deriveKey']);
    const publicJwk = await subtle.exportKey('jwk', pair.publicKey);
    keys = { privateKey: pair.privateKey, publicJwk };
    await kv.set('keys', keys);
  }
  return keys;
}

const shared = new Map();
async function sharedKey(myPrivate, theirJwk) {
  const id = theirJwk.x + theirJwk.y;
  if (shared.has(id)) return shared.get(id);
  const pub = await subtle.importKey('jwk', theirJwk, ECDH, false, []);
  const key = await subtle.deriveKey(
    { name: 'ECDH', public: pub },
    myPrivate,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  shared.set(id, key);
  return key;
}

export async function seal(myPrivate, theirJwk, payload) {
  const key = await sharedKey(myPrivate, theirJwk);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(payload)));
  return { iv: b64.from(iv), ct: b64.from(ct) };
}

export async function open(myPrivate, theirJwk, { iv, ct }) {
  const key = await sharedKey(myPrivate, theirJwk);
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64.to(iv) }, key, b64.to(ct));
  return JSON.parse(dec.decode(pt));
}

/** Hash a chat-lock PIN (PBKDF2) so the PIN itself is never stored. */
export async function hashPin(pin, saltB64) {
  const salt = saltB64 ? b64.to(saltB64) : crypto.getRandomValues(new Uint8Array(16));
  const base = await subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' }, base, 256);
  return { salt: b64.from(salt), hash: b64.from(bits) };
}
