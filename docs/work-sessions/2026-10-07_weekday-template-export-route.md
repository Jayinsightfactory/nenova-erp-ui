# 주광 다운로드 버튼 원본 양식 경로 통합

Q. 다운로드 결과가 ‘주광_요일합계_2026_41’ 일반 표라 원본 주광 발주내역 디자인과 다르다.

A. 앞선 원본양식/서버저장은 추가 상단 버튼만 연결했고 표 위 ‘합산 엑셀’은 WeekdayCycleMatrix의 별도 aoa 일반표 생성 경로를 유지한 누락이었다. 이 경로를 제거하고 ‘발주내역 엑셀’로 표시하여 두 버튼이 Workspace.downloadOriginalWorkbook 하나만 호출하게 수정했다.

- 원본은 기존 서버 저장 양식 또는 수동 업로드 우선. 원본 ZIP/셀 양식·15시트 보존, 명시 연결된 날짜 셀만 기존 절대합계로 갱신. 선출고/미연결원문·수식 보존 및 윌슨 이중합산 금지 정책 유지.
- visibleRows/filter/search/collapse는 파일 원본 또는 다운로드 가능 여부를 자르지 않는다. scope의 원본 준비와 callback 존재 조건, busy/ref중복클릭 가드를 적용한다.
- 부작용: 다운로드 버튼 경로만 변경. ERP API/SQL/분배/출고/확정/재고/Estimate/WebProfitReport 보존. 이전 실제 EXE/읽기 전용 근거 및 고정 원본 SHA 재사용, 원장 보정 없음.
- 실제 callback 실행/한번호출/준비안됨/오류/전체원본 경로 회귀와 독립 검토 통과. 필수 ERP계약/dnSpy/manifest/쓰기 가드 및 빌드 진행.
- 1920×1080/100% 기준. CUA kernel 초기화 오류 지속으로 직접 UI 확인 미완료. 검사 통과 후 PR/master/Cafe24 및 서버/Actions smoke 확인.
