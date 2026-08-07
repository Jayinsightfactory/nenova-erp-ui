# 자연어 품목 매칭 지표

90% 목표는 사용자 확인 골든 표본의 top-1 정확도로 측정한다. 클릭률은 지표가 아니다. 함께 기록할 값은 top-3 recall, 미매칭률, 자동매칭 오류율(출시 기준 1% 이하), 국가/품종/단위 충돌률, Brier/ECE calibration, 최근 4주 대 직전 12주 PSI/drift다.

거래처·국가·품종별 precision/recall을 각각 낸다. 20건 미만 그룹은 전체 평균에 병합해 안전하다고 판정하지 않고 `lowSampleWarning`으로 표시한다. 출시 게이트는 전체 확인 표본 20건 이상, top-1 90% 이상, 잘못된 자동매칭 1% 이하이며 국가·품종 핵심 그룹 회귀가 없어야 한다. 운영 목표는 표본 200건 이상으로 재검증하는 것이다.

현재 저장소의 익명화 회귀 fixture는 Moon Light/Candlelight, Colombia/China, ROSE/CARNATION, 단/박스 충돌을 포함한다. 운영 DB 접속정보가 없는 worktree에서는 실데이터 수치를 주장하지 않으며 배포 전 read-only 집계 리포트를 별도로 생성해야 한다.
