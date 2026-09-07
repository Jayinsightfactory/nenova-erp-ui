# 신라 품목 연결 한글 검색 수정

## 요청·원인

사용자: 품목 검색에서 한글을 입력하면 검색되지 않음.
운영 3a95150b 로그인 화면에서 버튼으로 재현: 안시리움·핑크몬디알은 조회되지만 그라시오사는 0건이다. 안시리움 후보에는 실제 Anthurium Graciosa 15cm (#181)가 있다. displayName.js에는 그라시오사→graciosa 별칭이 이미 있으나 기존 item-mapping GET의 SQL 선필터가 영문 품목을 먼저 제외했다.

한글 조합 중 Enter는 별개 잠재 오류다. 조합 확정 직전 요청 후 onChange가 요청을 무효화할 수 있다. 늦은 응답 보호를 없애지 않고 조합 중 Enter를 차단한다. 실제 Windows IME 재현과 단순 문자열 채우기를 동일시하지 않는다.

## 기준·부작용

| 동작 | 기준 | Product/주문 | 결산/가격/분배/재고 |
|---|---|---|---|
| 검색 버튼·확정 Enter | 기존 /api/products/search, 자연어·한영 별칭·사용량 순서 | 읽기만 | 보존 |
| 한글 조합 Enter | isComposing/nativeEvent/229 확인, 검색 안 함 | 보존 | 보존 |
| 후보 표시 | 상위50, 명시 선택 전 자동연결 없음 | 보존 | 보존 |
| 연결 저장 | 기존 신라 전용 POST 및 행 snapshot 검증 그대로 | 보존 | 기존 한 행 ProdKey 연결 계약 유지 |

빈값은 요청하지 않으며, 미검색/0건/실패를 구분한다. 이전 검색 응답은 새 입력을 덮지 않는다. Raum의 기존 검색·전역 매칭 저장 API는 이번 범위에서 변경하지 않는다.

## 근거·역할

- 기존 decompile FormOrderAdd.GetDataProduct 326행: Product.ProdKey/ProdName/CounName/FlowerName/OutUnit 식별값을 사용. 원본명·단위·SQL 저장 경로는 이번 변경에서 그대로 보존한다.
- 고성능 설계/검토 gpt-5.6-sol, 제한 구현 gpt-5.6-terra/high. 외부쓰기와 배포는 메인만 담당한다.
- 로컬 의존성 준비 완료. 운영 증거는 로그인 화면 GET 검색만 사용했다. 운영 DB 직접 조회·원장 쓰기는 하지 않았다.
- 로컬 `test:shilla-pnl`, dnSpy evidence, 전체 `verify:erp-change` 성공(103페이지 빌드). 그라시오사/영문 Graciosa, 확정 한글 Enter, 조합 Enter 차단, 검색 응답 상한50, 0건/오류/잘못된 응답 구분 검사 통과. 고성능 최종 검토 GO, 미해결 P1/P2 없음.
- 기존 검색/연결 서버 API 파일 변경 없음. 운영 배포 후 동일 검색어를 재조회한다.
