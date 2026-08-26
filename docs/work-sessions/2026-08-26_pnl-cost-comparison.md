# 라움·초이문 차수별 매입단가 비교

- 작업: PNL-COST-COMPARISON / branch `codex/pnl-cost-comparison`
- 상태: LOCAL_TESTED, 배포 및 읽기 화면 검증 예정

## 요청과 결정

Q. 상세페이지 오른쪽에서 동일 품목의 차수별 입력 매입단가를 비교하고 싶다. 엑셀에는 넣지 않는다.

A. 같은 연도·거래처의 저장된 결산 CostPrice를 최근 차수순 비교열로 표시한다. 신규 차수 저장 후 조회에 자동 포함한다. 미입력은 —, 0은 0, 동일 차수의 다른 단가는 모두 표시한다. 품목명은 가로스크롤 중 고정하고 비교/입력란 이동 버튼을 제공한다.

## 고정 기준

- 원천: WebRaumPnlItem.CostPrice. 현재 미저장 입력이나 참고/학습단가로 과거 값을 바꾸지 않는다.
- 범위: 활성 WebRaumPnl + OrderYear + PartnerCode. 라움/초이문 및 연도 혼입 금지.
- 품목: ProdKey+단위. 양쪽 모두 미매칭일 때만 공백정리한 동일 품목명+단위. 수동 행 별도.
- 신규 GET cost-history는 SELECT-only, ensure/DDL 없음. 기존 저장·금액계산·Excel/인쇄 생성기 변경 없음.
- Order/Shipment/Stock/Estimate/WebProfitReport 원장 모두 보존. 운영 데이터 수정 없음.
- dnSpy: FormRaumPnl golden의 웹 전용 기능 경계 확인. EXE 쓰기 경로는 변경하지 않음. 직접 DB probe 환경 없음, 기존 운영 저장 상세 읽기 확인 및 배포 후 동일 값 대조 예정.

## 검증

- test:raum-pnl (실행형 identity/scoping/0/missing/multiple costs, workbook 결과 불변) PASS
- test:erp-contract, test:nenova-dnspy-evidence PASS
- test:erp-manifest / guard:erp-writes --changed-from origin/master PASS
- npm run build (98 pages), git diff --check PASS

## 다음 확인

PR/배포 성공 뒤 두 거래처 상세에서 비교값과 이동 버튼 확인. 실수 방지를 위해 가격 입력·저장/전산 일괄수정 버튼은 운영 스모크에서 실행하지 않는다.
