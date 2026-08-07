# 자연어 품목 매칭 지표

90% 목표는 사용자 확인 골든 표본의 top-1 정확도로 측정한다. 클릭률은 지표가 아니다. 함께 기록할 값은 top-3 recall, 미매칭률, 자동매칭 오류율(출시 기준 1% 이하), 국가/품종/단위 충돌률, Brier/ECE calibration, 최근 4주 대 직전 12주 PSI/drift다.

거래처·국가·품종별 precision/recall을 각각 낸다. 20건 미만 그룹은 전체 평균에 병합해 안전하다고 판정하지 않고 `lowSampleWarning`으로 표시한다. 출시 게이트는 전체 확인 표본 20건 이상, top-1 90% 이상, 잘못된 자동매칭 1% 이하이며 국가·품종 핵심 그룹 회귀가 없어야 한다. 운영 목표는 표본 200건 이상으로 재검증하는 것이다.

운영 리포트는 `/api/product-matching/events?days=90`에서 확인한다. 최근 28일과 직전 84일의 top-1 차이가 -5%p 이하이면 drift 경고를 내고, 후보 1위 confidence와 실제 정답 여부의 Brier score로 calibration을 추적한다. 사용자 확인이 아닌 이벤트는 모든 정확도·calibration 분모에서 제외한다.

현재 저장소의 익명화 회귀 fixture는 Moon Light/Candlelight, Colombia/China, ROSE/CARNATION, 단/박스 충돌을 포함한다. 2026-08-07 읽기 전용 probe에서는 29-02의 2026 Moon Light 사용 9건과 Candlelight 2건, 2025 Moon Light 1건을 확인했다. 이는 충돌 회귀의 실제 근거이지만 전체 정확도 표본은 아니므로 90% 달성을 주장하는 데 사용하지 않는다.
