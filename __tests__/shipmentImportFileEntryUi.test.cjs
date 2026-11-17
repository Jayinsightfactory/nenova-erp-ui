const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const suffix = process.platform === 'win32' ? '-msvc' : '-gnu';
const { transformSync } = require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
function transform(source) { return transformSync(source, false, Buffer.from(JSON.stringify({ jsc: { parser: { syntax: 'ecmascript', jsx: true }, transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }))).code; }
function load(source, requireFn, globals = {}) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), transform(source))(requireFn, mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const reads = load(fs.readFileSync('lib/importReadRequests.js', 'utf8'), require);
function fixture(overrides = {}) {
  const states = [], refs = [], calls = [], downloads = [];
  let stateIndex = 0, refIndex = 0;
  const hookReact = { ...React, useState(value) { const i = stateIndex++; if (!(i in states)) states[i] = value; return [states[i], value => { states[i] = typeof value === 'function' ? value(states[i]) : value; }]; }, useRef(value) { const i = refIndex++; return refs[i] ||= { current: value }; }, useEffect() {}, useLayoutEffect() {}, useMemo: fn => fn(), useCallback: fn => fn };
  const fetch = (url, options) => new Promise((resolve, reject) => { calls.push({ url, options, resolve, reject }); options.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); });
  let source = fs.readFileSync('pages/shipment/distribute-import.js', 'utf8');
  for (const [name, value] of Object.entries(overrides)) source = source.replace(new RegExp(`(const \\[${name}, [^\\]]+\\] = useState\\()([^;]+)(\\);)`), (_, a, _b, c) => a + JSON.stringify(value) + c);
  const Page = load(source, id => {
    if (id === 'react') return hookReact;
    if (id === 'next/router') return { useRouter: () => ({ isReady: false, query: {} }) };
    if (id.endsWith('/useWeekInput')) return { getCurrentWeek: () => '2026-46-01', useWeekInput: () => ({ value: '2026-47-01', props: {} }) };
    if (id.endsWith('/importReadRequests')) return reads;
    if (id.endsWith('/shipmentImportQty')) return { isAlstroImportRow: () => false };
    if (id.endsWith('/shipmentFixScopeCore')) return {};
    if (id.endsWith('/importApplyClient')) return { IMPORT_UNKNOWN_CODES: new Set() };
    if (id.includes('/components/')) return () => null;
    return require(id);
  }, { fetch, FormData: class { append() {} }, window: {}, document: { body: { appendChild() {} }, createElement: () => ({ click() { downloads.push(this.download); }, remove() {} }) }, URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} }, requestAnimationFrame: fn => fn(), setTimeout: fn => { fn(); } }).default;
  const render = () => { stateIndex = 0; refIndex = 0; return Page(); };
  function nodes(node, predicate) { if (!node || typeof node !== 'object') return []; return [...(predicate(node) ? [node] : []), ...React.Children.toArray(node.props?.children).flatMap(child => nodes(child, predicate))]; }
  const button = (tree, label) => nodes(tree, node => node.type === 'button' && node.props.children === label)[0];
  const select = name => { const tree = render(); const input = nodes(tree, node => node.type === 'input' && node.props.type === 'file')[0]; input.props.onChange({ target: { files: [{ name }], value: name } }); };
  const compactPicker = tree => button(nodes(tree, node => node.props?.storageKey === 'distribute-import')[0].props.summary, '파일 선택');
  const editFarmText = text => nodes(render(), node => node.props?.['aria-label'] === '농장분배 카톡 내용')[0].props.onChange({target:{value:text}});
  return { render, button, compactPicker, editFarmText, select, calls, downloads, cleanup: () => refs.forEach(ref => ref.current?.abortAll?.()) };
}

test('actual page allows file selection while read waits; newer file owns download and loading state', async () => {
  const f = fixture();
  try {
    f.select('first.xlsx');
    assert.equal(f.calls.length,0);
    f.button(f.render(),'물량표 바로 생성').props.onClick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.button(f.render(), '파일 선택').props.disabled, false);
    f.select('second.xlsx');
    assert.equal(f.calls.length,1);
    f.button(f.render(),'물량표 바로 생성').props.onClick();
    assert.equal(f.calls.length, 2, 'new selection starts its own generation even while old downloading state was true');
    assert(f.calls[0].options.signal.aborted);
    await Promise.resolve(); await Promise.resolve();
    assert(f.button(f.render(), '다운로드 준비 중...').props.disabled, 'older cancelled finally must not unlock current download');
    f.calls[1].resolve({ ok: true, blob: async () => ({}) });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(f.downloads, ['second-신형현장물량표-업로드기준.xlsx']);
    assert.equal(f.button(f.render(), '파일 선택').props.disabled, false);
    assert(f.calls.every(call => call.url.endsWith('distribute-import-export')), 'file selection never sends ERP apply');
  } finally { f.cleanup(); }
});

