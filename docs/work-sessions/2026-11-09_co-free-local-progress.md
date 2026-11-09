# 46-1 무료 구조화 및 회귀 진행

## 승인 범위
유료 호출0, ERP DB 쓰기0. 기존 완료3개 서버 구간 변경 금지. ESPERANCE 원문 HAWB 차이는 확인필요로 남기고 다른 송장 계속 처리.

## 로컬 검증 결과
- 원본 SHA256 88c28b75c418261a9411d00d00d7d210f11af837543f59ba1f61cb015f454a65,43쪽.
- 원본의1~9쪽을 별도 비교본으로 구조화하고10~43쪽26송장과 로컬 결합.31송장266행,308495송이,1137pieces,64204.86USD. 행금액·송장총액·송이 검증 통과.
- 기존 완료3개 서버 데이터가 아니라 **원본 재구성 비교본**으로 병합정책을 시험했다. 실제 서버3개 사용/일치확인/운영무료복구 성공으로 보고하지 않는다.
- 로컬 free-merge.test.mjs6 PASS: 합계,입력보존,금액변조,원본교체,페이지누락,중복송장. 출력의 providerCalls/erpWrites0은 외부 의존성 없는 로컬 경로에 한정한다.
- 스크립트/구조화 결과: C:/Users/USER/Documents/Codex/2026-07-11/new-chat/output/461-free-extract/. exact-source 프로토타입이며 일반CO 파서/실행웹경로로 연결하지 않았다.

## 별도 확인 이슈
- ESPERANCE FEER4346: 원본송장AFBH00568432,명세AFBG00568432,원문유지/확인필요. 사용자 지시는 이 표기를 고치라는 승인이 아니다.
- AYURA17805/17806 같은농장 두송장 합45600송이/152pieces. 농장당 한송장 강제금지.
- INVOS48.11 및FUNZA15 추가비 원문포함. 상품만총액비교금지.
- FLORA CONCEPT2191857 AWBH AFBG00568511은 명세TheElite와대응. 공급자문자열만으로누락단정금지.
- 일부 소매송장에는 행별포장정보없음.송장총포장과행별수량을구분하고 행에임의배분금지. 혼합상자하위품목/설명 줄바꿈까지완료라고보고금지.

## 다른 실파일 무료 사전검사
기존 production helper inspectChinaPdfInvoice와pdfjs로 실행. 유료API없음.

|파일|쪽수|텍스트없는쪽|무료파서결과|
|---|---:|---|---|
|41-1 중국 해상 ci1.pdf|7|없음|missing or ambiguous product subtotal|
|42-1 CHINA CI.pdf|3|없음|unknown compact category|
|42-2B CLOUD CI.pdf|7|없음|unsupported Hubfresh column geometry|
|44-01 호주 CI.pdf|2|1,2|이미지형,구조화미검증|
|44-1 콜수국 CI.pdf|12|없음|텍스트추출만확인,구조화미검증|
|44-1 콜카장 Ci.pdf|36|22|22쪽이미지형,구조화미검증|

## 미완료
서버의실제완료3개를읽어일치검사후보존병합,source별범용무료파서/OCR연결,웹에서확인필요표시/정상결과재사용,전체필수gate/실앱/배포. 아직 production source diff없으므로 배포하지않았다. 다른파일오류없음/전체무료완료를주장하지않는다.

검색어: 46-1 무료병합 31송장 308495 1137 64204.86 source-mirror 중국무료파서실패
