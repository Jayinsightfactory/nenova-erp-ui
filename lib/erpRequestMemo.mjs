import { currentErpReadContext, erpContextCache } from './erpReadContext.js';

// Exact, typed arguments only: no coercion of 0/false/undefined, dates or years.
// Unsupported/cyclic values bypass memoization rather than change reader behavior.
export function erpRequestMemoKey(value, state = { functions: new WeakMap(), nextFunction: 0 }) {
  const seen = new Set();
  function encode(item) {
    if (item === null) return ['null'];
    const type = typeof item;
    if (type === 'function') {
      if (!state.functions.has(item)) state.functions.set(item, ++state.nextFunction);
      return ['function', state.functions.get(item)];
    }
    if (type === 'symbol') throw new TypeError('Unsupported memo argument');
    if (type !== 'object') return [type, type === 'number' && Object.is(item, -0) ? '-0' : String(item)];
    if (seen.has(item)) throw new TypeError('Cyclic memo argument');
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype) throw new TypeError('Unsupported memo object');
    seen.add(item);
    const result = Array.isArray(item) ? ['array', item.map(encode)]
      : ['object', Object.keys(item).sort().map(key => [key, encode(item[key])])];
    seen.delete(item);
    return result;
  }
  return JSON.stringify(encode(value));
}

export async function memoizeErpRequestRead(name, args, read) {
  if (!currentErpReadContext()) return read();
  const state = erpContextCache(`exact-read:${name}`, null,
    () => ({ entries: new Map(), functions: new WeakMap(), nextFunction: 0 }));
  let key;
  try { key = erpRequestMemoKey(args, state); } catch { return read(); }
  if (!state.entries.has(key)) {
    const pending = Promise.resolve().then(read).catch(error => {
      state.entries.delete(key);
      throw error;
    });
    state.entries.set(key, pending);
  }
  // Isolate callers from both the cached evidence and each other. No TTL or
  // cross-request cache; the owning report still verifies its source fences.
  return structuredClone(await state.entries.get(key));
}
