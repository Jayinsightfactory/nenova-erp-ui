# 네덜란드·베트남 이월 및 후속 재계산

| 항목 | 내용 |
|---|---|
| 기간 | 2026-10-22 |
| 화면 | 재고조정·견적/요일 분배·주차별 매출이익 |
| 부작용 | 기존 저장 계약 유지, native CALC 후 전차수 검산 추가 |
| 운영 보정 | 승인 두 품목 ProductStock만; 원장·현재고·확정 보고서 보존 |
| 배포 | 테스트/PR/배포 진행 중. 완료 근거 없는 완료 주장 금지 |
| 이어받기 | 이 문서 및 docs/plans/carry-cascade-2026-10-22.md |

## 고정 결정
- 과거 StockHistory/확정출고 삭제를 현재 SQL 기준으로 반영한다. 삭제 출고를 복구하거나 조정 이력을 중복 생성하지 않는다.
- 기존 에콰도르 보정은 재실행하지 않는다. 다른 품목의 초기차수 불일치는 진단만 한다.
- 재고 목표값 일괄편집의 과거차수 차단은 보존한다. 명시 증감 조정·확정수량 수정의 후속 검산을 강화한다.
- native CALC/readback은 저장 transaction 안에서 수행한다. 실패·범위 중복·누락은 전체 rollback.
- 운영 보정은 코드 배포 이후 지문 일치·rollback rehearsal·별도 readback 후 적용한다.
- EXE의 직접 SQL 삭제는 웹 wrapper 보호 범위 밖이다. 공유 SP/trigger/스키마 변경 없음.

### 1. 사용자 요청
**Q.** 네덜란드·베트남 이월을 SQL 기준으로 고치고, 출고 삭제·조정 시 후속차수 재계산을 보완해 배포. 41차까지 검증.

**A.** 실제 dnSpy와 SQL을 기준으로 기존 native CALC 및 원장 산식 readback을 재사용했다. 단건 조정의 실패 결과 미확인, 확정수량 감소/삭제의 후속 산술 검증 누락, 구형 API의 확정수량 우회 수정을 보강한다.

**검산 범위.** 2026년 1~41차 독립 재고 감사는 두 대상 이월 누락 외 초기차수 별도 불일치도 반환했다. 후속 legacy 백업 노드에서 독립 감사의 carry chain이 끊길 수 있으므로 단순 MATCH를 전체 역사 정상으로 해석하지 않는다. 두 품목 보정 미리보기는 모든 native 후속 노드를 포함한다.

## 진행 근거
- 새/관련 회귀 97개 통과. 전체 verify:erp-change/build 및 CI는 진행 중.
- 운영 SELECT-only preview: 두 품목 126 snapshot 검산, 113 변경 예정, 2027 기존 snapshot까지 포함.
- 상세 원행·보정 지문·가격/수량 증거는 `.verify/` private. 커밋 금지.
- 아직 운영 보정·배포 완료로 기록하지 않는다. 완료 후 결과를 이 문서에 이어 적는다.

검색어: carry cascade Netherlands Vietnam 후속재고 출고삭제 native readback 41차

## 2026-10-22 실제 적용 및 후속 원가 검산

- PR [1225](https://github.com/Jayinsightfactory/nenova-erp-ui/pull/1225), squash `78f19ba39d6eaf8ab2b2f9fa9b0fb804bb9fab21`.
- CI `39702671667`, Cafe24 `39702956142` 성공. 전체 ERP 가드/build와 로그인·피벗·레이아웃 브라우저 hydration, ping DB 연결 통과.
- 배포 후 native-only 보정: rollback rehearsal/원상복구 검증 후 commit/별도 연결 readback 성공. 두 품목 126 snapshot 검산, 113 수정, 추가 이력 0, 보호 원장 18항목 보존. 현재고·확정보고서·공통 SP 변경 없음.
- **네덜란드·베트남 보정 재실행 금지.** `C:/Users/USER/nw-carry-cascade/.verify/stock-cascade-repair/apply-transaction.json`과 `after.json` 참조. 이전 에콰도르 보정도 재실행 금지.
- 실제 운영 다운로드 `39704410335`: 18·26·31·41 모두 HTTP200/한 시트/업무 쓰기0 성공. 저장된 미확정 보고서는 최신화 전 과거 값이 보일 수 있다. 확정 revision은 자동 덮어쓰지 않는다.
- 1~41 재고 독립 재감사 15,692검사, 대상 두 품목 문제0. 초기1·2·3·8·12·13·14·17의 별도18품목/21관측과34·35 자료누락은 남는다. EXE 직접 SQL 삭제 보호·EXE GUI·실물 재고 일치는 미검증.
- 수량 복구 후 네덜란드 오래된 실제 매입원가가 에콰도르 전용 분기에서 제외되어 판매단가 자동평가로 넘어가는 추가 문제 발견. `C:/Users/USER/nw-netherlands-acquisition`, `codex/netherlands-acquisition-carry`에서 SELECT-only 원가 복원 범위 보완. 베트남 기존 평균원가 산식은 유지.
- 상세 설계: `docs/plans/netherlands-acquisition-carry-2026-10-22.md`. 추가 원가 수정 포함1~41 조회 완료: 표시 산식15,058개와 SQL 순수매출/불량/기타매출/외화매입 대사 모두 일치. 자동값 변화는26~41차 네덜란드에 한정, 타국가 보존. 원가 근거 경고와 실사 불확실성은 별개다. CI/배포는 진행 중이며 별도 완료 근거를 남긴다.

### 깨끗한 컨텍스트에서 이어받기

이 문서와 두 작업트리의 private `.verify`를 읽는다. PR1225 배포와 native 재고 보정은 이미 완료했으므로 다시 실행하지 않는다. 네덜란드 원가 보완의 최종 검산/PR/배포 상태만 확인한다. 초기차수 다른 품목과 Product.Stock 현재고는 실사 또는 기존 조정 목적 확인 없이 변경하지 않는다. 전체 정상이라고 보고하지 않는다.
