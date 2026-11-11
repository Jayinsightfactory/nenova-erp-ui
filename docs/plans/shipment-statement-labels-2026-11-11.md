# 2026-11-11 출고내역서 샘플 표기 기준
- 사용자: 국가+품종 대신 카네이션, 품목은 카네이션 돈셀이 아닌 돈셀. 샘플 플로르 목 F3=카네이션/G5=돈셀, 알파 P22=카네이션/Q24=돈셀 확인.
- 실제 Product 조회: DisplayName 카네이션 CHINA / 돈셀 (DONCEL), 문라이트 (문라이트), ProdName Carnation CHINA / 돈셀 (Doncel). 출고원본 선택/ProdKey/단가/수량을 표시문자열로 다시 합치지 않는다.
- 엑셀 전용 순수 label helper: 품목군은 FlowerName 단독. 품목은 알려진 전체 분류 세그먼트만 제거하고, 구조화 이름의 마지막 영문 별칭/중복 한글별칭 제거. 국가명/품종명이 품목명 중간에 들어간 경우 보존. 규격/색/길이/포장/unknown 문구는 보존, 결과빈칸이면 원래이름.
- 샘플에 실제 있는 카네이션/장미/수국 영문 분류 별칭만 명시. 분류 아닌 slash 구간은 보존. 숫자·규격·색상 괄호 보존. 기존 웹 원본/초안/immutable 저장본의 값은 변경하지 않고 다운로드 렌더링만 적용.
- ERP 전테이블·웹저장본·날짜·수량·단가·그룹키 보존. UI/작업순서 변경0, 영상에 Excel 내부표가 나오지 않으므로 가이드 재촬영 해당없음. 기존 영상 gate/재생 확인 유지.
- dnSpy 실제 FormShipmentDistribution 재실행, 양연도reader SELECT 업체64/66·표본28/29·7일/세부차수 유지, 추가 Product SELECT-only 예시 확인. 운영쓰기0.

## 출고일 빨간 글씨 — 사용자 추가 요청
샘플 플로르 sharedStrings.xml은 업체/출고일자 접두사는 검정, 날짜·요일 run만 FFFF0000/맑은고딕19굵게이다. xlsx-js-style writer가 rich-text runs를 버리는 것을 최소재현으로 확인. 기존 번들 CFB ZIP API로 제목셀만 inline rich-text 처리(검정 접두사+빨강 날짜/요일), 별도 의존성/ERP쓰기/원본저장본변경0. 전체 요일·옆표 제목 적용, XML escaping·중복ZIP경로 방지 및 다른OOXML부분 내용보존 회귀 포함.
Artifact 미리보기는 부분글자색을 표시하지 않아 native Microsoft Excel을 별도 hidden/readOnly 인스턴스로 확인: 접두사Font.Color=0, 날짜Font.Color=255(red), PDF QA도 생성. 테스트파일만 열고 저장없이 닫음, 원본샘플/운영원장/사용자Excel세션조작0. UI흐름/가이드노출 화면변경0.
