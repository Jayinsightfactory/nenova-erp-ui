// 클라이언트·서버 공용 거래처명 정규화 (fs 의존 없음)

export function normalizeCustomerToken(t) {
  return String(t || '')
    .toLowerCase()
    .replace(/㈜|\(주\)|（주）|주식회사|유한회사|농업회사법인|영농조합법인/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/꽃(?=소재)/g, '')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}
