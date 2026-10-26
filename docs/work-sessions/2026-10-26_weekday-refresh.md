# 2026-10-26 주광 차수 감소와 자동 갱신

Q.44에서 감소하면1이 되고,출고일 NULL/음수 오류와2025/52 조회 오류가 반복된다.
A.차수 증감을 React 값 기반으로 변경. 과거 NULL EstQuantity가 있는 기준 확정 후보의 거부는 유지하되 독립적으로 검증된 최신 분배 갱신은 허용한다. 선출고 GET만2000..2200로 일치시키고 POST2026+는 보존한다. 입력 초안/실제 원장 쓰기는 변경하지 않았다.

근거: [설계·native·SELECT](../plans/weekday-refresh-2026-10-26.md). 과거2026/01~02 견적수량NULL230행, 분배수량은 유효. 실제43-01 baseline93품목 정상. 직접44입력→감소의 신고 현상은 운영에서 재현되지 않아 원인을 단정하지 않음.
검증: 대상29건,전체 ERP계약,dnSpy evidence,manifest,쓰기guard,UI layout,build 통과. 격리 Chrome44→43,Space증가/ArrowDown,Tab초점,Enter조회43 유지 확인.
배포: PR/CI/Cafe24/운영 스모크 진행 중.
메뉴 기준선: 적용 명시조회/키보드/페이지스크롤. 해당없음 새메뉴·모달·출력양식. 예외없음.
검색어: 주광 자동갱신 차수44 43 1 EstQuantity NULL INVALID_ERP_DATES2025/52
