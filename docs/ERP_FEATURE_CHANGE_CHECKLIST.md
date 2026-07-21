# Nenova ERP 기능 변경 체크리스트

이 문서는 `nenova.exe`와 같은 MSSQL을 사용하는 웹 기능의 변경 절차다. MD를 읽는 것만으로 검증이 끝난 것으로 보지 않는다. 기능별 계약 JSON, 순수 정책 테스트, 변경 SQL 스코프 검사, 빌드가 모두 통과해야 배포 후보로 인정한다.

## 1. 작업 시작 전에 작성할 것

- [ ] 대상 기능의 사용자 동작을 명사로 쪼갰다. 예: 업체 추가, 분배 `+`, 분배 `-`, 확정, 취소.
- [ ] 동작별로 OrderMaster/OrderDetail, ShipmentMaster/ShipmentDetail, Warehouse, Stock, ShipmentDate의 생성·수정·삭제·보존을 표로 만들었다.
- [ ] `docs/contracts/<feature>.json`을 추가하거나 기존 계약을 갱신했다.
- [ ] 업무 식별자가 `OrderYear + OrderWeek + CustKey + ProdKey`에 필요한지 확인했다. `OrderWeek` 단독은 허용하지 않는다.
- [ ] `docs/DB_STRUCTURE.md`, `docs/ERP_COMPAT_INVARIANTS_2026-06-04.md`, `docs/WEB_VS_ERP_CONFLICTS.md`와 관련 dnSpy/View/SP 근거를 읽었다.
- [ ] `docs/NENOVA_DNSPY_CLI_WORKFLOW.md`에 따라 로컬 dnSpy CLI로 실제 EXE의 Form/Class/메서드/SQL 저장 순서를 확인했고, `docs/exe-golden/*.md`에 근거와 읽기 전용 DB probe를 기록했다.
- [ ] 이전 연도에 같은 차수명이 존재하는 교차연도 fixture를 정의했다.
- [ ] 견적·매출 downstream 영향(Estimate, ShipmentDetail.Amount/Vat, isFix, WebProfitReport)을 별도 표로 정의했다.
- [ ] 후보를 보여주는 GET과 저장 트랜잭션의 최종 검증이 같은 SQL scope/helper를 사용하는지 확인했다.

## 2. 구현 중에 지켜야 할 것

- [ ] 화면의 연도 선택값이 조회 GET, 변경 POST/PATCH/PUT/DELETE의 payload까지 전달된다.
- [ ] API가 `YYYY-WW-SS`와 `WW-SS`를 정규화하더라도 내부 SQL에는 `OrderYear`를 별도 파라미터로 전달한다.
- [ ] Master 재사용·잠금·삭제·집계 SQL 모두 `OrderYear`와 `OrderWeek`를 함께 사용한다.
- [ ] 공유 API를 호출할 때 `mode`를 명시하고, 부작용 정책은 순수 함수로 분리했다.
- [ ] 전산 화면에서 필요한 `OrderYearWeek`, `Manager`, `CustKey`, 환산수량, 출고일 등의 불변식을 유지한다.
- [ ] 0 수량 가짜 주문, 전년도 Master 재사용, 확정행의 무단 변경을 만들지 않는다.
- [ ] `ViewWarehouse` 농장 후보처럼 EXE가 품목 전체 범위를 사용하는 조회에는 차수/연도 필터를 임의로 추가하지 않는다.
- [ ] farm-only 수정은 `ShipmentFarm`/`ShipmentDetail.Descr` 외의 주문·출고수량·금액·견적·매출 원장을 변경하지 않는다.

## 3. 차수피벗 고정 계약

| 동작 | 현재연도 활성 주문 | 주문등록수량 | 분배수량 |
|---|---|---|---|
| 업체 추가 | 없음 | 양수 주문 신규 등록 | 증가 |
| `+N` | 없음 | `+N` 신규 주문 등록 | `+N` |
| `+N` | 있음 | 보존 | `+N` |
| `-N` | 있음/없음 | 보존 | `-N` |

이는 `docs/contracts/week-pivot-distribution.json`과 `lib/pivotAdjustmentPolicy.js`가 실행 가능한 기준이다. 업체 추가와 기존 주문이 있는 분배 증가를 같은 의미로 처리하지 않는다.

## 4. 검증 순서

로컬에서 다음 순서로 실행한다.

```powershell
npm run test:erp-contract
npm run test:nenova-dnspy-evidence
npm run test:erp-manifest -- --changed-from HEAD^
npm run guard:erp-writes -- --changed-from HEAD^
npm run build
```

변경 전 기준 커밋을 알고 있으면 `HEAD^` 대신 그 SHA를 사용한다. manifest 가드는 변경된 ERP 파일이 적어도 하나의 기능 계약 scope에 등록됐는지 확인한다. `guard:erp-writes`의 변경 범위 검사는 새로 바뀐 API를 차단하는 용도이며, 저장소 전체의 기존 위반을 자동으로 모두 해결했다는 뜻이 아니다. 전체 감사는 별도 이슈로 나누고, 새 변경에서 기존 위반을 확대하지 않는 것을 먼저 강제한다.

## 5. 배포 전·후 확인

- [ ] 위 세 명령이 모두 성공했다.
- [ ] 2025 동일 차수 행과 2026 대상 행을 나란히 조회해 대상 연도만 변했는지 확인했다.
- [ ] `ViewOrder`와 `ViewShipment`를 네 키로 대조했다.
- [ ] 주문등록수량과 분배수량의 변경 전후를 기록했다.
- [ ] 견적 노출 진단에서 `ViewShipment`, `ViewOrder`, `ShipmentDate`, `PeriodDay`, `DetailFix=1`, `InGetDetail`을 확인했다.
- [ ] 해당 차수 판매현황/손익에서 확정 집계와 대상 품목 행을 확인하고, 농장-only 변경이면 `Amount/Vat/isFix`가 보존되는지 확인했다.
- [ ] 운영 데이터 보정은 코드 배포 및 스모크 확인 뒤 별도 SQL로 실행한다.
- [ ] 사용자가 요청하지 않은 `git push`, 운영 DB 보정, 전년도 데이터 수정은 실행하지 않았다.
- [ ] 음수재고 확정 보정은 사용자 확인 후 정확한 부족수량만 `StockHistory`에 기록하고, 재계산 실패 시 트랜잭션이 롤백되는지 확인했다.

## 재발 방지의 핵심

기존 문제는 문서와 에이전트가 있었지만, 계약이 기능 파일과 자동으로 연결되지 않았고 PR/배포 시 필수 성공 조건도 아니었던 데서 발생했다. 이제 계약 JSON을 검사하는 `test:erp-manifest`, 순수 정책·전산 SQL 검사를 포함한 `test:erp-contract`, 변경 API의 연도 스코프 검사, Next 빌드를 한 묶음으로 실행한다. 계약 파일이나 필수 fixture가 없으면 검증 자체가 실패한다.
