// Execute no navegador/Activity. Compartilhe a chave fora do servidor, idealmente no fragmento #key=...
const enc = new TextEncoder();
const dec = new TextDecoder();
const b64u = bytes => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const fromB64u = text => Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((text.length + 3) % 4)), c => c.charCodeAt(0));

export function generateRoomKey() { return b64u(crypto.getRandomValues(new Uint8Array(32))); }
async function importKey(secret) { return crypto.subtle.importKey('raw', fromB64u(secret), 'AES-GCM', false, ['encrypt', 'decrypt']); }

export async function encryptSignal(secret, value) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await importKey(secret), enc.encode(JSON.stringify(value))));
  return JSON.stringify({ v: 1, iv: b64u(iv), data: b64u(cipher) });
}

export async function decryptSignal(secret, envelope) {
  const value = JSON.parse(envelope);
  if (value.v !== 1) throw new Error('Versão de envelope inválida');
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64u(value.iv) }, await importKey(secret), fromB64u(value.data));
  return JSON.parse(dec.decode(plain));
}
