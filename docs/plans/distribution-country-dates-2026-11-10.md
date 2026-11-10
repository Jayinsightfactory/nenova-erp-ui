# 2026-11-10 출고분배 국가 즐겨찾기 / 출고일 저장 기준

## 선행 근거
실제 설치 Nenova.exe를 dnSpy.Console로 FormShipmentDistribution 재추출(outputs/country-dates-dnspy.txt).
GetCustomerList / grdViewCust_FocusedRowChanged / btnSave_Click / ShipmentQuantityToEstQuantity 확인.
날짜 탭은 ShipmentDate 삭제 후 요일1~7 순서로 양수행 삽입, 마지막 요일의 SD.ShipmentDtm을 대표일로 저장.
EstQuantity는 소수 환산 원값이며, 금액만 Math.Round(EstQuantity,0) 후 Math.Round(gross/1.1,0).
기존 distributeUnits 정수 EstQuantity는 이 날짜 편집 경로의 권위가 아님. 새 경로에서 별도 native 소수/은행가 반올림을 사용한다.
운영 SELECT: 2026/45-01 Prod3513 두 상세101436/101823, 각1박스=15단,단가11500,gross172500,DetailFix1,ViewOrder 각1.
2025 동일품목/차수0. 2025/2026 PeriodDay 각7행, 수~화 달력(요일번호1~7)임을 확인.
SD 트리거는 OutQuantity UPDATE에만 비고를 기록, Date 트리거 없음. 날짜만 바꿀 때 수량·재고 확정 사이클 불필요.

## 부작용 표
| 동작 | UserFavorite | Order* | SD | Date | Farm/Stock*/Estimate/WebProfitReport |
|---|---|---|---|---|---|
| 국가/품종 즐겨찾기 | 계정별 설정 | 보존 | 보존 | 보존 | 보존 |
| 날짜 조회/미리보기 | 보존 | 보존 | 보존 | 보존 | 보존 |
| 총량 동일 날짜저장 | 보존 | 보존 | ShipmentDtm만 | 해당 상세의 날짜행 재생성 | 보존 |
| 날짜저장 감사 | 보존 | 보존 | 보존 | 보존 | SystemActionLog만 추가 |

## 기준 원장
- 국가 설정: UserFavorite shipment-distribute-countries, {version:1,countries:[]}; 없는 설정만 기존 품종 즐겨찾기 국가로 이행 표시, 명시[]는 비어있음 유지. 저장은 기존 인증 favorites API. 중복 상단 품종 버튼 삭제. 전체보기에서 국가/품종 별도 토글.
- 업무키: 명시 4자리 연도+WW-SS+CustKey+ProdKey, 단일 활성 Master/상세, raw SD.CustKey NULL 정상, ViewOrder/Shipment 정확 연결 필요.
- 표시/미리보기/저장 모두 공용 readDistributionDateContext와 planDistributionDates. 실제 PeriodDay exact timestamp7개, 각요일1행, 연도·차수 달력만. 날짜 임의 계산 금지.
- 수량: 유한 양수/0, 최대소수3자리, 합=잠긴 SD.OutQuantity. 기존 Date합 불일치, 미가격/다중가격/다중비고/수동견적수량 등 불명확한 원장은 저장 전 차단.
- 금액: EXE 소수 환산과 은행가 반올림. 기존 Date 견적수량 합과 gross 유지. SD 수량/환산/단가/금액/확정/비고 그대로. 날짜별 공급가/VAT 분할 반올림 차이는 미리보기 표시(매출gross불변).
- 동시성: V2재고게이트+해당업체/부모차수 내부 편집리스, serializable Master/상세/Date 잠금. 조회시점 전체 스냅샷SHA256과 저장직전 비교. 재시도는 stale로 중복적용 차단. 감사/사후조회 실패 전체 롤백.
- 확정: 총출고량 그대로, 확정플래그 보존. 확정해제/재확정/SP/재고변경 없음. 날짜별 견적 노출일만 바뀜.
- UI: 날짜 편집은 별도 대화창, preview후 명시 저장, 합계 불일치 차단. 닫기/ESC 미저장 확인. 기존 수량 미저장 상태면 먼저 저장 안내. 품목/업체/출고일지정 동일 창. 출고일 탭 기존 가짜 날짜입력 제거, 실제 저장값 표시. 요일기본값 저장과 실제 날짜저장 구분.
- 검증: 긍정/near-miss/교차연도 순수 및 격리MSSQL, 견적 native join/엑셀, rollback, 브라우저1920/390/키보드, 합성데이터 안내영상. 운영 임의 테스트저장 없음.

### 추가 회귀 검증
국가 설정 로드가 끝난 뒤에만 기본 품종을 선택하여 명시적 빈 국가[]에 숨은 품종이 자동 선택되지 않게 했다.
최신 국가설정 FavoriteKey 우선, 계정전환 즉시 초기화, 명시[] 재접속 보존을 확인했다.
출고일지정/집계 탭에서는 상단 수량저장·Ctrl+S가 숨은 기존 품목을 저장할 수 없게 차단했다.
날짜창의 Ctrl+S는 뒤쪽 저장을 호출하지 않으며, ESC 미저장 취소/폐기와 모바일390을 확인했다.
달력은 원차수 exact scope와 날짜·요일·시각·중복을 함께 검증하고, 연말52/연초01만 경계 연도를 허용한다.
격리 SQL의 실제 전산 ViewOrder(UserInfo/Customer/Product 포함) 연결 및 삭제·담당자누락 차단,
감사 INSERT 실패 후 Date삭제/재생성/대표일 전체 롤백, V2 gate busy도 확인했다.
