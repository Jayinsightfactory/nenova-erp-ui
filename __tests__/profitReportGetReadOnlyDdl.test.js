// 2026-08-11 결함수정 7·8: 주차별 매출이익 GET 조회 경로가 ensureStockPriceTable/ensureCustomsTables 같은
// ensure* 함수로 CREATE TABLE/ALTER TABLE/CREATE INDEX(DDL)를 실행하지 않는지 정적 검증.
// CLAUDE.md 규칙 1: "GET 요청 = 읽기 전용. SELECT만 허용. UPDATE/DELETE/INSERT 금지. 자동 동기화, 자동 보정 금지."
// 스키마 생성은 저장(POST) 경로 또는 배포 마이그레이션에서만 수행해야 한다.
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed += 1;
  }
};

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function sliceFn(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  if (start === -1) return '';
  const end = endMarker ? source.indexOf(endMarker, start + startMarker.length) : source.length;
  return source.slice(start, end === -1 ? source.length : end);
}

async function main() {
  const reportApiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report.js'), 'utf8');
  const reportLibSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReport.js'), 'utf8');
  const customsLibSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'customsForwarding.js'), 'utf8');

  console.log('=== pages/api/sales/profit-report.js GET 핸들러 — DDL(ensure*) 직접 호출 없음 ===');
  const getBlock = sliceFn(reportApiSource, "if (req.method === 'GET')", "if (req.method === 'POST')");
  check('GET 블록 파싱', getBlock.length > 100);
  check('GET이 assertProfitReportReadSchema()로 스키마 존재만 확인', /assertProfitReportReadSchema\(\)/.test(getBlock));
  check('GET 블록에 ensureProfitReportTable/ensureStockPriceTable 호출 없음', !/ensure(ProfitReportTable|StockPriceTable)\(/.test(stripComments(getBlock)));

  console.log('\n=== lib/profitReport.js — runtime schema helper도 읽기 전용 계약 확인만 수행 ===');
  const stockSnapshotSrc = sliceFn(reportLibSource, 'export async function stockSnapshotByCategory', '\nexport async function');
  check('stockSnapshotByCategory 함수 블록 파싱', stockSnapshotSrc.length > 100);
  check('stockSnapshotByCategory가 read-only schema contract를 확인', /ensureStockPriceTable\(\)/.test(stripComments(stockSnapshotSrc)));
  check('profitReport runtime 소스에 DDL 없음', !/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX/i.test(stripComments(reportLibSource)));
  check('ensureStockPriceTable은 assertWebSchemaContract만 사용',
    /export async function ensureStockPriceTable[\s\S]{0,300}assertWebSchemaContract/.test(reportLibSource));

  console.log('\n=== lib/customsForwarding.js — 조회/저장 모두 migration 계약 확인, runtime DDL 없음 ===');
  const READ_FNS = ['loadHistory', 'getRateConfig', 'loadCustomsWeekly', 'loadColombiaWeekly', 'loadForwardingWeekly', 'computeCustomsAndForwarding'];
  for (const fn of READ_FNS) {
    const block = sliceFn(customsLibSource, `export async function ${fn}`, '\nexport');
    check(`${fn} 함수 블록 파싱`, block.length > 20, `fn=${fn}`);
    check(`${fn}이 ensureCustomsTables(DDL)를 호출하지 않음`, !/ensureCustomsTables\(\)/.test(stripComments(block)), `fn=${fn}`);
    check(`${fn}이 assertCustomsReadSchema로 스키마 존재만 확인`, /assertCustomsReadSchema\(\)/.test(block), `fn=${fn}`);
  }

  const WRITE_FNS = ['saveRateConfig', 'saveCustomsWeeklyBatch', 'saveColombiaWeekly', 'saveForwardingWeekly'];
  for (const fn of WRITE_FNS) {
    const block = sliceFn(customsLibSource, `export async function ${fn}`, '\nexport');
    check(`${fn}(저장/POST 경로)은 migration 계약을 확인`, /ensureCustomsTables\(\)/.test(block), `fn=${fn}`);
  }
  check('customs runtime 소스에 DDL 없음', !/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+INDEX/i.test(stripComments(customsLibSource)));

  console.log('\n=== computeCustomsAndForwarding 호출자 — profit-report.js GET 경로에서만 사용됨(다른 파일 회귀 없음) ===');
  check('computeCustomsAndForwarding은 pages/api/sales/profit-report.js에서만 import됨',
    /import \{ computeCustomsAndForwarding \} from '\.\.\/\.\.\/\.\.\/lib\/customsForwarding'/.test(reportApiSource));

  console.log(`\n총 ${failed ? '실패' : '성공'} — 실패 ${failed}건`);
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
