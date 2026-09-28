# 피벗 배치판 가독성

| 항목 | 내용 |
|---|---|
| 화면 | 전산 피벗 필터/행/열/값 배치판 |
| 기준 | 1920×1080, 확대100%, 작은 화면도 줄바꿈 |
| 부작용 | 표시/CSS만. ERP·API·SQL·계산/엑셀·개인 설정 기본값 보존 |
| 배포 | 검증 진행 중 |

## 결정과 기준
- 필터 위/행 왼쪽/열 오른쪽 위/값 오른쪽 아래의 기존 EXE 공간 관계 유지.
- 필드 본문 드래그·클릭과 오른쪽 필터 버튼 이벤트 보존. 테두리 중첩 제거,13px 글자/32px 이상 버튼.
- 활성 필터 파란색, 구역별 색상선과 글자 제목, 집계방식 보조 배지.
- 안내는 접기. API/조회범위/원본수량/모델/단가 집계방식은 변경하지 않음.

## 사전 근거·부작용
실제 dnSpy.Console FormQuantityPivot GetData/ViewWarehouse/ExportToXlsx 재확인.
읽기 probe:2026 01-01~02-02 8,066행, Colombia rose incoming main4,858/4,330. EXE 예시 농장630/400/10.
모든 UI 동작은 OrderMaster/Detail, ShipmentMaster/Detail/Date/Farm, Warehouse, Stock, Estimate, Amount/Vat/isFix, WebProfitReport 보존.
하위작업 운영 문서는 이 체크아웃에 없음. 직접 구현/검증.

## Q&A
Q. 디자인이 보기 어렵다. 앞서 제안한 정리안으로 작업 시작.
A. 기존 조작과 계산을 유지한 배치판 표시 개선. 최종 검증/배포 결과는 아래에 기록.

## 검증
- ERP contract/dnSpy evidence/manifest/write guard/UI layout/build 통과. 쓰기 API 변경0.
- 실행형 교차연도/빈 선택/필터 비활성 fixture 추가, 통과.
- 실제 빌드 localhost 16,000행 fixture:13px/32px/본문 border0 측정. 필터 팝업·적용·수량800 유지, 국가 버튼 마우스 드래그 rows→filters 성공.
- 1920×1080 화면 확인,1280×800 가로 잘림 없음,720px 배치판 단일열 및 scrollWidth=clientWidth682. 콘솔 오류 없음.
- `.tmp` probe/fixture/로그는 커밋 제외. 배포 진행 중.
