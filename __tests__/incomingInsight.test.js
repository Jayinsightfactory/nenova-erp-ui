// __tests__/incomingInsight.test.js — 입고 인사이트: SQL이 읽기 전용인지, 수량 규칙/판정 태그가 계약대로인지 (DB 불필요)
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = process.cwd();
const src = fs.readFileSync(path.join(root, 'pages/api/incoming/insight.js'), 'utf8');
const eta = fs.readFileSync(path.join(root, 'pages/api/incoming/eta.js'), 'utf8');

// 1) 읽기 전용: INSERT/UPDATE/DELETE/MERGE/EXEC 없음
for (const s of [src, eta]) assert.ok(!/(INSERT|UPDATE|DELETE|MERGE|EXEC|TRUNCATE)/i.test(s.replace(/\/\/.*$/gm, '')), 'SQL 쓰기 금지');
// 2) 수량 정답 쿼리(Product.OutUnit CASE) 사용, ShipmentDetail은 OutQuantity 단일값
assert.ok(/p\.OutUnit IN \(N'박스'/.test(src) && /OutQuantity/.test(src), 'OutUnit CASE + OutQuantity');
// 3) isDeleted는 마스터(om/wm/sm)로만 — sd./wd. isDeleted 금지 (컬럼 없음 → 500)
assert.ok(!/(sd|wd)\.isDeleted/.test(src) && !/wm\.isDeleted.*wd\./.test(''), 'ShipmentDetail/WarehouseDetail isDeleted 금지');
assert.ok(/om\.isDeleted/.test(src) && /wm\.isDeleted/.test(src) && /sm\.isDeleted/.test(src), '마스터 isDeleted 필터');
// 4) ETA 저장은 파일(data/incoming-eta.json) + 단계 집합
assert.ok(/incoming-eta\.json/.test(eta) && /\['발주', '선적', '통관중', '도착', '입고등록'\]/.test(eta), 'ETA 파일 저장·단계');
// 5) 판정 태그 규칙(대사)
const tag = (ordered, received) => { const diff = received - ordered; return ordered === 0 && received > 0 ? '미발주' : received === 0 && ordered > 0 ? '미입고' : diff < 0 ? '부족' : diff > 0 ? '초과' : '일치'; };
assert.deepStrictEqual([tag(10, 0), tag(0, 5), tag(10, 8), tag(10, 12), tag(10, 10)], ['미입고', '미발주', '부족', '초과', '일치']);
assert.ok(src.includes("'미발주' : r.received === 0 && r.ordered > 0 ? '미입고'"), '판정 규칙이 API에 그대로');
console.log('incoming insight contract tests passed: 읽기전용·OutUnit 수량·마스터 isDeleted·ETA 파일저장·판정 태그');
// 6) 드라이브 AWB 시트 파일명 인식(가브리엘 운임 시트 규칙) — 소스에서 정규식·사전을 그대로 평가(DB 불필요)
{
  const re = new RegExp(eta.match(/const AWB_FILE_RE = \/(.+)\/i;/)[1], 'i');
  const ok = ['33-02_Apollo_AWB_006-45462001.xlsx', '21-01_FREIGHTWISE_AWB_992-01528181 (1).xlsx', '26-01_Freightwise Ecuador_AWB_00645434174.xlsx', '30-02_Apollo_AWB_160-10740586 (10).xlsx'];
  for (const n of ok) assert.ok(re.test(n), 'AWB 파일명 인식: ' + n);
  for (const n of ['20-02_CO_AYU_13790.xlsx', 'nenova_26-1_lista.xlsx', '22차 콜롬비아 AWB운임비.xlsx']) assert.ok(!re.test(n), 'AWB 아님: ' + n);
  const m = re.exec(ok[0]); assert.strictEqual(m[1] + '-' + m[2], '33-02'); assert.strictEqual(m[3], 'Apollo'); assert.strictEqual(m[4].replace(/\D/g, ''), '00645462001');
}
// 7) 농장 별칭 사전(lib/farmAlias): 정규화·순환 방지·그룹 제안 (파일 I/O 없이 map 주입)
{
  const fa = fs.readFileSync(path.join(root, 'lib/farmAlias.js'), 'utf8');
  assert.ok(!/(query|UPDATE|INSERT|DELETE)/.test(fa.replace(/\/\/.*$/gm, '')), '별칭 사전은 DB를 건드리지 않는다(파일 전용)');
  const alias = fs.readFileSync(path.join(root, 'pages/api/incoming/farm-alias.js'), 'utf8');
  assert.ok(!/(INSERT|UPDATE|DELETE|MERGE|EXEC)\s/i.test(alias.replace(/\/\/.*$/gm, '')), '별칭 API SQL 쓰기 금지');
  assert.ok(/view === 'lista'/.test(src) && /view === 'awbcalc'/.test(src) && /WebSalesDefectDeduction d LEFT JOIN Product/.test(src), 'lista·awbcalc 뷰');
  // 산식 상수: 원본 시트(nenova_26-1_lista) 단위 사전과 Lote 접두
  assert.ok(/'c' : .*'r' : .*'s' : ''/.test(src.match(/const LOTE_PREFIX[^\n]*/)[0]), 'Lote 접두 c/r/s');
}
// 8) 별칭 사전 동작: 그룹 제안·대표명 치환·순환 방지 (import 제거 후 평가)
{
  const strip = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/^import .*$/mg, '').replace(/^export /mg, '');
  const code = strip('lib/farmRemitImport.js').split('\n').filter((l) => /^const (LEGAL_RE|normName)/.test(l)).join('\n') + '\n' + strip('lib/farmAlias.js').replace(/const FILE = .*$/m, '').replace(/function readAliases[^\n]*\n/, 'function readAliases(){return {}}\n');
  const { suggestGroups, makeCanon, setAlias } = new Function('fs', 'path', code + '; return { suggestGroups, makeCanon, setAlias };')(fs, path);
  const g = suggestGroups(['Colibri', 'Colibri Flowers', 'COLIBRI FLOWERS S.A.S', 'Premium Greens', 'PREMIUM GREENS ', 'Don Eusebio', 'Apollo', 'Matina Flowers', 'matina'], {});
  assert.deepStrictEqual(g.map((x) => x.canonical).sort(), ['Colibri', 'Premium Greens', 'matina'].sort(), '그룹 제안: ' + JSON.stringify(g));
  assert.strictEqual(g.find((x) => x.canonical === 'Colibri').names.length, 3);
  const m = setAlias({}, 'Colibri Flowers', 'Colibri'); setAlias(m, 'COLIBRI FLOWERS S.A.S', 'Colibri'); setAlias(m, 'Colibri', 'Colibri Flowers'); // 순환 시도
  const canon = makeCanon(m);
  assert.strictEqual(canon('colibri flowers s.a.s'), 'Colibri'); assert.strictEqual(canon('Apollo'), 'Apollo');
  assert.ok(['Colibri', 'Colibri Flowers'].includes(canon('Colibri')), '순환은 3단계에서 멈춘다');
  assert.strictEqual(suggestGroups(['Colibri', 'Colibri Flowers'], m).length, 0, '등록된 별칭은 다시 제안하지 않음');
}
// 9) AWB는 WarehouseMaster.OrderNo (컬럼명 AWB 없음 → 'Invalid column name' 500)
for (const s of [src, eta]) assert.ok(!/wm\.AWB\b|SELECT AWB FROM WarehouseMaster|\bAWB IS NOT NULL/.test(s), 'AWB 컬럼은 OrderNo AS AWB 로');
// 10) 계산기 저장은 웹 파일 전용(DB 접근 없음) + lista Variedad는 한글 품목군 접두 제거
{
  const fc = fs.readFileSync(path.join(root, 'pages/api/incoming/freight-calc.js'), 'utf8') + fs.readFileSync(path.join(root, 'lib/awbFreightCalc.js'), 'utf8');
  assert.ok(!/lib\/db|WebArrivalCost|\bINSERT\b|\bUPDATE\b/.test(fc.replace(/\/\/.*$/gm, '')), '계산기 저장은 DB·도착원가 테이블에 쓰지 않는다');
  const vari = (p, c) => { const pn = String(p || '').replace(/^[가-힣()\s]+/, '').trim(); return [pn || (c ? '' : p), c].filter(Boolean).join(' ').toLowerCase(); };
  assert.deepStrictEqual([vari('카네이션 novia', ''), vari('카네이션', 'novia'), vari('장미', 'spray fairy lola'), vari('ruscus', ''), vari('기타', '')], ['novia', 'novia', 'spray fairy lola', 'ruscus', '기타']);
}
// 11) useEffect에 Promise 반환 함수를 직접 넘기지 않는다(React가 cleanup으로 호출 → 't is not a function' 클라이언트 크래시)
{
  const page = fs.readFileSync(path.join(root, 'pages/import/freight-calc.js'), 'utf8');
  assert.ok(!/useEffect\((load|loadSaved),/.test(page), 'useEffect(fn) 직접 전달 금지 — () => { fn(); } 로');
}
