# 차수별 재고조정 Excel 계약과 기준

사용자 요청: 조정 원장 전수에서 품목 행 × 세부차수 열(41-1,41-2)의 Excel과 차수별 조회.

## 근거
2026-10-15 실제 Nenova.exe FormStockView dnSpy 재추출(outputs/stock-matrix-FormStockView.txt): GetData는 같은 연도·세부차수의 StockHistory AfterValue-BeforeValue와 CodeInfo StockType을 사용한다. 운영 SELECT probe는 2025/2026 총151개 연도·차수 그룹과 StockType 5개를 확인했다. 기존 stockAdjustments는 대차수 snapshot residual이며 실제 이력과 같다고 가정하지 않는다.

## 동작과 원장
조회/필터/엑셀: StockHistory/Product/CodeInfo/StockMaster 및 기존 대차수 분석 테이블 SELECT만. OrderMaster/OrderDetail,ShipmentMaster/Detail/Date/Farm,StockMaster/ProductStock/StockHistory,Estimate,WebProfitReport 모두 보존. 재계산/수정/확정/DDL 없음.

## 기준
명시 연도 필수. major는 전체 또는1..53, 검색은 현재 품명/국가/품종/품목번호. 실제조정은 StockType EXISTS로 읽고 After-Before를 합산. ProdKey+단위로 그룹, 동명품목 분리. 연도내 StockMaster 차수와 이력 차수로 열 구성, 숫자정렬. 대차수만 있는 기록/잘못된 차수는 별도열에 표시하고 원이력 보존. 무이력 빈칸, 실제 순0은0, 값누락은 확인 필요. 소수·음수·상쇄 보존. 전체품목 단위혼합 합계 금지.
엑셀 3시트: 세부차수별 실제 조정 / 실제 조정 원이력 / 기존 대차수 흐름차이. 마지막 시트는 기존 계산식 그대로이며 세부차수로 임의 분해하지 않는다. 첫 두 시트는 현재 연도/차수/검색을 적용한다. 마지막 기존 흐름차이 시트는 필터와 동등한 품목 메타데이터가 없어 선택 연도 전체 참고자료로 보존하며 화면과 시트에 명시한다. 조회실패/연도전환중 낡은 데이터는 정상 빈값이나 새 연도값으로 표시하지 않는다.

## UI 기준선
적용:1920x1080 100%, 작은창, 페이지 세로스크롤, 표 가로스크롤, 줄바꿈, 키보드, 조회/다운로드 진행·실패 알림. 해당 없음:새메뉴/shell/편집/임시저장/ERP반영 승인. 기존 대차수 분석 유지.
