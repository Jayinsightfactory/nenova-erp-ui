# Nenovaweb → MOYI 주차별 매출이익 보고서 전송 작업 기록

작성일: 2026-08-03

## 확정 범위

이번 1차 구현은 Nenovaweb의 **주차별 매출이익 보고서 XLSX**를 MOYI의 회사
Drive로 보내는 흐름이다. MOYI 채팅 알림 발송은 별도 기능으로 섞지 않았다.

## 부작용 매트릭스

| 사용자 동작 | ViewOrder/ViewShipment 읽기 | OrderDetail | ShipmentDetail | Stock/ProductStock | Estimate/WebProfitReport | 웹 전용 |
|---|---|---|---|---|---|---|
| 보고서 조회/파일 생성 | 읽기 | 보존 | 보존 | 보존 | 보존 | 없음 |
| MOYI 전송 신규 | 보고서와 동일하게 읽기 | 보존 | 보존 | 보존 | 보존 | `WebMoyiReportPush` 신규 |
| MOYI 전송 재시도 | 보고서와 동일하게 읽기 | 보존 | 보존 | 보존 | 보존 | 같은 `PushId` 상태 갱신 |
| MOYI 수신 완료 | 해당 없음 | 보존 | 보존 | 보존 | 보존 | MOYI Drive 파일 저장 |
| MOYI 실패 | 해당 없음 | 보존 | 보존 | 보존 | 보존 | `failed` 및 오류 저장 |

## 멱등·보안 규칙

- `PushId`를 MOYI `file_id`로 전달한다. 재시도는 같은 ID를 사용한다.
- 전송 파일의 SHA-256, 크기, 원격 파일 ID와 응답 상태를 웹 감사 이력에 남긴다.
- 인증된 Nenovaweb 사용자만 전송·이력 조회할 수 있다.
- MOYI 토큰은 코드·브라우저·응답에 노출하지 않고 서버 환경변수만 사용한다.
- MOYI 서버는 이미 저장된 `file_id`를 다시 저장하지 않고 `idempotent:true`를 반환한다.

## 호환성 판정

이 기능은 `nenova.exe`가 쓰는 ERP 원장을 변경하지 않는 웹 전용 파일 전송이다.
주차별 보고서의 원천값·계산식은 기존 `pages/api/sales/profit-report.js`와
`lib/profitReportExcel.js`를 재사용하므로, 보고서 화면과 MOYI 파일의 수치·양식
생성 경로가 분리되지 않는다.
