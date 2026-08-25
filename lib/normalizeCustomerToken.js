// 클라이언트·서버 공용 거래처명 정규화 (fs 의존 없음)

export function normalizeCustomerToken(t) {
  return String(t || '')
    .toLowerCase()
    // 카카오톡 목록 말머리는 거래처명의 일부가 아니다.
    // 예: "●영남가빈"은 "영남가빈"과 같은 거래처로 조회되어야 한다.
    .replace(/^\s*[●•○◦▪■□◆◇▶▷►▸▹✓✔☑※·ㆍ]+\s*/g, '')
    .replace(/㈜|\(주\)|（주）|주식회사|유한회사|농업회사법인|영농조합법인/g, ' ')
    .replace(/[()[\]{}]/g, ' ')
    .replace(/꽃(?=소재)/g, '')
    .replace(/(추가|취소|삭제|출고|입고|변경사항|변경|오늘|일요일|월요일|화요일|수요일|목요일|금요일|토요일)/g, ' ')
    .replace(/[|:：,\-→>]/g, ' ')
    .replace(/\s+/g, '')
    .trim();
}

export function normalizeCustomerMappingKey(t) {
  return normalizeCustomerToken(String(t || '').split(/[\/／]/)[0]);
}
