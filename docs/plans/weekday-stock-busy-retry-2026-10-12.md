# 주광 수량 저장의 재고 계산 대기

- 대상: 주광 분배 적용 클라이언트. 서버 확정/수량/견적/재고 정책은 유지한다.
- 사전 근거: 실제 nenova.exe FormShipmentDistribution.btnFix_Click/btnFixCancel_Click의 확정 처리 후 uspStockCalculation 순서를 dnSpy CLI로 재확인했다. 읽기 전용 DB probe에서 2026-10-12 17:09:23의 V2 gate는 Mode/OwnerSessionID/OwnerToken NULL, PendingCalc=0이었다. 이 조회는 과거 오류의 원인을 특정하지 않는다.
- lockDirectionalGate는 업무 행 저장 및 작업 UUID 예약 전에 실행된다. HTTP 409, success=false, code=STOCK_GATE_BUSY, retryable=true, saved=false 응답에만 재시도한다.
- 동일 요청 본문/UUID/연도/세부차수/업체/품목/기대 스냅샷으로 1/2/3/4/5초 뒤 최대 5회 재시도한다. 대기 중 상태를 모달에 알리고 입력/중복 클릭 잠금을 유지한다.
- 한도 이후에는 미저장과 입력 보존을 알린다. 네트워크/JSON/408/불명확한 응답은 재전송하지 않고 기존 UUID의 결과만 조회한다. 권한/편집 잠금/재고 부족/스냅샷 충돌은 자동 재시도하지 않는다.
- gate 해제, native 복구/재계산 실행, DB/SP 변경은 없다. 기존 ERP 트랜잭션이 정상 허용한 경우에만 기존 확정 생명주기 및 downstream 계산을 수행한다.
- 검증: strict ack 경계, 횟수/대기시간 상한, 불명확 결과 GET-only, 교차연도 불변 본문, 기존 클라이언트 회귀 및 필수 ERP guard/build. 운영 ERP 수량 쓰기는 검증에 사용하지 않는다.
