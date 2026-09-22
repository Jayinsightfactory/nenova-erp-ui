# Nenova UI 개선 — 거래처관리 시범

2026-09-22. 목표: 익숙한 표 작업을 유지하면서 작업 위치와 상태를 알아보기 쉽게 한다.

## 후보 조사와 선택
| 후보 | 장점 | 이번 코드와 통합 비용 | 판단 |
|---|---|---|---|
| shadcn/ui | 소스 소유·조합형 디자인, TanStack 기반 표 예제 | 기존 비 Tailwind 스타일과 별도 토큰/구성 통합 필요 | 이후 공통 컴포넌트 설계 참고 |
| Mantine | 다양한 완성형 컴포넌트, Next Pages 지원 | Provider와 전역 스타일 도입·충돌 검토 필요 | 전체 재작성보다 점진 적용이 적합 |
| Radix Primitives | 무스타일 접근성 컴포넌트, 모달 포커스·Escape 지원 | Dialog 단위 도입 가능, 기존 표/API 유지 | 시범 채택 |

공식 근거:
- https://ui.shadcn.com/docs/installation
- https://ui.shadcn.com/docs/components/radix/data-table
- https://github.com/shadcn-ui/ui/blob/main/LICENSE.md
- https://mantine.dev/getting-started/
- https://github.com/mantinedev/mantine/blob/master/LICENSE
- https://www.radix-ui.com/primitives/docs/components/dialog
- https://github.com/radix-ui/primitives/blob/main/LICENSE

위 후보의 코어는 MIT. 이번 설치는 @radix-ui/react-dialog만 사용하며 패키지 LICENSE를 유지한다. 유료 템플릿·서비스·그리드 기능에 의존하지 않는다. Radix가 한국어 ERP 업무 정확성을 보장하지 않으므로 한글 입력·저장 계약은 별도로 검사한다.

## 시범 설계
- 상단: 거래처 제목/검색/주요 작업, 명확한 파란 신규·저장 버튼.
- 표: 기존 12개 열과 열별 필터·정렬 보존. 회색/흰색 줄, 선택 행, 선명한 헤더.
- 기본 32px 행 높이, 촘촘히 보기 26px. 세로는 페이지 전체 스크롤.
- 선택 거래처 요약은 표 위에 배치해 긴 목록 아래까지 찾지 않아도 된다.
- 모달: Radix 포커스 가두기, Escape 취소 확인, 닫은 뒤 원래 위치로 포커스 복귀.
- 처리 중·실패·미저장·성공을 텍스트와 색으로 구분. 빈값/0 및 원본 충돌 보호 보존.
- CSS Modules로 페이지/모달에만 스타일 적용. 전역 shell과 다른 메뉴는 변경하지 않는다.

## 기준·부작용
| 동작 | 기준 | API/Customer | 주문·분배·재고·견적·손익 |
|---|---|---|---|
| 검색·정렬·밀도 변경·모달 열기 | 기존 filterCustomers 및 로컬 표시 state | 기존 조회 외 추가 쓰기 없음 | 모든 연도 보존 |
| 신규/수정 저장 | 기존 customer-management 계약, CustKey | 기존 payload/API 그대로 | 기존 계약 그대로, 신규 side effect 없음 |

서버 코드·customerEditor helper·DB·dnSpy 동작 변경 없음. 2026-09-21 FormCustomerInfo 근거를 재사용한다. 이번 작업을 이유로 운영 저장 시험을 수행하지 않는다.

## 수용 기준
1920×1080/100%, 800×800에서 가로 페이지 이탈·모달 이탈·겹침 없음. 표 가로 스크롤 허용. 한글 필터, 정렬, 밀도 전환, 신규/수정, 실패 입력 보존, 성공 payload, 포커스 순환/복귀, Escape 확인을 fixture로 검사. 빌드 및 ERP 회귀 검사 통과 후 반영.

## 확대 순서
시범 확인 → 견적서(선택·저장 상태) → 주문등록(입력/미리보기/결과) → 입고 → 피벗. 계산 엔진이나 전체 표 라이브러리 교체는 별도 과제. 사용자별 즐겨찾기·권한 변경은 이번 범위 아님.

모델 배정: 별도 하위 에이전트 도구가 없어 메인이 설계·구현·검증 담당. 외부 쓰기와 배포도 메인만 수행.
