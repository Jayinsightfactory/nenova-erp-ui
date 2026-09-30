// 매출원가 양식 원천시트 골든 테스트 — docs/contracts/profit-workbook.json
// fixture: __tests__/fixtures/profit-workbook-golden.json (scripts/golden/build-profit-workbook-fixture.mjs 로 생성:
//   샘플 워크북 22·25·27·28차 원천시트 + 같은 차수 ERP 원천행 스냅샷). DB 접속 없이 오프라인 검증.
//  1) 샘플 셀 대조(엑셀에만 있는 수기행 제외) — 시트별 일치율 하한
//  2) 스냅샷 기준 100%: 스냅샷(ERP행+수기행) → 양식 엑셀 → 다시 열기 → 시트별 행수·합계 100% 일치
//  3) 템플릿 재오픈: 시트 순서·본표 수식·원천시트 분류식(행별 상대참조) 유지
//  4) 스냅샷 불변: 분배 변경 후 최신화해도 이전 버전 행이 바뀌지 않음 + DB 트리거·SQL 소스 계약
const fs = require('fs');
const path = require('path');

let failed = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ✓ ${label}`);
  else { console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`); failed += 1; }
};
const root = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

// 시트별 일치율 하한(엑셀에만 있는 수기행 제외, 2026-09-30 실측: 판매 99.1~100 / 불량 100 / 그외 98.6~100 / 구매 95.0~98.4)
const FLOOR = { sales: 0.99, defect: 0.99, other: 0.98, purchase: 0.94 };

