# 기존 입고자료 원가 계산 (2026-10-27)

| 항목 | 내용 |
|---|---|
| 작업트리 | C:/Users/USER/nw-native-cost-1027 |
| 분기 | feat/native-cost-1027 |
| 화면 | 수입부 업무도구 → 도착원가 작업 |
| 원장 부작용 | 없음, SELECT만 |
| 배포 | 검증 진행 중 |

## 고정 결정
- 기존 입고자료만으로 계산한다. 인보이스 연결을 요구하지 않는다.
- 새 계산본은 승인 원가가 아니다. 기존 원장·손익·재고·승인 비용은 변경하지 않는다.
- 통화·운송·누락 비용은 실제 근거를 확인해 입력. 테스트 비용은 TEST_ONLY.
- 입고 상품값은 서버 재조회값만 사용. 클라이언트 수정 상품 payload는 반영하지 않는다.
- 승인 파일 내보내기의 엄격한 검증은 변경하지 않는다.

### 1. 사용자 요청
**Q.** 입고내역이 있으면 인보이스 없이 도착원가 생성, 부족한 운임/환율만 입력, 운영 DB 수정 없이 테스트, UI 개선.

**A.** 기존 진입은 WebInvoice documentId 필수로 막혔다. 별도 읽기 전용 계산/다운로드 API와 화면을 추가했다. 연도/차수 검색을 압축하고 입고 조회를 우선 버튼으로 배치했다. 문서 검색은 보조 버튼으로 유지한다.

**검증.** 실제 dnSpy ExcelLoadingPackingList 실행에서 native upload→stock SP 연쇄 확인. 새 경로는 이를 호출하지 않는다. WarehouseKey7771,2026/43-01 SELECT 재생성 시험:64상품+3운송/중량행, 계산 전후 지문 동일. 운영 SQL 쓰기0. 10국가·운송 공식 순수 계산/원본양식 다운로드 통과. 브라우저 격리 fixture에서 누락값 안내, 수기입력, XLSX 다운로드 및 쓰기 요청0 확인.

## 최종 검증 / 남은 배포
- 최종 UI webpack build, 전체 ERP 계약, manifest, 쓰기 guard, dnSpy evidence 통과. Native 회귀57건 중48통과/9선택 private template skip.
- Chrome 최종 빌드에서 원문 파일 없이 조회→CNY/해상 선택→환율/운임/관세·기타비 일괄입력→계산→다운로드. 품목2,600/4,600원, 합계144,000원이 XLSX와 일치. fixture read4/preview1/download1/blockedWrites0. 실제 비용이 아닌 시험값.
- PR1309: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1309 . CI/배포 및 운영 조회 화면 확인 대기.
- 실제 승인 환율/운임으로 모든 국가 실데이터 원가금액 대사는 이번 범위에서 미검증. 국가 공식 테스트는 기존 검증 fixture 재사용.
- 시험 파일 outputs/native-cost-7771-TEST_ONLY.xlsx는 실제 견적/원가로 사용하지 않는다.
- .next-native-ui 및 outputs는 커밋하지 않는다. probe-native-cost-readonly.cjs는 임시 로컬 확인용.

## 이어받기
이 문서와 docs/plans/native-receipt-cost-preview-2026-10-27.md를 읽고 진행. 운영 DB 변경 금지.
