# 호텔+미우 주문전용

사용자 요청: 호텔 주문등록 기본 탭, 연도/차수 선택, 요청/발주 별도 파일·텍스트·이미지 입력, 품목 합산, 잔량 자동 분류, 업체 고정/추가/취소, 주문 전후 로그.

## 기준과 부작용

| 동작 | 기준/소비자 | 주문 | 출고/견적/매출/재고 |
|---|---|---|---|
| 업로드/매칭 | 기존 hotel-miu parser, 공용+호텔 저장 매칭. 충돌은 수동 확인 | 보존 | 보존 |
| 합산/분류 | 같은 ProdKey를 Product.OutUnit으로 환산. 잔량=요청-발주. 발주→라움, floor(잔량/박스계수)*계수→호텔여분, 나머지→분류필요 | 보존 | 보존 |
| 업체 선택 | 활성 Customer 명시 선택. 없는/모호한 업체는 재선택. 고정은 이 브라우저 작업 설정 | 보존 | 보존 |
| 등록 전 확인 | 연도+차수+업체 GET my-customers의 CurrentQty/CurrentOrderRows. 미매칭/음수/단위누락/미분류/중복 차단 | 보존 | 보존 |
| 등록 | 기존 POST orders source=my-customer, orderMode=ADD, expectedCurrentQty. 업체별 트랜잭션/사후검증. 결과 불명은 재전송 금지 | Master/Detail/History 변경 | 보존 |

정확히 1박스는 호텔여분. 1.5박스는 1박스 호텔여분+0.5박스 분류필요. 발주가 요청보다 크면 음수를 숨기지 않고 등록 차단. 환산 계수 누락은 임의 1 대체 금지. 기존값 0 보존. 사용자 선택 수량이 자동분류 잔여를 초과하면 차단.

## 실제 근거

2026-10-27 dnSpy.Console.exe --no-color -t FormOrderAdd 실제 Nenova.exe 재실행. btnSave_Click는 연도/차수/업체 Master, Detail(UnitQuantity Out/Est), History를 transaction으로 저장한다. native 신규는 빈 ShipmentMaster와 stock calculation도 수행한다. 이번 UI는 기존 주문전용 my-customer ADD 계약(Stock/Shipment 보존)을 명시 재사용한다. 과거 MD의 PK IDENTITY/Manager 한글/CASE 현재수량 설명은 실제 writer와 불일치하므로 사용하지 않는다.

SELECT-only 운영 probe: 활성 Product3373. 라움 Cust680, 호텔여분690, 은화691, 쵸이문683; 신라/미우 별칭 후보 복수이므로 선택 확인 필요. 라움2026/44-01 OrderDetail3행, 2025 동일키0행, ViewShipment0행. WebHotelMiuProductMap/WebRaumItemMap/WebRaumPnl/Item/WebPnlHotel 존재. 기존 호텔 저장본 partner raum/shilla/choimun/custom 확인. 자격증명/원문/개인정보 저장 없음.

## 검증과 완료 기준

교차연도, 단위혼합, 박스 경계, 음수, 미분류, 0, stale/부분실패/재시도 회귀. 전체 ERP 가드·webpack·UI 확인 후 PR/CI/배포. 운영 시험 주문은 생성하지 않는다.
메뉴 기준: 단일 shell/페이지 세로 스크롤/키보드/입력 원문 비교/명시 등록 확인/실제 결과 로그 적용. 초안·결과는 브라우저 저장 범위를 표시. 기존 업체별 입력과 등록 이력은 보조 탭 보존.

## 검증 진행

- `hotelOrderWorkspace`4건: 단위혼합105/발주30/잔량75/호텔여분60/선택업체15, 정확1박스, 0, 음수, 미매칭, 누락계수, 초과배정, 삭제/없는 업체, 교차연도, 중복 매칭 충돌 통과.
- 실제 parse API 실행형2건: TXT/Excel/다중시트/text/OCR응답 모형과 파일 정리, SELECT-only 매칭 통과. 실제 외부 OCR 서비스에 사진을 전송한 시험은 미검증.
- Chrome 격리 UI: 요청105·발주30→라움30/호텔여분60/은화15. 기존5에서 서버 결과35/65/20 표시. 두번째 업체 저장후 응답유실 시험에서 첫업체 완료/두번째 확인필요/재등록 비활성/현재조회65 확인. 운영 POST 없음.
- 실제 매칭 SQL1035행/146품목 조회. downstream SELECT: ViewOrder3, ViewShipment0, ShipmentDate0, ShipmentFarm0, 견적 DetailFix=1 조인0, Estimate0, WebProfitReport0. 초기 Estimate 컬럼 가정 오류는 실제 schema 확인 후 ShipmentKey→Master 업무키로 정정; 데이터 쓰기0.
- 첫 전체검증은 공유 node_modules의 puppeteer-core 누락으로 중단. 별도 npm ci 설치 후 재실행 중. 전체검증/빌드/PR/배포는 완료 후 아래 기록.

- 전체 ERP 계약, dnSpy, manifest167, 변경API 쓰기guard, UI layout, 최종 webpack build 통과. 최신 master 병합의 충돌은 작업기록 두 파일에서 양쪽 내용을 보존해 해결.
