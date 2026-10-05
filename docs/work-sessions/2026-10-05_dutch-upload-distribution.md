# 네덜란드 물량표 주문·분배 연결 — 사전 조사

| 항목 | 상태 |
|---|---|
| 날짜 | 2026-10-05 |
| 화면 | /stats/dutch-volume-board |
| 작업공간 | codex/dutch-upload-distribution, 기준 abd4e8bf |
| 구현·배포 | 구현 진행 중. 최종 검증·배포 미완료 |
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

## 미완료 / 다음 작업

1. 적용 범위는 기존처럼 해당 품종 전체 교체로 확정. 누락 업체·품목0 전후값을 미리보기에서 확인시킨다.
2. 설계 확정 후 계약 JSON/실행형 fixture부터 구현, 필수 ERP 검사·빌드·PR·병합·Cafe24·1920×1080 smoke.
3. 운영 실제 저장 없이 격리 fixture로 롤백·교차연도·단가·확정 경합 검증. 운영 최종 작업 후 readback 기능 구현.

설계 하위작업은 gpt-6-astra/high, P0_LOCAL만 사용했다. 최신 모델 대체는 사용자 AGENTS 지시에 따른다. 원본 orchestration은 주 작업 저장소에서 읽었으며 새 worktree에는 없다.
`.tmp/dutch-read-probe.cjs` 및 node_modules junction은 커밋하지 않는다. 비밀값은 기록하지 않았다.
