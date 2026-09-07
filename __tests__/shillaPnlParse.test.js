const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const XLSX = require('xlsx');

function addSheet(wb, name, aoa) {
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name);
}

// 표준 정상 헤더. 비율 누락은 아래 전용 fixture에서 저장 차단으로 검증한다.
const STD_HEADER = ['품명', '칼라', '입고수량', '매입단가', '매입액', '매출단가', '매출액', '이익', '이익율', '네노바이익\r\n(60%)', '미우이익\r\n(40%)'];

function stdRow({ name = '', color = '', qty, buyPrice, buyAmount, sellPrice, sellAmount, profit }) {
  return [name, color, qty, buyPrice, buyAmount, sellPrice, sellAmount, profit];
}

// 실제 원본은 배분비율을 열 이름이 아니라 헤더 문구 안에 박아 둔다: "네노바이익\r\n(80%)".
// 그 열의 값 자체는 비율이 아니라 이익×비율 금액이다.
function headerWithRatio(pct) {
  return ['품명', '칼라', '입고수량', '매입단가', '매입액', '매출단가', '매출액', '이익', '이익율', `네노바이익\r\n(${pct}%)`, `미우이익\r\n(${100 - pct}%)`];
}
function rowWithRatio({ name = '', color = '', qty, buyPrice, buyAmount, sellPrice, sellAmount, profit, pct }) {
  const nenovaAmount = (profit != null && pct != null) ? Math.round(profit * (pct / 100) * 100) / 100 : null;
  const miuAmount = (profit != null && pct != null) ? Math.round(profit * ((100 - pct) / 100) * 100) / 100 : null;
  return [name, color, qty, buyPrice, buyAmount, sellPrice, sellAmount, profit, null, nenovaAmount, miuAmount];
}

