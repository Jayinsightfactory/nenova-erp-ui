// Unit-test adapter only. Real SQL locking/migration is verified separately.
import fs from 'node:fs';
import * as productMatch from '../../lib/pasteMappingMatch.js';
import * as customerMatch from '../../lib/pasteCustomerMappingMatch.js';
import * as customerToken from '../../lib/normalizeCustomerToken.js';
import * as importKey from '../../lib/orderImportMappingKey.js';

function loadWrapper(relative, deps) {
  let source = fs.readFileSync(new URL(`../../lib/${relative}`, import.meta.url), 'utf8');
  const names = [...source.matchAll(/export (?:async )?function (\w+)/g)].map(m => m[1]);
  source = source.replace(/^import[\s\S]*?from ['"][^'"]+['"];\r?\n/gm, '')
    .replace(/^export \{[^}]+\}(?: from ['"][^'"]+['"])?;\r?\n/gm, '')
    .replace(/export (async )?function /g, '$1function ');
  return Function(...Object.keys(deps), `${source}\nreturn {${names.join(',')}};`)(...Object.values(deps));
}

export function mappingStoreFixture(initial = {}) {
  const documents = structuredClone({ customer: {}, product: {}, 'customer-product': {}, ...initial });
  let tail = Promise.resolve();
  const deps = {
    ...productMatch, ...customerMatch, ...customerToken, ...importKey,
    MAPPING_STORE_KEYS: { customers: 'customer', products: 'product', customerProducts: 'customer-product' },
    async readMappingDocument(key) { await tail; return structuredClone(documents[key]); },
    mutateMappingDocument(key, change) {
      const next = tail.then(async () => {
        const mutation = await change(structuredClone(documents[key]));
        if (mutation.changed !== false) documents[key] = structuredClone(mutation.document);
        return mutation.result;
      });
      tail = next.catch(() => {});
      return next;
    },
  };
  return {
    documents,
    products: loadWrapper('parseMappings.js', deps),
    customers: loadWrapper('customerMappings.js', deps),
    scoped: loadWrapper('orderImportCustomerProductMappings.js', deps),
  };
}
