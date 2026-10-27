# 44-01 호주 분류 버튼 권한 오류

## 기준 원천과 범위
- 사용자 확인: `Woolly bush 품목·입고량 분류` 클릭 시 관리자 오류, 수입부 직원 작업 불가.
- 기존 관리 UI AUTH_MAP: 4=수입부, 7=수입부(관리). 운영 UserInfo SELECT 집계에서 활성 Authority4 4계정의 DeptName 공란. 개인정보·자격증명 저장 없음.
- 기존 canManageInvoiceReceipt는 부서명/관리자만 허용해 숫자4를 거절. 서버 인증 역할4/7을 입고 업무에만 허용한다. 일반 관리자 권한 확장 아님.
- 최신 master의 openProductMatch는 이미 Woolly 행을 prepareReceipt로 연결한다. 이 동선을 중복 수정하지 않는다.
- 팀 공용 현재 저장 매칭과 실제 업로드 추출 비교: 일반9행 재사용 가능, Woolly2행 파일별 분류 필요. 별칭 seed만 있는 최초 이름은 확인 대상으로 남는다. 유사명 전체를 확인 완료로 승격하지 않는다.
- 원본 마지막 두 행: Green 6박스/180단/900송이/AUD1530, Red Tip 4박스/120단/600송이/AUD1020. 저장된 AI description은 둘 다 Woolly bush로 색상 누락. 순서만으로 자동 품목 결정하지 않는다.

## EXE 확인
2026-10-27 실제 실행: `dnSpy.Console.exe --no-color -t ExcelLoadingPackingList "C:\Program Files (x86)\Wooribnc\Nenova\Nenova.exe"`.
MakeTempTable의 BoxQuantity/BunchQuantity/SteamQuantity 별도 필드와 InsertMaster의 uspCreateWarehouse→uspStockCalculation 순서를 확인. 이번 수정은 이 writer/SP/수량 환산을 변경하지 않는다.

## 부작용 표
| 동작 | 웹 입고 문서 | UserInfo | 입고/주문/출고/재고/견적/손익 |
|---|---|---|---|
| 역할 판정 | 보존 | 인증 정보 읽기 | 모두 보존 |
| 분류/초안 (사용자 실행) | 기존 문서별 검증·저장 경로만 | 보존 | 모두 보존 |
| 테스트 | 메모리 fixture만 | 보존 | DB 호출 없음 |

Woolly 공용 자동별칭 금지, 문서별 원본4합계 보존, 교차연도/sourceHash 분리 유지.
메뉴 기준: 기존 UI/키보드/레이아웃 보존(새 화면 없음), 권한 오류만 수정. 배포 검증 결과는 세션 기록에 남긴다.
