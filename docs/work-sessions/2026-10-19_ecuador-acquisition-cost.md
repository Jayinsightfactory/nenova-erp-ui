# 에콰도르 기초재고 매입원가 검증

| 항목 | 내용 |
|---|---|
| 세션 | codex/ecuador-acquisition-cost |
| 기간 | 2026-10-19 |
| 화면 | 주차별 매출이익 보고서·수익률 검증 새창 |
| 원장 부작용 | SELECT만 수행, ERP·수기·확정 revision 보존 |
| PR/배포 | PR #1105, squash ea015ab0, Cafe24 run 39257930494 success |
| 다음 힌트 | profit-acquisition-carry 계약과 아래 결론부터 확인 |

## 이어받을 때 고정된 결정

- 국가 합계가 판매단가 상태라고 모든 품목이 판매단가인 것은 아니다.
- 최근 4차수 FIFO는 보존. 그 밖의 마지막 실제 매입은 같은 연도·평가 차수 이전만 인정한다.
- 정확 과세환율·단위·완전한 입고 원가 계산이 모두 있어야 판매단가보다 우선한다.
- 입고 원가 재현은 원본 인보이스 전수 감사 또는 재고 실사 완료라는 뜻이 아니다.
- ERP 수량·판매단가·재고조정·확정본은 수정하지 않는다.
- 민감한 운영 금액, 품목별 원장, 자격증명은 이 문서에 저장하지 않는다.

### 1. 41차 기초재고 조사와 수정

**Q.** 41차 에콰도르 기초재고가 판매단가로 잡힌 이유를 실제 매입원가와 비교하고 이전 차수도 확인, 배포까지.

**A.** dnSpy의 FormWarehouseView와 FormProductAdd로 입고 TPrice/UPrice와 출고단가 Cost의 의미를 재확인했다. 운영 SELECT와 실제 보고서 모듈의 변경 전후 비교에서 일부 품목의 마지막 매입이 FIFO 검색 범위 밖이라 판매단가로 넘어감을 확인했다. 해당 품목만 과거 매입 차수 도착원가 재현으로 대체한다. 원가 수정은 손실을 줄이지 않으며 기말재고 0과 별도로 설명한다.

**결과.** 1~41차 재고 평가 전후 비교에서 다른 국가 변경 없음. 36~41차 실제 보고서 비교에서 40차 기말/41차 기초만 변경되고 매출·매입·운임 등 보존. 30~39차 일부 원가 누락 및 평균 추정은 남아 있다. 해당 시점 이전 입고 기록 없는 품목과 오래된 입고의 완전한 원가 근거가 없는 품목은 임의 가격으로 확정하지 않았다.

추가 SELECT에서 41차 마지막 스냅샷은 41-03이고 해당 국가 잔량은 0임을 확인했다. ViewWarehouse 입고·DetailFix 확정출고·41-02 재고조정의 합계가 기초→기말 수량 식과 일치한다. 조정 사유에는 전산오류와 폐기가 함께 있으므로 실제 판매 손실로 일괄 단정하지 않는다. 단가 정정과 과거 수량 정리의 손익 귀속은 별개의 문제다.

## 검증 및 미완

- 새 회귀: 동일/타 연도, 미래 매입, 최근 4차수, 최신 무효 근거, 직접 근거 우선, 환율/단위/부분행, 과거 원가 캐시 지문, 읽기 전용 및 경고.
- 추가 실제 probe: 이전 차수의 잔여 판매단가 품목은 마지막 오래된 매입 시점의 과세환율 원천이 missing. 현재 환율을 넣어 확정하지 않음. 기초단가 화면도 보고서와 같은 과거 근거를 사용하고 현재 기말 단가와 분리됨을 확인.
- 조회 전후 OrderDetail/ShipmentDetail/ShipmentDate/ShipmentFarm/ProductStock/StockHistory/Estimate/WebProfitReport의 COUNT+CHECKSUM 변화 없음 관측. 동시성 없는 완전 감사 증명과는 구분하며 SQL writer 변경 없음.
- 최초 전체 검사는 신규 계약 businessIdentity 형식 오류로 중단, 공통 4키 형식으로 수정 후 재실행.
- 전체 verify/build, CI, 운영 브라우저 완료 여부는 실제 결과 후 추가한다.
- 로컬 최종 `npm run verify:erp-change` 통과(전체 계약·dnSpy·변경 manifest·SQL scope guard·Next production build 포함). 별도 origin/master 기준 write guard 및 신규 회귀도 통과. CI·배포·운영 스모크는 아직 미검증.
- 미해결 원장 원가/실재고를 정상이라고 주장하지 않는다. 운영 DB 보정은 이번 작업에서 수행하지 않는다.
- 임시 probe와 개인 환경파일은 커밋하지 않는다.

## 병합 추적

- PR: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1105
- CI: 39257489736 success, head 6363c821.
- Squash: ea015ab054556fcc6ca4fb96393e0a92c9565126.
- 배포: https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/39257930494 — 완료 확인 전에는 운영 반영을 주장하지 않는다.
- 배포 완료: 위 run success 및 자동 hydration 브라우저 스모크 success. `/api/ping` DB 연결 성공, error 없음. 로그인 Chrome 검증창에서 ea015ab0 버전 확인. 실제 41차 결과 조회 검증은 이어서 기록한다.

### 2. 운영 스모크에서 발견한 과거 경고 혼용

**Q.** 같은 요청의 배포 후 검증.

**A.** 실제 로그인 Chrome의 41차 본표는 수정된 평가값으로 계산됨을 확인했다. 하지만 하단 week-check가 기본 캐시 경로를 사용해 이전 판매단가 경고를 표시했다. 검증 새창의 두 GET 모두 auditLive=1로 맞추고 week-check loader에 명시적으로 전달한다. 일반 호출 기본 동작과 확정 revision 보호는 보존한다. 원가 경고의 summary도 내부 키 대신 사람이 읽는 설명으로 표시한다.

**결과.** 순수 fetch fixture와 실제 loader 함수의 mock 실행으로 최신/기본 모드 및 교차연도 전달을 검증. 전체 검사·후속 PR·배포·브라우저 재검증은 진행 중이다. 이 후속 변경도 SQL writer나 DB 보정은 없다.

실제 운영 DB SELECT를 사용하는 새 loadWeekCheck(41, 2026, preferLive=true) 실행에서 과거 판매단가 경고가 사라지고 사람이 읽는 매입원가 재구성 설명만 나옴을 확인했다. 원장 쓰기 없이 실행했다.

후속 로컬 전체 verify:erp-change(build 포함) 통과. 신규 loader·fetch·설명 회귀 통과. 후속 PR/CI/배포/운영 설명 일치 스모크는 완료 후 기록한다.
