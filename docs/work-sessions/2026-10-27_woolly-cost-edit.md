# 2026-10-27 Woolly 원가표 품목 변경

Q. 원가 화면에서 Woolly bush 품목 선택/변경을 못해서 진행이 안 됨.

A. 입고탭에만 존재하던 분류 모달을 인보이스 원가표 상단 및 각 Woolly행에서도 열도록 연결했다. 전산코드만이 아닌 매칭 영문/한글 이름을 보여준다. 기존 applyInvoiceAllocation 검증을 재사용한다. 상품/수량 변경시 이전 원가·다운로드는 폐기하고 prepare/미리보기를 다시 수행한다. 동일 문서 환율·통관비/불변행 입력 보존, 변경행 관세 재확인. 다른 연도/파일에는 승계하지 않는다.

- 운영 Product2997 Wolly Bush Green Tip/2998 Wolly Bush Red Tip 활성·호주·단 SELECT확인. 실제 dnSpy ExcelLoadingPackingList UPrice/TPrice 및 SP호출 순서 재확인. 입고/재고/원가승인/공용매칭 쓰기없음.
- 격리19847 Chrome 실제 Workbench: 행 변경창→검색 green→선택→합계검증적용→표2997/매칭명변경·관세 재입력→미리보기→XLSX 다운로드 성공. 1000환율/10000통관비/0관세는 TEST_ONLY, 2560000합계와2시트 확인. 운영5100을 변경한 결과 아님.
- 75표적검사66통과9선택private원본생략, 실패0. 전체검사/PR/배포 결과 후속기록.
- outputs/ui는 DB없는 격리 harness, 커밋대상 아님. 원본PDF재분석/유료AI실행 없음.
- 후속: 배포완료 후 버전/버튼 운영읽기스모크. 검색어 woolly-cost-edit invoiceCostEditing.
