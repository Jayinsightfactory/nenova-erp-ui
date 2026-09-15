const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');

const root = path.resolve(__dirname, '..');
const filename = path.join(root, 'components/raum/PnlHotelAddDialog.js');
const source = fs.readFileSync(filename, 'utf8');

function compileWithHookHarness() {
  const slots = [];
  let hookIndex = 0;
  let pendingEffects = [];
  const hooks = {
    useState(initial) {
      const index = hookIndex++;
      if (!slots[index]) slots[index] = { kind: 'state', value: typeof initial === 'function' ? initial() : initial };
      return [slots[index].value, value => {
        slots[index].value = typeof value === 'function' ? value(slots[index].value) : value;
      }];
    },
    useRef(initial) {
      const index = hookIndex++;
      if (!slots[index]) slots[index] = { kind: 'ref', value: { current: initial } };
      return slots[index].value;
    },
    useEffect(effect, dependencies) {
      const index = hookIndex++;
      const previous = slots[index];
      const changed = !previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]));
      if (changed) pendingEffects.push({ index, effect, cleanup: previous?.cleanup });
      slots[index] = { kind: 'effect', dependencies, cleanup: previous?.cleanup };
    },
  };
  const code = transformSync(source, {
    filename,
    jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } },
    module: { type: 'commonjs' },
  }).code;
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  const nativeRequire = loaded.require.bind(loaded);
  loaded.require = request => request === 'react' ? hooks : nativeRequire(request);
  loaded._compile(code, filename);

  let documentMock;
  function visit(element, nodes = []) {
    if (!element || typeof element !== 'object') return nodes;
    if (Array.isArray(element)) { element.forEach(child => visit(child, nodes)); return nodes; }
    if (typeof element.type === 'string') nodes.push(element);
    visit(element.props?.children, nodes);
    return nodes;
  }
  function render(props) {
    hookIndex = 0;
    pendingEffects = [];
    const tree = loaded.exports.default(props);
    const elements = visit(tree);
    const focusableNodes = elements
      .filter(element => ['input', 'button'].includes(element.type) && !element.props.disabled)
      .map(element => ({
        tag: element.type,
        focus() { documentMock.activeElement = this; },
      }));
    for (const element of elements) {
      const ref = element.ref || element.props.ref;
      if (!ref || typeof ref !== 'object') continue;
      if (element.type === 'input') {
        const input = focusableNodes.find(node => node.tag === 'input') || { tag: 'input', focus() {} };
        ref.current = input;
        element.__testNode = input;
      } else if (element.type === 'section') {
        ref.current = { querySelectorAll: () => focusableNodes };
      }
    }
    for (const pending of pendingEffects) {
      pending.cleanup?.();
      const cleanup = pending.effect();
      slots[pending.index].cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
    return { tree, elements, focusableNodes };
  }
  return { render, get document() { return documentMock; }, set document(value) { documentMock = value; } };
}

const renderer = compileWithHookHarness();
const sent = [];
let closeCount = 0;
const outsideFocus = { focused: false, focus() { this.focused = true; } };
renderer.document = { activeElement: outsideFocus };
global.document = renderer.document;
const props = { open: true, onClose: () => { closeCount += 1; }, onSubmit: (...args) => sent.push(args), busy: false, error: '' };
let view = renderer.render(props);
let markup = renderToStaticMarkup(view.tree);
assert.match(markup, /role="dialog"/);
assert.match(markup, /aria-modal="true"/);
assert.match(markup, /aria-labelledby="pnl-hotel-add-title"/);
assert.match(markup, /for="pnl-hotel-add-name"/);
assert.match(markup, /호텔명을 직접 입력하세요/);
assert.match(markup, /전산 거래처는 만들지 않습니다/);
assert.equal(renderer.document.activeElement.tag, 'input', 'opening the dialog focuses the name field');

