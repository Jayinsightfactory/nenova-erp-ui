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

### 최종 배포·운영 검증 기록
- PR [#871](https://github.com/Jayinsightfactory/nenova-erp-ui/pull/871), 기능 커밋 bf68998be09c8cadc41df63f917e1332513a7c8e. 독립 검토 P0/P1 없음, GitHub ERP Contract Guard run37263585646 성공.
- master squash abd4e8bf7a7ba401f4f682cbd0bd52ff53a09f43. Cafe24 [run37263739595](https://github.com/Jayinsightfactory/nenova-erp-ui/actions/runs/37263739595) 전체 성공(서버 빌드·Hydration smoke 포함). 병합 당시 다른 세션 #870 원문 이력 작업은 보존되며 대상 파일 겹침 없음.
- 2026-10-05 13:35:46 KST 운영 브라우저1920×1080/100% 최종 통과. 39-01 28품목×5업체,40-01 123품목×34업체,40-03·검색 후 다운로드 모두 동일 집합/수량/HF/CL. 실제 Customer 조회의 CL 번호와 native Pivot 중국 주문 수량을 같은 연도/전체 세부차수/CustKey/ProdKey로 대조해 일치. pageerror0, 프레임 하단1005.30px,1100px 가로 overflow0.
- 운영 화면·실제 다운로드 Excel5시트 대조 완료. 이 후속 기록은 배포 후 로컬 handoff로 추가했으며 인증정보/원자료는 포함하지 않는다.

## 후속 요청: 박스 병기·코드 전용 업체 열·접두어 그룹
**Q.** 품목명의 HF 미매칭 문구는 불필요하다. 수량(박스수)을 DB 품목관리 기준으로 표시하고, Excel 업체 열은 BCL77 같은 코드만 표시하며 YCL/KCL 등 문자끼리 묶어 달라.
**A.** 기본 품목명에는 실제 HF만 남긴다. 단 수량은 현재 Product.BunchOf1Box, 송이는 SteamOf1Box로 나누고 박스 단위는 그대로 병기한다. API는 두 현재 마스터 필드 SELECT만 추가하며 원장 값은 변경하지 않는다. 0/NULL/비정상 분모는 추정하지 않고 수량(—)으로 표시한다. 운영 읽기 사전조회169품목 중147개 단 박스기준 양수,22개 누락 확인. 사용자에게 누락 처리 안내 후 진행.
- 같은 CustKey/ProdKey/단위 집계, 연도+원본 세부차수/검색/HF 사전 계약 유지. 코드 접두어 먼저, 그룹 안 자연숫자 정렬, 같은 CL의 다른 CustKey는 구분.
- Excel 기본 수량표 업체 헤더는 코드만, 그룹 경계 테두리 추가. 주문이 없는 업체/품목 교차 셀은 빈칸 유지. 기존4개 감사 시트는 원자료·매칭 상태를 보존한다.
- 수량(박스수) 표시 수식과 캐시, 별도 숨김 수량원본의 numeric/SUM/DB분모를 보존. 서로 다른 품목 분모의 박스합은 개별 환산 후 합산하며 양수 미환산이 있으면 합계 박스도 —. 다른 단위의 미등록 분모는 해당 단위 footer에 영향을 주지 않는다.
- 재계산 시 정수의 불필요한 소수점 기호를 방지하는 ROUND/INT 기반 서식 선택, 원수량0·분모0 및 합계 처리 보강.
- PRD: `docs/plans/china-order-box-code-layout-2026-10-05.md`. 전체 ERP 계약/manifest78/write guard0/API SELECT-only/생산빌드 통과. 브라우저1920×1080/100%·1100×800, 실다운로드39-01/40-01/40-03·검색·실패 차단 확인(pageerror0). 최종 변경 후 재빌드/재검증·CI·배포 결과는 아래 후속 기록으로 판정한다.
- 지정 분리 구현 모델 미제공 시 gpt-6-luna/high 대체, 최종 검토gpt-5.6-sol/xhigh. Excel worker 파일만 분리, main이 실제dnSpy·운영읽기·API/UI·외부반영 수행. DB/EXE/SP 보정 없음.

## 이어받기
이 문서와 `docs/plans/china-order-customer-matrix-2026-10-05.md`, `docs/contracts/china-order-download.json`, `docs/exe-golden/ChinaOrderDownload.md`를 먼저 읽는다. 이전 단일 차수 계약은 [앞선 세션](2026-10-05_china-order-download.md) 참고. 품목 표시 코드=HF, 업체 표시 코드=Customer.OrderCode(CL), 원장 쓰기 없는 작업이라는 결정을 유지한다.
