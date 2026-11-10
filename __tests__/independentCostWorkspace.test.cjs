const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('cost menu defaults to existing receipts, keeps independent drafts and rejects stale matching', async () => {
  const { transform, loadBindings } = require('next/dist/build/swc');
  await loadBindings();
  const source = fs.readFileSync(require.resolve('../components/import-tools/IndependentCostWorkspace.js'), 'utf8');
  const states = [], refs = [], callbacks = [];
  let si = 0, ri = 0, ci = 0, dynamicIndex = 0;
  const React = {
    createElement: (tag, props, ...children) => ({ tag, props: props || {}, children: children.flat().filter(Boolean) }),
    useState(initial) { const i = si++; if (!(i in states)) states[i] = initial; return [states[i], value => { states[i] = value; }]; },
    useRef(initial) { const i = ri++; return refs[i] ||= { current: initial }; },
    useCallback(fn) { const i = ci++; return callbacks[i] ||= fn; },
    useEffect(fn) { fn(); },
  };
  const compiled = await transform(source, { jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'classic' } } }, module: { type: 'commonjs' } });
  const mod = { exports: {} };
  vm.runInNewContext(compiled.code, { module: mod, exports: mod.exports, React,
    require: name => name === 'react' ? React : name === 'next/dynamic' ? () => ['Workbench','Packing','NativeCost'][dynamicIndex++] : {} });
  const render = (props = {}) => { si = ri = ci = 0; return mod.exports.default({ userId: 'tester', storage: {}, ...props }); };
  const all = node => node && typeof node === 'object' ? [node, ...node.children.flatMap(all)] : [];
  let tree = render();
  assert.equal(all(tree).filter(n => n.tag === 'Packing').length, 0);
  assert.equal(all(tree).find(n => n.tag === 'Workbench').props.workspaceMode, 'cost');
  tree.children[0].children[1].props.onClick();
  tree = render();
  let packing = all(tree).find(n => n.tag === 'Packing');
  const next = { file: {}, excels: [{}], invoices: [{}], country: 'AU' };
  packing.props.onReceiptSourceChange(next);
  tree = render();
  const uploaded = all(tree).filter(n => n.tag === 'Workbench')[1];
  uploaded.props.onMatchStateChange({ ...next, file: {} });
  assert.equal(states[2], null);
  const matched = { ...next, records: ['ready'] };
  uploaded.props.onMatchStateChange(matched);
  packing.props.onContinue();
  tree = render();
  tree.children[0].children[0].props.onClick();
  tree = render();
  tree.children[0].children[1].props.onClick();
  tree = render();
  packing = all(tree).find(n => n.tag === 'Packing');
  assert.equal(packing.props.receiptMatchState, matched);
  assert.equal(states[3], true);
  assert.equal(all(tree).filter(n => n.tag === 'Workbench')[0].props.file, undefined);
  const resumeReceiptScope = { userId: 'tester', documentId: 'receipt', orderYear: '2026', orderWeek: '46-01', warehouseKey: 1 };
  render({ resumeReceiptScope });
  tree = render({ resumeReceiptScope });
  assert.equal(states[0], 'existing');
  const nativeCost = all(tree).find(n => n.tag === 'NativeCost');
  assert.equal(nativeCost.props.orderWeek, '46-01');
  assert.equal(nativeCost.props.warehouseKey, 1);
  nativeCost.props.onClose();
  tree=render({resumeReceiptScope});assert.ok(all(tree).some(n=>n.tag==='Workbench'));
  tree=render({resumeReceiptScope:{...resumeReceiptScope,userId:'another'}});
  assert.ok(!all(tree).some(n=>n.tag==='NativeCost'));
});
