# 주광 요일수량 업로드 및 품종 범위 보정

## 사용자 요청
기존 파일 기준 요일수량 업로드/배포, 기존 주문 보존, 중복·빈칸 삭제 방지. 수국만 선택했는데 카네이션도 처리되는 화면은 출고분배 엑셀 업로드·검증.

## 결정과 근거
- [원본 조사 및 정책](../plans/jugwang-order-upload-weekdays-20261021.md), [계약](../contracts/jugwang-weekday-upload.json), [native 근거](../exe-golden/FormShipmentDistribution.md).
- 새 진입점 `/orders/weekday-upload`는 기존 주문을 바꾸지 않는다. 기존 주문 없는 품목은 차단. 양수 날짜만 추가, 기존 동일분배 no-op, 다른 기존분배는 충돌. 일반 주문 업로드의 FINAL_SNAPSHOT을 호출하지 않는다.
- 일반 분배 업로드는 파일명이 아니라 workbook 실제 시트·매칭 품목으로 범위가 확장되던 구조. 명시 시트+품종을 서버 preview/prealign까지 제한. 수국만 선택하면 타 품종 catalog/행/키맵/기존 전체교체 범위 제외.
- 감사120 카네이션 파일의 완료행에 장미104행/변경2행이 포함된 이력 확인. 사용자 수국 파일 감사122(2026/43-01)는 STARTED/입력485/완료행0이며 성공을 확인하지 못함. 이를 이번 코드로 복구했다고 주장하지 않는다.

## 운영 읽기 전용 확인
2026/44-01/533 ViewOrder48행 합3378, ViewShipment0, Estimate0. 2025 동일차수 ViewOrder93/7808, ViewShipment89/7504.733333333334, DetailFix89, Amount+Vat65902900. WebProfitReport2026/44행0. 운영 DB 쓰기·원본 재적용 없음. 44차 파일 수량 빈칸이므로 backfill 불가.

## 검증
실제 38/42/44파일, 순수파서·실제 buildImportPreview 회귀, 격리 MSSQL 신규/중복/롤백/교차연도/원장 보존 통과. 필수 전체검사·최종빌드·브라우저·배포는 진행 중. EXE GUI 직접 조작 미검증.

검색어: 주광 요일업로드 수국 카네이션 시트 범위 ShipmentDate 주문보존 빈칸 중복 감사122
