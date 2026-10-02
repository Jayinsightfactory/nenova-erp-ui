# 주광 요일 화면 native NULL 오탐·반복 오류 수정

## 요청과 범위

사용자 ‘수정’: 정상 상세 고객 NULL의 오탐, 상단 연결 경고, 품목 합계마다 반복되는 긴 견적 오류를 웹에서 정정한다. [기존 조사 및 설명 정정](../SHIPMENT_DETAIL_CUSTOMER_NULL_NATIVE_COMPAT_2026-10-02.md), [설계·계약·부작용](../plans/weekday-native-customer-read-2026-10-02.md)을 적용했다.

EXE·운영 SQL 데이터·스키마·SP를 변경하지 않았다. 자동 확정/해제, 정상 NULL 채우기, 운영 테스트 저장을 하지 않았다. 기존 페이지 최초 기준을 자동 갱신하지 않는다.

## 적용 내용

- 양수 Master 고객 + 상세 raw NULL/같은 양수 키만 허용하는 공통 SQL/JS 정책.
- 비교·최초 기준·이월/비고·품목 조회에 정상 NULL 포함. 0·타 고객은 별도 오류/invalid로 차단.
- raw 상세 CustKey가 compare/save digest에 동일하게 보존된다. 실제 저장에서 기존 NULL은 미변경.
- 직접 셀 편집과 초안 이동의 잘못된 고객 연결 차단. 다른 연도의 무관한 오류는 현재 이동을 차단하지 않는다.
- ERP 확정과 페이지 ‘기준 미확정’ 구분. 동일 차수 견적 오류는 헤더에 접힌 상세 1개, 셀은 조회실패 버튼, 선택 내역에서 상세 확인.

## 검증

- 전체 `test:erp-contract`, `test:weekday-estimate`, 변경 범위 manifest 및 write guard 통과.
- 최종 webpack build 통과(113개 static page).
- 격리 MSSQL: native NULL 날짜 이동 총량25, raw NULL/Detail.isFix 유지, baseline/carryover 정상 집계 및 wrong key 오류 집계, 인쇄 성공, 0·타 고객 거부와 전체 rollback. 기존 교차연도/방향별 재고/lease/negative rollback adversarial도 통과. 테스트 DB는 guard로 제한되고 종료 시 삭제된다.
- 1920×1080 / 100% fixture 화면: 상하 가로 스크롤, 수량/행 hover/선택 상세/모달, 좁은 화면 회귀와 긴409 오류 3차수 검사. 일반 행 160px 미만, 특수 긴 초안/환산불가 fixture는200px 미만; 오류 전후 행 높이 증가1px 이하.
- 운영 읽기 전용 조사: 주광39차 정상 상세 NULL79건, 기존 EXE 호환 견적94행. 실제 운영 저장 및 EXE GUI 프린터 출력은 시험하지 않았다.

## 후속·주의

배포 후 version/API/실화면 읽기 전용 확인을 수행한다. 운영에서 남은 미확정·날짜·금액 오류는 숨기거나 자동 보정하지 않는다. 범용 distribute-diagnose/exe-errors/item-trace의 과거 진단·보정 제안은 별도 정정 범위이며, 정상 NULL의 일괄 SQL 보정 근거로 삼지 않는다.
