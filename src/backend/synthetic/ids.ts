/** Order-independent ids. The same seed, kind, and index always return the same UUID. */
export function stableId(seed: number, kind: string, index: number): string {
  const parts = [0, 1, 2, 3].map((part) =>
    fnv1a(`${seed}:${kind}:${index}:${part}`).toString(16).padStart(8, "0"),
  );
  const hex = parts.join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  return hash >>> 0;
}

/** Spread a timestamp across [from, to) using the id hash, so a re-run does not move rows. */
export function timestampIn(from: string, to: string, key: string): string {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  const unit = (fnv1a(key) % 1_000_000) / 1_000_000;
  return new Date(start + Math.floor(unit * (end - start))).toISOString();
}

export function addSeconds(iso: string, seconds: number): string {
  return new Date(Date.parse(iso) + seconds * 1000).toISOString();
}
