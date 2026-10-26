# 2026-10-26 호텔 도착원가 환율 적용 복구

사용자: 신라·라움 손익 상세의 해당 차수 도착원가에서 환율 적용해도 원화 금액이 변하지 않음.

구현 전 근거: 실제 dnSpy FormWarehouseView GetData/GetDetail 실행 성공. OrderYear/OrderWeek, WarehouseDetail.UPrice/TPrice 확인. 웹 참고 환율은 EXE 저장 기능이 아니다.
운영 SELECT-only: 신라·라움 2026 연결 141품목/단위, 4,873참조. EXCEL 통화누락243, EUR 단위근거 누락95. 기존 SQL은 정확히 도착원가(송이)만 읽어 부가세 별도 접미사와 송의 표기를 누락. 중국/태국/베트남/에콰도르 통화도 누락. 원본 DB 수정 없음.

| 동작 | 읽기/계산 | 쓰기 | 보존 |
|---|---|---|---|
| 상세 조회 | 같은 OrderYear+ProdKey의 WebArrivalCostLine/Product 및 기존 승인 인보이스 | 없음 | 전체 원장 |
| 환율 적용/원본 | compareHotelArrival 브라우저 계산 | 없음 | 저장매입가·매입액·이익·엑셀, Order/Shipment/Date/Farm/Warehouse/Stock/Estimate/WebProfitReport |

기준 ledger: 명시 Currency 우선, 없으면 COUNTRY_CURRENCY_MAP의 정확 국가(알 수 없는 국가는 미확인). 송이 원가 제목은 공백/개행·송의·부가세 별도만 정규화하고 부가세 포함/상충값은 제외. 원본 단당수량1은 송이와 단 비용 단위 동일; 그 외는 원본 송이원가×단당수량과 저장 원가 대조 후 환산. 0/미입력 원본 환율·단위 불명은 계속 보류. 환율 미입력은 원본, 양수 입력만 적용, 다른 통화는 안내. 과거/현재년도 참조 격리 유지.

검증·배포: 진행 중. 기준선: 기존 shell/스크롤 유지, native 입력·버튼/Enter 적용. ERP 최종 반영 확인은 쓰기 없음으로 해당 없음. 1920 고정 viewport는 미검증.

추가 원인: 초기 업로드 RawJson은 headers/cells 병렬 배열인데 최신 조회는 객체 셀만 읽었다. 배열 길이·중복 제목 충돌 검증을 거쳐 원본 송이원가/단당수량을 복구해 EUR65개 추가 해결. 최종4873개 중4837개 계산 가능(기존4528개 대비309개 복구), 나머지36개는 원본환율/대상단위/비용근거 부족으로 명시 보류. 원본 DB 무변경.
로컬 실제 컴포넌트 CUA: USD1400 적용 시1200→1600원, 0 Enter 차단, 원본복원1200원 및 매입9000/이익1000 유지 확인.

운영 downstream SELECT 기준: 2026/40-02/Cust446/Prod181 ViewOrder+ViewShipment 조인, Out520/DetailFix1/NativeDateJoins1/FarmRows0. 같은연도40차 신라·라움 저장매입가74행 SHA256=4ed9b3e67cdc9ed17c15dd370581059c76ff2e1464b72dc2c66868bda918044d. 확정매출89행 Amount65765036/Vat6576504. 배포 뒤 동일 SELECT 대조 예정.

최종 로컬 검증: npm ci로 잠금파일 의존성 복원 후 test:erp-contract exit0, test:nenova-dnspy-evidence 통과, test:erp-manifest 기준cf5b717f 통과, guard:erp-writes API변경0 통과, npm run build(webpack) exit0. 최초 공유 node_modules의 puppeteer/pdfjs 누락 실패는 격리 npm ci로 해결. 실제코드 회귀6개 통과. 전체 suite의 optional private-original 자료검사는 기존 skip 유지.
