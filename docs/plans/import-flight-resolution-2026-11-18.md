# 수입 비행기 현재 이슈 판정 — 2026-11-18

사용자 승인 범위: NENOVAKAKAO 운영 원문 확인 → 완료 근거 반영 → 비행기별 미해결 업무 → 필수 테스트/PR/웹 배포/설치앱 반영. 영상 제외.

## 기준 및 부작용
| 동작 | 기준 | 소비자 | ERP 원장 영향 |
|---|---|---|---|
| 원문 읽기 | Orbit kakao_messages source=nenovakakao, 고정 3방, 원문시각+저장시각 | readImportScheduleFeed | 없음 |
| 공지 공유 판정 | 방별 최신 도착일·시간·편명·박스 동일 | mergeFlightNotices → buildChecklist | 없음 |
| 완료 판정 | 명시 AWB 또는 유일한 날짜범위/차수/나라/품목 연결, 완료 이후 새 요청 재개 | extract/linkRoomEvents → buildChecklist | 없음 |
| 공항 연결 | 편명+공지 도착시각 키, 3시간 범위 밖 자료 배제 | readIcnFlights → board/checklist | 없음 |
| 화면 | 변경은 이력, 현재 요청은 카드. ERP 등록으로 카톡 요청 완료 확정 금지 | Web / Desktop | 없음 |

기존 WarehouseMaster/Detail·Product SELECT 및 SQL predicates 변경 없음. Order*, Shipment*, ShipmentDate, Stock*, Estimate, WebProfitReport 전부 보존. 기존 파일 docsSent 명시 동작 변경 없음. 기존 import-flight-board 계약의 웹 전용 EXE 근거 적용(새 Form/SQL/writer 없음).

## 운영 근거 (원문·개인정보 원본 미저장)
Railway PostgreSQL BEGIN READ ONLY / ROLLBACK으로 조회. 11/18 조회 당시 최근 14일 스케줄 41, 빌번호 210, 선율 153건. 마지막 원문 모두 11/18 13:35 KST. 최신 imported_at 각각 14:25:48,14:21:04,14:28:33. imported_at은 마지막 저장 시각이며 수집기 마지막 정상 점검 시각을 증명하지 않음.
K4254: 11/17 10:15 선율에도 최신 변경 공지 존재. 11/18 12:23 서류 수령 목록에 해당 차수·품목 존재. 미해결: 11/17 18:03 수량 대조, 11/18 13:07 마스터/하우스 적하 구분. 운영 원문을 메모리로만 읽어 수정 함수 실행: 서류 done, currentRooms=3, alerts=2, 과거 일정 이슈=0. AC063도 docs done. 이는 원문 판정 검증이며 통관 완료 선언이 아님.

## 검증
합성 회귀: 두 편 공지, 키워드 없는 동일 일정 재공유, 수령과 수량 정정의 분리, 정정 완료/새 요청 재개, unknown AWB fallback 금지, 이전 연도/다른 품목 배제, 같은 편명의 다른 운항일 분리. 사진 내용 및 모호한 답글은 자동 완료 근거로 쓰지 않음.
필수 gate·CI·배포·설치앱 상태는 WORK_MEMORY 후속 기록을 따른다.
