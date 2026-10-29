# 카네이션 분배 적용 중단

## 근거
- 사용자: 미리보기 이후 분배 적용 중 멈춤.
- SELECT-only ShipmentImportAudit: 2026/44-01 카네이션 Audit135(09:53:29),136(10:06:40), 각381행이 STARTED/CompletedDtm NULL. 전일361행은 약6분41초 후 SUCCESS.
- 배포40796947094는 한국시간09:59:14~16,40798692776는10:14:42~45에 pm2 reload. 두 미완료 적용의 실행시간과 겹친다. 재시작이 유력 원인이며 HTTP 원본 로그/트랜잭션 rollback 로그를 확보했다는 뜻은 아니다.
- 후속 SELECT: DB 현재 실행요청0. 동일44-01 카네이션 상세는2025년405행(확정405),2026년29행(확정8). 이것만으로 특정 업로드의 미반영/rollback을 단정하지 않는다. 기존 STARTED 이력을 임의 성공/실패로 보정하지 않는다.
- 실제 설치 EXE에 dnSpy.Console --no-color -t FormShipmentDistribution 재실행. OrderYear+OrderWeek 조회와 기존 ShipmentDate 저장 흐름 확인. 이번 수정은 EXE/SQL 저장 순서·수량·단가를 바꾸지 않는다.

## 기준 및 부작용
| 동작 | 원천/기준 | 주문·분배·날짜·농장 | 견적/Amount/Vat/isFix/매출/WebProfitReport/재고 |
|---|---|---|---|
| 업로드 적용 | 기존 applyImportRows, 명시 연도·차수·고객·품목 | 기존 트랜잭션과 사전/사후검증 그대로 | 기존 정책 그대로 |
| 배포 admission gate | Linux OS flock, /var/lib/nenova/import-apply.lock.gate | 새 적용은 업무 쓰기 전503 | 보존 |
| 활성 적용 shared lease | 감사 시작부터 commit/readback/감사완료까지 | 원장 변경 없음 | 보존 |
| 배포 exclusive lease | gate 획득 후 최대1200초 대기, 시간초과는 기존 앱 보존 | 적용 끝나기 전 build swap/pm2 중지 금지 | 보존 |
| 진행정보 소실 | 연속10회 정상 GET의 progress=null | 결과 불명 안내, POST 재전송 없음 | 보존 |

- Linux production만 OS lease 필수. 개발환경은 생략; production의 OS/권한/flock 오류는 fail-closed.
- lock 파일은 비어 있고 개인정보/원문을 기록하지 않는다. release/프로세스종료로 커널 잠금이 해제된다. 파일 자체를 삭제하면 inode가 바뀌므로 삭제하지 않는다.
- 배포 child PM2에 lock fd8/9를 넘기지 않는다. EXIT에도 unlock. 대기 중 새 적용은 gate에서 거부되어 무한 유입을 막는다.
- 요청60초/진행GET10초 timeout은 브라우저 대기 제한이며 서버 작업 취소/실패를 의미하지 않는다. 이후 같은 job GET만 조회한다. 명시 IMPORT_DEPLOY_BUSY는 적용 시작 전 거부로 곧바로 표시.
- 이전 버전은 lease를 잡지 않으므로 최초 rollout 전 진행 중 적용 여부를 별도 확인해야 한다. 최초 rollout부터 이전 진행정보를 복원할 수 있다고 주장하지 않는다.

## 검증
- shipment-import 회귀 통과. 신규2025/2026 동일44-01 전달·0수량 보존, 오류전파, 소실/일시소실/서버실패/재전송금지 실행 fixture.
- Linux 실제 flock 다중 적용·배포차단·gate거부·성공/실패해제는 Linux CI에서 실행(Windows 로컬 skip).
- 전체ERP·dnSpy·manifest·write guard·build·CI·배포·브라우저 검증은 후속 기록.
