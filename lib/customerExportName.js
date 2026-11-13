function isScheduleAlias(value) {
  const raw = String(value || '').replace(/\s+/g, '').replace(/[－–—]/g, '-');
  if (!raw || /^CL\d+$/i.test(raw)) return true;
  return /^(카|수|장|알|태|중|소|네)-?(월|화|수|목|금|토|일|미정)$/i.test(raw);
}

/**
 * 거래처관리의 비고(Descr)는 전산명과 엑셀 표시명을 연결하는 별칭이다.
 * 비고가 `표시명/일정` 형식이면 첫 번째 값을 사용하고, 일정 토큰만
 * 들어 있는 비고는 전산 거래처명을 유지한다.
 */
export function customerExportName(item) {
  const canonical = String(item?.customerName || item?.CustName || '').trim();
  const descr = item?.customerAlias ?? item?.CustomerAlias ?? item?.customerDescr
    ?? item?.CustomerDescr ?? item?.CurrentCustomerDescr ?? item?.Descr ?? '';
  const firstPart = String(descr || '').split(/[\/／]/)[0]?.trim() || '';
  return firstPart && !isScheduleAlias(firstPart) ? firstPart : canonical;
}
