# 2026-11-11 출고내역서 샘플 품목 표기

|항목|내용|
|---|---|
|화면|/shipment/statement 엑셀 출력만|
|원장 부작용|ERP·웹 저장본 쓰기0|
|PR·배포|후속, 최종 WORK_MEMORY 참조|

## 고정 기준
- 샘플 플로르 목 F3=카네이션/G5=돈셀,알파 P22/Q24=카네이션/돈셀.
- 품목군은 FlowerName 단독,국가는 내부 그룹키에서 보존.
- 전체 분류 세그먼트와 구조화 이름의 영문/중복별칭만 출력 시 정리.
- 품목명 중간의 분류단어,60cm/XL/색상/포장/unknown 한글메모는 보존.
- 원본명/ProdKey/분배수량/단가/날짜/묶음/저장본/ERP writer는 변경하지 않음.

### 1. 샘플 표기 학습 요청
**Q.** 콜롬비아 카네이션과 카네이션 돈셀 대신 카네이션,돈셀로 출력하고 샘플 입력 기준을 반영해 달라.
**A.** 실제 샘플 셀과 Product SELECT로 카네이션 CHINA / 돈셀 (DONCEL) 구조 확인,shipmentStatementLabels 순수 Excel 표시 규칙과 회귀검사에 고정. 기존 저장본의 다시받기에도 적용.
**결과.** 25대상·양연도/XLSX재열기·불변검사/전체ERP(pre/core/post)/dnSpy/manifest213/쓰기0API/layout/workflow/webpack PASS. 생성XLSX Artifact렌더에서 카네이션/돈셀 확인,PC1920/390 실제Chrome 기존저장/복구/다운로드/가이드player PASS.

## 후속
CI·Cafe24 배포·운영 read-only 화면 확인. 최종 완료 여부는 WORK_MEMORY 최종 기록.
비공개 .verify/실험파일/원본 XLSX는 커밋하지 않음. UI·작업순서·가이드에 보이는 화면 변경이 없어 영상 재촬영 해당 없음.

### 2. 출고일 빨간 글씨
**Q.** 출고일 빨간 글씨가 적용되지 않는 것 같다.
**A.** 샘플 rich-text XML에서 날짜·요일만 FFFF0000임을 확인. 기존 writer의 부분글자색 누락 최소재현 후 제목셀만 native OOXML rich-text로 보존. 업체명검정/날짜요일빨강. 다른셀/스타일/수량/단가/날짜값 보존.
**검증.** 26대상 회귀·모든요일/옆표·XML escape·중복ZIP경로0·비제목셀과다른OOXML내용불변. 실제 Microsoft Excel hidden/readOnly test파일에서 업체명Font.Color0,날짜255(red) 확인,Excel PDF를직접열어빨강확인. 원본샘플·운영DB·사용자Excel세션조작/저장0.
