# 업체·품목 매칭 공유 DB 전환

## 확정 범위

기존 업체, 공용 품목, 업체별 품목 JSON을 웹 전용 MSSQL 저장소로 옮긴다. 기존 별칭과 CustKey/ProdKey, manual, 단위, savedAt, 작성자, 업체별 history, 알 수 없는 추가 필드를 보존한다. 모든 계정과 서버 프로세스는 동일 DB를 읽는다. 재매칭이나 ERP 원장 보정은 수행하지 않는다.

## 저장 계약

메인 사전 근거: 운영 읽기 `outputs/paste-mappings-db-before.json`에서 업체 36건·품목 501건과 현재 master 일치 및 identity digest를 확보했다. 실제 로컬 dnSpy `outputs/paste-mappings-db-native.txt`의 FormOrderAdd.GetCustomer/GetDataProduct/btnSave로 키와 독립 ERP 저장 경로를 재확인했다. 구현 SQL 검증은 격리 Docker MSSQL `nenova-estimate-sql-test-20260826`의 127.0.0.1:14339에서 수행하며 운영 쓰기 검증으로 대체하지 않는다.

- WebMappingStore는 세 논리 문서의 StoreKey, Payload NVARCHAR(MAX), Revision, UpdatedAt을 저장한다. 원본 JSON 전체 구조를 유지하며 별칭을 SQL 문자열 키로 분해하지 않는다. 대소문자·악센트·공백 차이를 SQL collation으로 합치지 않는다.
- WebMappingMigration의 완료 표식과 원본 해시·건수·검증 결과는 최초 세 문서와 같은 트랜잭션으로 기록한다. 성공 응답 전에 재조회 동등성을 검증한다.
- 저장·삭제는 동일 문서의 UPDLOCK/HOLDLOCK 또는 동등한 DB 잠금 아래 최신 문서를 읽고 기존 정규화·manual 보호 규칙을 적용한다. 이전 프로세스 캐시로 덮어쓰지 않는다.
- DB 오류, 준비 표식 부재, 문서 누락, JSON 손상은 명시적으로 실패한다. 파일 또는 빈 객체로 fallback하지 않는다. DB 전환 후 런타임 파일 쓰기는 없다.
- GET의 최신 업체·품목 이름 보충은 응답 전용이다. 보충 과정에서 저장된 별칭이나 이력을 변경하지 않는다.

## 비동기 전환 경계

스토어 접근 함수와 모든 호출자를 await하도록 전환한다. 업로드·붙여넣기 외 입고비용, Drive 자동화, 카탈로그, 마스터·상품검색 통계, RAUM·호텔 파싱, 분배 이력 대조도 포함한다. 순수 매칭·정규화는 DB 모듈을 import하지 않고 이미 조회한 매핑을 명시적으로 받는다. Promise가 매핑 객체로 사용되는 조용한 실패를 fixture로 차단한다. 클라이언트 번들에 fs/mssql이 유입되면 실패다.

## 배포 및 최초 전환

1. workflow_dispatch의 migrate_order_mappings boolean은 기본 false다. push 및 일반 배포는 DB 스키마를 변경하지 않는다.
2. 새 빌드 완료 후 읽기 전용 --check-ready를 실행한다. 일반 배포에서 준비되지 않았으면 기존 앱을 중지하거나 빌드를 교체하기 전에 실패한다.
3. 메인이 최초 전환을 위해 명시적으로 true dispatch한다. 새 빌드 검증을 끝내고, 모든 기존 파일 작성자를 중지하고 PM2 stopped·PID 0 및 같은 작업 경로의 추가 작성자 부재를 확인한 후 최종 운영 파일을 백업하고 해시를 확보한다. 완료 응답을 받은 동기 파일 저장을 보존하는 전환이며, 중지 당시 진행 중 요청은 실패할 수 있다. JSON 파싱·구조 검증이 실패하면 이전을 중단한다.
4. 기존 프로세스가 쓰던 실제 runtime 파일을 이전한다. tracked seed는 runtime이 있는 경우 절대 대신 사용하지 않는다. DB 문서·marker 생성과 검증은 원자적으로 수행한다.
5. 새 DB 전용 앱을 시작하고 readiness 및 계정 간 읽기 일치를 확인한다. 이후 파일은 백업 자료일 뿐이다.
6. marker가 이미 있으면 파일 재수입은 금지한다. DB 문서가 없다고 seed로 복구하지 않는다. 따라서 삭제한 별칭이 재배포 때 부활하지 않는다.

전환 이전 실패는 DB rollback 확인 후 기존 파일 기반 앱을 재시작할 수 있다. 전환 commit 이후 실패나 결과 불명은 DB marker를 먼저 확인한다. commit 이후에는 DB를 지원하는 빌드로만 복구한다. 일반 배포의 자동 이전 빌드 복구 분기가 파일 기반 앱을 실행하지 않도록 제한한다. 다른 호스트 작성자나 중지 상태를 확인하지 못하면 전환을 진행하지 않는다.

## 부작용 표

| 동작 | 허용 쓰기 | 보존 |
|---|---|---|
| 조회·매칭 | 없음 | 모든 ERP 원장 및 매핑 이력 |
| 매핑 저장·삭제 | WebMappingStore | Customer/Product 및 주문·출고·재고·견적·매출 |
| 최초 이전 | WebMappingStore, WebMappingMigration | 원본 백업·매칭 값·전체 history·모든 ERP 원장 |
| 일반 배포/readiness | 없음 | DB 스키마·매핑·삭제 상태 |

## 필수 검증

- 원본 세 문서 deep equality, 전체 history와 알려지지 않은 필드 보존, 정확한 key 유지.
- 동시 저장의 서로 다른 별칭 보존, 동일 별칭 manual 보호, 삭제 후 재배포·migration 재실행 시 부활 없음.
- DB 중단·손상·marker 부재 시 실패하고 파일 쓰기/빈 매핑 성공이 없음.
- 계정 A 저장→계정 B 조회, 프로세스 재시작 뒤 같은 값, 기존 완료 fingerprint·수량·단위 보존.
- 2025/2026 동일 차수의 주문 작업은 매핑 공유와 별개로 기존 연도별 업무키를 유지한다.
- 기본 배포 DB 무변경, stop 이전 readiness 실패, 최초 전환 실패 rollback, commit 이후 구버전 복귀 금지 fixture.
- ERP 계약/dnSpy/manifest/write guard/build 및 실제 브라우저 1920×1080 확인.

메뉴 기준선: 적용—기존 화면·키보드·명시적 저장 및 실패 피드백 유지. 해당 없음—신규 메뉴·화면틀·인쇄·ERP 수량 정책. 로컬 orchestration 문서는 없으므로 사용자가 제공한 역할 분리 규칙을 적용한다. 실제 운영 이전과 배포는 메인만 수행한다.

상태: 구현 및 격리 SQL 검증 완료, 운영 이전·배포 검증 대기.