async function main() {
  const { parseShillaPnlWorkbookGroups } = await import('../lib/shillaPnlParse.js');

  // ── 0. orderYear 명시 필수 ────────────────────────────────────────────
  const emptyWb = XLSX.utils.book_new();
  addSheet(emptyWb, '01차', [STD_HEADER]);
  assert.throws(() => parseShillaPnlWorkbookGroups(XLSX, emptyWb, {}), /orderYear/);
  assert.throws(() => parseShillaPnlWorkbookGroups(XLSX, emptyWb, { orderYear: 'abc' }), /orderYear/);
  assert.throws(() => parseShillaPnlWorkbookGroups(XLSX, emptyWb, { orderYear: 1999 }), /orderYear/);
  assert.throws(() => parseShillaPnlWorkbookGroups(XLSX, emptyWb, { orderYear: 2026.5 }), /orderYear/);

  // ── 1. 정상 단일 차수 시트 — 행/합계 검증 통과 ───────────────────────────
  const okWb = XLSX.utils.book_new();
  addSheet(okWb, '07차', [
    ['2026년 상반기 신라호텔 7차 결산'],
    headerWithRatio(60),
    rowWithRatio({ name: '장미 레드퍼포먼스', color: '레드', qty: 10, buyPrice: 1000, buyAmount: 10000, sellPrice: 1500, sellAmount: 15000, profit: 5000, pct: 60 }),
    rowWithRatio({ name: '수국 화이트', color: '화이트', qty: 5, buyPrice: 2000, buyAmount: 10000, sellPrice: 3000, sellAmount: 15000, profit: 5000, pct: 60 }),
    ['합계', null, 15, null, 20000, null, 30000, 10000],
    // 합계 아래 전산 참고내역 — 파싱 대상 아님(다시 합산되면 안 됨)
    rowWithRatio({ name: '전산참고행 무시대상', qty: 999, buyPrice: 1, buyAmount: 999, sellPrice: 1, sellAmount: 999, profit: 0, pct: 60 }),
  ]);
  const ok = parseShillaPnlWorkbookGroups(XLSX, okWb, { orderYear: 2026 });
  assert.equal(ok.batches.length, 1);
  const okBatch = ok.batches[0];
  assert.equal(okBatch.major, '07');
  assert.equal(okBatch.items.length, 2, '합계 행 아래 전산 참고행은 품목으로 잡히면 안 된다.');
  assert.equal(okBatch.items[0].name, '장미 레드퍼포먼스');
  assert.equal(okBatch.items[0].unit, '');
  assert.equal(okBatch.items[0].remark, '07차 3행', '원본 시트명+행 인용이 remark 에 남아야 한다.');
  assert.equal(okBatch.nenovaPct, 60);
  assert.equal(okBatch.miuPct, 40);
  assert.ok(okBatch.verification.every((c) => c.ok), '정상 시트는 모든 검증을 통과해야 한다.');
  assert.ok(okBatch.items.every((it) => it.ok));

  // ── 2. 배분 비율은 헤더/데이터에서만 읽는다 (기본값 주입 금지) ───────────
  const ratioWb = XLSX.utils.book_new();
  addSheet(ratioWb, '27차', [
    headerWithRatio(80),
    rowWithRatio({ name: '카네이션', qty: 2, buyPrice: 100, buyAmount: 200, sellPrice: 200, sellAmount: 400, profit: 200, pct: 80 }),
    ['합계', null, 2, null, 200, null, 400, 200],
  ]);
  const ratio = parseShillaPnlWorkbookGroups(XLSX, ratioWb, { orderYear: 2026 });
  assert.equal(ratio.batches[0].nenovaPct, 80);
  assert.equal(ratio.batches[0].miuPct, 20);
  assert.equal(ratio.nenovaPct['27'], 80);
  assert.ok(ratio.batches[0].verification.every((c) => c.ok), '헤더 비율과 일치하는 분배금액은 검증을 통과해야 한다.');

  // 분배금액 열이 헤더 비율과 어긋나면 실패로 표시한다 (역산/추정으로 넘어가지 않는다).
  const ratioMismatchWb = XLSX.utils.book_new();
  addSheet(ratioMismatchWb, '28차', [
    headerWithRatio(80),
    [...rowWithRatio({ name: '카네이션', qty: 2, buyPrice: 100, buyAmount: 200, sellPrice: 200, sellAmount: 400, profit: 200, pct: 80 })].map((v, i) => (i === 9 ? 999999 : v)),
    ['합계', null, 2, null, 200, null, 400, 200],
  ]);
  const ratioMismatch = parseShillaPnlWorkbookGroups(XLSX, ratioMismatchWb, { orderYear: 2026 });
  assert.equal(ratioMismatch.batches[0].items[0].ok, false);
  assert.ok(ratioMismatch.batches[0].items[0].issues.some((i) => /네노바이익 배분액 불일치/.test(i)));

  const ratioTotalMismatchWb = XLSX.utils.book_new();
  addSheet(ratioTotalMismatchWb, '28차합계', [
    headerWithRatio(80),
    rowWithRatio({ name: '카네이션', qty: 2, buyPrice: 100, buyAmount: 200, sellPrice: 200, sellAmount: 400, profit: 200, pct: 80 }),
    ['합계', null, 2, null, 200, null, 400, 200, null, 100, 40],
  ]);
  const ratioTotalMismatch = parseShillaPnlWorkbookGroups(XLSX, ratioTotalMismatchWb, { orderYear: 2026 }).batches[0];
  assert.ok(ratioTotalMismatch.verification.some((check) => check.label === '네노바이익 합계' && !check.ok), '합계 배분액도 헤더 80:20과 대조해야 한다.');

  const noRatioWb = XLSX.utils.book_new();
  addSheet(noRatioWb, '01차', [
    ['품명', '칼라', '입고수량', '매입단가', '매입액', '매출단가', '매출액', '이익'],
    ['카네이션', null, 2, 100, 200, 200, 400, 200],
    ['합계', null, 2, null, 200, null, 400, 200],
  ]);
  const noRatio = parseShillaPnlWorkbookGroups(XLSX, noRatioWb, { orderYear: 2026 });
  assert.equal(noRatio.batches[0].nenovaPct, null, '비율 헤더가 없으면 기본값(예: 80)을 주입하면 안 된다.');
  assert.ok(noRatio.batches[0].verification.some((check) => check.label === '배분 비율 헤더 누락' && !check.ok), '비율 헤더가 없으면 저장 차단 검증이 있어야 한다.');

  // ── 3. 범위/결산/검토 시트는 건너뛴다 ──────────────────────────────────
  const skipWb = XLSX.utils.book_new();
  addSheet(skipWb, '26차~30차(7월)', [STD_HEADER, stdRow({ name: 'X', qty: 1, buyPrice: 1, buyAmount: 1, sellPrice: 1, sellAmount: 1, profit: 0 }), ['합계', null, 1, null, 1, null, 1, 0]]);
  addSheet(skipWb, '결산', [STD_HEADER, stdRow({ name: 'X', qty: 1, buyPrice: 1, buyAmount: 1, sellPrice: 1, sellAmount: 1, profit: 0 })]);
  addSheet(skipWb, '검토리포트', [STD_HEADER]);
  const skipped = parseShillaPnlWorkbookGroups(XLSX, skipWb, { orderYear: 2026 });
  assert.equal(skipped.batches.length, 0, '범위/결산/검토 시트만 있으면 배치가 없어야 한다.');
  assert.deepEqual(skipped.sourceSheets.map((s) => s.included), [false, false, false]);
  assert.equal(skipped.sourceSheets[0].reason, 'range');
  assert.equal(skipped.sourceSheets[1].reason, 'summary-sheet');
  assert.equal(skipped.sourceSheets[2].reason, 'summary-sheet');

  // 단일 차수처럼 보이는 접미사(범위 아님)는 허용: "11차까지끝", "22차까지 금액만", "5차ㅇㅋ"
  const suffixWb = XLSX.utils.book_new();
  addSheet(suffixWb, '5차ㅇㅋ', [STD_HEADER, stdRow({ name: 'A', qty: 1, buyPrice: 1, buyAmount: 1, sellPrice: 1, sellAmount: 1, profit: 0 }), ['합계', null, 1, null, 1, null, 1, 0]]);
  addSheet(suffixWb, '11차까지끝', [STD_HEADER, stdRow({ name: 'B', qty: 1, buyPrice: 1, buyAmount: 1, sellPrice: 1, sellAmount: 1, profit: 0 }), ['합계', null, 1, null, 1, null, 1, 0]]);
  addSheet(suffixWb, '22차까지 금액만', [STD_HEADER, stdRow({ name: 'C', qty: 1, buyPrice: 1, buyAmount: 1, sellPrice: 1, sellAmount: 1, profit: 0 }), ['합계', null, 1, null, 1, null, 1, 0]]);
  const suffixed = parseShillaPnlWorkbookGroups(XLSX, suffixWb, { orderYear: 2026 });
  assert.deepEqual(suffixed.batches.map((b) => b.major), ['05', '11', '22']);

  // ── 4. 고정 위치 파싱 금지 — 매출액/이익 열이 시트마다 다른 위치라도 텍스트로 찾는다 ──
  const shiftedWb = XLSX.utils.book_new();
  addSheet(shiftedWb, '22차', [
    ['품명', '칼라', '입고수량', '매입단가', '매입액', '부가세공제', '부가세포함', '매출단가', '매출액', '이익', '네노바이익\r\n(60%)', '미우이익\r\n(40%)'],
    ['장미', null, 3, 100, 300, null, null, 200, 600, 300, 180, 120],
    ['합계', null, 3, null, 300, null, null, null, 600, 300],
  ]);
  const shifted = parseShillaPnlWorkbookGroups(XLSX, shiftedWb, { orderYear: 2026 });
  assert.equal(shifted.batches[0].items[0].sellAmount, 600, '매출액 열이 뒤로 밀려 있어도 헤더 텍스트로 찾아야 한다(고정 열 파싱 금지).');
  assert.ok(shifted.batches[0].verification.every((c) => c.ok));

  // ── 5. 첫 합계 행 SUM 이 한 행을 누락 — 원본 수정 없이 실패로 표시 (31차8월 재현) ──
  const gapWb = XLSX.utils.book_new();
  addSheet(gapWb, '31차8월', [
    STD_HEADER,
    stdRow({ name: '장미A', qty: 1, buyPrice: 100, buyAmount: 100, sellPrice: 200, sellAmount: 200, profit: 100 }),
    stdRow({ name: '장미B', qty: 1, buyPrice: 100, buyAmount: 100, sellPrice: 200, sellAmount: 200, profit: 100 }),
    stdRow({ name: '누락행(합계에서 빠짐)', qty: 1, buyPrice: 2664, buyAmount: 2664, sellPrice: 2664, sellAmount: 2664, profit: 0 }),
    // 합계는 위 세 줄 중 마지막(누락행)을 빼고 SUM 되어 있다고 가정 — 파서가 자동 보정하면 안 됨
    ['합계', null, 2, null, 200, null, 400, 200],
  ]);
  const gap = parseShillaPnlWorkbookGroups(XLSX, gapWb, { orderYear: 2026 });
  const gapBatch = gap.batches[0];
  assert.equal(gapBatch.items.length, 3, '합계 SUM 범위와 무관하게 합계 행 위의 품목 행은 모두 파싱되어야 한다.');
  const buyTotalCheck = gapBatch.verification.find((c) => c.label === '매입액 합계');
  assert.equal(buyTotalCheck.ok, false, '합계 SUM 이 한 행을 빠뜨리면 실패로 표시해야 하며 원본을 고쳐서는 안 된다.');
  assert.equal(buyTotalCheck.parsedVal, 2864);
  assert.equal(buyTotalCheck.sheetVal, 200);
  assert.ok(gapBatch.warnings.some((w) => /매입액 합계/.test(w)));

  // ── 6. 이름 칸 공백, 칼라 칸도 무의미 — 자리표시자 + 검증 실패 (35차 재현) ──
  const blankNameWb = XLSX.utils.book_new();
  addSheet(blankNameWb, '35차', [
    STD_HEADER,
    stdRow({ name: '', color: '화이트', qty: 324, buyPrice: 11233, buyAmount: 324 * 11233, sellPrice: 13000, sellAmount: 324 * 13000, profit: 324 * (13000 - 11233) }),
    ['합계', null, 324, null, 324 * 11233, null, 324 * 13000, 324 * (13000 - 11233)],
  ]);
  const blankName = parseShillaPnlWorkbookGroups(XLSX, blankNameWb, { orderYear: 2026 });
  const blankItem = blankName.batches[0].items[0];
  assert.equal(blankItem.name, '화이트', '이름이 비어도 칼라 칸 값을 그대로 보이는 자리표시자로 써야 한다(추측 금지).');
  assert.equal(blankItem.nameSource, 'color-fallback');
  assert.equal(blankItem.ok, false, '이름 미기재 행은 항상 검증 실패로 표시해야 한다.');
  assert.equal(blankItem.qty, 324, '금액은 원본 그대로 합산 대상에 포함되어야 한다.');
  assert.ok(blankName.batches[0].warnings.some((w) => /행 확인 필요/.test(w)));

  // 이름/칼라 모두 공백 — 고정 자리표시자
  const bothBlankWb = XLSX.utils.book_new();
  addSheet(bothBlankWb, '36차', [
    STD_HEADER,
    stdRow({ name: '', color: '', qty: 1, buyPrice: 100, buyAmount: 100, sellPrice: 200, sellAmount: 200, profit: 100 }),
    ['합계', null, 1, null, 100, null, 200, 100],
  ]);
  const bothBlank = parseShillaPnlWorkbookGroups(XLSX, bothBlankWb, { orderYear: 2026 });
  assert.equal(bothBlank.batches[0].items[0].name, '(품목명 미기재 — 원본 확인 필요)');
  assert.equal(bothBlank.batches[0].items[0].nameSource, 'missing');
  assert.equal(bothBlank.batches[0].items[0].ok, false);

  // ── 7. 이름 칸이 비어 있고 칼라 칸에 실제 이름성 텍스트가 들어간 경우 (33차 재현) ──
  const misplacedWb = XLSX.utils.book_new();
  addSheet(misplacedWb, '33차', [
    STD_HEADER,
    stdRow({ name: '', color: '태국샘플', qty: 1, buyPrice: 0, buyAmount: 0, sellPrice: 0, sellAmount: 0, profit: 0 }),
    ['합계', null, 1, null, 0, null, 0, 0],
  ]);
  const misplaced = parseShillaPnlWorkbookGroups(XLSX, misplacedWb, { orderYear: 2026 });
  const misplacedItem = misplaced.batches[0].items[0];
  assert.equal(misplacedItem.name, '태국샘플', '칼라 칸의 실제 텍스트를 그대로 보존해야 한다(품종 추측 금지).');
  assert.equal(misplacedItem.unit, '', '단위를 임의로 채워 넣으면 안 된다(미확인 상태 유지).');
  assert.equal(misplacedItem.ok, false);

  // ── 8. 원본 캐시 값 누락(수식 오류 포함) — qty×단가로 표시하되 확인 필요로 표시 ──
  const missingCacheWb = XLSX.utils.book_new();
  addSheet(missingCacheWb, '02차', [
    STD_HEADER,
    stdRow({ name: '장미', qty: 4, buyPrice: 500, buyAmount: null, sellPrice: 900, sellAmount: 3600, profit: 1600 }),
    ['합계', null, 4, null, 2000, null, 3600, 1600],
  ]);
  const missingCache = parseShillaPnlWorkbookGroups(XLSX, missingCacheWb, { orderYear: 2026 });
  const mcItem = missingCache.batches[0].items[0];
  assert.equal(mcItem.buyAmount, 2000, '매입액 원본이 없으면 수량×매입단가로 계산해 표시해야 한다.');
  assert.equal(mcItem.ok, false, '원본 값 누락은 항상 확인 필요로 표시해야 한다.');
  assert.ok(mcItem.issues.some((i) => /매입액 원본 값 누락/.test(i)));

  // 0은 값이지 누락이 아니다.
  const zeroWb = XLSX.utils.book_new();
  addSheet(zeroWb, '03차', [
    STD_HEADER,
    stdRow({ name: '사입품목', qty: 1, buyPrice: 0, buyAmount: 0, sellPrice: 0, sellAmount: 0, profit: 0 }),
    ['합계', null, 1, null, 0, null, 0, 0],
  ]);
  const zero = parseShillaPnlWorkbookGroups(XLSX, zeroWb, { orderYear: 2026 });
  assert.equal(zero.batches[0].items[0].ok, true, '0은 정상 값으로 취급해야 하며 누락으로 보면 안 된다.');
  assert.equal(zero.batches[0].items[0].buyAmount, 0);

  // ── 9. 행 단위 산술 불일치 — 원본과 계산이 다르면 실패로 표시 ─────────────
  const mismatchWb = XLSX.utils.book_new();
  addSheet(mismatchWb, '04차', [
    STD_HEADER,
    stdRow({ name: '장미', qty: 10, buyPrice: 100, buyAmount: 5000, sellPrice: 200, sellAmount: 2000, profit: -3000 }),
    ['합계', null, 10, null, 5000, null, 2000, -3000],
  ]);
  const mismatch = parseShillaPnlWorkbookGroups(XLSX, mismatchWb, { orderYear: 2026 });
  const mmItem = mismatch.batches[0].items[0];
  assert.equal(mmItem.ok, false);
  assert.ok(mmItem.issues.some((i) => /매입액 불일치/.test(i)));

  // ── 10. 동일 차수 시트 중복 — 자동 합산하지 말고 실패로 표시 ──────────────
  const dupWb = XLSX.utils.book_new();
  const dupSheet = [STD_HEADER, stdRow({ name: 'A', qty: 1, buyPrice: 1, buyAmount: 1, sellPrice: 1, sellAmount: 1, profit: 0 }), ['합계', null, 1, null, 1, null, 1, 0]];
  addSheet(dupWb, '08차', dupSheet);
  addSheet(dupWb, '08차재작성', dupSheet);
  const dup = parseShillaPnlWorkbookGroups(XLSX, dupWb, { orderYear: 2026 });
  assert.equal(dup.batches.length, 1);
  assert.equal(dup.batches[0].sheets.length, 2);
  assert.ok(dup.batches[0].verification.some((c) => c.label === '동일 차수 시트 중복' && c.ok === false));
  assert.ok(dup.batches[0].warnings.some((w) => /중복 집계 위험/.test(w)));

  // ── 11. 단위 문자열은 원문 그대로 보존 (환산/추정 금지) ──────────────────
  const unitWb = XLSX.utils.book_new();
  addSheet(unitWb, '09차', [
    ['품명', '칼라', '단위', '입고수량', '매입단가', '매입액', '매출단가', '매출액', '이익'],
    ['카네이션', null, '단-5스팀', 2, 100, 200, 200, 400, 200],
    ['안개초', null, '8스팀', 3, 50, 150, 100, 300, 150],
    ['합계', null, null, 5, null, 350, null, 700, 350],
  ]);
  const unit = parseShillaPnlWorkbookGroups(XLSX, unitWb, { orderYear: 2026 });
  assert.equal(unit.batches[0].items[0].unit, '단-5스팀', '단위 문자열의 묶음 의미를 그대로 보존해야 한다.');
  assert.equal(unit.batches[0].items[1].unit, '8스팀');

  const noQtyTotalWb = XLSX.utils.book_new();
  addSheet(noQtyTotalWb, '09차수량없음', [
    headerWithRatio(60),
    rowWithRatio({ name: '장미\n(단)', qty: 2, buyPrice: 100, buyAmount: 200, sellPrice: 200, sellAmount: 400, profit: 200, pct: 60 }),
    rowWithRatio({ name: '호접\n(8스팀)', qty: 3, buyPrice: 100, buyAmount: 300, sellPrice: 200, sellAmount: 600, profit: 300, pct: 60 }),
    ['합계', null, null, null, 500, null, 1000, 500],
  ]);
  const noQtyTotal = parseShillaPnlWorkbookGroups(XLSX, noQtyTotalWb, { orderYear: 2026 }).batches[0];
  assert.ok(!noQtyTotal.verification.some((check) => check.label === '입고수량 합계'), '서로 다른 포장 단위의 빈 수량 합계는 실패로 만들면 안 된다.');

  // 단위 열이 없고 품명에 줄바꿈 괄호로만 포장단위가 적힌 실제 원본 형식.
  const embeddedUnitWb = XLSX.utils.book_new();
  addSheet(embeddedUnitWb, '10차', [
    headerWithRatio(60),
    rowWithRatio({ name: '호접\n(8스팀)', qty: 2, buyPrice: 100, buyAmount: 200, sellPrice: 200, sellAmount: 400, profit: 200, pct: 60 }),
    ['합계', null, 2, null, 200, null, 400, 200],
  ]);
  const embeddedUnit = parseShillaPnlWorkbookGroups(XLSX, embeddedUnitWb, { orderYear: 2026 }).batches[0].items[0];
  assert.equal(embeddedUnit.name, '호접');
  assert.equal(embeddedUnit.unit, '8스팀', '포장 단위를 품명에서 원문 그대로 분리해야 한다.');
  assert.equal(embeddedUnit.sourceName, '호접 (8스팀)', '원문 품명도 함께 보존해야 한다.');

  // ── 12. 시트 제목의 M.D 날짜는 지정 연도 기준으로 해석 ───────────────────
  const dateWb = XLSX.utils.book_new();
  addSheet(dateWb, '23차 9.10', [STD_HEADER, stdRow({ name: 'A', qty: 1, buyPrice: 1, buyAmount: 1, sellPrice: 1, sellAmount: 1, profit: 0 }), ['합계', null, 1, null, 1, null, 1, 0]]);
  const dated = parseShillaPnlWorkbookGroups(XLSX, dateWb, { orderYear: 2026 });
  const sheetDate = dated.batches[0].quoteDate;
  assert.ok(sheetDate instanceof Date);
  assert.equal(sheetDate.getFullYear(), 2026);
  assert.equal(sheetDate.getMonth(), 8); // 9월 → index 8
  assert.equal(sheetDate.getDate(), 10);

  // 실제 원본처럼 A1 제목에만 날짜·전산 차수 메모가 있는 경우도 별도 보존한다.
  const titleWb = XLSX.utils.book_new();
  addSheet(titleWb, '24차', [
    ['신라호텔 24차(6.16) 전산 25차 완벽', null, null, '전산- 신라 - 25차'],
    headerWithRatio(60),
    rowWithRatio({ name: '장미', qty: 1, buyPrice: 100, buyAmount: 100, sellPrice: 200, sellAmount: 200, profit: 100, pct: 60 }),
    ['합계', null, 1, null, 100, null, 200, 100],
  ]);
  const titled = parseShillaPnlWorkbookGroups(XLSX, titleWb, { orderYear: 2026 }).batches[0];
  assert.equal(titled.quoteDate.getMonth(), 5);
  assert.equal(titled.quoteDate.getDate(), 16);
  assert.match(titled.sourceTitle, /전산 25차/);
  assert.match(titled.erpWeekNote, /전산/);

  // 제목에 M.D 가 없으면 날짜를 추측하지 않는다.
  assert.equal(okBatch.quoteDate, null);

  // ── 13. DB/네트워크 호출 없음 — 순수 함수 소스 점검 ──────────────────────
  const src = fs.readFileSync(require.resolve('../lib/shillaPnlParse.js'), 'utf8');
  assert.doesNotMatch(src, /require\(['"]mssql['"]\)|from ['"]\.\.\/lib\/db(\.js)?['"]|fetch\(|http\.request|https\.request/, '순수 파서에는 DB/네트워크 호출이 없어야 한다.');

  // ── 14. 실제 원본(선택) — 파일이 있을 때만 실행, 없으면 통과 ─────────────
  const realPath = 'C:/Users/USER/Desktop/2026 신라 상반기 입고 손익계산_이사님보고.xlsx';
  if (fs.existsSync(realPath)) {
    const realWb = XLSX.readFile(realPath, { cellDates: true });
    const real = parseShillaPnlWorkbookGroups(XLSX, realWb, { orderYear: 2026 });
    assert.ok(Array.isArray(real.batches));
    assert.equal(real.sourceSheets.length, realWb.SheetNames.length, '모든 시트가 포함/제외 사유와 함께 sourceSheets 에 나타나야 한다.');

    // 설계 리포트 기준값 — docs/work-reports/2026-09-07_shilla-pnl-design.md
    assert.deepEqual(
      real.sourceSheets.filter((s) => !s.included).map((s) => s.sheetName).sort(),
      ['검토리포트', '결산', '26차~30차(7월)('].sort(),
      '범위/결산/검토 시트 3개만 제외되어야 한다(문서 기준 38개 중 35개 단일 차수).',
    );
    assert.equal(real.batches.length, 35, '38개 시트 중 단일 차수 배치는 35개여야 한다.');
    assert.deepEqual(real.batches.map((b) => b.major), Array.from({ length: 35 }, (_, i) => String(i + 1).padStart(2, '0')));

    // 1~26차 60:40, 27~35차 80:20 — 원본 헤더 문구에서만 읽고 기본값을 주입하지 않는다.
    for (const b of real.batches) {
      const expectedNenova = Number(b.major) <= 26 ? 60 : 80;
      assert.equal(b.nenovaPct, expectedNenova, `${b.major}차 네노바이익 비율은 헤더 기준 ${expectedNenova}% 여야 한다.`);
      assert.equal(b.miuPct, 100 - expectedNenova);
    }

    // 31차8월: 합계 SUM 이 한 행을 빠뜨려 매입액 합계 검증이 실패해야 한다(원본 수정 금지, 266,400원 차이).
    const gap31 = real.batches.find((b) => b.major === '31');
    const gap31Check = gap31.verification.find((c) => c.label === '매입액 합계');
    assert.equal(gap31Check.ok, false);
    assert.equal(gap31Check.diff, 266400);

    // 33차: 품명 칸 공백 + 칼라 칸 "태국샘플" — 추측 없이 그대로 보존 + 확인 필요로 표시.
    const item33 = real.batches.find((b) => b.major === '33').items.find((it) => it.name === '태국샘플');
    assert.ok(item33);
    assert.equal(item33.nameSource, 'color-fallback');
    assert.equal(item33.ok, false);

    // 35차: 품명 칸 공백 + 칼라 칸 "화이트" — 품종 추측(예: 호접) 없이 그대로 보존 + 확인 필요로 표시.
    const item35 = real.batches.find((b) => b.major === '35').items.find((it) => it.name === '화이트');
    assert.ok(item35);
    assert.equal(item35.nameSource, 'color-fallback');
    assert.equal(item35.ok, false);

    // 승인된 SHA256 원본일 때만 메모리 복사본에 적용되는 정책을 별도 확인한다.
    // 정책 파일은 여기서 수정하지 않으며, 원본 파일에도 쓰지 않는다.
    const { applyConfirmedShillaSourceNames } = await import('../lib/shillaPnlImportPolicy.js');
    const raw = fs.readFileSync(realPath);
    const approvedWorkbook = XLSX.read(raw, { type: 'buffer', cellDates: true });
    const approvalNotes = applyConfirmedShillaSourceNames(
      approvedWorkbook,
      crypto.createHash('sha256').update(raw).digest('hex'),
    );
    const approved = parseShillaPnlWorkbookGroups(XLSX, approvedWorkbook, { orderYear: 2026 });
    assert.equal(approvalNotes.length, 5, '승인된 원본 SHA256일 때만 다섯 가지 명시 보정이 적용되어야 한다.');
    assert.equal(approved.batches.length, 35);
    assert.ok(approved.verification.every((check) => check.ok), '승인 정책 적용 뒤 35개 신라 차수는 모두 검증을 통과해야 한다.');
    for (const major of ['30', '31']) {
      const batch = approved.batches.find((candidate) => candidate.major === major);
      assert.ok(batch.verification.some((check) => check.label === '네노바이익 합계' && check.ok), `${major}차 네노바 합계 배분액을 검증해야 한다.`);
      assert.ok(batch.verification.some((check) => check.label === '미우이익 합계' && check.ok), `${major}차 미우 합계 배분액을 검증해야 한다.`);
    }

    console.log(`신라 실제 원본: 시트 ${realWb.SheetNames.length}개 중 배치 ${real.batches.length}개, 원본 검증 실패 ${real.verification.filter((c) => !c.ok).length}건 / 승인 정책 적용 후 ${approved.verification.filter((c) => !c.ok).length}건`);
  } else {
    console.log('신라 실제 원본 파일 없음 — 합성 fixture 검증만 수행 (미검증: 실제 원본 대조).');
  }

  console.log('Shilla P&L parser tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
