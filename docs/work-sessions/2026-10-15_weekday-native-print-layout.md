# 주광 견적 native 순서·양식 및 박스 병기

## 사용자 질문 → 결정
- EXE 품종/품목 순서·견적서 셀 양식 동일화: 실제 dnSpy FormEstimateView/ReportEstimate 기준으로 주광 출력만 수정. 날짜당 전체 품목 문서는 유지.
- 네덜란드 포장 환산값이 없는가: 활성1305품목 중 박스당단455,박스당송이44,단당송이506개 양수. 나머지0/NULL이며 전체부재는 아님. 현재42차 델피늄·에린지움·수국 다수는 박스당송이0.
- 수량 박스 병기: 사용자가 300송이(30) 형태, 박스단어 생략으로 확정. 견적 단가/금액은 그대로. 정확한 박스분배량 또는 직접 환산값이 있을 때만 괄호. 누락값은추정하지 않음.

## 구현·근거
계획 docs/plans/weekday-native-print-layout-2026-10-15.md. SQL Server native 정렬rank전달, JS locale재정렬제거. 주광nativeLayout에A4/표180mm/행6.35mm/상단88.23121mm/합계7.5mm와native셀비율. 다른인쇄메뉴기존양식보존. DBwrite없음.
실제dnSpy재추출 output/estimate-native-report-20261015.cs, output/estimate-native-form-20261015.cs. DB단위probe output/netherlands-box-probe.json. 실출력probe돈셀180단(12),문라이트630단(42), 금액동일.

## 검증 진행
독립리뷰정렬/환산조건중요문제없음. Chrome1920×1080에서표폭179.99935mm, header88.23027mm, 겹침없음 확인. 긴박스병기수량의overflow는괄호앞줄바꿈으로보완중. 필수계약/빌드 및배포 결과후속기록.
기준선 적용:기존화면틀/키보드,선택일검증,실브라우저. 해당없음:신규메뉴/ERPwrite/재고계산. 예외:미확정분배출력은앞선명시정책유지.

| 항목 | 기록 |
|---|---|
| 기간 | 2026-10-15 |
| 화면 | 주광 견적 선택일 인쇄 |
| 원장 부작용 | 없음, SELECT/HTML만 |
| 다음 채팅 힌트 | nativeAllocationPrintLayout 계약과 이 문서 확인 |

## 검증 보완
박스 병기 포함 Chromium 실측 overflow0건, 세표폭179.99935mm. 긴 수량은 괄호앞줄바꿈, 폰트·열폭불변. unit14개 및 Typography7+bundle 통과, 전체ERP계약/dnSpy/manifest112개/writeguard 통과. 원본DB probe와생성미리보기는 비공개output에만보관하며커밋제외.
