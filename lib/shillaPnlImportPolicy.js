// Source-specific human confirmation, never a general name/price inference.
export const SHILLA_CONFIRMED_SOURCE_SHA256 = '1ce46b834326038680c2768b04431637a6e09f1bea2bd45b5e5ce34badf6b7e4';

const cell = (sheet, address) => sheet?.[address]?.v;
const text = value => String(value ?? '').replace(/[\s\u00a0]+/g, ' ').trim();
const numberIs = (value, expected) => Number.isFinite(Number(value)) && Math.abs(Number(value) - expected) < 0.001;
const oneOfNumbers = (value, expected) => expected.some(candidate => numberIs(value, candidate));

function week30Columns(sheet) {
  if (numberIs(cell(sheet, 'H6'), 4140) && numberIs(cell(sheet, 'H7'), 46800) && numberIs(cell(sheet, 'H9'), 1970778)) {
    return { profit: 'H', nenova: 'J', miu: 'K' };
  }
  if (numberIs(cell(sheet, 'I6'), 4140) && numberIs(cell(sheet, 'I7'), 46800) && numberIs(cell(sheet, 'I9'), 1970778)) {
    return { profit: 'I', nenova: 'K', miu: 'L' };
  }
  return null;
}

function sourceSheetIdentity(sheet, title, nenovaPct) {
  return text(cell(sheet, 'A1')) === title
    && text(cell(sheet, 'A2')) === '품명'
    && text(cell(sheet, 'B2')) === '칼라'
    && text(cell(sheet, 'C2')) === '입고수량'
    && text(cell(sheet, 'D2')) === '매입단가'
    && text(cell(sheet, 'J2')) === `네노바이익 (${nenovaPct}%)`;
}

// Excel은 열기/저장만 해도 package metadata와 calc chain이 바뀌어 파일 SHA가 달라질 수 있다.
// 과거 사용자 확인은 파일 컨테이너 전체가 아니라 아래의 정확한 업무 셀에 대한 것이므로,
// 시트 제목·헤더·행 값이 모두 같은 경우에만 해당 행의 확인사항을 재적용한다.
function confirmedCellRevision(workbook, correction) {
  const sheet = workbook?.Sheets?.[correction.sheetName];
  return !!sheet
    && sourceSheetIdentity(sheet, correction.title, correction.nenovaPct)
    && correction.matches(sheet);
}

export function isConfirmedShillaBusinessRevision(workbook) {
  const sheets = workbook?.Sheets || {};
  const week30Layout = week30Columns(sheets['30차']);
  const week15Matches = text(cell(sheets['15차'], 'A4')) === '호접'
    && text(cell(sheets['15차'], 'B4')) === '염색'
    && numberIs(cell(sheets['15차'], 'C4'), 48)
    && (cell(sheets['15차'], 'D4') == null || numberIs(cell(sheets['15차'], 'D4'), 0))
    && numberIs(cell(sheets['15차'], 'E4'), 0);
  const week30Matches = !!week30Layout
    && oneOfNumbers(cell(sheets['30차'], `${week30Layout.nenova}9`), [1566434.4, 1576622.4])
    && oneOfNumbers(cell(sheets['30차'], `${week30Layout.miu}9`), [404343.6, 394155.6]);
  const week31Matches = numberIs(cell(sheets['31차8월'], 'E9'), 266400)
    && oneOfNumbers(cell(sheets['31차8월'], 'E10'), [6568213, 6834613])
    && numberIs(cell(sheets['31차8월'], 'H10'), 2468949);
  const week33Original = !text(cell(sheets['33차'], 'A7')) && text(cell(sheets['33차'], 'B7')) === '태국샘플';
  const week33Corrected = text(cell(sheets['33차'], 'A7')) === '태국샘플' && !text(cell(sheets['33차'], 'B7'));
  const week33Matches = (week33Original || week33Corrected)
    && numberIs(cell(sheets['33차'], 'C7'), 1) && numberIs(cell(sheets['33차'], 'D7'), 43000);
  return sourceSheetIdentity(sheets['15차'], '신라호텔 15차(04.14)', 60)
    && sourceSheetIdentity(sheets['30차'], '신라호텔 30차(7.28)', 80)
    && sourceSheetIdentity(sheets['31차8월'], '신라호텔 31차(8.3)', 80)
    && sourceSheetIdentity(sheets['33차'], '신라호텔 33차(8.18)', 80)
    && week15Matches && week30Matches && week31Matches && week33Matches;
}

