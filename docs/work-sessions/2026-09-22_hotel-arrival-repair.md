# 호텔 도착원가 품목 연결·단위 보정

| 항목 | 내용 |
|---|---|
| 기간 | 2026-09-22 |
| 화면 | 호텔 손익계산서·차수별 매입단가·도착원가 업로드 |
| PR | https://github.com/Jayinsightfactory/nenova-erp-ui/pull/738 |
| 원장 경계 | 원가/매입단가/주문/분배/재고 보존, 배포 후 검토된 WebArrivalCostLine.ProdKey만 감사와 함께 보정 |

## 고정 결정

- 품목명 정확 비교에는 규격과 브랜드를 보존한다. 검색용 국가 토큰 제거와 구분한다.
- Mix Box와 단일품목, M/L/XL, MC/MEL/EZ를 임의 대체하지 않는다.
- 명시 단-N스팀은 N송이 단가이며, 원본 단당 수량을 먼저 확인한다. 원가 자체는 변경하지 않는다.
- 같은 연도의 해당 차수 우선, 없으면 이전 최신 대차수. 미래값 금지.
- 미연결 약칭/국가충돌은 자동 추정하지 않는다.

### 1. Q: 품목 매칭만 잘하면 단가는 문제없을 것 같다. 작업 시작.

A: 엄격 품명 우선 비교, 규격 near-miss 차단, 명시 복합단위 환산, 숫자상 같은 세부차수 중복 표시 제거 구현. 타깃 테스트 및 전체 ERP 계약/manifest/쓰기 가드/dnSpy 근거 검증 통과. 최신 master의 Radix 의존성은 공유 node_modules junction을 변경하지 않고 임시 별도 경로에 준비, NODE_PATH로 webpack 빌드 통과.

결과: PR738 merge 3ca742b2. 배포 run35676177556 진행 중. 데이터 보정은 배포/브라우저 검증 이후만 허용. 근거 보고서: [repair](../work-reports/2026-09-22_hotel-arrival-repair.md).

## 로컬 파일

`.tmp/repair-hotel-arrival.cjs`는 기본 SELECT-only incident probe이며 apply는 검토 digest+배포확인을 요구한다. `.tmp`의 probe/log/임시 의존성은 커밋하지 않는다. 데이터 보정 완료 여부를 최신 후속 기록에서 반드시 확인하고 재실행하지 않는다.
