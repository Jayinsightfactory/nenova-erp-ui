// A product write sets data to null, invalidating even a load still in flight.
export async function cachedRows(cache, force, load) {
  if (cache.data === cache.pending && cache.pending) return cache.pending;
  if (!force && cache.data && Date.now() - cache.updatedAt < cache.ttl) return cache.data;
  const pending = load();
  cache.pending = pending;
  cache.data = pending;
  try {
    const rows = await pending;
    if (cache.data === pending) {
      cache.data = rows;
      cache.updatedAt = Date.now();
    }
    return rows;
  } catch (error) {
    if (cache.data === pending) cache.data = null;
    throw error;
  } finally {
    if (cache.pending === pending) cache.pending = null;
  }
}
