# Product 품목 선택 EXE 근거

- 원본: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\FormEstimateView.cs`
- 확인: `FormEstimateView_Load`의 `LogicManager.Common.GetProduct()` 결과를 `ProdName` 표시, `ProdKey` 값으로 사용한다. 견적 조회는 Product를 조인하며 웹 alias가 EXE 원본 품명을 대체해서는 안 된다.
- 웹 차이: 자연어 후보/alias/학습 이벤트는 웹 전용이며 최종 저장 키는 기존 Product.ProdKey다.
- 보존: Product.ProdName/DisplayName, OrderDetail, ShipmentDetail, ShipmentDate, Estimate, WebProfitReport.
- 읽기 전용 DB probe(2026-08-07): `CARNATION Moon Light`는 ProdKey 447, 콜롬비아/카네이션, OutUnit=박스, EstUnit=단이다. `ROSE / Candlelight`는 콜롬비아 장미 40/50/60cm와 에티오피아 장미 50/60cm로 별도 존재한다. 중국에는 장미 Moonlight와 카네이션 Moonlight가 각각 존재한다.
- 교차연도 probe: 같은 `29-02`에 2025 Moon Light 1건, 2026 Moon Light 9건, 2026 Candlelight 2건이 확인됐다. 최근성 집계는 반드시 OrderYear를 포함해 2025 행을 2026 거래처 신호로 섞지 않는다.
- 개인정보는 조회·기록하지 않았고 Product 필드 및 연도/차수별 집계만 남겼다.
