# 물량표 가이드 및 주문·잔량 즉시 계산

## 사용자 요청 → 처리
- 네덜란드 단계별 말풍선/하이라이트/끄기 → 차수→조회→편집→저장→검토→명시 적용 안내. 끄기 브라우저 저장. 실제 성공 응답과 현재 초안으로 단계 판정.
- 네덜란드·중국 고객 수량 변경에 주문/입고/잔량 미갱신 → 주문은 편집 고객합계, 입고 원본 유지, 잔량=입고-주문(네덜란드 명시 재고 가산). 화면 및 XLSX 캐시 동기화, 수식 보존.
- ERP 기존 주문·분배 정책과 writer 변경 없음. 가이드가 자동 ERP 적용하지 않음.

## 검증
- 실제 dnSpy FormQuantityPivot 및 SELECT-only probe 수행(작업 계획 기록).
- test:erp-contract, test:pivot, test:nenova-dnspy-evidence, test:erp-manifest, guard:erp-writes, build 통과.
- test:dutch-volume-distribution-sql: 격리 DB 실제 writer 검증 통과. 교차연도, 기존주문 보존, 신규주문, NULL, 롤백, 견적·매출 보존 포함.
- CUA 실제 production build + API 격리 fixture: 네덜란드/중국 모두 5→8 편집 후 주문8/입고20/잔량12 및 하단 합계 일치. 네덜란드 Enter, 중국 Tab 조작 확인.
- 가이드 끄기 후 reload 유지, 저장 성공 후 검토 안내, 미매칭 시 적용 차단 안내, 화면 하이라이트 확인.
- 실제 XLSX write/read 회귀 통과. 운영 데이터 시험 분배는 미실행.

## 배포
- PR/CI/운영 배포 확인 후 후속 기록.

검색어: volume-guide-totals 네덜란드 중국 가이드 주문 입고 잔량 수식캐시
