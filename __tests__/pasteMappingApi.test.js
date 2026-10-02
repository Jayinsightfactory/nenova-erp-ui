import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual authenticated handler with an isolated alias store; no ERP connection.
const source = fs.readFileSync(new URL('../pages/api/orders/mappings.js', import.meta.url), 'utf8')
  .replace(/import[\s\S]*?from\s+['"][^'"]+['"];\s*/g, '')
  .replace('export default withAuth(', 'globalThis.handler = withAuth(');
const mappings = {};
const context = vm.createContext({
  withAuth: handler => handler, loadMappings: () => mappings,
  normalizeToken: input => input.toLowerCase().trim(),
  saveMapping: (input, value) => { const key = input.toLowerCase().trim(); mappings[key] = value; return { saved: true, key }; },
});
vm.runInContext(source, context);
function post(body) {
  let status = 200, output;
  context.handler({ method: 'POST', body }, { status(code) { status = code; return this; }, json(value) { output = value; return this; } });
  return { status, output };
}
assert.equal(post({ inputToken: 'Moonlight', prodKey: 1, manual: true, force: true }).status, 200);
assert.equal(mappings.moonlight.manual, true);
assert.equal(post({ inputToken: 'Moonlight', prodKey: 2, manual: false, force: true }).status, 409);
assert.equal(mappings.moonlight.prodKey, 1);
assert.equal(post({ inputToken: 'Moonlight', prodKey: 1, manual: false }).status, 200);
assert.equal(mappings.moonlight.manual, true);
assert.equal(post({ inputToken: 'Moonlight', prodKey: 2, manual: true }).status, 200);
assert.equal(mappings.moonlight.prodKey, 2);
assert.equal(post({ inputToken: 'Legacy', prodKey: 3, force: true }).status, 200);
assert.equal(mappings.legacy.manual, false, 'force alone never authorizes reviewed-result override');
console.log('paste mapping API: explicit correction, stale learning rejection, legacy non-manual passed');
