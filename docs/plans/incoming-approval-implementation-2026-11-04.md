# 입고 정정 승인 구현 기준

진행 중. 배포/완료 기록이 아니다. 기준 dc5a5d58.

## 근거와 기준표

- 실제 EXE dnSpy CLI FormShipmentDistribution.btnSave_Click 재추출(2026-11-04): ShipmentDetail → ShipmentFarm → ShipmentDate. 날짜별 EstQuantity 정수반올림과 Amount/Vat는 기존 distributeUnits/amountVatFromCostEst 재사용.
- 운영 SELECT: 2026 41~44차 상세 1558/1412/1445/1351 모두 확정. 2025 동일 차수 별도 존재. Warehouse7970=2026/44-01. 41차 이후 활성 WebProfitReportConfirm=0(조회시점).
- ShipmentFarm에는 입고 키 없음. 기존 상세 CustKey NULL은 정상 가능하며 상위 ShipmentMaster.CustKey가 기준.
- 기존 web_mgmt.ApprovalRequest/ApprovalAudit의 실제 운영 스키마를 확인해 전용 TargetKind=WAREHOUSE_CORRECTION_V1로 재사용한다. 일반 결재 API에서 이 종류 생성/전환을 차단한다. 감사 SystemActionLog를 요청 저장소로 쓰지 않는다. DDL 없음.
- 정책 원천: 최신 EXE/실제 SELECT → 실행 helper → 계약. 오래된 MD의 IDENTITY/환산/Manager 설명은 근거로 사용하지 않는다.

| 동작 | 요청/감사 | 입고 | 분배/날짜 | 주문 | 재고 | 견적·매출 |
|---|---|---|---|---|---|---|
| 초안/요청/매칭/반려/취소 | 버전검사 저장 | 보존 | 보존 | 보존 | 보존 | 보존 |
| 농장 정정 확정 | 같은 트랜잭션 완료 | 농장만 | 명시한 농장연결만 | 보존 | 보존 | 금액·확정 보존 |
| 품목/수량 확정 | 같은 트랜잭션 완료 | 승인 최종값 | 선택 물리행/날짜만 | 기존 보존, 신규 양수 연결 명시 | 입고/확정출고 차액+native cascade | 날짜별 금액과 상세합계 검산 |
| 실패/오래된 요청 | 완료 금지 | 전체 롤백 | 전체 롤백 | 전체 롤백 | 전체 롤백 | 전체 롤백 |

## 필수 조건

- 업무키 연도+차수+업체+품목, 물리키 요청번호/입고번호/SdetailKey/SdateKey. 요청값으로 역할/확정 상태를 결정하지 않는다.
- 같은 수량의 품목 이동도 단위와 단가를 검토한다. 감소만/독립 추가/0 허용. 감소와 증가의 수량 일치 강제 없음.
- 초안과 매칭을 저장해 이어가기, 명시 미리보기와 최종 확인, UUID 중복확정 및 서버 revision CAS.
- 최종확정 재고 게이트 → 요청/원장 잠금 → 기준재검증 → 원장 변경 → 이전/신규 품목 후속연도 포함 재계산 → EXE 견적/매출 재조회 → 완료 커밋.
- 외부 발송 파일/ECOUNT 변경 없음. 이미 발송한 서류는 재발행 대상으로 표시.
- 손익 확정본/저장 계산본은 일반 매출 원장과 별개이며 기존 고정조회 계약을 무시해 과거 기록을 덮어쓰지 않는다. 영향 표시에 포함하고 재계산 정책을 검증해야 한다.
- 메뉴 기준: 페이지 세로 스크롤·1920/390·키보드·초점복귀·선택맥락·미저장 경고·전후비교·실측 단계·오류표시 모두 적용. 네이티브 모바일앱 해당 없음.

## 완료 조건

계약/양성·반례/실제 격리SQL 원자성/후속연도/동시확정/권한/실브라우저/전체ERP/빌드/CI/배포 모두 통과. 운영 데이터 수정은 시험에 사용하지 않는다.

## 구현 판정 기준

| 기준 | 원천·정규화 | 소비자/검증 |
|---|---|---|
| 수입부/영업지원/대표 | 로그인 서버 사용자, 수입4/7·지원2, 비활성/누락 역할 차단 | API/Store/Commit 공통 approvalPermissions, 누락/false/0 fixture |
| 업무 범위 | 저장된 요청의 명시 WarehouseKey+2026이후 연도+세부차수, 대상 SdateKey/ShipmentKey | normalizedCorrection, readIncomingApprovalFacts/prepareIncomingApproval을 GET/preview/locked commit 공유 |
| 수량 | 최종 OutUnit, 명시0=삭제, 누락/빈칸/boolean/음수 불가; 소수2자리 | normalizeApprovalMatching/buildApprovalDistributionPlan, 0/다른단위/감소·독립추가 fixture |
| 단가/금액 | 명시0 보존, native distributeUnits/amountVatFromCostEst, 동일단가만 상세에 반영/혼합단가 기존 보존 | preview/locked commit 같은 순수 계획, 날짜합계/상세금액/EXE 조인 readback |
| 상태/기본값 | draft→requested→applied, reject/cancel terminal; 매칭 기본 빈배열=기존분배보존 | payload revision CAS, request gate/원장 SHA 재검증, 완료와 ERP/audit 단일 커밋 |
| 농장 후보 | FARM_CANDIDATE_SCOPE_SQL 품목전체이력 + 승인입고가 반영된 예상 후보 | reader/preview/commit 공유, 명시 farm-only 연결 실제SQL fixture |
| 재고 | 입고 및 확정출고 signed delta, Product.Stock과 StockMaster/ProductStock 후속연도, 미확정 예약수량 | locked native V2/재계산/동일 트랜잭션 검산; 부족 자동보정 없음 |
| 신규 주문 | 기존보존, 누락 양수 대상만 명시 createOrder=true, 유효한 현재 주문마스터1개 | raw+ViewOrder preflight/locked 재검증, 전년도·0주문·중복 차단 |
| 보호 범위 | 원가/문서/확정손익 연결·기존농장배정 수량변경은 현 writer 지원 밖 | 전체 차단하고 이유 표시; 농장-only는 원가연결 보존하며 허용 |

메뉴 기준선: 화면틀/세로스크롤/1920·390/키보드/초점/선택맥락/초안·이력/전후확인 적용. 과거 이력 추측 생성 없음. 네이티브 모바일앱 해당 없음. 임베드 기존 입고의 넓은 표·명시 모달은 가로/내부 스크롤 예외. 원가 연결 정정은 범위 제한을 화면/세션/PR에 명시.
