# 공동 AWB 원가 계산

## 근거와 기준
- 43-1 콜롬비아 원가표: 품종별 박스수 × 실중량/부피 계수로 비율 계산. GW=CW이면 중량, 다르면 부피로 운임 배분. 통관비는 중량 비율.
- 44-1 수국 원가표: 공동 AWB 운임과 통관비를 전체 수국 송이수로 나눔. 농장별 CW는 필요하지 않음.
- 45-1 수국 AWB 160-17338005: 전체 GW 3483kg, CW 4307kg. 13개 송장 전체가 계산 분모. 농장별 CW를 실제 측정값으로 만들지 않는다.
- 실제 설치 EXE dnSpy CLI 재확인: BoxQuantity/BunchQuantity/SteamQuantity/UPrice/TPrice 독립 보존, InsertMaster의 입고 및 재고 SP 호출 순서 변경 없음.

## 기준 ledger
| 기준 | 원천 | 사용 |
|---|---|---|
| 연도+세부차수+정규화 AWB+통화 | 서버 문서 및 명시 manifest | 그룹 선택/미리보기/다운로드 |
| 전체 송장 목록+revision+sourceHash | 조회 당시 manifest | 누락/중복/변경 차단 |
| 품종 분류 | 확인한 행별 groupId | 이름 자동 추정 금지 |
| 박스·송이·가격 | 저장 입고 재조회 | 원본 단위 보존 |
| GW/CW 및 총비용 | 공동 AWB 입력 | 그룹 전체에 한 번만 적용 |
| 미입력/0 | 원본 명시 값 | 누락은 오류, 명시 비용0 보존 |
| 출력 | 미승인 계산본 | 승인된 원가 자동 갱신 금지 |

## 부작용
공동 계산/다운로드는 WarehouseMaster/Detail 읽기만, Order*, Shipment*, Stock*, Estimate, WebProfitReport, 승인 WebInvoiceCost* 모두 보존한다. 실제 입고는 기존 writer의 격리 테스트에서만 실행한다. 새 운영 쓰기/DDL/SP 호출 없음.

## 검증 상태
구현 중. Aside 전체 13농장 입고→다운로드, 다른 국가 회귀, 배포는 아직 미검증.
