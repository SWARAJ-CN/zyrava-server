const store = new Map();

export async function withCache(key, ttlMs, producer) {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value;

  const value = await producer();
  store.set(key, { value, expiresAt: now + ttlMs });

  if (store.size > 120) {
    for (const [entryKey, entry] of store) {
      if (entry.expiresAt <= now) store.delete(entryKey);
    }
    // Still oversized: drop the oldest insertion.
    while (store.size > 120) store.delete(store.keys().next().value);
  }

  return value;
}

export function clearCache() {
  store.clear();
}

export function cacheInfo() {
  return { entries: store.size };
}
