/**
 * crypto.randomUUID() is restricted to secure contexts, so it THROWS on
 * http://192.168.x.x — which is exactly how you test from a phone on the LAN.
 * getRandomValues has no such restriction, so this works everywhere.
 */
export function uid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}
