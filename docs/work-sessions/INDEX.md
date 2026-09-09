# 세션 Q&A 인덱스

- [2026-09-09 견적 증가분 다음 세부차수 배정](2026-09-09_estimate-next-subweek-overflow.md) — 부족한 증가분만 다음 차수 업체 기본 출고일로 배정; 검증·배포 상태는 본문 후속 기록 참조.

- [2026-09-09 붙여넣기 작업 묶음·견적 최신화와 작업권 인계](2026-09-09_paste-history-estimate-handoff.md) — 실행별 취소/추가 이력, 초안 대조, 관리자 명시 인계 및 닫기 정리.

- [2026-09-08 주문 변경이력 상시 진입·검색](2026-09-08_order-history-search.md) — 분석 전 상단 버튼, 연도·차수·거래처·품목 검색, 500건 페이지 조회.

- [2026-09-08 피벗 물량표 합산셀](2026-09-08_pivot-combined-cells.md) — 동일 업체·품목 세부차수 수량 합산 표시 옵션.

- [2026-09-07 붙여넣기 업체·품목 AI 최종 검증](2026-09-07_paste-ai-match-review.md) — #531 배포·업체 실분석 통과. 품종 후보 누락 #534 후속 보완; 최신 운영 검증은 PR 댓글 참조.

- [2026-09-07 신라 품목 연결·차수별 단가 통합](2026-09-07_shilla-product-matching.md) — 개별 연결 운영 반영 완료. 미매칭 일괄 연결 구현·검사 완료, 운영 반영 준비. 실제 연결 저장은 사용자 선택 후 수행.

- [2026-09-07 신라 결산 통합·원본 배분율·운영 반영](2026-09-07_shilla-pnl-integration.md) — 메뉴 배포 완료, 실제 원본 업로드는 Chrome 파일 접근 허용 대기.

새 세션은 `TEMPLATE.md`를 복사하지 말고, 아래 파일명으로 **질문→답변 요약**을 만든다.

`docs/work-sessions/YYYY-MM-DD_{slug}.md`

최신이 위. 에이전트는 세션 시작 시 이 목록의 최근 1~2개를 읽고 이어간다.