export function shillaSettlementItem(item) {
  return { ...item, name: [item.name, item.color].filter(Boolean).join(' · '),
    price: item.sellPrice, supply: item.sellAmount, costPrice: item.buyPrice,
    byBranch: { 신라호텔: item.qty }, prodKey: null, costSource: 'shilla',
    refPrice: null, refSource: null, erpSalePrice: null, erpQty: null, consigned: false };
}

export function applyConfirmedShillaSourceNames(workbook, sha256) {
  const notes = [];
  const exactApprovedFile = String(sha256).toLowerCase() === SHILLA_CONFIRMED_SOURCE_SHA256;
  const week15 = workbook?.Sheets?.['15차'];
  const week15Confirmed = exactApprovedFile || confirmedCellRevision(workbook, {
    sheetName: '15차', title: '신라호텔 15차(04.14)', nenovaPct: 60,
    matches: sheet => text(cell(sheet, 'A4')) === '호접' && text(cell(sheet, 'B4')) === '염색'
      && numberIs(cell(sheet, 'C4'), 48) && cell(sheet, 'D4') == null && numberIs(cell(sheet, 'E4'), 0),
  });
  if (week15Confirmed && week15?.A4?.v === '호접' && week15?.B4?.v === '염색' && week15?.C4?.v === 48 && week15?.D4?.v == null && week15?.E4?.v === 0) {
    week15.D4 = { t: 'n', v: 0 };
    notes.push('15차 4행: 확인된 원본 업무 셀과 일치하여 염색 호접 48개의 무상입고 매입단가 0원을 적용합니다. 매출과 이익은 포함하며 원본 파일은 변경하지 않았습니다.');
  }
  const sheet = workbook?.Sheets?.['35차'];
  const week35Confirmed = exactApprovedFile || confirmedCellRevision(workbook, {
    sheetName: '35차', title: '신라호텔 35(9.2)', nenovaPct: 80,
    matches: source => !text(cell(source, 'A8')) && text(cell(source, 'B8')) === '화이트'
      && numberIs(cell(source, 'C8'), 324) && numberIs(cell(source, 'D8'), 11233),
  });
  if (week35Confirmed && sheet && !String(sheet.A8?.v || '').trim() && sheet.B8?.v === '화이트' && sheet.C8?.v === 324 && sheet.D8?.v === 11233) {
    sheet.A8 = { t: 's', v: '호접\n(8스팀)' };
    notes.push('35차 8행: 확인된 원본 업무 셀과 일치하여 빈 품목명을 호접 화이트로 표시합니다. 원본 파일은 변경하지 않았습니다.');
  }
  const week31 = workbook?.Sheets?.['31차8월'];
  const week31Confirmed = exactApprovedFile || confirmedCellRevision(workbook, {
    sheetName: '31차8월', title: '신라호텔 31차(8.3)', nenovaPct: 80,
    matches: source => numberIs(cell(source, 'E9'), 266400) && numberIs(cell(source, 'H10'), 2468949)
      && oneOfNumbers(cell(source, 'E10'), [6568213, 6834613]),
  });
  if (week31Confirmed && week31?.E9?.v === 266400 && week31?.E10?.v === 6568213 && week31?.H10?.v === 2468949) {
    week31.E10 = { ...week31.E10, v: 6834613, f: 'SUM(E3:E9)' };
    week31.J10 = { ...week31.J10, v: 1975159.2, f: 'SUM(J3:J9)' };
    week31.K10 = { ...week31.K10, v: 493789.8, f: 'SUM(K3:K9)' };
    notes.push('31차: 확인된 원본 업무 셀과 일치하여 합계에서 누락된 염색 호접을 포함합니다. 매입액 6,568,213→6,834,613원, 이익 2,468,949원 유지, 네노바 1,975,159.2원·미우 493,789.8원. 원본 파일은 변경하지 않았습니다.');
  }
  const week30 = workbook?.Sheets?.['30차'];
  const week30Confirmed = exactApprovedFile || confirmedCellRevision(workbook, {
    sheetName: '30차', title: '신라호텔 30차(7.28)', nenovaPct: 80,
    matches: source => {
      const columns = week30Columns(source);
      return !!columns
        && oneOfNumbers(cell(source, `${columns.nenova}9`), [1566434.4, 1576622.4])
        && oneOfNumbers(cell(source, `${columns.miu}9`), [404343.6, 394155.6]);
    },
  });
  const week30Layout = week30Columns(week30);
  if (week30Confirmed && week30Layout) {
    for (const row of [6, 7]) {
      const profitCell = `${week30Layout.profit}${row}`;
      const nenovaCell = `${week30Layout.nenova}${row}`;
      const miuCell = `${week30Layout.miu}${row}`;
      week30[nenovaCell] = { ...week30[nenovaCell], v: week30[profitCell].v * 0.8, f: `${profitCell}*80%` };
      week30[miuCell] = { ...week30[miuCell], v: week30[profitCell].v * 0.2, f: `${profitCell}*20%` };
    }
    const nenovaTotalCell = `${week30Layout.nenova}9`;
    const miuTotalCell = `${week30Layout.miu}9`;
    week30[nenovaTotalCell] = { ...week30[nenovaTotalCell], v: 1970778 * 0.8, f: `SUM(${week30Layout.nenova}3:${week30Layout.nenova}8)` };
    week30[miuTotalCell] = { ...week30[miuTotalCell], v: 1970778 * 0.2, f: `SUM(${week30Layout.miu}3:${week30Layout.miu}8)` };
    notes.push('30차: 확인된 원본 업무 셀과 일치하여 7월 이후 80:20 기준을 적용합니다. 장미 두 행에 남은 60:40 배분만 보정하며 매입·매출·전체 이익은 그대로입니다. 원본 파일은 변경하지 않았습니다.');
  }
  const week33 = workbook?.Sheets?.['33차'];
  const week33Confirmed = exactApprovedFile || confirmedCellRevision(workbook, {
    sheetName: '33차', title: '신라호텔 33차(8.18)', nenovaPct: 80,
    matches: source => !text(cell(source, 'A7')) && text(cell(source, 'B7')) === '태국샘플'
      && numberIs(cell(source, 'C7'), 1) && numberIs(cell(source, 'D7'), 43000),
  });
  if (week33Confirmed && week33 && !String(week33.A7?.v || '').trim() && week33.B7?.v === '태국샘플' && week33.C7?.v === 1 && week33.D7?.v === 43000) {
    week33.A7 = { t: 's', v: '태국샘플' };
    week33.B7 = { t: 's', v: '' };
    notes.push('33차 7행: 확인된 원본 업무 셀과 일치하여 칼라 칸의 태국샘플을 그대로 품목명으로 표시합니다. 실제 품종·환산단위를 추정하거나 전산 품목과 자동 연결하지 않습니다.');
  }
  return notes;
}

export function selectShillaImportBatches(batches, selectedMajors) {
  if (!Array.isArray(selectedMajors) || !selectedMajors.length) throw new Error('저장할 신라 차수를 선택하세요.');
  const keys = selectedMajors.map(value => String(value).padStart(2, '0'));
  if (keys.some(value => !/^\d{2}$/.test(value)) || new Set(keys).size !== keys.length) throw new Error('신라 차수 선택이 잘못되었거나 중복되었습니다.');
  const selected = keys.map(key => batches.find(batch => String(batch.major).padStart(2, '0') === key));
  if (selected.some(batch => !batch || batch.partnerCode !== 'shilla')) throw new Error('미리보기에 없는 신라 차수입니다. 다시 확인하세요.');
  for (const batch of selected) {
    if (!batch.verification?.length || batch.verification.some(check => !check.ok)) throw new Error(`${Number(batch.major)}차의 원본 확인이 필요해 저장할 수 없습니다.`);
  }
  return selected;
}
