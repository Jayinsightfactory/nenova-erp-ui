# 품목관리 EXE 공유 데이터 호환성

## 요청 → 처리
- 웹 국가·품종 그룹, 사진 연동, 일괄 편집은 유지하면서 EXE 데이터 충돌만 수정하고 검증·배포 요청.
- 실제 FormProductAdd/ClassProduct dnSpy와 운영 읽기 전용 probe 확인. UI 기능 동등성이 아닌 Product 공유 원장의 의미 보존이 기준.
- 이름만 저장해도 SteamOf1Box를 두 계수의 곱으로 덮어쓰던 문제 제거. 개별·일괄 저장 모두 명시적으로 수정하지 않은 독립값/NULL/0 보존.
- 국가·품종 변경 시 Country.isSelectFlower 기준 CountryFlower 저장. 기본정보 검증, 단위 변경 확인, 편집 원본 충돌 검증, 감사 필드/입력 이력 및 저장 후 대조를 동일 트랜잭션으로 처리.
- 입력 표시값과 요청 값의 대소문자 불일치 수정. DB 기준 국가/품종 선택, 박스당 송이수 독립 입력 추가.
- 웹 전용 그룹/사진/일괄편집/이력 유지. 기존 주문·출고·재고·견적·매출 원장, DB 스키마는 수정하지 않음.

## 검증
- 실제 dnSpy 및 운영 SELECT 근거: docs/exe-golden/ProductMasterSave.md.
- 격리 Docker MSSQL에서 실제 저장 함수의 신규/수정/충돌/로그 실패/읽기 대조 실패 롤백, NULL·0 독립값, 교차연도 원장 sentinel 보존 통과. 운영 DB 테스트 쓰기 없음.
- 개별 저장 정책/실제 React 입력 핸들러/일괄 저장 테스트 통과. 로컬 브라우저 수정값 표시와 최소 payload 확인.
- 전체 ERP 검사·빌드 재실행 중. 최초 계약 명령 누락 보완. PR/CI/운영 배포는 아직 미검증이며 완료 전 성공으로 표시하지 않음.

## 검색어
product-save-compat CountryFlower SteamOf1Box 독립값 품목저장 EXE호환 원본충돌
