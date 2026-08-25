# 작업 완료 보고 — 분배 Descr SqlClient 제거 · 견적 적요는 직접입력만

## 메타

| 항목 | 내용 |
|------|------|
| 일시 | 2026-08-25 |
| 사용자 요청 | nenova.exe 분배에 SQL 문구 제거(재용3>2만), 견적서관리 비고는 직접입력만 |
| 브랜치 | `fix/descr-strip-sqlclient` |

## 원인

`TR_ShipmentDetail_OutQty_Log`가 웹 OutQuantity 변경 시 `[.Net SqlClient Data Provider / …] 20->10`을 `ShipmentDetail.Descr`에 append.

## 조치

1. 트리거: SqlClient/Node APP_NAME이면 append 안 함 (운영 DB 적용 완료)
2. `appendDescr`이 SqlClient/node-mssql 감사줄 제거, 분배는 `재용3>2`만 유지
3. 견적 적요 sanitize: 운영로그·업로드 로그 숨김, 직접입력만
4. 기존 Descr 정리: SqlClient 2035건 + node-mssql 잔여 191건

## 원장

| 대상 | 결과 |
|------|------|
| Order/Shipment 수량·금액·Stock | 보존 |
| ShipmentDetail.Descr | SqlClient 감사줄만 제거 |
| ShipmentHistory | 보존 |
