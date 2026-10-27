# 호텔 주문 서버 초안 — 2026-10-27

## 기준·부작용 (구현 전)
- 인증 userId + OrderYear + OrderWeek + UUID 작업키. 같은 계정의 다른 PC에서 조회·재개, 타 사용자 접근 불가. 기존 브라우저 초안은 명시 가져오기, 원본 보존.
- 서버 전용 data/runtime/hotel-orders (배포 git/.next 교체와 분리). immutable revision 파일을 fsync 후 atomic hard-link로 게시: 같은 버전의 동시 저장은 409, 기존 파일 덮어쓰기 없음.
- 초안 저장/조회/목록: 서버 파일만 변경. OrderMaster/Detail/History, Shipment*, Stock*, Estimate, WebProfitReport 모두 보존. 기존 /api/orders my-customer ADD 계약은 그대로 유지.
- 입력·미매칭 텍스트·업체분류·등록 전후 결과를 저장. 등록 시작 frozen과 각 pending receipt를 서버 저장 완료한 뒤 주문 POST. 저장/응답 불명은 재전송 차단. 완료 이력 삭제·동결해제 금지.
- 연도 2020..2100, 주차01..53/세부01..04. 차수만으로 조회 금지. revision 0은 신규, 이후 정확한 현재 버전만 저장. 저장실패는 브라우저 내용을 보존하고 미저장 표시.
- UI: 차수별 목록/불러오기, 저장상태/명시 저장, 새 작업은 별도 UUID. 원본 이미지 파일은 분석 후 품목 데이터로 저장 (파일 blob 보관은 범위 밖).
- EXE/동일키 SELECT 근거는 이 대화 직전 실행한 FormOrderAdd 및 docs/exe-golden/FormOrderAdd.md 2026-10-27 probe와 동일. 이번 변경은 웹 파일 저장만 추가하고 SQL/ERP writer 변경 없음.
- 기준선 적용: 단일 shell, 페이지 스크롤, 키보드, 미저장 경고, 명시 주문 확인. 검증: 교차연도·계정격리·재시작·동시CAS·동결·응답유실·복구·브라우저/ERP가드/build.