| 세션 | 사용자 요청 한 줄 | 상태 |
|------|-------------------|------|
| [2026-09-07_shipment-import-final-state-drift](./2026-09-07_shipment-import-final-state-drift.md) | 36-01 카네이션 EXE/웹 출고분배 차이의 저장 원인 확인·재발 방지 | 원인 확인·전체 검증 완료, 운영 원장 보정 없음 |
| [2026-09-03_exe-web-stock-fix-parity](./2026-09-03_exe-web-stock-fix-parity.md) | EXE에서 0인 소수잔량·웹 음수차단·공용 SP 영향 등 이번 세션 오류를 후속 작업 필수 기준으로 저장 | 운영 읽기 전용 확인·설계 기준 기록, 원장/SP 쓰기 없음 |
| [2026-09-02_estimate-and-paste-regression-guards](./2026-09-02_estimate-and-paste-regression-guards.md) | 오늘 발생한 견적서관리·붙여넣기 회귀 원인과 다음 작업 필수 기준 저장 | PR #472~#476 배포·스모크 완료, 재발 방지 계약 연결 |
| [2026-08-31_dutch-volume-price-overlay](./2026-08-31_dutch-volume-price-overlay.md) | 네덜란드 물량표 원본 디자인 보존·단가를 수량 셀 안에 표시 | 전체 계약·빌드 통과, 배포 진행 |
| [2026-08-31_china-volume-subweek-navigation](./2026-08-31_china-volume-subweek-navigation.md) | 자동 중국물량표를 실제 DB 세부차수 순서로 이동 | 구현·전체 계약·빌드 통과, 배포 진행 |
| [2026-08-27_paste-incoming-display](./2026-08-27_paste-incoming-display.md) | 붙여넣기 품목 매칭 시 선택 차수 전산 입고수량 표시 | 로컬 ERP 계약·빌드 통과, 배포 준비 |
| [2026-08-26_estimate-directional-quantity](./2026-08-26_estimate-directional-quantity.md) | 증가만 부족재고 검사·기존 수량 확정 유지·변경 품목 재고 반영 | 배포 지시·통합 검사 완료, EXE/웹 저장 중지 확인 대기·미배포 |
| [2026-08-26_estimate-category-buttons](./2026-08-26_estimate-category-buttons.md) | 수국만 확정취소·모든 재조회 업체 유지·검색 초안 분리·버튼 검사 | 로컬 수정·자동검사 완료, 후속 화면 클릭 미검증·미배포 |
| [2026-08-26_pivot-display-export](./2026-08-26_pivot-display-export.md) | 차수 제목 대비·비고 토글·엑셀 수량 변경내역 | 로컬 검증 중 |
| [2026-08-26_pricing-drag-select](./2026-08-26_pricing-drag-select.md) | 업체별 단가 셀 드래그·선택영역 일괄 적용 | 구현/검증 중 |
| [2026-08-26_my-order-replace-log](./2026-08-26_my-order-replace-log.md) | 현재 주문수량·추가/변경등록·실행로그 | 구현·로컬 회귀검증, 배포 대기 |
| [2026-08-26_pricing-enter-next](./2026-08-26_pricing-enter-next.md) | 업체별 단가 Enter시 같은 업체 아래 품목 입력칸 이동 | 구현 중 |
| [2026-08-26_pricing-recent-products](./2026-08-26_pricing-recent-products.md) | 품목도 최근90일 거래 기본표시·검색시 전체 | PR367 배포완료·대량조회 브라우저 검증 지연 |
| [2026-08-26_pricing-product-selection](./2026-08-26_pricing-product-selection.md) | 품목 전체 선택 후 개별 해제·선택 품목만 일괄 단가 적용 | PR366 배포·실브라우저 확인 완료 |
| [2026-08-26_pricing-recent-customers](./2026-08-26_pricing-recent-customers.md) | 단가관리 기본 업체목록 최근90일, 검색시 전체 | PR365 배포·실브라우저 확인 완료 |
| [2026-08-26_estimate-deduction-delete](./2026-08-26_estimate-deduction-delete.md) | 견적서 불량·검역차감 체크 선택 삭제 | 구현·검사 중 |
| [2026-08-26_pnl-cost-hover](./2026-08-26_pnl-cost-hover.md) | 매입단가 입력칸에 차수별 단가 미리보기 | 구현 중 |
| [2026-08-26_pnl-cost-comparison](./2026-08-26_pnl-cost-comparison.md) | 라움·초이문 상세 우측 차수별 매입단가 비교, 엑셀 제외 | 로컬 검증 완료 |
| [2026-08-26_arrival-cost-weight-active](./2026-08-26_arrival-cost-weight-active.md) | 도착원가 안내를 콜롬비아장미 면 활성화로 | 배포 대기 |
| [2026-08-26_defect-manual-cost](./2026-08-26_defect-manual-cost.md) | 불량차감 단가 누락 시 직접입력 후 등록 | 검증 중 |
| [2026-08-25_hotel-miu-variety-buttons](./2026-08-25_hotel-miu-variety-buttons.md) | 호텔+미우 품종별 묶음·버튼 선택 | 배포 대기 |
| [2026-08-25_support-customer-estimate](./2026-08-25_support-customer-estimate.md) | 영업지원 처리상태 견적서 열기·이월·수동처리완료·견적서 캡쳐 | 진행 |
| [2026-08-25_raum-choimun-pnl](./2026-08-25_raum-choimun-pnl.md) | 라움/초이문 손익, 업로드 잔존·전산 매칭 표시 | 진행 |
| [2026-08-24_import-skip-all-result](./2026-08-24_import-skip-all-result.md) | 업로드 주문등록 전체 제외·등록 후 결과 표시 | 진행 |
| [2026-08-24_arrival-cost-week-farm-group](./2026-08-24_arrival-cost-week-farm-group.md) | 도착원가 차수 정렬·농장별 원가·품종만 조회, 이어서 농장 이어받기·단/박스·CW/GW(콜롬비아), 업로드 502, 문라이트 단원가·한눈에, 33-2 빈국가 유령 476원 | 진행 |
| [2026-08-20_arrival-cost-matching-search](./2026-08-20_arrival-cost-matching-search.md) | 도착원가 매칭검색·품종 버튼·수국 엑셀·HTML JSON, 이후 세션별 Q&A 기본화 | 배포됨 |
