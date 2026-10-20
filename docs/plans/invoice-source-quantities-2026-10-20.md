# 중국 인보이스 원본 수량 보존

## 원인과 근거
- 중국 AI 프롬프트는 total_bunch=quantity ordered만 요구하고 박스/송이 필드를 요청하지 않았다.
- genChina의 비정형 경로는 매칭 후 pcs=1, bunch_st=1, steam_box=0으로 대체하고 total_stems를 버렸다.
- 내부 pcs는 기존 스키마의 박스 필드다. 인보이스의 PCS 표기(송이)와 다르므로 내부 필드명을 일괄 치환하면 다른 국가를 손상시킨다.
- 2026-10-20 실제 dnSpy.Console ExcelLoadingPackingList 재확인: F→BoxQuantity, I→BunchQuantity, J→SteamQuantity, G/H→SteamOf1Bunch/Box. 각 수량은 별도 원본 값이다.

## 기준 원장
| 기준 | 근거 | 소비 |
|---|---|---|
| Order는 박스 수인 표에서만 pcs로 추출 | 사용자 지정 중국 양식, 정형 중국 파서 | AI 지시문 |
| Bunch/PCS 표시는 단/송이, 단당·박스당과 총량 구분 | 원본 헤더 | AI 지시문 |
| 명시 총량 및 0 보존 | 원본 제품행 | genChina, 엑셀 F/I/J |
| 누락 비율은 양수 원본 총량으로만 유도 | 총송이/총단, 총송이/박스 | 공통 순수 helper |
| 총량 누락 시 명시 원본 비율로만 계산 | 총단×단당송이 | helper; DB/품목 기본값 금지 |
| 매칭 확인과 수량 원문 확인은 별도 | 기존 sourceReview | 기존 확인 게이트 보존 |

## 부작용
분석/매칭/미리보기/파일 생성: 브라우저와 다운로드 결과만 변경.
Order*, Shipment*, ShipmentDate, Warehouse*, Stock*, Estimate, WebProfitReport 모두 보존.
SQL writer, 단가 단위, 팀 공용 매칭 저장 정책 변경 없음.
실제 운영 DB SELECT 집계: 2026/41-01 XJ-2026-NN004 활성 입고 상세 102행,
박스102/단5391/송이5391. 원본 101상품행 429박스/5390단/68775송이와 다름.
추가 행 및 개별 입고 원인은 본 집계만으로 확정하지 않는다. 기존 운영 데이터 보정 없음.
사용자 화면의 현재 오류 문구 및 배포 후 스모크는 아직 미검증.

## 검증
2025/2026 동일 41-01, 원본 4박스/40단/400송이, 0과 누락, 상충 총량,
기존 정형 중국 및 타국 회귀. 미지정 수량을 1로 만드는 것 금지.
실제 41-1 중국 해상 ci1.xlsx와 Catalog.xlsx 테스트 20/20 통과.
ERP contract 전체, dnSpy evidence, manifest, write guard 통과. production build 성공.
메뉴 기준선: 기존 UI/스크롤/품목 매칭 유지(적용). 신규 화면틀/입력 UI(해당 없음).
