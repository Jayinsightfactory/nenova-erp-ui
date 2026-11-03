# 공식 관세 근거 연결과 중국 40cm 운임 배분 검산

## 변경 전 기준과 권한

사용자 요청은 DB 무변경이다. 공식 관세율 및 입고 원천은 읽기만 하고 웹 보고서의 파생 계산을 보완한다. 실제 관세, 명시 0, 역사 입력값, 수기 H 및 저장/확정 원본은 보존한다. 다른 세율이 더 낮다는 이유로 FTA/APTA 자격을 자동 인정하지 않는다.

| 동작 | Warehouse/Product/FreightCost | Shipment/Estimate/Stock | WebProfitReport/계산본/확정 |
|---|---|---|---|
| 근거 조회 및 보고서 계산 | SELECT | 보존 | SELECT 후 응답 clone만 계산 |
| 테스트/배포 | 쓰기 없음 | 쓰기 없음 | 저장/갱신 호출 없음 |

## 실제 EXE 및 SQL 사전 확인

2026-11-03 실제 설치본을 다음 CLI로 확인했다.

```powershell
& 'C:/Users/USER/Desktop/백업/다운로드/dnSpy-net-win32/dnSpy.Console.exe' --no-color -t FormWarehouseView 'C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe'
```

`FormWarehouseView.GetData`는 WarehouseMaster.OrderYear/OrderWeek와 WarehouseDetail을 부모 WarehouseKey로 조회한다. 기존 `docs/exe-golden/FormWarehouseView.md` 및 ViewWarehouse 계약을 보존한다. 삭제 경로의 StockHistory/재계산은 호출하지 않는다.

SELECT 전용 진단은 SQL Request에 비조회 문장 거부, execute/batch/transaction 거부를 설치했다. 동일 2026년/27차 입고 11회 SELECT, DB 쓰기 0. 비밀정보는 기록하지 않는다.

## 재현과 안전한 보완

- 27-01 AWB 99993212350: 실제 운임 6,975.5 CNY, 기존 bucket 합계도 6,975.5. 수정 영향 없음.
- 27-02 AWB 99993212361: 실제 운임 4,269.5 CNY가 SQL에 존재한다. 기존 중국 엑셀 호환 계산은 40cm 장미를 기타 잔여에서는 0.45kg/단으로 빼지만 장미 bucket에서는 일반 중량을 적용하여 4,580.21832884 CNY를 배분했다. 총액 초과 310.71832884 CNY 때문에 관세 전용 보존 검사가 10행을 모두 보류했다.
- 수정은 관세 전용 배분에만 기존 중국 40cm 중량/CBM 기준을 행별로 적용한다. 실제 GW/CW 잔여가 계산되고 행별 basis 합계가 분모에 일치할 때만 허용한다. 실제 27-02 GW 371kg, 보완 행합계 371kg, 배분합계 4,269.5 CNY를 재확인했다.
- 부정확한 배분을 단순 정규화하지 않는다. 미확인 행, 중복키, 음수/누락 metric, GW/CW 불일치, VALUE/STEMS 및 비중국 경로는 이 보완을 사용하지 않는다.
- 기존 입고 원가 화면의 Excel 호환 수치와 송이당 원가 출력은 변경하지 않는다. 따라서 그 화면과 관세 전용 배분 사이에는 기존 오류 차이가 남는다. 응답 근거에 legacy 합계와 corrected 합계/방식을 함께 남긴다. 기존 원가 화면 자체의 수정 완료로 설명하지 않는다.

## 공식 관세 근거

공식표 및 적용조건은 `../work-sessions/2026-11-03_official-tariff-evidence.md`를 따른다. 39차 신고가 확인된 동일 품목이라도 27차 원산지 증빙/신고 세율 확인을 대신하지 않는다. 추정은 실제 납부세액과 분리한다.

## 검증 현황

- `profitTemplateDuty.test.cjs` 18개 통과: 기존 실제0/수기/교차연도/보존에 GW/CBM 40cm 양성 및 누락/음수/중복키/분모불일치/부분·역전중량 반례 추가. GW>CW 판정은 기존 0.01kg 허용오차를 유지한다.
- 변경 전 c0bbc84be에서 생성한 GW/CBM fixture와 추가 metadata를 제외한 전체 원가출력 deep equality 통과. 기존 freightCalc238 및 pivot freight suite 통과.
- 공식표에 연결된89개39차 품목 지문과 별도 동일형태 추정3210/3212, 총91개 exact mapping만 추가. 이름·국가·연도·유효기간을 제한하고 원산지 자격/신고량1:1 미확인을 보존한다. 3210/3212는 observedAWB가 아니라 referenceAWB다. 보존형태는 같고색상만다른두품목에동일조건을적용하며오차맞춤으로세율을선택하지않는다.
- 27중국 역사fallback Customs2=0은 새 원문 SHA/J10 빈칸 확인으로 duty loader에서만 null 복원. SQL행 우선 및 다른 모든 역사필드는 보존한다. 빈칸 때문에2차 관세 조건부추정621,939.946원이 추가되고27F/28E가102,092.029원 증가한다.
- 26~31 전체48조합/입고25반차수 및 웹 전체행 대조 완료. 상세 표와 실제/추정/빈칸 분리는 `../work-sessions/2026-11-03_duty-sql-excel-validation.md` 참조.
- 기존 diagnostics31scenario는 version변경만 명시 정규화하며 수치·판정·출력동일성 유지. 새 근거가 없을 때 null metadata/빈설명/문장suffix를 추가하지 않아 무관한출력이 유지된다.
- ERP guard/build 및 운영 CI/배포/브라우저 확인은 부모 담당이며 아직 완료로 판정하지 않는다. DB/schema/snapshot write와 자동재계산은 금지한다.

## 배포 전 버전 경계 검토

계산본 저장은 `saveProfitCache(options,loadReportData)`, 확정은 `loadReportData` 결과만 사용한다. `loadWeeklyReportPayload`의 관세 파생 hook은 저장에 사용하지 않는다. 이 경계를 회귀로 고정했다. 그래도 이전버전 파생payload가 재입력되면 원본평가 metadata를 추정 복원하지 않고 `DUTY_DERIVED_VERSION_MISMATCH`로 명시 중단한다. loader는 해당 오류를 원천조회실패 fallback으로 재호출하지 않는다. 사용자에게 중복가산 방지를 위한 중단과 원본보고서 재조회를 안내한다. 동일버전은 기존 멱등 반환, raw는 신규 계산을 유지한다. 이 경계 포함19회귀 및31전체출력대조 PASS.
