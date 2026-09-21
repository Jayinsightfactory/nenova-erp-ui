# 운임 박스수 한 화면 비교

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-09-21 |
| 화면 | 견적서관리 → 운임비 추가 |
| 원장 부작용 | 조회 열과 클라이언트 레이아웃만 변경. 모든 ERP 쓰기 및 기존 추가 품목 사이클 보존 |
| 기준 화면 | 1920×1080, 100% |

## 고정 결정 / 기준 원천
- 품목을 3열의 한 줄 행으로 표시하고 합계·등록 운임·기존 운임·확인 버튼을 같은 화면에 둔다.
- 작은 화면이나 한 화면 수용량을 넘는 데이터에서는 접근성을 위해 overflow를 허용한다. 임의로 품목을 숨기지 않는다.
- 박스 원천은 해당 SdateKey의 ShipmentQuantity / Product.OutUnit 및 환산값이다. Detail 총량을 날짜마다 복제하지 않는다.
- 누락된 DateShipQty는 0이 아니라 확인 필요. 명시된 0은 보존한다.

## Q&A
### 1. 박스 카운팅을 스크롤 없이 한 페이지에서 확인
**Q.** 박스수를 한 페이지에서 다 볼 수 있도록 구성 요청.
**A.** 전체 폭 모달, 품목 3열, 운임 입력 2열, 기존 내역 압축 표시로 변경. 현재 27개 품목을 기준으로 실화면 확인 예정.

### 2. 모든 박스가 0인 원인
**A.** 실제 API는 loadExeDetailItems → sqlEstimateGetDetail → mapExeDetailRowToWebItem 경로인데 기존 계산 테스트는 다른 조회 경로의 DateShipQty 필드를 가정했다. 실제 mapper가 출고수량·환산값을 전달하지 않아 Number(undefined) 실패를 0으로 표시했다. 기존 JOIN의 ShipmentDate와 Product 열을 SELECT에 추가하고 mapper로 전달한다. WHERE/JOIN 및 인쇄값·수량 원장 변경 없음.

## 부작용 / 증거
| 동작 | Order/Shipment/Date/Farm | Stock/Estimate/WebProfitReport |
|---|---|---|
| 박스 미리보기·체크·반올림 | SELECT 및 화면 상태만 | 모두 보존 |
| 실제 운임 등록 | 기존 추가 품목 경로 보존 | 기존 계약 그대로, 이번 변경 없음 |

- 로컬 decompile FormEstimateView.GetDetail은 SdateKey의 EstQuantity를 표시하고 Product.EstUnit을 사용한다. 웹의 추가 환산 정보는 표시용 보조 열이며 EXE 표시값을 대체하지 않는다.
- 배포 전 운영 읽기: 2026 37차 영남꽃소재 정상 품목 27행과 기존 운임 7행이 표시됨. 모든 박스가 0인 현상을 확인. 운영 쓰기 probe는 수행하지 않음.
- 회귀: 실제 mapper를 거친 2박스/30단, 값 누락/null/0/잘못된 값, 날짜별 분리, 교차연도 제외를 검사.
- 로컬 ERP 계약 전체, dnSpy 증거, manifest, 변경 쓰기 가드, build 통과.
- 배포 및 실브라우저 결과는 최종 응답에 실제 확인 결과로 보고한다. 운영 운임을 시험 등록하지 않는다.
