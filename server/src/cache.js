/**
 * Minimal in-memory TTL cache.
 *
 * DSE's site is scraped, not a real API — it will rate-limit or block an IP
 * that hits it every request. Every route reads through this cache instead
 * of calling dsebd.org directly. `withCache` also collapses concurrent
 * requests for the same key into a single in-flight fetch, so a burst of
 * page loads doesn't fire the same scrape N times.
 */

const store = new Map(); // key -> { value, expiresAt }
const inFlight = new Map(); // key -> Promise

async function withCache(key, ttlMs, fetcher) {
  const hit = store.get(key);
  if (hit && hit.expiresAt > Date.now()) {
    return hit.value;
  }

  if (inFlight.has(key)) {
    return inFlight.get(key);
  }

  const promise = (async () => {
    try {
      const value = await fetcher();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    } catch (err) {
      // On failure, serve stale data if we have any rather than erroring out.
      if (hit) {
        console.error(`[cache] refresh failed for "${key}", serving stale data:`, err.message);
        return hit.value;
      }
      throw err;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, promise);
  return promise;
}

function clear(key) {
  if (key) store.delete(key);
  else store.clear();
}

module.exports = { withCache, clear };