test('actual page keeps file selection available during preview but protects active ERP apply', () => {
  for (const state of [{ loading: true }, { downloading: true }]) {
    const f = fixture(state); assert.equal(f.button(f.render(), '파일 선택').props.disabled, false); f.cleanup();
  }
  const applying = fixture({ applying: true });
  assert.equal(applying.button(applying.render(), '파일 선택').props.disabled, true);
  applying.cleanup();
});

test('2/5/10/20 mounted staff pages accept independent normal files while another read waits', async () => {
  for (const count of [2, 5, 10, 20]) {
    const screens = Array.from({ length: count }, () => fixture());
    try {
      screens.forEach((screen, index) => {screen.select(`staff-${index}.xlsx`);assert.equal(screen.calls.length,0);screen.button(screen.render(),'물량표 바로 생성').props.onClick();});
      assert(screens.every(screen => screen.calls.length === 1 && !screen.button(screen.render(), '파일 선택').props.disabled));
      // First staff's network request remains pending while everyone else finishes.
      screens.slice(1).forEach(screen => screen.calls[0].resolve({ ok: true, blob: async () => ({}) }));
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
      assert.equal(screens[0].downloads.length, 0);
      screens.slice(1).forEach((screen, index) => assert.deepEqual(screen.downloads, [`staff-${index + 1}-신형현장물량표-업로드기준.xlsx`]));
      assert(screens.flatMap(screen => screen.calls).every(call => call.url.endsWith('distribute-import-export')));
    } finally { screens.forEach(screen => screen.cleanup()); }
  }
});

test('collapsed upload header exposes a file picker while reading and observes the same ERP write guards', () => {
  for (const [initial,disabled] of [[{},false],[{downloading:true},false],[{loading:true},false],[{applying:true},true],[{preAligning:true},true]]) {
    const view=fixture(initial), tree=view.render();
    assert.equal(view.compactPicker(tree).props.disabled,disabled);
    assert.equal(view.button(tree,'파일 선택').props.disabled,disabled);
    view.cleanup();
  }
});

test('editing the farm note during a download suppresses the old result and releases the download button', async () => {
  const view=fixture();
  try {
    view.select('draft.xlsx');view.button(view.render(),'물량표 바로 생성').props.onClick();view.editFarmText('새 메모');
    view.calls[0].resolve({ok:true,blob:async()=>({})});
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual(view.downloads,[]);
    assert.equal(view.button(view.render(),'물량표 바로 생성').props.disabled,false);
  } finally { view.cleanup(); }
});

test('upload enables farm-only apply and field download before ERP quantity validation', async () => {
  const view=fixture();
  try {
    view.select('46-02 장미 물량표.xlsx');
    assert.equal(view.calls.length,0);
    await new Promise(resolve=>setImmediate(resolve));
    const download=view.button(view.render(),'신형 물량표 다운로드');
    assert.equal(download.props.disabled,false);
    const farm=view.button(view.render(),'카톡 농장 적용');
    assert.equal(farm.props.disabled,false);
    const pending=farm.props.onClick();
    assert.match(view.calls[0].url,/distribute-import-farms$/);
    view.calls[0].resolve({ok:true,json:async()=>({success:true,changed:1})});
    await pending;
    const exportPending=download.props.onClick();
    assert.match(view.calls[1].url,/field-sources/);
    view.calls[1].resolve({ok:true,json:async()=>({items:[{id:'r',revision:'1',filename:'46-02 장미 물량표.xlsx'}]})});
    await new Promise(resolve=>setImmediate(resolve));
    assert.match(view.calls[2].url,/field-sources/);
    view.calls[2].resolve({ok:true,blob:async()=>({}),headers:{get:()=>null}});
    await exportPending;
    assert.equal(view.downloads.length,1);
  } finally {view.cleanup();}
});
