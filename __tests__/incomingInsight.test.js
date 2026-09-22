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
