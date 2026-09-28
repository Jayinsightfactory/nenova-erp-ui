const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path'), Module = require('module');
const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
const { transformSync } = require('next/dist/build/swc');
function compile(relative, custom) {
  const filename = path.resolve(__dirname, '..', relative), m = new Module(filename, module);
  m.filename = filename; m.paths = Module._nodeModulePaths(path.dirname(filename));
  if (custom) m.require = custom;
  m._compile(transformSync(fs.readFileSync(filename, 'utf8'), { filename, jsc: { parser: { syntax: 'ecmascript', jsx: true }, target: 'es2022', transform: { react: { runtime: 'automatic' } } }, module: { type: 'commonjs' } }).code, filename);
  return m.exports;
}
const policy = compile('lib/workDriveCategories.js');
const { fileSubcategory, filterCategories, subcategoryCounts, subcategories } = policy;
const examples = [
  ['발주', '38차 발주서.xlsx', '발주·주문서'], ['발주', '컨펌률.xlsx', '컨펌·확정'],
  ['입고', '38-02_NL_H_PROFORMA.xlsx', '인보이스·Proforma'], ['입고', '중국 패킹리스트.xlsx', '패킹리스트'],
  ['원가·운임', '38-2 NL 원가자료.xlsx', '원가자료'], ['원가·운임', '운임비.xlsx', '운임·물류'],
  ['출고', '44차 양재동 차감내역.xlsx', '차감내역'], ['견적·거래처', '예상 가격표.xlsx', '단가·가격표'],
  ['송금·경영', '지출결의서 250829 청구서.xlsx', '지출결의'], ['송금·경영', '외화송금신청서.pdf', '송금·결제'],
  ['송금·경영', '(주)네노바_하나은행 외화계좌.pdf', '계좌·사업자서류'], ['송금·경영', '6월 매출이익 보고서.xlsx', '손익·매출보고'],
  ['품질', '38-1 Quality Issue.pdf', '품질·이슈보고'], ['품질', '농장 피드백 불량.pdf', '피드백·개선'],
  ['미분류', '사진.PNG', '이미지'], ['미분류', '기록.XLSX', '엑셀·CSV'], ['미분류', '알수없음.zip', '기타 파일'],
  ['발주', '수동교정 운임.pdf', '기타 발주'],
];
for (const [stage, filename, expected] of examples) assert.equal(fileSubcategory({ stage, filename }), expected, filename);
const stages = [...new Set(examples.map(([stage]) => stage))];
const files = examples.map(([stage, filename], i) => Object.freeze({ id: String(i), stage, filename, ext: filename.split('.').pop().toLowerCase(), uploaderName: '담당자', dept: '영업', uploadedAt: '2026-09-28T09:00:00Z', mtime: '2026-09-28T09:00:00Z', cycle: '38-1', size: 100 }));
const snapshot = JSON.stringify(files);
for (const stage of stages) {
  const counts = subcategoryCounts(files, stage);
  assert.equal(Object.values(counts).reduce((a,b) => a+b, 0), files.filter(f => f.stage === stage).length);
  for (const sub of subcategories(stage)) assert.equal(filterCategories(files, stage, sub).length, counts[sub]);
}
assert.equal(filterCategories(files, '', 'stale').length, files.length);
assert.equal(JSON.stringify(files), snapshot);
let values = {}, index = 0, setters = {};
const Page = compile('pages/work/drive.js', name => name === 'react' ? { ...React, useState(v) { const i = index++; return [Object.hasOwn(values, i) ? values[i] : v, n => { setters[i] = n; }]; }, useMemo: f => f(), useEffect() {} } : name === '../../lib/workDriveCategories' ? policy : require(name)).default;
const data = { files, stages, me: '담당자', dept: '영업', isAdmin: true };
function tree(v = {}) { values = { 0: data, ...v }; index = 0; setters = {}; return Page(); }
function render(v) { return renderToStaticMarkup(tree(v)); }
let html = render({ 6: 'list', 7: '송금·경영', 18: '지출결의' });
assert(html.indexOf('aria-label="연도별 차수"') < html.indexOf('<main'));
assert(html.indexOf('aria-label="PC별 업로드 현황"') > html.indexOf('</main>'));
assert.match(html, /지출결의서 250829 청구서/); assert.doesNotMatch(html, /외화송금신청서.pdf/);
for (const mode of ['kanban', 'list', 'recent']) {
  html = render({ 6: mode, 7: '원가·운임', 18: '원가자료' });
  assert.match(html, /38-2 NL 원가자료.xlsx/); assert.doesNotMatch(html, /운임비.xlsx/);
}
html = render({ 5: '외화', 7: '송금·경영', 18: '송금·결제' });
assert.match(html, /외화송금신청서.pdf/); assert.doesNotMatch(html, /하나은행 外/);
html = render({ 0: { ...data, isAdmin: false } }); assert.doesNotMatch(html, /aria-label="PC별 업로드 현황"/);
html = render({ 19: false }); assert.match(html, /aria-expanded="false"/); assert.doesNotMatch(html, /오늘 \/ 전체 파일/);
function find(el, predicate) {
  if (!el || typeof el !== 'object') return null;
  if (predicate(el)) return el;
  for (const child of React.Children.toArray(el.props?.children)) { const found = find(child, predicate); if (found) return found; }
  return null;
}
const root = tree({ 7: '송금·경영', 18: '지출결의' });
const major = find(root, e => e.type === 'button' && React.Children.toArray(e.props.children).includes('입고'));
assert(major); major.props.onClick(); assert.equal(setters[7], '입고'); assert.equal(setters[18], '');
console.log('work-drive: subcategories, precedence, immutable major category, count conservation, layout order, permission and all view filters passed');