async function main() {
  const R = await import('../lib/profitWorkbookRules.js');
  const X = await import('../lib/profitWorkbookExcel.js');
  const ExcelJS = require('exceljs');
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'profit-workbook-golden.json'), 'utf8'));

  console.log('=== 1) 샘플 워크북 셀 대조(수기행 제외) ===');
  const specs = {
    sales: (w) => R.compareMaps(R.excelSalesMap(w.excel.sales), R.rowsSalesMap(w.rows), ['qty', 'vat', 'supply']),
    defect: (w) => R.compareMaps(R.excelDeductMap(w.excel.defect), R.rowsDeductMap(w.rows, 'defect'), ['qty', 'supply']),
    other: (w) => R.compareMaps(R.excelDeductMap(w.excel.other), R.rowsDeductMap(w.rows, 'other'), ['qty', 'supply']),
    purchase: (w) => R.compareMaps(R.excelPurchaseMap(w.excel.purchase), R.rowsPurchaseMap(w.rows), ['usd'], 0.05),
  };
  const nFields = { sales: 3, defect: 2, other: 2, purchase: 1 };
  for (const wk of ['22', '25', '27', '28']) {
    const w = fx.weeks[wk];
    check(`${wk}차 fixture 존재`, Boolean(w));
    if (!w) continue;
    for (const [sheet, fn] of Object.entries(specs)) {
      const c = fn(w);
      const denom = c.cells - c.onlyX * nFields[sheet];
      const pct = denom ? c.ok / denom : 1;
      check(`${wk}차 ${R.SHEET_LABEL[sheet]} 셀일치 ${(pct * 100).toFixed(1)}% ≥ ${FLOOR[sheet] * 100}% (수기행 ${c.onlyX} 제외, DB만 ${c.onlyD})`, pct >= FLOOR[sheet]);
    }
  }

  console.log('\n=== 2) 스냅샷 기준 행수·합계 100% (스냅샷 → 양식 엑셀 → 재오픈) ===');
  const tplBuf = fs.readFileSync(path.join(root, 'data', 'profit-workbook-template.xlsx'));
  for (const wk of ['22', '28']) {
    const w = fx.weeks[wk];
    // 엑셀에만 있는 행 = 수기행으로 스냅샷에 추가(설계: 매칭 안 되는 행은 수기행)
    const edits = [];
    const D = R.rowsDeductMap(w.rows, 'other');
    for (const r of w.excel.other) {
      if (!r[1] || typeof r[5] !== 'number') continue;
      if (D.has(`${R.custKeyOf(r[1])}|${R.normText(r[8])}`)) continue;
      edits.push({ op: 'addRow', sheet: 'other', rowKey: `M:other:${edits.length}`, data: { custName: r[1], typeName: r[2], qty: r[3], unitCost: r[4], supply: r[5], vat: r[6], prodName: r[8] || '' } });
    }
    const snap = R.applyEdits(w.rows, edits, { by: '강명훈', at: '2026-09-30T00:00:00Z' });
    const totals = R.sheetTotals(snap);
    const buf = await X.buildProfitWorkbookXlsx({ major: wk, rows: snap, templateBuffer: tplBuf });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    for (const [sheet, lay] of Object.entries(X.SOURCE_SHEET_LAYOUT)) {
      const ws = wb.getWorksheet(lay.name);
      let rows = 0; let money = 0;
      const moneyCol = sheet === 'purchase' ? 'G' : (sheet === 'sales' ? 'E' : 'F');
      for (let r = lay.firstRow; r <= ws.rowCount; r += 1) {
        const b = ws.getCell(`B${r}`).value;
        if (b == null || b === '') continue;
        rows += 1; money += Number(ws.getCell(`${moneyCol}${r}`).value) || 0;
      }
      const t = totals[sheet];
      const expMoney = sheet === 'purchase' ? t.usd : t.supply;
      check(`${wk}차 ${lay.name} 행수 ${rows} = 스냅샷 ${t.rows}`, rows === t.rows);
      check(`${wk}차 ${lay.name} 합계 ${Math.round(money * 100) / 100} = 스냅샷 ${expMoney}`, Math.abs(money - expMoney) < 0.01);
    }
    check(`${wk}차 수기행 ${edits.length}건 포함(RowKey M:, 작성자 기록)`, snap.filter((r) => R.isManualRowKey(r.rowKey)).every((r) => r.manualBy === '강명훈'));
  }

  console.log('\n=== 3) 템플릿 재오픈: 시트 순서·수식 유지 ===');
  const tpl = new ExcelJS.Workbook(); await tpl.xlsx.load(tplBuf);
  const order = tpl.worksheets.map((s) => s.name);
  check('템플릿 시트 순서 = 원본 11개', order.join('|') === '주차별 매출이익 보고서|재고잔량|그외통관비|구매현황|포워딩|판매현황|불량차감|그 외 매출액|콜롬비아 1차|콜롬비아 2차|품목리스트', order.join('|'));
  const out = new ExcelJS.Workbook();
  await out.xlsx.load(await X.buildProfitWorkbookXlsx({ major: '28', rows: fx.weeks['28'].rows, templateBuffer: tplBuf }));
  check('출력 시트 순서 = 템플릿', out.worksheets.map((s) => s.name).join('|') === order.join('|'));
  const main = out.getWorksheet('주차별 매출이익 보고서');
  check('본표 N7 = 판매현황 SUMIF 수식 유지', /SUMIF\(판매현황!I:I/.test(main.getCell('N7').formula || ''));
  check('본표 Q7 = 구매현황 SUMIF 수식 유지', /SUMIF\(구매현황!N:N/.test(main.getCell('Q7').formula || ''));
  check('본표 제목 차수 반영', main.getCell('B1').value === '주차별 매출이익 보고서-28차');
  const sales = out.getWorksheet('판매현황');
  const nSales = fx.weeks['28'].rows.filter((r) => r.sheet === 'sales').length;
  const lastRow = 3 + nSales;
  check('판매현황 I열 분류식이 마지막 데이터행까지 행별 상대참조', /CLEAN\(B4\)/.test(sales.getCell('I4').formula || '') && new RegExp(`CLEAN\\(B${lastRow}\\)`).test(sales.getCell(`I${lastRow}`).formula || ''));
  check('판매현황 데이터 없는 행은 수식 없음', !sales.getCell(`I${lastRow + 1}`).formula);
  check('재고잔량(수기 시트) 수식 그대로', (out.getWorksheet('재고잔량').getCell('G2').formula || '') === (tpl.getWorksheet('재고잔량').getCell('G2').formula || ''));
  check('그외통관비(수기 시트, 콜롬비아 이중소스 미해결) 값 그대로', out.getWorksheet('그외통관비').getCell('C3').value === tpl.getWorksheet('그외통관비').getCell('C3').value);
  check('shiftFormulaRow: 상대참조만 이동, $고정 유지', X.shiftFormulaRow('SEARCH("x",C3)+$E$2:$E$9000+B3', 3, 17) === 'SEARCH("x",C17)+$E$2:$E$9000+B17');

  console.log('\n=== 4) 스냅샷 불변(분배 변경 후) ===');
  const base = fx.weeks['28'].rows;
  const v1 = R.applyEdits(base, [
    { op: 'addRow', sheet: 'other', rowKey: 'M:other:a', data: { custName: '수기거래처', supply: -1000, vat: -100, qty: -1 } },
    { op: 'set', sheet: 'sales', rowKey: base.find((r) => r.sheet === 'sales').rowKey, field: 'memo', value: '확인' },
  ], { by: '강명훈', at: '2026-09-30T01:00:00Z' });
  const frozen = JSON.stringify(v1);
  // 분배 변경: 한 판매행 금액 변경 + 한 행 삭제
  const changedKey = base.find((r) => r.sheet === 'sales').rowKey;
  const live = base.filter((r, i) => i !== 5).map((r) => (r.rowKey === changedKey && r.sheet === 'sales' ? { ...r, data: { ...r.data, supply: r.data.supply + 5000 } } : r));
  const v2 = R.carryManual(v1, live);
  check('최신화 후에도 v1 행 불변(깊은 비교)', JSON.stringify(v1) === frozen);
  check('v2에 수기행 이월', v2.some((r) => r.rowKey === 'M:other:a'));
  check('v2에 수기 셀보정(memo) RowKey로 이월 + 작성자·시각', v2.find((r) => r.sheet === 'sales' && r.rowKey === changedKey)?.manual?.memo?.by === '강명훈');
  const ch = R.diffRows(v1, live);
  check('변경분: 금액 변경 감지', ch.some((c) => c.kind === 'changed' && c.rowKey === changedKey && c.fields.includes('supply')));
  check('변경분: 삭제 감지', ch.some((c) => c.kind === 'removed'));
  check('변경분: 수기행은 원천 비교 제외', !ch.some((c) => R.isManualRowKey(c.rowKey)));
  let threw = false; try { R.applyEdits(v1, [{ op: 'removeRow', sheet: 'sales', rowKey: changedKey }]); } catch { threw = true; }
  check('ERP 원천행 삭제 편집 거부', threw);

  const mig = read('docs/migrations/2026-09-30_profit_workbook_snapshot.sql');
  check('migration: 헤더·행 테이블 INSTEAD OF UPDATE, DELETE 트리거', (mig.match(/INSTEAD OF UPDATE, DELETE/g) || []).length === 2);
  const lib = read('lib/profitWorkbook.js').replace(/\/\/.*$/gm, '');
  check('lib: 스냅샷 테이블 UPDATE/DELETE 없음', !/\bUPDATE\s+dbo\.ProfitWorkbook|\bDELETE\s+FROM\s+dbo\.ProfitWorkbook/i.test(lib));
  check('lib: ERP 테이블 쓰기 없음', !/(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(dbo\.)?(Shipment|Estimate|Warehouse|Customer|Product|Order|Stock)/i.test(lib));
  check('lib: 런타임 DDL 없음', !/CREATE\s+TABLE|ALTER\s+TABLE|CREATE\s+TRIGGER/i.test(lib));
  const api = read('pages/api/sales/profit-workbook.js');
  const getBlock = api.slice(api.indexOf("if (req.method === 'GET')"), api.indexOf("if (req.method === 'POST')"));
  check('API GET: insertSnapshot 호출 없음(SELECT만)', getBlock.length > 100 && !/insertSnapshot\(/.test(getBlock));
  check('API: withAuth', /export default withAuth\(/.test(api));

  console.log('\n=== 5) 지역·권한·국가 ===');
  check('CustArea → 지역', R.regionOf('경부선') === '경부호남' && R.regionOf('경부선_주광') === '경부호남' && R.regionOf('호남선') === '경부호남'
    && R.regionOf('양재동') === '양재동' && R.regionOf('지방직매장') === '지방' && R.regionOf('') === '기타' && R.regionOf('호텔') === '기타');
  check('기본지역 = 담당 거래처 최빈 지역', R.defaultRegionFor([{ CustArea: '지방', n: 30 }, { CustArea: '양재동', n: 7 }]) === '지방' && R.defaultRegionFor([]) === '전체');
  const acc = (u, a = false) => R.resolveWorkbookAccess(u, { isAdmin: a });
  check('강명훈 전체', acc({ userId: 'nenovaMS2', userName: '강명훈' }).full && acc({ userName: '강명훈' }).tabs.length === 5);
  check('관리자 전체', acc({ userId: 'x' }, true).canConfirm);
  check('김원영 = 지역별 매출현황만(조회)', JSON.stringify(acc({ userId: 'nenova1', userName: '김원영' }).tabs) === '["regionRevenue"]' && !acc({ userName: '김원영' }).canEdit);
  check('정재훈·박성수 = 지역별 판매현황만', ['정재훈', '박성수'].every((n) => JSON.stringify(acc({ userName: n }).tabs) === '["regionSales"]' && acc({ userName: n }).sheets.join() === 'sales'));
  check('그 외 사용자 권한 없음', acc({ userName: '조현욱' }).tabs.length === 0);
  check('구매현황 국가에 국내(비용행) 제외', !R.PURCHASE_COUNTRIES.includes('국내') && R.PURCHASE_COUNTRIES.includes('콜롬비아'));
  check('구매현황 국가 필터 적용', R.buildPurchaseRows([{ CounName: '국내', TPrice: 1 }, { CounName: '중국', TPrice: 2, WarehouseKey: 1, ProdKey: 1 }]).length === 1);
  check('운송료 판매행 → 그 외 매출액', R.buildSalesRows([{ CustKey: 1, ProdKey: 2, ProdName: '수국 운송료', Amount: 2727, Vat: 273, EstQuantity: 1 }])[0].sheet === 'other');
  check('거래처명 NFKC+괄호 제거', R.custDisplayName('아이엠 (I am)') === '아이엠' && R.custKeyOf('아이엠(미우)') === R.custKeyOf('아이엠'));

  if (failed) { console.error(`\n${failed}건 실패`); process.exit(1); }
  console.log('\nprofitWorkbookGolden: all passed');
}
main().catch((e) => { console.error(e); process.exit(1); });
