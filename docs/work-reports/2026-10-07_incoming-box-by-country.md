# 차수별 국가 입고 박스 (웹 메뉴 + 대표 모바일 보고서)

## 목표

매 차수 자동으로 국가별 입고 박스 총수량을 차수별·대차수별·월별로 본다. 국가 열은 총 박스가 많은 순, 오른쪽 합계 열과 아래 합계 행만 두고 비고는 두지 않는다.

- 웹: `/incoming/box-by-country` (입/출고관리 메뉴 "차수별 국가 입고 박스")
- 대표 모바일: `/m/incoming-box` (모바일 홈 "경영 보고서" 섹션, 국가별 물량 보고서와 상호 링크)
- API: `GET /api/incoming/box-by-country?year=2026`, `POST` 카톡 내보내기 업로드(관리자)

## 원천과 Git 근거

- `docs/exe-golden/FormWarehouseView.md`: 입고는 `WarehouseMaster.OrderYear + OrderWeek` 범위, `OrderNo`가 AWB(BILL), `WarehouseDetail.BoxQuantity/BunchQuantity`. 이 보고서는 SELECT 만 한다.
- 비행 스케줄 카톡방 공지(AWB·편명·박스)는 ERP에 없다. 카카오톡 내보내기(txt)를 업로드하면 `lib/incomingBoxByCountry.parseKakaoFlightSchedule` 가 파싱해 웹 전용 `WebFlightScheduleBox` 에 MERGE 한다 (`docs/migrations/2026-10-07_web_flight_schedule_box.sql`).

## 2026-10-06 카톡↔입고관리 대조에서 확정한 사실

1. 입고관리는 콜롬비아·호주·베트남·미국만 `BoxQuantity`가 들어 있다. 네덜란드·태국·중국·에콰도르는 단/송이로만 입력되어 박스가 0이다 (2026년 태국 719라인 전부 박스0).
2. 콜롬비아 22차부터 Maxiflores·Esperance Roses·Construnorte·Flores Tiba 장미 라인이 단만 입력되고 박스가 0이다 (장미 3,897라인 중 699라인). 10단=1박스로 환산하면 카톡과의 차이 2,357박스가 54박스로 줄어 차이가 설명된다.
3. 같은 선적이 AWB를 바꿔 재공지된 중복 8건은 웹에 한쪽 AWB로만 입고되어 있다.
4. 수국 AWB는 전 차수 박스가 1개 단위까지 카톡과 일치한다.

## 최종 박스 규칙 (`buildBoxByCountry`)

| 상황 | 최종 박스 | 출처 표시 |
|---|---|---|
| 카톡 중복 의심(같은 차수·품목, AWB 다른데 박스 동일) | 제외 | — |
| 웹 입고 있음 + 박스 0 (단/송이 단위 국가) | 카톡 박스 | 카톡(웹 박스 미입력) |
| 웹·카톡 둘 다 박스 있음 | 웹(전산) 박스 | 웹(전산) |
| 위 중 콜롬비아 장미 단만 입력(박스0 단수/10 ≈ 차이) | 카톡 박스 | 카톡(웹 장미 박스 미입력 보정) |
| 웹에만 있음 | 웹 박스 | 웹(카톡 공지 없음) |
| 카톡에만 있음 | 카톡 박스 | 카톡(웹 미입고) · 확인 필요 |
| 카톡 AWB 미기재 품목내역만 | 같은 차수·국가 선적이 없을 때만 품목합 | 카톡(AWB 미기재·품목합 추정) |
| 웹 '국내' 입고 | 제외 | — |

중국 농장(Yunnan Melody/Okyong/Cloud/HUBFRESH) 품목이 콜롬비아 국가코드로 등록된 입고는 표시 국가만 중국으로 정정한다 (`Product.CounName` 은 수정하지 않는다). 웹 AWB 자릿수 오타는 같은 차수·국가의 근접 카톡 AWB로 매칭한다.

## Side-effect matrix

| 작업 | OrderMaster/Detail | WarehouseMaster/Detail | ShipmentMaster/Detail | Product | WebFlightScheduleBox |
|---|---|---|---|---|---|
| GET 집계 | 미조회 | SELECT only | 미조회 | SELECT only | SELECT only |
| POST 카톡 업로드(관리자) | 변경 없음 | 변경 없음 | 변경 없음 | 변경 없음 | MERGE (웹 전용) |

## 운영 절차 (매 차수)

1. 수입부가 "비행 스케줄" 카톡방을 **대화 내보내기(txt)** 로 저장한다.
2. 웹 `/incoming/box-by-country` 에서 "카톡 내보내기 업로드"로 파일을 올린다. 같은 AWB는 마지막 공지로 갱신되므로 누적 파일을 그대로 올려도 된다.
3. 전산 입고는 자동 반영된다. 카톡 업로드 전에는 전산 박스만 표시되며, 비콜롬비아 국가는 박스 단위가 없어 0으로 보인다.

## 검증

- `npm run test:incoming-box` — 파서(대괄호/무괄호 헤더, 분할 A/B, 연착 재공지, AWB 변경 중복, `_ box` 미정 후 확정, 사전공지 흡수), 최종 박스 규칙(박스0→카톡, 장미 보정, 웹만/카톡만, 국내 제외, 국가 정렬), 교차연도 격리, 계약 파일 존재.
- 실제 2026 카톡 내보내기(공지 717건)로 JS 파서가 Python 분석과 동일한 결과(선적 477건, 중복 8건)를 냈고, 입고관리 2026 마스터 3,078행과 합산한 최종 합계가 분석본과 일치했다.
- `npm run test:ui-layout`, `npm run test:erp-manifest -- --changed-from origin/master`, `npm run guard:erp-writes -- --changed-from origin/master`, `npm run build`.