const find = (elements, type, id) => elements.find(element => element.type === type && (id == null || element.props.id === id));
const input = find(view.elements, 'input', 'pnl-hotel-add-name');
input.props.onChange({ target: { value: '   Seoul Hotel   ' } });
view = renderer.render(props);
find(view.elements, 'form').props.onSubmit({ preventDefault() {} });
assert.deepEqual(sent, [['Seoul Hotel']], 'submit trims and sends exactly one name argument');
assert.equal(find(view.elements, 'input', 'pnl-hotel-add-name').props.value, '   Seoul Hotel   ', 'successful parent handling does not eagerly clear the draft while open');

// A returned parent error keeps the typed value available for correction/retry.
view = renderer.render({ ...props, error: '저장에 실패했습니다.' });
markup = renderToStaticMarkup(view.tree);
assert.match(markup, /role="alert"/);
assert.match(markup, /저장에 실패했습니다\./);
assert.equal(find(view.elements, 'input', 'pnl-hotel-add-name').props.value, '   Seoul Hotel   ');

// Closing after success/error clears the next draft; changing busy/error while open does not.
view = renderer.render({ ...props, busy: true, error: '저장에 실패했습니다.' });
assert.equal(find(view.elements, 'input', 'pnl-hotel-add-name').props.value, '   Seoul Hotel   ', 'busy/error changes preserve the open draft');
renderer.render({ ...props, open: false });
view = renderer.render(props);
assert.equal(find(view.elements, 'input', 'pnl-hotel-add-name').props.value, '', 'reopening after close starts with a clean name');

// Input is capped at 80 characters; whitespace-only submission is rejected locally.
find(view.elements, 'input', 'pnl-hotel-add-name').props.onChange({ target: { value: ` ${'H'.repeat(90)}` } });
view = renderer.render(props);
assert.equal(find(view.elements, 'input', 'pnl-hotel-add-name').props.value.length, 80);
find(view.elements, 'input', 'pnl-hotel-add-name').props.onChange({ target: { value: '   ' } });
view = renderer.render(props);
find(view.elements, 'form').props.onSubmit({ preventDefault() {} });
assert.equal(sent.length, 1, 'blank input never calls the parent submit handler');
assert.match(renderToStaticMarkup(renderer.render(props).tree), /호텔명을 입력하세요\./);

// Escape closes, Shift+Tab/Tab wrap focus, and a pending submission disables controls and is ignored.
view = renderer.render(props);
const dialog = find(view.elements, 'section');
let prevented = false;
dialog.props.onKeyDown({ key: 'Escape', preventDefault() { prevented = true; } });
assert.equal(prevented, true);
assert.equal(closeCount, 1);
let tabPrevented = false;
dialog.props.onKeyDown({ key: 'Tab', target: view.focusableNodes.at(-1), shiftKey: false, preventDefault() { tabPrevented = true; } });
assert.equal(tabPrevented, true, 'Tab wraps from the last dialog control');
assert.equal(renderer.document.activeElement.tag, 'input');
const busyProps = { ...props, busy: true };
view = renderer.render(busyProps);
assert.ok(view.elements.filter(element => ['input', 'button'].includes(element.type)).every(element => element.props.disabled));
find(view.elements, 'form').props.onSubmit({ preventDefault() {} });
assert.equal(sent.length, 1, 'busy state blocks duplicate submissions');
find(view.elements, 'section').props.onKeyDown({ key: 'Escape', preventDefault() {} });
assert.equal(closeCount, 1, 'Escape cannot dismiss a pending submission');

// Responsive sizing remains bounded by the viewport instead of fixing desktop dimensions.
assert.match(source, /width: 'min\(460px, 100%\)'/);
assert.match(source, /maxHeight: 'calc\(100dvh - 24px\)'/);
assert.match(source, /overflowY: 'auto'/);
assert.match(source, /flexWrap: 'wrap'/);
assert.doesNotMatch(source, /dangerouslySetInnerHTML|\bfetch\s*\(|\/api\//i, 'component has no HTML injection or network/API behavior');

// Closing the dialog restores the element that had focus before it opened.
view = renderer.render({ ...props, open: false });
assert.equal(view.tree, null);
assert.equal(outsideFocus.focused, true);

console.log('Raum PNL hotel-add dialog tests passed');
