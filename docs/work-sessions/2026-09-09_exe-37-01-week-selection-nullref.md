# EXE 37-01 차수 선택 NullReference 진단

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-09-09 |
| 작업공간 | nenova-erp-ui / codex/estimate-overflow-combined-cost |
| 화면 | nenova.exe FormShipmentDistribution |
| 상태 | 발생 경로 확인, 최초 DB 예외는 미확보 |
| 원장 부작용 | 없음 — 읽기 전용 API와 실제 설치본 decompile만 수행 |
| 배포 | 이번 진단은 코드/EXE 수정·배포 없음. 직전 웹 PR542와 인과관계 미확정 |

## 이어받을 때 고정된 결정

- 사용자가 확인한 차수는 **37-1**, 진단 조회 범위는 2026/37-01.
- JIT 디버깅 활성화나 임의 재고 보정으로 해결할 문제라고 단정하지 않는다.
- 빈 주문/NULL 품종 값과 조회 실패로 DataTable 자체가 null인 것은 다르다.
- EXE 수정 또는 운영 원장 수정은 이번 읽기 전용 진단에서 실행하지 않았다.
- 최근 웹 배포와 직접 인과관계는 입증되지 않았다. 저장 잠금/연결 실패 가능성은 가설이다.

## 질문 → 답변

### 1. 출고분배 차수 선택 중 EXE 오류

**Q.** `System.NullReferenceException`, 최상단 메서드
`Nenova.FormShipmentDistribution.txtOrderWeek_EditValueChanged`; 차수는 37-1.

**A.** 실제 설치본을 dnSpy CLI로 다시 확인했다.

- EXE: `C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe`
- CLI: `C:\Users\USER\Desktop\백업\다운로드\dnSpy-net-win32\dnSpy.Console.exe`
- 명령: `--no-color -t Nenova.FormShipmentDistribution`, `Nenova.DBManager`, `Nenova.DBMSSQL`.
- 차수 선택 이벤트는 `SELECT DISTINCT CountryFlower FROM ViewOrder WHERE OrderWeek = <화면 Text>`를 실행한다.
  이 EXE 쿼리에는 OrderYear가 없다. 조회 결과 null 검사 없이 `dataTable.Rows.Count`를 사용한다.
- DBMSSQL.GetDataTable은 먼저 new DataTable을 만든다. 조회 0행이나 isready=false는 빈 DataTable을
  반환하므로 그것만으로 이 NullReference가 나지 않는다. 실제 조회는 SqlDataAdapter.Fill이다.
- DBManager.GetDataTable(query,false)의 일반 Exception catch는 연결을 닫고
  `Program.WMSG.MSG(ex.Message)`를 표시한 뒤 초기값 null을 반환할 수 있다.
  이어 이벤트의 Rows 접근에서 이번 예외가 나는 경로가 존재한다.
- WarningMSG.MSG는 별도 모달에 오류 문자열을 표시한다. 확인한 코드에는 이 문자열의 파일 저장이 없다.
- 따라서 이 JIT 예외보다 먼저 뜬 오류 문구를 확보해야 SQL timeout/deadlock/연결 오류를 구분할 수 있다.

### 2. 현재 DB 읽기 전용 대조

**A.** 인증 후 GET만 호출했으며 주문/분배/재고 쓰기는 차단했다.

- `/api/ping`: HTTP200, 116ms.
- 2026/37-01 `distribute?type=groups`: HTTP200, 193ms, 품종 그룹24개.
- 같은 차수 카네이션 `type=customers&exeParity=1`: HTTP200, 273ms, 업체46개.
  이 경로는 ViewOrder/ViewShipment를 사용하지만 위 EXE 품종 SQL과 완전히 같은 쿼리는 아니다.
- AppLog 최근 오류150개 조회에서는 이번 EXE 오류의 최초 DB 메시지를 찾지 못했다.
  8월의 기존 timeout 기록을 이번 사고 증거로 취급하지 않는다.
- 현재 정상 조회만으로 과거 순간의 잠금/연결 실패가 없었다고 결론내릴 수 없다.

**결과.** 현재 조회는 정상이며 EXE의 null 오류 처리 공백을 확인했다. 당시 DB 최초 실패의 원인은 아직 미확정.
최근 PR541/542에는 운영 ViewOrder DDL이나 EXE 변경은 없으나, 수량 저장의 Product/Order 쓰기는
조회 의존 테이블에 잠금을 걸 수 있으므로 간접 영향 가능성을 배제하지 않는다.

## 미완 / 다음 확인

1. 미저장 입력을 보관하고 저장 작업이 끝난 상태에서 EXE를 다시 연 뒤 37-1 재선택 결과 확인.
2. 재발 시 **JIT 창 직전에 먼저 뜬 DB 오류 창**의 원문과 발생 시각 확보.
3. 재현 시점의 동일 SQL/DB 대기 상태를 읽기 전용으로 대조한 후 조치 범위를 결정.
4. 원장 손상으로 단정하거나 null을 피하려는 가짜 주문/품종/재고 보정 금지.

로컬 증거: `outputs/exe-week-null-readonly.cjs`, `outputs/exe-week-null-readonly.json`.
운영 행이 포함된 outputs는 공개 저장소에 커밋하지 않는다.

## 새 컨텍스트 이어받기

이 문서와 직전 PR542 완료 기록을 읽고 이어서. EXE 37-01 차수 선택 NullReference는
DBManager의 예외→null 반환과 이벤트의 null 검사 누락 경로를 확인했으나 최초 DB 오류는 미확보다.
현재 웹 GET은 정상. 사용자의 재실행 결과/선행 오류 문구를 먼저 확인하고 인과관계를 추정으로 확정하지 말 것.
