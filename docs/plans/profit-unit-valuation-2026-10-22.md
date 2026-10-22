# 보고서 단위·재고평가·환율 누락 수정

## 사용자 범위와 완료 기준

- DB는 변경하지 않는다. 웹 계산/표시/다운로드만 변경한다.
- 박스·단·송이 금액 분모는 재고 평가 단위와 같아야 한다. 과거 EstQuantity를 현재 Product.EstUnit 수량이라고 무조건 가정하지 않는다.
- 같은 연도·스냅샷의 기말과 다음 기초는 같은 환율·평가 우선순위를 적용한다.
- 외화 금액이 있으나 환율이 없으면 원가와 이익/이익률을 0원 기준으로 확정 계산하지 않는다. 현재 통화마스터 환율은 참고값이다.
- 수기 H/R/S/AC/AJ, 확정 revision, 수량 원장은 보존한다.
- 2026년 1~41차 SELECT 대사, 계약·dnSpy·manifest·write guard·build, PR/CI/배포 및 읽기 전용 smoke가 완료 조건이다.
- 1~31차 원본 Excel(14~18차 수정본 선택)과 대조한다. 32~41차 원본 부재는 공통 산술 검증과 구분한다. 원본의 과거 수기 수익률/조정 예외를 임의로 복사하지 않는다.

## 근거

2026-10-22 실제 설치 EXE의 dnSpy.Console FormStockView.GetData 재확인: ProductStock와 ViewWarehouse/ViewShipment.OutQuantity 및 StockHistory를 읽는다. 이 작업은 그 수량을 변경하지 않는다.
이전 읽기 전용 대사에서 판매 Amount/EstQuantity가 박스당 가격인데 재고 단/송이에 곱해지는 사례와 E/F의 현재환율 fallback 비대칭을 확인했다. 변경 전후 같은 year/week 키를 SELECT로 다시 검증한다.

## 부작용 표

| 동작 | 주문/출고/입고 | Product/Stock/History | Estimate·Amount/Vat/isFix | WebProfitReport·확정본·계산캐시 |
|---|---|---|---|---|
| 보고서/독립 대사 GET | SELECT만 | SELECT만 | 보존 | SELECT만 |
| Excel 다운로드 | SELECT/메모리 계산 | 보존 | 보존 | 보존 |
| 테스트/운영 smoke | 쓰기 SQL/EXEC/트랜잭션 차단 | 보존 | 보존 | POST refresh/확정/저장 실행 금지 |

## 회귀 기준

1~21차 업로드 원본 R셀 202개를 출처 파일·SHA256·시트·셀과 함께 버전관리 파일에서 읽는다. DB 저장값과 정확한 입고 환율이 우선한다. 18차 원본/재고수정본의 9개 환율 충돌은 자동 채택하지 않는다. 2025/2027 같은 차수에는 적용하지 않으며 통관비/H·재고/F 수기 최종값을 복사하지 않는다.

정상 단위, 과거 박스 EstQuantity, 환산계수 누락/0, 부분 누락, 명시적 0, 유효/누락/0 환율, 외화 0, 전년도 동일 차수, E/F 동일 입력, 확정본 불변을 검사한다. 원천 불명은 MATCH로 보고하지 않는다.
