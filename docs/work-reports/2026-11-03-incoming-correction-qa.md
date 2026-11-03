# 입고 교체 수정 검증

- 기준: origin/master 6428f624e, 설계 `../plans/incoming-replacement-2026-11-03.md`.
- 기능: 기존 `/incoming`에 농장·품목 수정/파일 교체 버튼. FARM/REPLACE 명시 모드, 최종값 미리보기, 사유/체크 확인, sessionStorage 초안 복구(승인 복구 금지), 동일 UUID 재시도, 최근20건 이력.
- 조건 공유: `prepareWarehouseCorrection`이 미리보기/잠금 저장에 동일하게 실행. `readInvoiceReceiptEligibility`의 현재확정/직전미확정/직후확정 및 V2 게이트 준비 상태 검사. 9종 연결·설정 검사. 기존/신규 ProdKey 차액, 후속 재고 및 음수 사후검사. 공용 staging 미사용.

## 실행 검증
1. `node --test __tests__/warehouseCorrection.test.mjs`: 10 PASS. FARM 수량보존, A→B 양쪽 차액·단위, 명시0, 누락/음수/비유한수, 파일 업무키 불일치, 미등록/중복품목, 교차연도, 9종 연결/확정/게이트 차단, 재시도/다른payload, native 계산·감사·검산·후속음수 실패 롤백, API권한/405/GET 의존성 override 방어.
2. `WAREHOUSE_CORRECTION_SQL=1 node --test __tests__/warehouseCorrectionSql.test.mjs`: PASS. 승인된 loopback SQL2022 컨테이너에 이번 실행 전용 무작위 DB 생성·삭제, 운영 접속 불가. 실제 캡처 native gate Enter/Leave/CALC 사용. capability 메서드는 기존 격리 fixture stub임을 명시.
   - A10→B10: Product.Stock A110→100/B100→110, 2027 snapshot100/110.
   - 동시 동일 UUID2요청: 감사1회·두번째 replay.
   - FARM 상세 PK/수량 유지. native 내부 오류와 미래 음수는 입고·재고·감사 모두 원복.
   - 2025 동일차수, 주문/출고/ShipmentDate/ShipmentFarm/Estimate/WebProfitReport 보호 snapshot 불변.
3. `node scripts/warehouse-correction-ui-smoke.cjs`: PASS. 실제 React 컴포넌트와 XLSX 파서를 localhost에 올리고 모든 API 모의응답. 파일선택, 미리보기, 확인 전 저장 잠금, 실패응답 동일작업 재시도, 연결차단, 초안복구 승인해제, Tab/ShiftTab/Escape/초점복귀, 1920×1080 및390×844. 모바일 모달 content-box 폭 넘침 발견·border-box 및 사유 입력 flex 보완 후 PASS. `.verify/correction-desktop.png`, `.verify/correction-mobile.png` 로컬 시각검사.
4. 기존 입고 파서/조회기간/표시 3 tests PASS. `npm run test:ui-layout` PASS. dnSpy guard PASS. manifest187 PASS, 변경 API1 write-scope guard PASS.
5. 최종 모바일 수정 반영 `npm run build` PASS(exit0), 전체 `npm run test:erp-contract` PASS(exit0). 검증 로그는 `.verify/build.log`, `.verify/erp-contract.log`에 보관한다.

## 운영 읽기 전용 확인
- 앞선 표본7968은 재조회 시 활성행이 없어 새 표본을 선택했다. 최신의 미매칭/NULL 수량 포함 원장은 `CORRECTION_OLD_DETAILS_INVALID`로 거부됨도 확인했다. 임의 보정 없음.
- 정상 상세를 가진 7970, 4행에 실제 `prepareWarehouseCorrection` 실행: 스키마/원가참조/게이트 capability 조회 성공. 동일 농장 요청은 `CORRECTION_UNCHANGED`, native 확정조건은 `NATIVE_ELIGIBILITY_BLOCKED`. ERP 쓰기0. capability는 조회 SP이며 입고/재고 SP 미실행.
- 실제 업무의 수정 저장은 수행하지 않았다. 운영 브라우저·배포는 후속 단계이며 미검증 상태를 완료라고 표시하지 않는다.

## 메뉴 기본값
적용: 기존 shell/메뉴 유지, 원장 키보드 방향키/Enter/Space 선택, 페이지 자연 세로스크롤, 수정 모달 반응형, 변경 전후/명시확인, 실패 재시도, 초안, 감사. 모달 내부 스크롤은 명시 모달 예외. 새 메뉴등록·공용품목매칭·취소/확정해제 자동화는 해당 없음.

## 한계와 보존
확정/원가/인보이스/농장분배 연결 및 기존 미매칭 품목은 이 화면에서 강제 해제하거나 자동 이관하지 않는다. 수정 대상과 저장본을 확인하고 해당 업무에서 먼저 정리해야 한다. 연도/차수/인보이스/AWB/입력일자/중량/운임은 교체 대상이 아니다. 기존 신규 업로드 API와 기존 삭제 API의 동작을 이번 기능으로 변경하지 않는다.
