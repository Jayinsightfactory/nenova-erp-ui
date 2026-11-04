# EXE 작업 흐름 감사: 실행 파일만 있는 환경

## 확인한 근거
- 2026-11-04 실제 설치 `C:/Program Files (x86)/Wooribnc/Nenova/Nenova.exe`를 dnSpy.Console로 조회. SHA256 `FEDEA619A6E54D6CDD58802E0707DD51D06F5D46E883F53F00134E801AC62F79`.
- Authenticode 상태 NotSigned. 이는 패치 호환성이나 배포 권한을 보증하지 않는다.
- 실제 FormLogin 성공 경로는 `Program.Option.LoginID`를 설정한다. Windows 계정/SQL 로그인과 직원 ERP 계정을 동일시하면 안 된다.
- FormShipmentDistribution.btnSave_Click은 ShipmentDetail 변경과 농장/요일 변경 SQL을 목록으로 모아 DBManager.Instance.ExcuteTransaction(list)를 호출한다.
- 수량 변경은 ShipmentDate 삭제/재생성, 요일 변경은 양수 day1~day7 행별 ShipmentDetail 대표일 갱신 및 ShipmentDate 재생성이다. 로거가 이를 다른 순서로 재실행하면 안 된다.
- DBMSSQL.ExcuteTransaction(string[])은 BeginTransaction→각 ExecuteNonQuery→Commit, catch에서 오류 문자열 설정→Rollback, finally에서 연결 종료. List overload는 배열 overload로 위임한다.
- 별도 mUpdate/mNonQuery, BulkCopyDI/TI, uspDistribute*, uspShipmentFix/Cancel/StockCalculation 경로가 존재한다. 공통 ExcuteTransaction 하나만 감시하면 전체 저장 기록이 되지 않는다.
- 원본 EXE·DLL·DB·SP 변경 및 운영 테스트 쓰기 없음. 현재 작업은 방법 조사이며 패치/격리 실행 검증 완료가 아니다.

## 권장 구현: 원본 보존 + 별도 계측 복사본 + 로컬 저널
1. 원본 EXE와 의존 DLL 전체의 해시/버전/백업을 고정한다. 업데이트되면 구버전 패치를 자동 적용하지 않는다. 공급사 지원/수정 가능 조건도 확인한다.
2. 별도 EXE 복사본에서 로그인/화면 진입/버튼·선택/검토/저장 시도를 계측한다. UI 상태 이름만으로 저장 성공을 생성하지 않는다.
3. 명시 업무 작업번호를 Form 이벤트에서 생성하고 실제 저장 호출로 전달한다. 로그인 ID, 화면/메서드, PC 식별자, 프로세스 세션, 연도·차수·업체·품목 키, 시작/종료, 재시도 부모번호를 기록한다.
4. 기존 트랜잭션과 SQL은 순서·범위 그대로 보존한다. 원문 SQL/접속문자열/비밀번호는 수집하지 않는다. 허용된 업무 필드만 변경 전후 스냅샷으로 만든다.
5. Commit 확인, rollback 확인, commit 결과불명, 후속 재조회 확인을 분리한다. 예외/응답 단절을 자동 미저장으로 판단하거나 원장 재시도를 실행하지 않는다.
6. 로컬 전용 비동기 저널에 기록 후 인증된 수집기로 전송하고 ACK까지 보관한다. ERP DB 연결을 로그 전송에 재사용하지 않는다. 네트워크 장애가 ERP 트랜잭션에 영향을 주지 않도록 하되, 저널 실패는 명시 경고한다. 무손실 보장과 무조건 업무진행을 동시에 주장하지 않는다.
7. 웹 로그와 공통 표현 형식을 쓰되 EXE 발신 인증·기기등록·권한·중복방지를 별도 설계한다. 기존 브라우저 클라이언트 이벤트를 EXE의 검증된 저장 근거로 위장하지 않는다.

## 대안과 한계
- 무패치 외부 관찰 프로그램: 화면 이동/접근성 이벤트를 일부 기록할 수 있으나 DevExpress 컨트롤 노출, 실제 로그인 사용자 및 저장 결과는 추가 검증 필요. 클릭은 시도 증거일 뿐이다.
- DB 측 감사: 실제 변경 대조에 보조적으로 쓸 수 있지만 화면/클릭/취소 과정을 복원하지 못한다. DB 계정 공유 시 직원 식별도 불명확하다. 트리거/DDL은 별도 SSMS 승인·부하·잠금·rollback 검증 선행이 필요하며 이번 작업에서 설치하지 않는다.
- 실행 중 코드 주입/전역 키보드 수집은 권장하지 않는다. 비밀번호/다른 프로그램 정보 수집과 안정성 위험이 있다.

## 충돌 없음 판정 전 필수 실험
운영과 분리된 DB/계정/파일로 원본과 계측본에 동일 입력을 실행한다. 주문·분배·요일·입고·견적·확정/취소 각 경로에 성공/검증거부/rollback/통신단절/재시작/오프라인/로그디스크 부족/교차연도 fixture를 둔다. Order*, ShipmentDetail/Date/Farm, Stock*, Estimate, WebProfitReport와 downstream 조회 결과가 원본과 동일해야 한다. 저장시간·UI 응답성·로그 재전송 중복·계정전환도 비교한다. 이후 카나리 PC 1대→확인→확대. 검증 전 운영 EXE 교체 금지.

## 부작용 표
이번 조사 및 웹 활동 로그 보강: 모든 ERP 테이블 보존, EXE 보존, 웹 전용 활동 저널만 기록. 현재 날짜 불일치 사건의 원인/행위자는 이 조사만으로 확정하지 않으며 과거 없는 로그를 생성하지 않는다.
