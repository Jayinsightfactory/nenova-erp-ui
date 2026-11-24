# 2026-11-24 CLOUD 계산 전 확인표

목표 g17/g19: 원문·현재 ERP·원가 적용값을 같은 행에서 확인하고 입고별 검토를 공유한다.

판정 기준: 8249/8250 40행 유지, ERP SELECT-only. 원문/ERP 불일치는 숨기지 않으며 비용 적용은 별도 사유·행 확인 필요. 공유 초안은 국가/농장/연도/차수/입고집합+revision으로 격리한다. 다른 사용자의 저장과 충돌 시 입력 보존/409. 행 변경은 해당 행만 재확인; 중량/비용 변경은 해당 비용 범위만 재확인한다. TEST_ONLY는 재무 승인과 분리한다.

부작용: WarehouseMaster/Detail/Product/WebInvoiceDocument/Operation 조회만. OrderDetail/ShipmentDetail/StockHistory/Estimate/WebProfitReport 보존. import-team runtime 초안만 expectedRevision/lock/atomic replace/actor history로 저장. 기존 전역 품목 분류 저장은 별도 경로 유지.

계산: 미스티 명시 운임×수량을 먼저 유보하고 동일 비용풀 잔액만 다른 행 CBM에 배분. 명시 관세×수량은 해당 행에만 적용. 잔액 음수/근거 없는 0/중복 증빙/불완전 규격/원문 귀속 불명확은 차단. 출처 있는 원가 전용 수량·금액 수정은 원장에 쓰지 않는다.

원문: CI A SHA fd136fbc2c0e33b58cf72a667a8197b2cb78eb00781b6809f13c0dfc79d2cb0b; 원가표 SHA 1e36606d598edab2f58c337298c4e58f397f53227c3d7f68f5e3843b8a922563. A CI D39=31,E39=27,F39=2,G39=899 / 원장51391=8990. 원가표 A64 160×30=4800 vs CI4769 차31. A C8=1823/F8=2452/E8=2656.2633는 각각 GW/CW/계산부피. B21/70/70. C9=18은 원가표 재현. E12=300은 B 수식 미사용으로 별도 제외 근거.

레퍼런스: Stripe 거래 대사의 원문/현재/적용 열, Linear 행 인라인 편집과 변경 상태. 가로 비교 원장, 상단 이슈 카운트/필터/명시 저장. 큰 카드 그리드 없음. desktop1920/mobile390 캡처와 키보드 검사.

검증: 순수 정책/수기 선배분·합계대사/교차연도·근접불일치/2사용자revision/입력유지/실제40행 TEST_ONLY XLSX. 필요한 가이드만 갱신 후 ERP 필수 검사→pstack→PR/CI→squash→Cafe24/Desktop→운영 읽기/초안/TEST_ONLY 스모크. 실제 비용 승인은 이 작업에 포함하지 않는다.
