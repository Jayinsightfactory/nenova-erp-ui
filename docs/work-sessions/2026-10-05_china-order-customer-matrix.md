# 중국 발주 품목(HF)×업체(CL) 수량표 — 2026-10-05

## 최신 요청·합의
**Q.** 첨부 `Pivot 통계_2026-10-05.xlsx`처럼 품목(코드번호), 업체(CL 번호), 품목별 수량과 토탈 수량을 보여 달라.
**정정.** 코드번호는 앞서 업로드한 품목목록의 **HF CODE**다. Product.ProdCode/ProdKey를 표시 코드로 혼용하지 않는다.
**A.** 중국 발주 화면과 다운로드 첫 시트를 `품목명(HF 코드) | 단위 | 총수량 | 업체명(CL 번호)…`로 개편했다. 제품 행, 고객 열, 교차 셀 주문 수량과 제품별 합계. HF 미매칭/검토 및 CL 미등록은 명시한다.

## 기존 계약 유지
- 7개 메인차수(이전3+현재+다음3)는 선택 범위다. 표시와 다운로드는 정확한 연도+실제 세부차수 하나이며 40-03·suffix도 01/02로 축소하지 않는다.
- 실제 ViewOrder.OutQuantity 양수 주문을 사용한다. CustKey로 고객, ProdKey+단위로 품목 행을 구분하며 동일 CL/품목명만으로 합치지 않는다.
- 검색/HF 필터와 화면/엑셀은 동일 주문 집합을 공유한다. 필터 적용 때 필터 합계임을 알린다. 박스/단/송이의 총합을 섞지 않는다.
- API SQL, nenova.exe, 확정/분배/출고/재고/견적 원장과 운영 스키마 변경 없음. HF 업로드는 기존 계정별 브라우저 로컬 저장 범위 유지.
- 첫 시트 `품목별업체수량` 추가, 기존 발주현황/업체별발주/주문상세/조회기준 보존. 코드는 문자열, 수량은 숫자, 합계 SUM+캐시. 전체 테두리·회색흰색·헤더 자동 높이·품목/단위/합계 고정.

## 근거·검증
- 실제 첨부 A1:U39 구조와 HF 원본 확인. main dnSpy CLI FormQuantityPivot.GetData 재확인: `vo.OutQuantity Quantity`, `FROM ViewOrder vo`, 양수 주문 조건.
- 운영 읽기 fixture: 2026 중심40, 총7메인범위, 양수 중국 주문1336행/42업체. 인증정보와 원자료는 ignore된 로컬 output에만 보관, Git에는 포함하지 않는다.
- origin/master 4f694305 통합 후 전체 ERP 계약, 중국 기능19개, manifest78개, dnSpy evidence, write guard(변경 API0), 생산빌드 통과.
- 생산번들 로컬 브라우저 **1920×1080/100%**: 39-01 28품목×5업체, 40-01 123품목×34업체. 모든 화면/엑셀 셀, HF/CL, 단위 합계 대조. 40-03·업체검색·실패/stale 다운로드 차단, 일반 shell1/sidebar1·popup shell1/sidebar0, pageerror0.
- 고정 열/헤더 및 양끝 스크롤, 1100×800 문서 가로 overflow0. 최종 프레임 하단1005.30px로 1080px 이내, 하단 안내와 스크롤 영역 접근 가능. 수량14px/총수량15px 짙은 중앙 정렬.
- 실제 다운로드 XLSX5시트 재독해 및 모든 시트 렌더 검사. 수량 값·SUM 캐시·단위 분리·문자열 코드를 검증. 정수 표시에는 불필요한 소수점 기호가 없도록 별도 숫자 서식 적용.
- 독립 고성능 검토의 프레임 세로 이탈/민감 산출물 추적 위험은 max-height 수정 및 .gitignore로 해소. 지정 구현 모델 미제공으로 분리 Excel 구현은 사용 가능한 경제 모델 gpt-6-luna/high, 최종 검토 gpt-5.6-sol/xhigh 사용.

## 배포 단계
로컬 구현·검증 완료. PR/CI/master 배포 및 운영 브라우저·실제 Pivot/Customer 읽기 대조는 후속 진행 결과로 확인한다. 배포가 검증되기 전 배포 완료라고 해석하지 않는다.

## 이어받기
이 문서와 `docs/plans/china-order-customer-matrix-2026-10-05.md`, `docs/contracts/china-order-download.json`, `docs/exe-golden/ChinaOrderDownload.md`를 먼저 읽는다. 이전 단일 차수 계약은 [앞선 세션](2026-10-05_china-order-download.md) 참고. 품목 표시 코드=HF, 업체 표시 코드=Customer.OrderCode(CL), 원장 쓰기 없는 작업이라는 결정을 유지한다.
