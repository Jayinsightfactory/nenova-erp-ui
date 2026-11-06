# 중국 관세·품목별 재고 평가 보완

| 항목 | 내용 |
|---|---|
| 기간 | 2026-11-06 |
| 화면 | 주차별·월별 매출이익 보고서 및 공통 출력 |
| 원장 부작용 | SELECT only; 전체 ERP/web 원장·저장 계산본 보존, 운영 DB 쓰기/SP/마이그레이션0 |
| 작업트리 | nw-china-duty-recovery / codex/china-duty-valuation-recovery |
| 검증/배포 | 대상42·Workbook5회귀/공식 ERP core+잔여 gate/webpack1worker/로컬 Chromium44 PASS. 첫 gate는 버전상수 실패 후 대상검사+남은공식 단계 재개. PR/CI/운영 배포 미검증 |
| 이어받기 | docs/plans/profit-china-duty-recovery-2026-11-06.md |

## 고정 결정

- 실제 납부 관세와 계산 관세·업로드 원가/ACTUAL 승인 모드를 구분한다. 중국 FreightCost 증빙0, 42차 승인64행은 live MATCH이나 비용 ESTIMATED다.
- 신규 exact124품목 기준은 승인된 같은 상품형태 워크북 셀 참고이며 특혜 자격·실제 신고 인증이 아니다. 원장 국가·통화 불일치를 수정하지 않는다.
- 3501/3524의 실제 입고20단=기록20송이와 master10 모순을 임의 보정하지 않는다. 실제 단 수량으로 승인 평균 원가를 보완하고 당시 실포장으로 주장하지 않는다.
- H는 알려진 현재 관세+그외 비용만 합산한다. F는 품목별 실제 SQL 수량으로 승인 평균 재평가하고 저장 FIFO 원본을 보존한다.
- C/G/R/AC/AJ 원본 숫자와 사용자 J/C 정책·비고를 보존한다.

### 1. 중국44차 관세/재고 누락

Q. 중국 품목 관세 미연결과 품목별 평가 보류를 실제 근거에 맞춰 보완하고 모든 차수를 확인해 배포한다.

A. 실제 dnSpy FormWarehouseView 및 SELECT-only 모든 원가 원천을 조사했다. exact124품목의 기존 워크북 참조와 live검증된42차 승인 원가 성분을 연결했다. 품목별 단위 평균 보완으로 현재17품목515단을 평가하며 당시351/단위불명과 비교 불가를 명시한다. 1~44차 최종 중국 E/F/H/I/J/K 누락0, 정책 미연결0, 원본JSON/기존C/G/R/AC/AJ 보존 PASS. 44차 H13,989,631원=관세계산12,242,065+그외보완1,747,566. J−31,328,602원/K−77.4316%이며 실제 납부·회계 확정값은 아니다.

결과. 대상42회귀와 계약 검증 PASS. 필수 전체 gate/build·PR/CI·Cafe24/실브라우저는 부모 진행. `.verify/china-*.cjs/mjs`는 운영 SELECT probe용 로컬 임시 파일이며 커밋하지 않는다. 인증정보·원본 workbook는 저장소에 추가하지 않았다.

## 남은 일

필수 전체 검증 결과 기록 → 부모 커밋/PR/CI/master/Cafe24 → 운영 전체 차수 감사·43/44차 브라우저 및 출력 확인. 계산 가능과 실제 납부 증빙 확인을 혼동하지 않는다.

검색어: 중국 관세124 44차 product_cost native_unit_acquisition 515단 13989631 실제납부 미확인

추가 검증: 첫 verify의 posttest 구형 v4 상수만 v5로 갱신하고 대상5검사 및 잔여공식 posthook/manifest/writeguard/build exit0. 중국1행 합성API Chromium1920×1080은 H/J/K·접힌515단근거·수평스크롤 K·유한셀 보류오표시 없음/JS오류0/쓰기0 PASS. 합성 fixture의 합계 미완성 표시는 중국1행만 제공한 자료라 전체 국가 완전성 증거가 아니다. 3245포트 테스트서버 종료 및 LISTEN0 확인. 생성 history JSON2개는 커밋 제외. 전체 운영1~44/실제 XLSX/인쇄는 부모의 배포후 검증 범위다.
