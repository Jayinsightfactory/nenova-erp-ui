# 강남 복수 시트 수동 저장 계약

## 확인된 원인과 기준

- 사용자: 강남 합산 정상이나 저장 버튼 무반응. 합산 확인 후 수동 저장 허용 요청.
- 실행형 재현: 34차강남 10 + 34차 강남 콘서트 3 = 강남13으로 합산되지만 duplicate branch check ok:false가 전체저장 disabled를 만든다.
- 기존 테스트도 같은 모순을 고정하고 있었다. 최신 사용자 기준으로 수동 저장과 자동 저장을 분리한다.
- 원본 파일/사용자 해당 차수는 미제공. 합성 fixture와 실제 코드 경로로 재현했으며 해당 사용자의 업로드를 직접 보았다고 주장하지 않는다.

## 동작·부작용

| 동작 | WebRaumPnl/Item | WebRaumCostPrice | 주문/분배/재고/견적/WebProfitReport |
|---|---|---|---|
| 합산 미리보기/확인 체크 | 보존 | 보존 | 보존 |
| 강남 복수시트 자동 저장 | 금지 | 보존 | 보존 |
| 합산 확인 후 수동 저장 | 기존 선택 연도+대차수+raum 결산 저장 경로 | 기존 명시 수기 단가 학습 정책만 유지 | 보존 |
| 금액 불일치/기타 검증 실패 | 저장 차단 | 보존 | 보존 |

## 기준 원천과 소비자

- 업무키: 기존 lib/raumPnl.js 실제 SQL의 OrderYear+MajorWeek+PartnerCode. SQL/스키마/키 정책 변경 없음.
- 경고 전환 범위: raum의 동일 대차수 강남 복수 시트만. 시트명/수량/금액을 보존하고 사용자 확인을 요구한다. 건대/초이문 중복과 실제 금액 불일치는 계속 오류다.
- confirmGangnamMerge 기본 false, boolean true만 허용. multipart는 정확한 문자열 true만 bool로 변환. UI/자동판정/API/core가 순수 정책을 공유한다.
- 확인은 새 파일/상세/업체/연도에서 해제한다. 기존 저장본 변경 확인, previewToken와 snapshot 재검증, 원자적 전체저장은 유지한다.
- 강남 복수시트 경고는 단일 차수라도 원본 파일과 previewToken을 가진 import 미리보기로 유지한다. 일반 detail 저장으로 내려보내지 않는다. 최종 리뷰에서 발견한 snapshot 우회 경로를 차단한다.
- 실패 사유는 저장 버튼 가까이 표시한다. HTML/네트워크 오류도 읽을 수 있는 안내로 표시하며 자동 재시도하지 않는다.
- 필수 fixture: 강남10+행사3 수동확인 성공/미확인 실패, 금액불일치+확인 실패, 건대중복 실패, 초이문 분리, 연도분리, null요약 오류 안내, 다차수·단일 상세 저장.

## EXE 경계

저장된 FormOrderAdd.GetDataProduct의 Product/OrderDetail SQL을 재확인했다. 이 요청은 EXE 주문 저장이 아니라 웹 결산 검증 정책 수정이다. FormRaumPnl golden 및 DB_STRUCTURE의 WebRaumPnl 업무키와 실제 save SQL을 대조했다. EXE/SP/공유 원장을 수정하지 않으며 운영 테스트 저장은 수행하지 않는다.

## 역할과 검증

메인: 기준·계약·브라우저 fixture·통합·운영 배포. Terra/high: 범위 확정 구현과 순수 회귀. Sol/high: 최종 위험 검토. 하위 P0_LOCAL, 의존성·최신독립worktree 준비 완료. 운영 원본 파일은 미제공이며 합성 fixture를 사용한다.

## 통합 검사

- `npm run test:raum-pnl`: 통과. 기존 버튼 모양 고정 검사와 검증 코드 위치 검사는 공통 정책에 맞춰 갱신했다.
- `npm run test:erp-contract`: 전체 통과(후속 distribution connection 23개 파일 포함).
- dnSpy evidence, ERP manifest 59개, 변경 API 쓰기 범위 2개 검사: 통과.
- production webpack build: 통과.
- 별도 MOYI 통합 HTTP 검사는 로컬 의존성 junction을 Turbopack이 프로젝트 밖 경로로 거부해 실행하지 못했다. 이번 PNL 변경과 무관한 환경 제한이며, 실제 node_modules를 설치하는 PR CI에서 재확인한다.
- 로컬 실브라우저 smoke 5개 시나리오 통과: 34+35차, 단일34차 원본 import 저장, 실제 합계 불일치 차단, HTTP500 안내+초안 보존, 신라 미선택 불합격 차수와 선택 저장 분리. 모든 저장은 가상 응답이며 외부 요청·실제 결산 쓰기 없음.
- 1920×1080 및 1366×768, 확대 100%에서 버튼 접근/가로 넘침 검사와 캡처 시각 검토 통과.
- 최종 검토에서 단일 경고 upload의 일반 detail 저장 경로를 발견해 import 경로로 수정한 뒤 재검토 통과.
- PR: https://github.com/Jayinsightfactory/nenova-erp-ui/pull/586. 운영 반영 결과는 완료 후 추가한다.
