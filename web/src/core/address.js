// Solana addresses in the browser: base58 of 32 bytes (no library: the site only needs to check and shorten them).
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = Object.fromEntries([...B58].map((c, i) => [c, i]));

/** base58 → bytes, or null when a character isn't base58. */
export function b58decode(s) {
  let n = 0n;
  for (const c of s) { const v = MAP[c]; if (v === undefined) return null; n = n * 58n + BigInt(v); }
  const out = [];
  while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of s) { if (c !== '1') break; out.unshift(0); }
  return Uint8Array.from(out);
}

/** A Solana address (a public key): 32 bytes in base58. */
export function isAddress(s) {
  const t = String(s ?? '').trim();
  if (t.length < 32 || t.length > 44) return false;
  return b58decode(t)?.length === 32;
}

/**
 * A pasted list of addresses: one per line (commas and spaces work too).
 * → { list: unique valid addresses in order, bad: what isn't an address, dup: repeats dropped }
 */
export function parseAddresses(text) {
  const parts = String(text ?? '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const list = [], bad = [];
  let dup = 0;
  for (const p of parts) {
    if (!isAddress(p)) bad.push(p);
    else if (list.includes(p)) dup++;
    else list.push(p);
  }
  return { list, bad, dup };
}

/** 7xKq…9fhk */
export const shortAddr = (k) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : '');
