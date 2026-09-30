// 매출이익 보고서 계산 결과 스냅샷 — 지문·변경 설명·신선도 판정·연쇄(E=F(n-1)) + GET 읽기 전용 계약
// 실행: node __tests__/profitReportSnapshot.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed += 1; }
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/.*$/gm, '$1');

async function main() {
  const S = await import('../lib/profitReportSnapshot.js');

  console.log('\n=== 지문 창: 자기 차수 + 앞 4개, 연도 경계 ===');
  const w = S.fingerprintWindow('2026', '02');
  check('2026 02차 창 = 02,01,(2025)52,51,50', w.map((x) => `${x.year}-${x.major}`).join(',') === '2026-02,2026-01,2025-52,2025-51,2025-50');

  console.log('\n=== 지문 합성·변경 설명 ===');
  const map = new Map([
    ['SHIP:2026:35', '10|123|2026-09-01'], ['WH:2026:34', '5|9|x'], ['CUR::', '5|1|y'], ['WPR:2026:35', '2|7|z'],
  ]);
  const a = S.composeWeekFingerprint(map, '2026', '35', { calcVersion: 'v1', categoryFileHash: 'c' });
  const b = S.composeWeekFingerprint(new Map(map), '2026', '35', { calcVersion: 'v1', categoryFileHash: 'c' });
  check('같은 원천 → 같은 지문', a.hash === b.hash);
  check('창 밖(36차) 변경은 35차 지문에 영향 없음',
    S.composeWeekFingerprint(new Map([...map, ['SHIP:2026:36', '1|1|1']]), '2026', '35', { calcVersion: 'v1', categoryFileHash: 'c' }).hash === a.hash);
  const map2 = new Map(map); map2.set('WH:2026:34', '6|10|x2');
  const c = S.composeWeekFingerprint(map2, '2026', '35', { calcVersion: 'v1', categoryFileHash: 'c' });
  check('전차수 입고 변경 → 지문 변경', c.hash !== a.hash);
  const ch = S.describeFingerprintChanges(a.components, c.components);
  check('변경 설명 = 입고(구매) 상세 (2026 34차)', ch.length === 1 && ch[0].text === '입고(구매) 상세·GW/CW (2026 34차)', JSON.stringify(ch));
  const d = S.composeWeekFingerprint(map, '2026', '35', { calcVersion: 'v2', categoryFileHash: 'c' });
  check('계산식 버전 변경 → 계산식(배포 버전) 변경 표시', S.describeFingerprintChanges(a.components, d.components).some((x) => x.table === 'CALC'));

  console.log('\n=== 신선도 판정 + 연쇄 ===');
  const stored = { fingerprintHash: a.hash, fingerprint: a.components, prevPayloadHash: 'P34v1' };
  check('지문 동일 + 전차수 결과 동일 → fresh', S.evaluateSnapshot(stored, a, { payloadHash: 'P34v1', orderYear: '2026', major: '34' }).state === 'fresh');
  const chain = S.evaluateSnapshot(stored, a, { payloadHash: 'P34v2', orderYear: '2026', major: '34' });
  check('전차수 재계산으로 결과가 바뀌면 → stale(전차수 재계산)', chain.state === 'stale' && chain.changes.some((x) => x.table === 'PREV'), JSON.stringify(chain));
  check('원천 변경 → stale', S.evaluateSnapshot(stored, c, null).state === 'stale');
  check('저장본 없음 → missing', S.evaluateSnapshot(null, a, null).state === 'missing');
  check('전차수 저장본이 계산 당시 없었으면(prevPayloadHash null) 연쇄 판정 생략',
    S.evaluateSnapshot({ ...stored, prevPayloadHash: null }, a, { payloadHash: 'X' }).state === 'fresh');

  console.log('\n=== 저장 payload: 정적 manifest·snapshot 메타 제외, 해시 결정적 ===');
  const p1 = { rows: [{ category: 'A', auto: { N: 1 } }], manualInputManifest: { big: true }, snapshot: { state: 'fresh' } };
  check('payloadForStorage 가 manifest/snapshot 제외', !('manualInputManifest' in S.payloadForStorage(p1)) && !('snapshot' in S.payloadForStorage(p1)));
  check('snapshot 메타가 달라도 결과 해시 동일', S.payloadHashOf(p1) === S.payloadHashOf({ ...p1, snapshot: { state: 'stale' } }));

  console.log('\n=== GET 읽기 전용 계약(CLAUDE.md 규칙 1) ===');
  const lib = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportSnapshot.js'), 'utf8');
  const readFn = lib.slice(lib.indexOf('export async function readProfitReportWithSnapshot'), lib.indexOf('export async function readStoredOrLive'));
  check('readProfitReportWithSnapshot 파싱', readFn.length > 200);
  check('GET 경로 함수는 INSERT/recompute 를 호출하지 않음', !/insertSnapshot\(|recomputeAndStore\(|INSERT\s+INTO/i.test(strip(readFn)));
  const api = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  const getBlock = api.slice(api.indexOf("if (req.method === 'GET')"), api.indexOf("if (req.method === 'POST')"));
  check('API GET 블록에 refreshProfitReportSnapshot 없음', !/refreshProfitReportSnapshot\(/.test(strip(getBlock)));
  const postBlock = api.slice(api.indexOf("if (req.method === 'POST')"));
  check('API POST 에 snapshotRefresh 액션', /action === 'snapshotRefresh'[\s\S]{0,600}refreshProfitReportSnapshot\(/.test(postBlock));
  check('스냅샷 INSERT 는 웹 전용 테이블만', /INSERT INTO dbo\.\$\{SNAPSHOT_TABLE\}/.test(lib) && !/INSERT INTO (dbo\.)?(Shipment|Warehouse|Estimate|Product|Stock)/i.test(lib));
  const mig = fs.readFileSync(path.join(__dirname, '..', 'docs', 'migrations', '2026-09-30_profit_report_snapshot.sql'), 'utf8');
  check('마이그레이션: 불변 트리거', /INSTEAD OF UPDATE, DELETE/.test(mig));
  check('마이그레이션: ERP 공유 테이블 ALTER 없음', !/ALTER TABLE dbo\.(FreightCost|Shipment|Warehouse|Product)/i.test(mig));
  const deploy = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy.yml'), 'utf8');
  check('deploy.yml 이 마이그레이션 적용', /apply-profit-report-snapshot-migration\.mjs --apply/.test(deploy));

  console.log('\n=== 계산식 지문: 줄바꿈 무관, 계산 파일 포함 ===');
  const calc = require('../lib/profitReportCalcHash.cjs');
  const files = calc.listFiles(path.join(__dirname, '..'));
  check('계산 파일 포함(profitReport.js·customsForwarding.js·freightCalc.js·API)', ['lib/profitReport.js', 'lib/customsForwarding.js', 'lib/freightCalc.js', 'pages/api/sales/profit-report.js'].every((f) => files.includes(f)));
  check('스냅샷/점검 모듈 자체는 제외', !files.includes('lib/profitReportSnapshot.js') && !files.includes('lib/profitReportWeekCheck.js'));
  check('next.config.js 가 PROFIT_REPORT_CALC_HASH 주입', /PROFIT_REPORT_CALC_HASH/.test(fs.readFileSync(path.join(__dirname, '..', 'next.config.js'), 'utf8')));

  if (failed) { console.error(`\n${failed} failed`); process.exit(1); }
  console.log('\nall passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
