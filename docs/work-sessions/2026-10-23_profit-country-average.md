# 국가별 SQL 수량 평균 도착원가

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-23 |
| 화면 | 주차별 매출이익 보고서 / 국가별 재고평가 근거 |
| 브랜치 | codex/profit-country-average, base423b7fc2 |
| 원장 | SELECT only. ERP·웹 DB·확정 revision 변경 없음 |
| 배포 | 검증 중, 아래 결과를 갱신하기 전 미완료 |

## 이어받을 결정
- 소액 수기 오차를 맞추기 위해 원본 금액을 복사하지 않는다. 승인된 큰틀은 `(Q+S)×R+H`를 매입수량으로 나눈 평균 도착원가다.
- 네덜란드·태국·에콰도르는 송이, 중국은 단으로 매입과 재고를 동일 단위화한다. SQL 실제 품목/잔량을 그대로 사용한다.
- 원본 NL의 오래된188송이 제외/혼합합계, 태국 loose blooms 금액만 포함, EC 다른 샘플 동치는 재현하지 않는다.
- 실제 Box/Bunch/Steam 우선. 환산 누락·상충, 통관/운송 미입력은 평균 사용을 보류하고 기존 검증 품목 원가로 fallback한다. 수동0은 유효.
- 31차 NL1959의 과거 입고20송이/단과 현재10송이/단 충돌은 임의 해소하지 않는다.
- CountryName은 실제 식별 가능한 분류에서 우선한다. 2880 China Pink·682 Domenichina는 NL. CO/아나나스 CHINA placeholder는 실제 전산 카탈로그 근거로 기존 중국 fallback 보존.
- 기초는 전차수 기말과 동일 정책. 원장/수량/환율 원천/확정본을 수정하지 않는다.

### 1. 요청과 구현
**Q.** 수기 소액 차이는 허용하고 큰 계산틀이 맞으면 그에 맞춰 수정.

**A.** 국가별 정규화 순수 helper와 SELECT loader, API 기초/기말 평균 선택 및 근거 표시, 분류 오인 회귀를 구현했다. 다른 6개 평균 품종/호주 등 기존 경로는 보존한다. 두 재고 조회는 같은 StockKey에 고정하며 음수 표시도 동일 단위다.

**근거.** 실제 dnSpy FormStockView/GetData·FormWarehouseView/GetDetail, SQL 품목/입고/스냅샷 읽기. 계획 `docs/plans/profit-country-average-2026-10-23.md`, 계약 `profit-country-average.json`.

## 검증 결과
- 순수 정규화16회귀, 실제API 주입통합(0/누락/혼합/연도/스냅샷/음수/E=직전F), 분류 JS/SQL parity 통과.
- SQL1~41 paired 조회43,406회, 산술/연속성/비대상국가·수동입력 보존16,257검사 실패0. 관측 원장 지문 전후 동일. 실제 분류변경은 NL 품목4개뿐이다. 상세 전후 금액은 계획 MD 참조.
- `npm run verify:erp-change`(전체 ERP 계약/manifest/write scope/build) 통과. 별도 profit-report22~28 전체 및 변경범위 origin/master manifest/write guard 통과. 기존 정적 배선 테스트3개는 실제 새 조건식에 맞게 갱신했고 실행형 API fixture로 보완했다.
- PR/CI/deploy/browser 결과는 진행 중이며 후속 갱신 전 미검증.
- EXE GUI 직접 조작, 실제 종이 인쇄는 미검증. EXE 원장 쓰기는 하지 않음.

## 메뉴 기본값
| 기준 | 판정·근거 |
|---|---|
| shell/키보드/페이지스크롤 | 기존 details/table 보존, SSR 회귀 |
| ERP 반영 확인 | 해당없음: SELECT 전용 |
| 실제 단위·출처 | 평균 분자/분모/잔량·단위 및 보류 사유 표시 |
| 1920×1080/100% | 운영 읽기 전용 Chrome smoke 예정 |

## 비커밋 자료
`.verify/` SQL 원본·조회 결과·진단 로그는 로컬 감사자료이며 커밋하지 않는다. 비밀값 없음, 원본 Excel은 불변이다.

검색어: profit-country-average 평균도착원가 China Pink Domenichina 태국루스블룸 샘플150 네덜란드1959
