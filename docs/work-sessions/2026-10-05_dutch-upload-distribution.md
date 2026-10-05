# 네덜란드 물량표 주문·분배 연결 — 구현 및 검증

| 항목 | 상태 |
|---|---|
| 날짜 | 2026-10-05 |
| 화면 | /stats/dutch-volume-board |
| 작업공간 | codex/dutch-upload-distribution, 기준 abd4e8bf |
| 구현·배포 | 구현·로컬 필수 검사·격리 SQL 완료. PR #880 CI·병합·배포 확인 대기 |
| PR | https://github.com/Jayinsightfactory/nenova-erp-ui/pull/880 |
| 운영 원장 쓰기 | 없음. SELECT 및 실제 EXE CLI만 실행 |

## 고정된 결정

- 업로드 자동 매칭 후 사용자가 업체·품목 추가/재매칭, 수량·단가 입력 가능.
- 사용자가 입력 단가는 모두 원화라고 확인했다. 기존 EUR 초안을 원화로 재해석하면 안 된다.
- 기존 활성 주문은 보존하고 없으면 양수 주문 생성 후 최종 분배수량 SET.
- 입력한 단가와 수량은 같은 transaction에 저장하고 날짜별 금액까지 검증해야 한다.
- 확정 자동 해제/재확정, 운영 테스트 등록, 마스터 생성은 승인된 범위가 아니다.
- 기존 Excel preview와 동일하게 같은 CountryFlower 전체의 누락 업체·품목을 분배 0으로 확장한다. 사용자가 청화50→0 예시를 확인하고 명시 승인했다. 기존값·최종값·증감을 미리보기에서 표시한다.

## Q&A

### 1. 업로드부터 DB 검증까지

**Q.** 네덜란드 물량표 자동 매칭, 업체·품목 추가, 단가 입력, 기존 Excel 분배 버튼 방식의 등록·분배, 작업 로그와 확정 오류, 완료 후 DB 검증을 구현해 달라.

**A.** ERP 가드와 원본 저장 코드를 조사했다. 최신 master의 독립 작업공간을 준비했고 원장은 변경하지 않았다. 기존 shared import core를 재사용하되 단가·재검증을 원자적으로 확장하는 설계를 진행했다.

### 2. 통화

**Q.** 입력 단가는 전부 원화로 사용.

**A.** KRW로 고정한다. 과거 EUR localStorage 초안을 자동 변환하거나 원화로 간주하지 않는다.

### 3. 파일에 없는 청화와 변경값 표시

**Q.** 파일에 없는 청화는 기존 엑셀업로드처럼 0송이로 바꾸고 원래 등록에서 변경값도 보여야 한다.

**A.** 선택 연도·차수 및 매칭된 국가·품종 범위의 기존 분배를 최종본으로 교체한다. 청화 50→0(-50), 포함 업체 100→120(+20)처럼 누락0 행을 포함하여 전후·증감을 표시한다. 기존 활성 주문은 분배와 구분하여 보존한다. 운영 저장은 아직 수행하지 않았다.

## 실제 근거

- 로컬 dnSpy CLI: 설치 Nenova.exe의 FormShipmentDistribution, ClassShipmentDate 실행.
- btnSave_Click: 상세 Cost/Amount/Vat 저장; 수량이 바뀌면 ShipmentDate 재생성, 단가만 바뀌면 UpdateCost. UpdateCost는 ROUND(EstQuantity,0) 기준 Amount/Vat.
- 운영 SELECT 2026/40-01/Cust533/Prod2231: OutQuantity100, Cost2100, 상세확정true, ViewOrder1, ViewShipment1, ShipmentDate합100, Farm0.
- 동일40-01 네덜란드 ViewOrder: 2025=14행, 2026=35행. 연도 분리 필수.
- 현재 apply core는 기존 주문 보존/신규 생성 정책. 일부 오래된 MD의 양수 주문 교체 설명과 다르므로 그대로 정책 근거로 사용하지 않는다.
- 현재 buildImportPreview는 같은 품종 전체 누락행0 확장. apply는 가격 입력을 받지 않음.
- 추가 검토 필요: 기존 core transaction 내부에서 preflight 확정 maps 재사용, invalid explicit key의 fallback matching, 가격 stale/원자성/DB readback/되돌리기 snapshot.

## 구현과 검증 중 발견·수정한 사항

