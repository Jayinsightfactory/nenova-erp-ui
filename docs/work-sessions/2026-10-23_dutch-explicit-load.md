# 네덜란드 명시 조회와 칼라 입력창

Q. 차수 선택 뒤 물량 바로 불러오기 버튼을 눌러야 조회. 칼라 입력 시 prompt() is not supported.

A. 초기/연도 선택 effect의 물량 자동 조회 제거. 기존 기본차수와 목록은 유지. 칼라를 페이지 dialog로 대체, 비고 전후 미리보기/명시 저장/취소/Escape/중복 방지/실패 입력 보존.

ERP 부작용: API/SQL 변경 없음. 기존 Product.Descr CAS 저장만 재사용, 수량/단가/분배/견적/재고 원장 보존. actual dnSpy ClassProduct Descr 재확인, SELECT-only schema/trigger probe 1310품목/905null/54분할비고 재확인.

기준선: 키보드/초점복귀 적용, shell/스크롤 보존. 새 메뉴 해당 없음. 운영 시험 쓰기 없음.
검증·PR·배포 결과는 후속 기록. 기존 추가팝업/인쇄/roundtrip은 범위 밖.

검증: 실행형 2025/2026 목록-only effect, dialog 중복저장/Escape/실패보존, productColor 테스트 통과. 전체 erp-contract, dnSpy evidence, manifest 156개, write guard 변경 API 0개, Next webpack build 통과.
