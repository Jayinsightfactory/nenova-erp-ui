# 적용재고 현재 매칭 일치 보완

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-10-13 |
| 화면 | 붙여넣기 주문등록 / 기초재고 기준 적용재고 |
| 원장 부작용 | 없음, ERP API/SQL/처리 결과 불변 |
| 배포 | 검증 진행 |

## 결정
- 현재 화면의 행별 품목 선택을 적용재고에 직접 전달한다. 오래된 preview draft는 원천으로 쓰지 않는다.
- 자동 매칭 예약이 수동 선택을 덮지 못하게 한다.
- result scope를 수정하거나 기존 주문/분배를 재실행하지 않는다.
- 실제 중복, 실제 누락, 결과와 다른 현재 입력, 단위/음수/실패 차단은 유지한다.

### 1. 배포 후에도 경고
Q. 믹스박스23/37, 연핑크43/두바이51 중복과 수국 알바리코게 누락이 계속된다. 바로잡아 달라.
A. 이전 수정은 행별 보존 함수는 검증했지만 panel이 오래된 draft와 별도 current scope를 결합하는 경계를 놓쳤다. 현재 매칭이 정상이고 draft만 오래된 테스트에서 동일 경고가 재현된다. 350ms callback도 이전 render 매칭을 캡처한다.

### 2. 사용 환경
Q. 네노바 PC 프로그램으로 작업했다. 둘 다 전산프로그램 웹앱이다.
A. 마지막 확인에 따라 Nenovaweb 작업으로 해석한다. 연결 브라우저에는 작업 탭이 없어 실제 자료의 ProdKey 비교는 아직 하지 못했다. 코드상 재현과 실제 사용자 데이터 해결 여부를 구분한다.

## 검증
계획: ../plans/applied-stock-current-source-2026-10-13.md
- `test:base-stock-mapping` PASS: 보고된 23/37, 43/51 중복·Albari 누락 재현, 현재 source 계산, 오래된 source 주입 차단, 실제 중복/누락 차단, 처리 후 매칭 변경 차단, 350ms 예약과 수동 선택 경합.
- `test:erp-contract`, `test:nenova-dnspy-evidence`, `test:erp-manifest -- --changed-from 1b8cdae0`, `guard:erp-writes -- --changed-from 1b8cdae0`, `test:ui-layout` PASS.
- 적용재고 모달 smoke PASS (1920×1080 / 1366×768 / 390×844): 키보드 열기/닫기, focus 복귀, clipboard fallback, rollback/stale 차단, 긴 목록 스크롤, 오류 없음.
- 독립 리뷰 blocker/P1 없음. 운영 검증 창은 로그인 만료로 사용자 재로그인 요청. 실제 사용자 ProdKey/기초재고 수정은 수행하지 않음.
- `npm run build` PASS. 전체 페이지 fixture 1920×1080/1366×768 PASS: 저장된 7개 행 ProdKey 보존, 재매칭 보존, 전각 원문 보존, 미완료 저장 차단, Escape 취소, 완전 매칭 1회 저장, ERP 쓰기/브라우저 오류 없음. 모든 API를 mock한 로컬 검증이다.
실제 dnSpy CLI FormShipmentDistribution 조회 재확인; 운영 SQL probe/보정 없음.

## 운영 규칙
메인 설계·통합·배포, 구현 gpt-6-sol/high, 독립 검토 gpt-5.6-sol/high. 하위 작업 P0_LOCAL만 허용. 테스트·초안 보존·기준 viewport1920×1080 적용, ERP 쓰기/신규 메뉴 해당 없음.
이전 generated JSON/세션MD와 outputs 및 .next-* 산출물은 커밋 제외.
