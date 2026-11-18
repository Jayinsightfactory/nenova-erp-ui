# PDF 분석의 배포 중단 방지 · 2026-11-18

## 근거와 범위

사용자 보고: 콜롬비아 46-1 PDF 0/6·1/9 진행 후 owner-dead 오류.
읽기 전용 진단 run44220341313: 11:03 KST 기준 최근30분 PM2 메모리재시작0,
최근7일 kernel OOM0, 현재 web프로세스 시작11:02:24.859 KST.
배포44216051551/44217840381은10:36:42/10:49:45 KST 완료.
각 실패job과 정확한 reload 시각 대조 전이므로 개별 원인을 확정하지 않는다.
확인된 구조 결함: provider 작업이 웹 process 안에서 실행되는데 배포는
진행중인 작업 확인 없이 build swap + pm2 reload를 수행한다.

## 기준·부작용

|동작|분석 파일|Provider|ERP 입고·주문·재고·원가|
|---|---|---|---|
|새 job admission|기존 웹 job 저장만 유지|기존 명시 선택 경로만|전부 보존|
|배포 preflight|상태 읽기, 수정/삭제 없음|호출0|전부 보존|
|활성 job 존재|기존 build 유지·배포 실패|재시도0|전부 보존|
|새 job과 배포 경쟁|동일 root canonical OS mutex|배포 잠금 중 접수 실패|전부 보존|

중단된 job/성공한3구간은 이수정으로 복구/재분석/삭제하지 않는다.
기존계정+해시+parser/page identity는 유지하며 연도/차수/SQL 변경없음.
deadline이 지나도 owner가 살아 있는 RUNNING job은 배포를 차단한다.
dead-owner job은 파일을 보존하되 배포 차단에서 제외하며 별도 복구가 필요하다.
읽기실패·malformed record·oversize·unknown PID는 fail closed.

## 한계

PM2 메모리종료·OS강제종료는 이 배포가드만으로 막을 수 없다.
최초 설치 시 구버전은 전역 admission mutex가 없으므로 그한번의 전환은
직원 분석이 끝난 시점에서 수행해야 한다. 이후 새버전끼리는 경쟁을 직렬화한다.
보호장치가 active job 때문에 배포를 거절하면 분석을 취소하지 말고 완료후 재배포한다.
파일 재사용/내용변경 재분석 선택 UI는 별도 남은 작업이다.
