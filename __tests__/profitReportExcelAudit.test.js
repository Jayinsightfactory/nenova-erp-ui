// 확정엑셀 대조 감사 — 파서·대조·분류 순수 함수 + API/화면 계약 검증.
// 실행: node __tests__/profitReportExcelAudit.test.js
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, condition, detail = '') => {
  if (condition) console.log(`  ✓ ${label}`);
  else { failed += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); }
};

async function main() {
  const XLSX = await import('xlsx');
  const {
    parseProfitWorkbookSheet, diffProfitReportAgainstWorkbook, classifyDiffCause, formatRuleBasedSummary,
  } = await import('../lib/profitReportExcelAudit.js');

  console.log('=== 원본 양식 첫 시트 파싱 ===');
  const sheet = {};
  const put = (addr, v) => { sheet[addr] = { v, t: typeof v === 'number' ? 'n' : 's' }; };
  put('B1', '주차별 매출이익 보고서-31차');
  put('B6', '품명'); put('C6', '매출액');
  put('B7', '콜롬비아 수국'); put('C7', 1000000); put('H7', 495467); put('N7', 990000); put('O7', 10000);
  put('B8', '베트남'); put('C8', 500000); put('J8', 120000);
  put('C9', 1500000); put('H9', 495467); // 합계행(품명 없음)
  put('B11', '비고사항');
  sheet['!ref'] = 'B1:U12';
  const wb = { SheetNames: ['주차별 매출이익 보고서'], Sheets: { '주차별 매출이익 보고서': sheet } };
  const parsed = parseProfitWorkbookSheet(wb);
  check('품명 행 2건 추출', Object.keys(parsed.rows).length === 2, JSON.stringify(Object.keys(parsed.rows)));
  check('셀 값 매핑(H열 그외통관비)', parsed.rows['콜롬비아 수국'].H === 495467);
  check('합계행 분리 추출', parsed.total && parsed.total.C === 1500000);
  check('비고 행은 본표에서 제외', !('비고사항' in parsed.rows));

  console.log('=== 대조·분류 규칙 (26~31차 확정 체계) ===');
  const webRow = (category, calc, extra = {}) => ({
    category, calc, manual: {}, auto: {}, source: {}, stockSourceKind: {}, ...extra,
  });
  const baseCalc = { C: 0, E: 0, F: 0, G: 0, H: 0, I: 0, J: 0, L: 0, N: 0, O: 0, Q: 0, R: 0, S: 0 };
  // ① N/O 상쇄 → 표시 위치 차이(expected)
  const offset = diffProfitReportAgainstWorkbook({
    webRows: [webRow('태국', { ...baseCalc, N: 100000, O: -50000 })],
    webTotals: null,
    workbookRows: { '태국': { N: 93181, O: -43181 } },
    workbookTotal: null,
  });
  check('N/O 같은 금액 상쇄는 expected(분류 위치 차이)',
    offset.diffs.length === 2 && offset.diffs.every(d => d.severity === 'expected' && d.cause === 'sales_reclass_display'));
  // ② H gw_auto → 통관비 미입력(review)
  const customs = classifyDiffCause({ col: 'H', category: '중국', webRow: webRow('중국', baseCalc, { source: { H: 'gw_auto' } }), dExcelMinusWeb: 500000, pair: {} });
  check('H gw_auto 차이는 통관비 미입력(review)', customs.cause === 'customs_not_entered' && customs.severity === 'review');
  // ③ 매출 차이 → 차수귀속(매출조정 안내)
  const rev = classifyDiffCause({ col: 'C', category: '베트남', webRow: webRow('베트남', baseCalc), dExcelMinusWeb: 4576000, pair: {} });
  check('C 차이는 차수귀속 → 매출조정(AC) 안내', rev.cause === 'revenue_attribution' && /매출조정/.test(rev.label));
  // ④ 전산에만 있는 매입(웹>엑셀) → expected(전산 우선)
  const purchase = classifyDiffCause({ col: 'G', category: '호주', webRow: webRow('호주', baseCalc), dExcelMinusWeb: -15224991, pair: {} });
  check('전산에만 있는 매입은 전산 우선(expected)', purchase.cause === 'erp_only_purchase' && purchase.severity === 'expected');
  // ⑤ 재고 근사치 → expected
  const stock = classifyDiffCause({ col: 'F', category: '태국', webRow: webRow('태국', baseCalc, { stockSourceKind: { end: 'category_average_fallback' } }), dExcelMinusWeb: 300000, pair: {} });
  check('재고 근사치(원본공식) 차이는 expected', stock.cause === 'stock_valuation_approx' && stock.severity === 'expected');
  // ⑥ 완전 일치 요약
  const clean = formatRuleBasedSummary({ major: '31', diffs: [], totalDiffs: [], counts: { review: 0, expected: 0 } });
  check('일치 시 한 문장 요약', /일치/.test(clean));

  console.log('=== API·화면 계약 ===');
  const apiSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'api', 'sales', 'profit-report-excel-audit.js'), 'utf8');
  const libSource = fs.readFileSync(path.join(__dirname, '..', 'lib', 'profitReportExcelAudit.js'), 'utf8');
  const pageSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'sales', 'profit-report.js'), 'utf8');
  check('API는 withAuth + multipart(bodyParser off)', apiSource.includes('withAuth(') && apiSource.includes('bodyParser: false') && apiSource.includes('formidable('));
  check('API는 읽기 전용(웹 저장/DB 쓰기 없음)', !/saveManual|INSERT INTO|UPDATE |MERGE /.test(apiSource));
  check('LLM 키 없으면 규칙 요약 폴백', libSource.includes('process.env.ANTHROPIC_API_KEY') && libSource.includes('if (!apiKey) return null') && apiSource.includes('ruleSummary'));
  check('LLM 비용은 costTracker에 기록', libSource.includes("purpose: 'profit-excel-audit'"));
  check('화면에 확정엑셀 대조 버튼 + 업로드 흐름', pageSource.includes('확정엑셀 대조') && pageSource.includes('profit-report-excel-audit') && pageSource.includes("append('file'"));
  check('소견/규칙요약을 화면에 표시', pageSource.includes('llmOpinion') && pageSource.includes('ruleSummary'));

  console.log(`\n${failed === 0 ? '✅ 확정엑셀 대조 테스트 전부 통과' : `❌ ${failed}건 실패`}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
