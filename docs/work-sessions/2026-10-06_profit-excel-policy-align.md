# 매출이익 보고서 계산 기준 정렬

## 요청과 결정
- 사용자: 전산 데이터로 계산하되 엑셀과 수식이 같아야 한다. 검증 후 “정렬해.”
- 전산 원장은 보존한다. 엑셀의 수기 재고금액을 복사하지 않는다.
- 콜롬비아 배분 계수는 보고서 전용으로 분리하고 E/F 중간 반올림을 제거한다.
- 기존 수기 H/R/S·AC/AJ와 확정 스냅샷은 보존한다.

## 근거와 영향
- 2026년 29/30/31차 원본 엑셀의 기본 수식 498건과 동일 입력 기반 평균단가 산식 17건 비교. 품목별 원천 범위나 수기 F의 평가 기준까지 동일하다는 의미는 아니다.
- 2026-10-06 로컬 dnSpy.Console로 설치된 nenova.exe FormStockView를 재확인. 재고는 StockMaster/ProductStock, 입출고 및 StockHistory 원천을 사용한다.
- 동일 2026년 29/30/31차 운영 읽기 전용 probe 실행, SQL 변경문 차단 상태에서 1,227개 SELECT 조회 완료. DB 쓰기 없음.
- 보고서 계산/통관 미리보기만 변경. Order/Shipment/Warehouse/StockHistory/ProductStock/Estimate 원장, 공용 도착원가 계수는 보존.

## 담당과 검증
- 메인: 사전 자료·읽기 근거·계약·통합·배포 담당.
- 설계/검토: gpt-5.6-sol xhigh, P0_LOCAL.
- 구현: 지정 terra 사용 불가로 동급 gpt-6-sol medium, P0_LOCAL.
- 테스트: gpt-6-luna medium, P0_LOCAL.
- 신규 정책 테스트 및 기존 customs/snapshot 테스트 통과. 전체 가드·빌드·배포 검증 진행 중.
- 현재 배포 완료로 판단하지 않는다. 최종 결과는 작업 완료 후 갱신한다.

## 구현 후 재검증
- 통관 H와 포워딩 S 미리보기까지 동일 보고서 정책/resolver를 적용했다. 혼적 수국 박스도 같은 배분 풀에 포함하고 미리보기에 표시한다.
- 새 운영 읽기 probe 1,227 SELECT 후 29/30/31차 기초·기말 재고수량 및 manual 객체의 변경 없음 확인.
- 수정 후 동일 ERP 입력으로 Excel 본표 498개 수식 전부 일치. 평균원가 산식 17개 최대 오차 0.000000000931원(부동소수점).
- 새 계수 적용으로 카테고리별 자동 H/S 및 이월 재고평가 금액은 바뀔 수 있다. 이는 재고수량 변경이 아니다. 수기 입력이 있는 칸은 기존 값이 우선한다.
- 최초 전체 검사에서 기존 2인자 호출을 강제하던 source-contract 테스트 실패. 새 report profile 계약을 명시하도록 테스트를 갱신했고 재검증 중이다.

## 최종 로컬 검증
- 최신 master(e15a0032) 통합 후 npm ci로 새 의존성을 맞췄다. 최초 통합 빌드의 pdfjs-dist 누락은 의존성 동기화 후 해소됐다.
- `npm run test:erp-contract`, `npm run test:nenova-dnspy-evidence`, `npm run test:erp-manifest -- --changed-from origin/master`, `npm run guard:erp-writes -- --changed-from origin/master`, `npm run build` 모두 통과. profit-report-22-28과 신규 정책 검사는 ERP 계약 검사에 포함된다.
- 최종 독립 검토: 차단 결함 없음. 공용 계수/수기값/확정본 보존 확인.
- PR: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/922
- 운영 배포 및 브라우저 스모크는 PR 병합 후 확인한다. 기준 viewport 1920×1080, 확대 100% 확인.
