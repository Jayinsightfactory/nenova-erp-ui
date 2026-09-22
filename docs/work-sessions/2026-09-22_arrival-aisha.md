# Aisha 도착원가 매칭 보정

|항목|내용|
|---|---|
|기간|2026-09-22|
|화면|도착원가|
|원장|WebArrivalCostLine 품목 연결/품종, History만; ERP 보존|
|배포|PR732, master7b6068b6, Cafe24 run35674412944 성공|

## 고정 결정
- 유일한 정확 품명 우선, 중복 정확명은 미매칭.
- Roselily는 백합. ROSE 부분문자열로 장미 후보에 가점을 주지 않는다.
- 확인된 2026 Import23 NL Aisha11행만3170으로 보정. 중국 Aisha/과거본은 미변경.
- 원가·수량·단위·농장·매칭상태 보존. 배포 후 재검증/원자적 보정/감사 기록.

### 1. 사용자 요청
**Q.** 보정.
**A.** 재발 방지 파서 수정 후 필수 테스트·PR·배포를 거쳐 운영11행을 보정하는 범위로 진행. 로컬 전체 ERP계약/dnSpy/manifest/write guard/build 통과.

## 후속
- CI35674319394 통과, 배포35674412944 및 운영 UI 버전7b6068b6 확인 후 보정 실행.
- 정확한11개 ArrivalLineKey/연도/원본명/Import/기존키/수동수정없음과 활성3170마스터 재검증. import applock 단일 트랜잭션으로 MATCH 감사 BeforeJson 전체 및 정정사유 저장 후 키/품종 정정.
- 11행 수량·원가·단위·농장·매칭상태 및 Import23 나머지 행 모두 내용 해시 보존 확인.
- 운영 1920×1080에서 `37-02 / aisha` 검색: `Lily Oriental Double Roselily Aisha 2+`, 3,470원, 현재본1행. 이전 ROSE 표시와 Aisha 원가 미업로드 행 사라짐.
- `.tmp/repair-arrival-aisha.cjs`는 전용 로컬 도구이며 커밋 제외. 기본 읽기 전용, 재적용은 기존키 검증에서 차단.
