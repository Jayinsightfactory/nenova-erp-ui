// Source-specific human confirmation, never a general name/price inference.
export const SHILLA_CONFIRMED_SOURCE_SHA256 = '1ce46b834326038680c2768b04431637a6e09f1bea2bd45b5e5ce34badf6b7e4';

export function shillaSettlementItem(item) {
  return { ...item, name: [item.name, item.color].filter(Boolean).join(' · '),
    price: item.sellPrice, supply: item.sellAmount, costPrice: item.buyPrice,
    byBranch: { 신라호텔: item.qty }, prodKey: null, costSource: 'shilla',
    refPrice: null, refSource: null, erpSalePrice: null, erpQty: null, consigned: false };
}

export function applyConfirmedShillaSourceNames(workbook, sha256) {
  const notes = [];
  if (String(sha256).toLowerCase() !== SHILLA_CONFIRMED_SOURCE_SHA256) return notes;
  const week15 = workbook?.Sheets?.['15차'];
  if (week15?.A4?.v === '호접' && week15?.B4?.v === '염색' && week15?.C4?.v === 48 && week15?.D4?.v == null && week15?.E4?.v === 0) {
    week15.D4 = { t: 'n', v: 0 };
    notes.push('15차 4행: 염색 호접 48개는 사용자 확인(2026-09-07)한 무상입고로 매입단가 0원을 적용합니다. 매출과 이익은 포함하며 원본 파일은 변경하지 않았습니다.');
  }
  const sheet = workbook?.Sheets?.['35차'];
  if (sheet && !String(sheet.A8?.v || '').trim() && sheet.B8?.v === '화이트' && sheet.C8?.v === 324 && sheet.D8?.v === 11233) {
    sheet.A8 = { t: 's', v: '호접\n(8스팀)' };
    notes.push('35차 8행: 빈 품목명은 사용자 확인(2026-09-07)에 따라 호접 화이트로 표시합니다. 원본 파일은 변경하지 않았습니다.');
  }
  const week31 = workbook?.Sheets?.['31차8월'];
  if (week31?.E9?.v === 266400 && week31?.E10?.v === 6568213 && week31?.H10?.v === 2468949) {
    week31.E10 = { ...week31.E10, v: 6834613, f: 'SUM(E3:E9)' };
    week31.J10 = { ...week31.J10, v: 1975159.2, f: 'SUM(J3:J9)' };
    week31.K10 = { ...week31.K10, v: 493789.8, f: 'SUM(K3:K9)' };
    notes.push('31차: 사용자 승인(2026-09-07)으로 합계에서 누락된 염색 호접을 포함합니다. 매입액 6,568,213→6,834,613원, 이익 2,468,949원 유지, 네노바 1,975,159.2원·미우 493,789.8원. 원본 파일은 변경하지 않았습니다.');
  }
  const week30 = workbook?.Sheets?.['30차'];
  if (week30?.I6?.v === 4140 && week30?.I7?.v === 46800 && week30?.I9?.v === 1970778) {
    for (const row of [6, 7]) {
      week30[`K${row}`] = { ...week30[`K${row}`], v: week30[`I${row}`].v * 0.8, f: `I${row}*80%` };
      week30[`L${row}`] = { ...week30[`L${row}`], v: week30[`I${row}`].v * 0.2, f: `I${row}*20%` };
    }
    week30.K9 = { ...week30.K9, v: 1970778 * 0.8, f: 'SUM(K3:K8)' };
    week30.L9 = { ...week30.L9, v: 1970778 * 0.2, f: 'SUM(L3:L8)' };
    notes.push('30차: 사용자 확인(2026-09-07)한 7월 이후 80:20 기준을 적용합니다. 장미 두 행에 남은 60:40 배분만 보정하며 매입·매출·전체 이익은 그대로입니다. 원본 파일은 변경하지 않았습니다.');
  }
  const week33 = workbook?.Sheets?.['33차'];
  if (week33 && !String(week33.A7?.v || '').trim() && week33.B7?.v === '태국샘플' && week33.C7?.v === 1 && week33.D7?.v === 43000) {
    week33.A7 = { t: 's', v: '태국샘플' };
    week33.B7 = { t: 's', v: '' };
    notes.push('33차 7행: 원본 칼라 칸의 태국샘플을 그대로 품목명으로 표시합니다. 실제 품종·환산단위를 추정하거나 전산 품목과 자동 연결하지 않습니다.');
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
