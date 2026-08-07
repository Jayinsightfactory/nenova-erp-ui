# Product 품목 선택 EXE 근거

- 원본: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- decompile: `C:\Users\USER\nenova-decompiled\Nenova\FormEstimateView.cs`
- 확인: `FormEstimateView_Load`의 `LogicManager.Common.GetProduct()` 결과를 `ProdName` 표시, `ProdKey` 값으로 사용한다. 견적 조회는 Product를 조인하며 웹 alias가 EXE 원본 품명을 대체해서는 안 된다.
- 웹 차이: 자연어 후보/alias/학습 이벤트는 웹 전용이며 최종 저장 키는 기존 Product.ProdKey다.
- 보존: Product.ProdName/DisplayName, OrderDetail, ShipmentDetail, ShipmentDate, Estimate, WebProfitReport.
- DB probe: 2026-08-07 worktree에 `.env.local`이 없어 실행하지 못했다. 운영 배포 전 읽기 전용으로 Moon Light/Candlelight의 ProdKey/CounName/FlowerName/OutUnit 및 같은 연도·차수·거래처 사용량을 확인해야 한다.