- 전용 JSON preview/apply와 기존 import 저장 코어를 연결했다. 서버 보관 단일 사용 계획, 소유자별 진행 로그, 잠금 후 전체 범위 지문 재검증을 사용한다.
- 파일 누락 분배는 최종0, 활성 주문은 보존, 없는 양수 주문만 생성한다. 미리보기는 주문·분배 전후와 단가 전후를 분리한다.
- 수량/단가만 변경 시 출고일·농장 보존 분기를 구분했다. 확정·중복·농장 배정 수량충돌·단위계수 누락은 전체 적용을 차단한다.
- 저장 직전 실제 ViewOrder/ViewShipment와 선택 연도 PeriodDay 정확 연결, 상세/날짜 금액 readback을 검증한다. commit 뒤 지문도 별도 조회한다.
- 격리 SQL 실행으로 같은 트랜잭션에 병렬 요청 시 대기하는 문제를 발견하여 transactional preview 조회를 순차 실행했다.
- 실제 격리 SQL에서 기존 ShipmentDetail.CustKey=NULL을 덮는 공용 경로를 발견했다. Dutch 수량 변경에만 이 필드 assignment를 생략하여 native 값 보존; 기존 일반 import 동작은 유지한다.
- 업로드/차수 변경 시 오래된 LIVE 데이터·미리보기 무효화, 주광 재매칭 시 기존 개별단가 제거, 원화 구버전 초안 검증을 적용했다.
- 2026-10-05 최신 master(3536c2cf)를 합친 뒤 전체 ERP 계약 검사, manifest, 4개 변경 API write guard, dnSpy 근거 검사와 빌드가 통과했다. 마지막 native NULL 보존 수정 뒤 SQL·최종 build 재검증은 아래 배포 결과와 별도로 완료해야 한다.

### 최종 로컬 검증 결과

- native NULL 수정 뒤 `npm run test:erp-contract`, `npm run test:erp-manifest -- --changed-from origin/master`, `npm run guard:erp-writes -- --changed-from origin/master`, `npm run test:nenova-dnspy-evidence`, `npm run build` 모두 exit 0. UI layout 검사도 전체 계약에 포함되어 통과했다.
- `npm run test:dutch-volume-distribution-sql` 실제 MSSQL 실행 exit 0. 기존 주문77 보존/분배50→60, 없는 양수 주문 생성, 파일 누락50→0(상세·날짜·농장 정리), 다른 품종 및 전년도 원장 보존, 공란단가 보존·명시0원·양수단가·EstUnit 환산을 검증했다.
- 추가 DB 사례: 출고일별0.4/0.6과 독립 EstQuantity의 가격 전용 저장 보존; 농장 배정 양수 수량변경 차단; PeriodDay datetime 1초 불일치로 전체 롤백; 확정·stale·중복 차단; 두 번째 행 trigger 실패 시 앞행까지 롤백. downstream Estimate/WebProfitReport/Stock/Warehouse와 native NULL도 대조했다.
- SQL은 127.0.0.1:14339 전용 무마운트 컨테이너의 임시 `NenovaEstimateFixture_dutch_<12hex>` DB만 사용하고 종료 시 삭제했다. 마지막 메인 재실행 DB는 `NenovaEstimateFixture_dutch_afd59face526`이다. 운영 DB 시험 저장은 없다.
- PR 최초 CI는 테스트의 Node24 전용 registerHooks 때문에 Node20에서 실패했다. 테스트 전용 `module.register` resolver로 수정했고 정책·격리 SQL을 재실행해 통과했다. CI에서 Node20 전체 검사를 다시 확인한다.
- 별도 MOYI mock 검사는 통과했다. 로컬 HTTP E2E는 worktree node_modules junction을 Turbopack이 거부하여 시작하지 못했다. 이 무관한 개발환경 제한을 업무 코드로 우회하지 않고, 실제 npm ci 의존성을 사용하는 PR CI 결과를 확인한다.

## 미완료 / 다음 작업

1. 적용 범위는 기존처럼 해당 품종 전체 교체로 확정. 누락 업체·품목0 전후값을 미리보기에서 확인시킨다.
2. PR #880의 Node20 CI 통과 확인 → master 병합 → Cafe24 배포 → 1920×1080 실브라우저 읽기 전용 smoke.
3. 운영 실제 저장 없이 격리 fixture로 롤백·교차연도·단가·확정 경합 검증. 운영 최종 작업 후 readback 기능 구현.

설계 하위작업은 gpt-6-astra/high, P0_LOCAL만 사용했다. 최신 모델 대체는 사용자 AGENTS 지시에 따른다. 원본 orchestration은 주 작업 저장소에서 읽었으며 새 worktree에는 없다.
`.tmp/dutch-read-probe.cjs` 및 node_modules junction은 커밋하지 않는다. 비밀값은 기록하지 않았다.
