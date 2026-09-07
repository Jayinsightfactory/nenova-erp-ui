# Product 품목 선택 EXE 근거

- 원본: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\FormEstimateView.cs`
- 확인: `FormEstimateView_Load`의 `LogicManager.Common.GetProduct()` 결과를 `ProdName` 표시, `ProdKey` 값으로 사용한다. 견적 조회는 Product를 조인하며 웹 alias가 EXE 원본 품명을 대체해서는 안 된다.
- 웹 차이: 자연어 후보/alias/학습 이벤트는 웹 전용이며 최종 저장 키는 기존 Product.ProdKey다.
- 보존: Product.ProdName/DisplayName, OrderDetail, ShipmentDetail, ShipmentDate, Estimate, WebProfitReport.
- 읽기 전용 DB probe(2026-08-07): `CARNATION Moon Light`는 ProdKey 447, 콜롬비아/카네이션, OutUnit=박스, EstUnit=단이다. `ROSE / Candlelight`는 콜롬비아 장미 40/50/60cm와 에티오피아 장미 50/60cm로 별도 존재한다. 중국에는 장미 Moonlight와 카네이션 Moonlight가 각각 존재한다.
- 교차연도 probe: 같은 `29-02`에 2025 Moon Light 1건, 2026 Moon Light 9건, 2026 Candlelight 2건이 확인됐다. 최근성 집계는 반드시 OrderYear를 포함해 2025 행을 2026 거래처 신호로 섞지 않는다.
- 개인정보는 조회·기록하지 않았고 Product 필드 및 연도/차수별 집계만 남겼다.

## 2026-09-07 AI 후보 재검증

로컬 dnSpy CLI 실행: `dnSpy.Console.exe --no-color -t FormOrderAdd "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`.
`GetCustomer(false)`는 CustName 표시/CustKey 선택, `GetDataProduct`는 Product.ProdKey와
OrderMasterKey로 주문을 연결한다. `btnSave_Click`은 별도 주문 저장 이벤트이며 AI 분석은 호출하지 않는다.
동일 운영 DB를 사용하는 인증 master/customer-mappings GET probe에서 양재동686/남촌양재325,
부산 서부꽃집671/서부청과405 및 Pink Mondial 40/50/60cm 키1437/1255/1438을 대조했다.
정확 별칭 양재동686·서부꽃집671은 정상인데 브라우저 캐시 우선 적용이 서버 선택을 변경할 수 있었다.
이번 변경은 후보 검증 및 웹 별칭 파일만 대상이다. 주문·출고·재고·견적·매출 원장과 SP는 모두 보존한다.
