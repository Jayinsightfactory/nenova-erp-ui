// 회귀 방어 eval 러너 — gold_outputs/*.json 의 기대값과 실제 함수 출력을 값 하나까지 비교한다.
// 실행: npm run eval   (DB·네트워크·.env 불필요, 새 의존성 없음)
// 종료코드: 전부 일치 0 / 하나라도 다르면 1 / 케이스 파일 오류 2
'use strict';
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const root = path.resolve(__dirname, '..');
const goldDir = path.join(root, 'gold_outputs');

// expected 의 모든 말단(leaf) 값을 'a.b[0].c' 경로로 펼친다. 말단은 숫자·문자열·불리언·null·빈 배열/객체.
function flatten(value, prefix, out) {
  if (value !== null && typeof value === 'object') {
    const keys = Array.isArray(value) ? value.map((_, i) => i) : Object.keys(value);
    if (keys.length === 0) { out.push([prefix, value]); return out; }
    for (const k of keys) flatten(value[k], Array.isArray(value) ? `${prefix}[${k}]` : (prefix ? `${prefix}.${k}` : String(k)), out);
  } else out.push([prefix, value]);
  return out;
}
function pick(actual, p) {
  let cur = actual;
  for (const tok of p.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean)) {
    if (cur === null || cur === undefined) return undefined;
    cur = cur[tok];
  }
  return cur;
}
function same(exp, act, tol) {
  if (typeof exp === 'number' && typeof act === 'number') return tol > 0 ? Math.abs(exp - act) <= tol : Object.is(exp, act) || exp === act;
  if (exp !== null && typeof exp === 'object') return JSON.stringify(exp) === JSON.stringify(act);
  return exp === act;
}
const show = (v) => (v === undefined ? '(없음)' : JSON.stringify(v));

async function main() {
  const files = fs.readdirSync(goldDir).filter((f) => f.endsWith('.json')).sort();
  if (!files.length) { console.error('gold_outputs/*.json 이 없습니다.'); process.exit(2); }
  const diffs = [];
  let total = 0, passed = 0;
  for (const f of files) {
    let gold;
    try { gold = JSON.parse(fs.readFileSync(path.join(goldDir, f), 'utf8')); } catch (e) { console.error(`${f}: JSON 오류 ${e.message}`); process.exit(2); }
    for (const need of ['id', 'module', 'export', 'source', 'cases']) {
      if (!gold[need] || (need === 'source' && !gold.source.length)) { console.error(`${f}: 필수 항목 '${need}' 없음 (근거 출처 없는 케이스는 만들지 않는다)`); process.exit(2); }
    }
    const mod = await import(pathToFileURL(path.join(root, gold.module)).href);
    const fn = mod[gold.export] || (mod.default && mod.default[gold.export]);
    if (typeof fn !== 'function') { console.error(`${f}: ${gold.module} 에 함수 ${gold.export} 없음`); process.exit(2); }
    for (const c of gold.cases) {
      total += 1;
      let actual, error = null;
      try { actual = await fn(...c.input); } catch (e) { error = e; }
      const rows = [];
      if (error) rows.push(['(예외)', show(c.expected), `throw ${error.message}`]);
      else for (const [p, exp] of flatten(c.expected, '', [])) {
        const act = pick(actual, p);
        if (!same(exp, act, c.tolerance || 0)) rows.push([p || '(값)', show(exp), show(act)]);
      }
      if (rows.length) rows.forEach((r) => diffs.push([`${gold.id} / ${c.name}`, ...r]));
      else passed += 1;
      console.log(`${rows.length ? 'FAIL' : 'ok  '} ${gold.id} / ${c.name}`);
    }
  }
  console.log(`\n${passed}/${total} 케이스 일치 (파일 ${files.length}개)`);
  if (diffs.length) {
    console.log('\n차이 표 (케이스 | 항목 | 기대값 | 실제값)');
    diffs.forEach((d) => console.log(d.join(' | ')));
    process.exit(1);
  }
}
main().catch((e) => { console.error(e); process.exit(2); });
