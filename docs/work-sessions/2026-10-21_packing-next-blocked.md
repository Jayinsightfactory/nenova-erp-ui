# 수동 매칭·날짜 확인 후 진행 차단 안내

| 항목 | 내용 |
|---|---|
| 날짜 | 2026-10-21 KST |
| 화면 | 수입부 패킹 / 원본 인식값 검토 |
| 원장 부작용 | 없음. ERP SQL·SP·승인 조건 변경 없음 |
| 기준 | origin/master df98d3a6 |

## 고정 결정
- 매칭 완료와 날짜/가격 검증 완료를 동일하게 취급하지 않는다.
- 날짜 입력 후 기존 필수 확인 사유가 비면 차단 유지. 사유 자동 생성이나 검증 우회 금지.
- 차단 시 즉시 알림창 및 화면에 같은 구체적인 설명을 표시한다. 파일·매칭·입력값 보존.
- 운영 DB/공용 매칭 수정 없이 로컬 fixture로 검증한다.

## Q&A
### 1. 매칭·날짜 확인 뒤 다음 버튼이 작동하지 않는 원인과 로그
Q. 버튼을 눌러도 넘어가지 않는다. 이해할 수 있는 오류창과 로그 확인 필요.
A. 오늘 조회된 SystemActionLog 114건 중 해당 패킹 준비 단계의 실패 기록은 없었다. 브라우저 검증은 서버 요청 전에 실행되므로 서버 로그 부재가 성공 증거는 아니다.
최근 보관 업로드는 42-1 CHINA CI.pdf, 송장 XJ-2026-NN006, 16:46 KST snapshot에서 reviewConfirmed=false, DATE_ORDER_AMBIGUOUS와 빈 날짜/사유가 확인됐다. 저장되지 않은 현재 브라우저 입력은 이 snapshot으로 판단할 수 없다.
코드의 validateDrafts 실패 분기는 setErrors 이후 submitError를 빈 값으로 두고 return했다. 날짜 확인 사유 누락 등 상세 오류가 스크롤 아래 입력칸에만 표시돼 무반응처럼 보였다. 날짜만 입력한 반례와 사유 입력 후 통과를 2025/2026 fixture로 재현했다.

## 기준 및 부작용
| 동작 | 기준/소비자 | 원장 |
|---|---|---|
| 인식값 적용 | 기존 validateDrafts/applyPackingReview, 수량·단가·사유 조건 보존 | 전부 보존 |
| 입고 준비 | 기존 공용 source 검증 / generation, 실패 이유를 예외로 전달 | 전부 보존 |
| 오류 표시 | packingReviewErrorSummary, notifyPackingBlocked; 값 변환·저장 없음 | 전부 보존 |

dnSpy 저장 decompile ExcelLoadingPackingList.CheckData/InsertMaster 재확인. 실제 입고 쓰기는 명시 등록 단계에서만 실행하며 이번 코드는 해당 경로를 변경하지 않는다. Estimate/ShipmentDate/ShipmentDetail.Amount/Vat/isFix/WebProfitReport 보존.

## 검증 및 기준선
- 적용: 구체적인 실패 설명, 키보드 기본 알림창, 입력 보존, 동일 검증 조건.
- 해당 없음: 새 메뉴/SQL 스키마/단위환산/ERP 승인 변경.
- 단위 회귀 31건 통과. 전체 계약·빌드·배포·실브라우저 결과는 후속 기록.
- 실제 41-1/42-1 PDF를 1920×1080 로컬 웹에서 업로드해 날짜 사유 누락 알림창과 인라인 설명, 날짜 입력 보존, 사유 입력 후 해당 오류 해제를 확인. 운영 API는 전부 차단/격리 응답. 브라우저 런타임 오류 0.
- 빌드, dnSpy evidence, manifest 141개, changed API write guard 통과. 전체 회귀는 진행 중.
- 사용자 파일/로그/인증정보는 저장소에 커밋하지 않는다.
- 검색어: packing next DATE_ORDER_AMBIGUOUS 확인사유 무반응 submitError 42-1 CHINA
