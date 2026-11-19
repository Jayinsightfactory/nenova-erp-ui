// components/pm/ArchFlowChart.js
// 자가발전형 직원 업무 분석 · 자동화 솔루션 아키텍처 흐름도 (/my-work?tab=arch 및 /pm 공용).
// 규칙: __tests__/pmNoHexColor.test.js(#hex 금지) · __tests__/pmUiKit.test.js(UI 키트 사용) · __tests__/workflowReview.test.js(금지어 미사용) 준수.
import { useEffect, useState } from 'react';
import { Badge, Button, SelectCard, ToggleChip } from './ui';

const LOOPS = [
  {
    id: 'detail',
    no: '1',
    badge: '자기보강',
    tone: 'accent',
    title: '데이터 디테일 자가발전',
    summary: '빈칸·미확증 구간을 역방향 대조해 매칭 사전과 추출 정밀도를 스스로 끌어올립니다.',
    trigger: '일일 작업 기록·전산 DB 대조에서 확증% 하락 또는 미분류 구간 발견',
    engine: '전산/카톡/파일 근거 대조 → 키워드·거래처·품목 별칭 자동 확장 → 차기 프롬프트 반영',
    outcome: '직원별 워크플로우·소요시간·자동화 후보 해상도 지속 상승',
    beforeSteps: [
      '화면 제목·카톡 문구 누락 시 미확인/기타로 분류',
      '거래처·품목 표기 차이로 전산 기록과 연결 단절',
      '수동 보정 없이는 매일 같은 빈칸 반복',
    ],
    afterSteps: [
      '채택 장부(adoption-ledger)로 일일 확증%·파일% 자동 계측',
      '연결 실패 패턴을 추출해 사전·앵커·프롬프트에 자동 편입',
      '오류 한도/빈 응답 차단 가드로 기존 분석 자산 손실 방지',
    ],
    caseTitle: '실제 사례: 10명 일일 업무분석 자기보강 루프',
    caseDetail: '관찰 근거(화면 해독 · 전산 저장 · 카톡 · 엑셀 필드)를 4중 대조해 매 회차 미확인 지점을 줄이고, 한도·용량 초과 시 안전 예산 분할과 직전 유효본 보존으로 무중단 갱신.',
    tabTarget: 'workflows',
    tabLabel: '업무 흐름 보기',
  },
  {
    id: 'heal',
    no: '2',
    badge: '자가치유',
    tone: 'err',
    title: '실시간 로그 관제 · 자가치유',
    summary: '웹·수집기·API 오류 로그를 즉시 포착해 원인을 수정하고 재검증까지 완료합니다.',
    trigger: 'HTTP 413/500, 수집 스크립트 셀렉터 실패, 데이터 갱신 지연·정체 로그 발생',
    engine: '로그 원인 분석 → 가드/셀렉터/용량 제한 패치 → 즉시 재실행·GREEN 100점 검수 → 홈 요약 전파',
    outcome: '장애 방치 제로화 + 사장님 데스크톱 홈 「PM 라이브 확인」에 미해결 건만 즉시 노출',
    beforeSteps: [
      '수집 실패·업로드 413 오류 발생 시 다음 날까지 공백 방치',
      '오인 클릭이나 빈 조회가 실패로 오인되어 파이프라인 중단',
      '원인 파악과 재실행을 사람이 수동으로 반복 확인',
    ],
    afterSteps: [
      '수집 데몬·API 응답 로그를 상시 확인해 실패 원인 즉시 격리',
      '예: ECOUNT 셀렉터 오인 클릭/빈 행 정상처리 수정 후 775건 즉시 재수집',
      '유효성·회귀 가드 추가 후 데스크톱 「PM 라이브 확인」·오류관제 연동',
    ],
    caseTitle: '실제 사례: 이카운트 3화면 · 스토리보드 413 즉시 복구',
    caseDetail: '스토리보드 30MB 초과(413)에 크기 예산 분할(fitBudget) 적용, ECOUNT 구매현황 행 문자열 오인 클릭에 정확 셀렉터 보정 및 즉시 트리거(.run-once)로 100점 회복.',
    tabTarget: 'proposals',
    tabLabel: '기능 후보 보기',
  },
  {
    id: 'pipeline',
    no: '3',
    badge: '연쇄압축',
    tone: 'ok',
    title: '연속 파이프라인 압축 기획',
    summary: '여러 화면·앱을 순서대로 오가는 긴 작업 연쇄를 감지해 단일 원스톱 흐름으로 묶습니다.',
    trigger: '복수의 직무·화면이 고정 순서로 이어지며 파일 다운로드/복붙이 반복되는 체인 포착',
    engine: '앞 단계 산출물과 뒷 단계 입력 스키마 자동 결합 → 중간 수기 옮겨적기 제거 → 시간 단축 실측 시뮬레이션',
    outcome: '여러 화면을 건너뛰던 수작업을 네노바웹 단일 작업 흐름으로 통합 기획',
    beforeSteps: [
      '1단계: 인보이스(PDF/엑셀) 확인 후 품목·단가 대조',
      '2단계: 입고관리 화면에서 엑셀/수량 업로드',
      '3단계: 도착원가 계산·생성 후 파일 저장',
      '4단계: 카톡방 공유 및 구글 드라이브 폴더 업로드',
    ],
    afterSteps: [
      '1단계 인보이스 확정 데이터가 곧바로 입고·원가 입력으로 직결',
      '중간 파일 다운로드·재업로드·수동 대조 단계 제거',
      '도착원가 확정에 맞춰 카톡·드라이브 공유까지 원클릭 연계 기획',
    ],
    caseTitle: '대표 기획 사례: 수입 인보이스 → 입고 → 도착원가 → 공유 일괄 파이프라인',
    caseDetail: '인보이스 확인 → 입고 업로드 → 도착원가 생성 → 카톡/드라이브 업로드까지 4분절 작업을 하나의 연결된 파이프라인으로 재설계하여 누락·지연을 차단.',
    tabTarget: 'pipeline',
    tabLabel: '전체 파이프라인 보기',
  },
  {
    id: 'roundtrip',
    no: '4',
    badge: '우회제거',
    tone: 'warn',
    title: '왕복 우회동작(A→B→A) 흡수 설계',
    summary: '선행 등록 때문에 다른 화면으로 나갔다 돌아오는 왕복 패턴을 현재 화면에 흡수합니다.',
    trigger: '작업 A 중 미등록 대상 발견 → 화면 B 이동·생성 → 화면 A 복귀 재입력 루프 반복 관측',
    engine: 'B의 선행 조건(레코드 생성/연결)을 A의 입력·저장 트랜잭션에 원자적(Upsert)으로 결합 설계',
    outcome: '화면 이탈 없는 직관 처리(예: 분배 입력만으로 미등록 업체 주문 자동 생성)',
    beforeSteps: [
      '분배 화면(A) 작업 중 업체가 주문 목록에 없음을 발견',
      '주문등록 화면(B)으로 이동해 업체·주문을 수동 등록',
      '다시 분배 화면(A)으로 복귀·새로고침 후 수량 재입력',
    ],
    afterSteps: [
      '분배 화면(A)에서 업체 선택·분배 수량 입력 즉시 검사',
      '해당 주차 주문이 없으면 저장 트랜잭션 안에서 주문 헤더·상세 자동 생성(Upsert)',
      '기존 주문·재고 잠금 가드(dnSpy 기준)는 유지한 채 왕복 동작 완전 제거',
    ],
    caseTitle: '핵심 로직 설계: 분배 입력 → 미등록 업체 주문등록 자동 흡수',
    caseDetail: '출고 분배 시 주문등록 화면을 오가며 업체를 먼저 만들던 우회 루프를, 분배 저장 시점의 조건부 주문 자동생성 + 이력 기록 로직으로 단순화 설계.',
    tabTarget: 'erp',
    tabLabel: '전산 실제 처리 비교',
  },
];

const PIPELINE_NODES = [
  { key: 'collect', label: '1. 현장 관측', sub: 'PC 화면 · 창제목 · 카톡 · 전산DB' },
  { key: 'evolve', label: '2. 4대 자가발전 엔진', sub: '디테일 · 자가치유 · 연쇄압축 · 우회제거' },
  { key: 'design', label: '3. 로직·UX 자동 기획', sub: '시뮬레이션 · 전산 가드 · 안전 이식' },
  { key: 'deploy', label: '4. 웹·앱 반영 & 실측', sub: '네노바웹 · 데스크톱 · 시간 단축 재계측' },
];

const SCHEMA_LAYERS = [
  {
    id: 'erp',
    badge: 'Tier 1 · MSSQL 공유 원장',
    tone: 'accent',
    title: '전산(nenova.exe) ↔ 네노바웹 공유 ERP 스키마',
    rule: 'dnSpy · SQL 원장 정본 일치 필수 | 복합 업무키: OrderYear + OrderWeek + CustKey + ProdKey | SELECT 시 ISNULL(isDeleted,0)=0 적용',
    tables: [
      {
        name: 'Customer · Product · Flower · Country · Farm',
        pk: 'CustKey / ProdKey / FarmKey / CounKey',
        fk: 'Customer.CounKey, Product.FlowerName / CounName / FarmName',
        cols: 'ProdName(견적 고정), DisplayName(웹 표시), OutUnit(박스/단/송이), BunchOf1Box, SteamOf1Box, BoxWeight, BoxCBM, TariffRate',
        note: 'OutUnit이 수량 환산 기준. CustomerProdCost(AutoKey)는 CustKey+ProdKey 단가 연결.',
      },
      {
        name: 'OrderMaster → OrderDetail · OrderHistory · ViewOrder',
        pk: 'OrderMasterKey / OrderDetailKey',
        fk: 'CustKey, OrderMasterKey, ProdKey (OrderKey 컬럼 없음)',
        cols: 'OrderWeek(NN-NN), OrderDate, BoxQuantity / BunchQuantity / SteamQuantity(3종 모두 환산 저장), UnitPrice, Amount, Vat, isDeleted',
        note: 'OrderDetail 조회 시 Product.OutUnit CASE WHEN으로 1종 수량만 선택(3종 합산 금지).',
      },
      {
        name: 'ShipmentMaster → ShipmentDetail · ShipmentFarm · ViewShipment',
        pk: 'ShipmentKey / SdetailKey (소문자 d)',
        fk: 'CustKey(Master 기준), ShipmentKey, ProdKey (ShipmentMasterKey 없음)',
        cols: 'sm.isFix(1=매출 확정), OutQuantity(단일값·재환산 금지), EstQuantity, Box/Bunch/SteamQuantity(단일공식), Amount, Cost, Vat, Descr, sd.isFix(DetailFix)',
        note: 'ShipmentDetail에는 isDeleted 컬럼 없음(쿼리 금지). sd.CustKey NULL 정상이며 ViewShipment는 sm.CustKey 기준.',
      },
      {
        name: 'WarehouseMaster → WarehouseDetail · FreightCost · FreightCostDetail',
        pk: 'WarehouseKey / WdetailKey / FreightKey / DetailKey',
        fk: 'ProdKey, FreightCost.WarehouseKey(활성 1건), WarehouseDetailKey',
        cols: 'FarmName, InputDate, Box/Bunch/SteamQuantity, OutQuantity, EstQuantity, TPrice, WeightBasis(GW|CBM), ArrivalPerStem/Bunch',
        note: 'WarehouseDetail에도 isDeleted 컬럼 없음(WarehouseMaster.isDeleted=0으로만 필터).',
      },
      {
        name: 'ProductStock · StockMaster · StockHistory · Estimate · FarmCredit',
        pk: 'StockKey / StockMasterKey / EstimateKey / CreditKey',
        fk: 'OrderYear + OrderWeek, ProdKey, CustKey, ShipmentKey',
        cols: 'ProductStock.Stock(usp_StockCalculation 차수 스냅샷), StockMaster.isFix(0|1|2), FarmCredit(FarmName, OrderWeek, CreditUSD)',
        note: '매출·재고 계산은 OrderYear 포함 차수 단위로 격리(전년도 동일 차수 혼입 금지).',
      },
    ],
  },
  {
    id: 'web',
    badge: 'Tier 2 · MSSQL 웹 전용(Web*)',
    tone: 'ok',
    title: '네노바웹 전용 확장 스키마 (assertWebSchemaContract)',
    rule: 'nenova.exe 원장·SP 무변경 원칙 | GET 경로에서 CREATE/ALTER 런타임 DDL 금지 · 사전 마이그레이션 존재 검증만 수행',
    tables: [
      {
        name: 'WebProfitReport · WebCustoms* · WebStockPriceEvidence · ProfitWorkbookSnapshot*',
        pk: 'OrderYear + MajorWeek (+ ColKey/Category/SnapshotKey)',
        fk: 'assertWebSchemaContract: profit-report-inputs@2, profit-report-customs@3, profit-workbook@1',
        cols: 'WebCustomsRateConfig, WebCustomsWeekly, WebColombiaWeekly, WebForwardingWeekly, WebCustomsRateHistory, SnapshotRow(DataJson/ManualJson)',
        note: '재고 단가는 EvidenceStatus=VERIFIED 행만 사용하며 Product.Cost·도착원가 평균 fallback 금지.',
      },
      {
        name: 'WebArrivalCostImport · WebArrivalCostLine · WebArrivalCostHistory',
        pk: 'OrderYear + OrderWeek + CountryName (IsCurrent revision)',
        fk: 'ProdKey, FarmKey 매칭 스냅샷',
        cols: 'WeightBasis/배분기준(SOURCE|WEIGHT|VOLUME|VALUE|EQUAL), IsCurrent(0|1), 원본·선택 원가, 환율/GW/CW',
        note: '재업로드 시 이전 웹 행만 IsCurrent=0 처리. Product.Cost·Order·Shipment·Estimate 자동 변경 없음.',
      },
      {
        name: 'WebRaumPnl · WebRaumPnlItem · WebRaumCostPrice · WebPnlHotel* · WebRaumPnlSpecialNote',
        pk: 'PartnerCode(hotel_*) / PnlKey / ItemKey',
        fk: 'OrderYear + MajorWeek + PartnerCode (CustKey 매핑은 WebPnlHotelCustomerMap)',
        cols: 'CostPrice, CostSource, SalePrice, ProdKey, Revision(낙관적 동시성 잠금 409), NoteText',
        note: '라움·초이문 공통 매입단가 공유, 신라는 독립 스냅샷·Revision 잠금 검증.',
      },
      {
        name: 'WebSalesDefectDeduction* · WebFarmQuality* · WebPreShipment* · WebChinaVolume*',
        pk: 'DeductionKey / CaseKey / PlanKey / BoardKey',
        fk: 'OrderYear + OrderWeek + CustKey + ProdKey (명시 등록 시에만 Estimate 연결)',
        cols: 'WebSalesCarryoverApplication, WebFarmQualityInbox, WebPreShipmentSchedule/Allocation, WebChinaVolumeProductMap, RowVersion',
        note: '웹 작업본 저장만으로는 Order/Shipment/Stock 원장을 변경하지 않고 명시 실행·계약 경로로만 연결.',
      },
      {
        name: 'WebImportFarmPaymentDay · WebInvoice* · WebMappingStore · WebWorkflowReview',
        pk: 'FarmName / DocumentKey / StoreKey / ReviewKey',
        fk: 'OrderYear · WarehouseKey(인보이스) · ErpUserId(본인 확인)',
        cols: 'PaymentDay(5|15|25|30), WebInvoiceCostRevision/Line, MappingPayload+Revision, Verdict(ok|fix|reject)',
        note: 'WebWorkflowReview·WebMappingStore는 문서/계정 경계 안에서 트랜잭션 잠금으로만 갱신.',
      },
    ],
  },
  {
    id: 'runtime',
    badge: 'Tier 3 · 파일 JSON 스키마',
    tone: 'warn',
    title: '자가발전 · PM 관제 런타임 JSON 저장소 (data/runtime/*.json)',
    rule: 'MSSQL 무관 파일 전용 계층 | POST /api/work/feature-data-ingest → .tmp 쓰기 → fs.renameSync 원자 교체 → data/runtime 우선 조회',
    tables: [
      {
        name: 'work-feature-workflows.json (workflows) · adoption-ledger.json (adoption-ledger)',
        pk: 'name=workflows | adoption-ledger',
        fk: 'generatedAt / updatedAt(ISO 시각) + person.name',
        cols: 'people[].workflows[{ name, stage, trigger, stepsDetail, frequency, tools, pitfalls }], days[], 확증%, 근거건수(전산/파일/카톡)',
        note: '/my-work 업무 파이프라인·업무 흐름·도입 레이더 및 일반 직원 ?tab=mine 본문 데이터.',
      },
      {
        name: 'work-feature-proposals.json (proposals) · work-feature-simulations.json (simulations)',
        pk: 'name=proposals | simulations',
        fk: 'workflowRefs · menu · person.name',
        cols: 'proposals.rows[{ observed, proposal, menu }], items[{ before.steps, after.screen, after.steps, savingPerWeekMin }]',
        note: '기능 추가 후보(시뮬레이션) 탭에서 개선 전/후 단계별 단축 분(minute) 비교 구동.',
      },
      {
        name: 'work-feature-storyboards.json (storyboards) · work-feature-timesave.json (timesave)',
        pk: 'name=storyboards (28MB 예산 상한) | timesave (2MB 상한)',
        fk: 'who · session timestamp · corridor stage',
        cols: 'sessions[{ frames, captures, clicksTotal, erp }], corridor.perPerson, features[{ title, saveHoursPerWeek, menu }]',
        note: '캡처식 워크플로우 근거 장면과 /pm · 아키텍처 흐름도의 주간 시간 단축 계기판 공급.',
      },
      {
        name: 'work-feature-pm-office.json (pm-office) · manual-routines · live-pipelines · tech-radar',
        pk: 'name=pm-office (2MB 상한) | tech-radar (4MB) | import-lecture-<id>',
        fk: 'agents[].id · staff[].name · workLog',
        cols: 'agents, staff, tasks(미해결 오류 판정 pmUnresolved), workLog(부서간 넘김 사슬), live-pipelines',
        note: 'GET /api/pm/office 및 데스크톱 홈 「PM 라이브 확인」에 미해결 오류 제목 실시간 전달.',
      },
    ],
  },
];

const SCHEMA_INVARIANTS = [
  { key: 'PK 명명 고정', rule: 'OrderMasterKey (OrderKey 불가) · ShipmentKey (ShipmentMasterKey 불가) · SdetailKey (소문자 d)' },
  { key: '삭제 행 필터 분리', rule: 'Order*/Product/Customer 등은 ISNULL(isDeleted,0)=0, 반면 ShipmentDetail·WarehouseDetail은 컬럼 자체가 없음' },
  { key: '수량 환산 비대칭 주의', rule: 'OrderDetail 읽기는 OutUnit CASE WHEN 1개만 선택; ShipmentDetail OutQuantity는 단일값(추가 환산 금지)' },
  { key: '연도·확정 격리', rule: '업무키는 항상 OrderYear+OrderWeek+CustKey+ProdKey; 품종 확정은 ViewShipment.DetailFix(=sd.isFix) 기준' },
  { key: 'PK 채번·웹 스키마', rule: 'ERP 쓰기는 safeNextKey() UPDLOCK·HOLDLOCK 채번; Web* 테이블은 GET 런타임 DDL 금지(assertWebSchemaContract)' },
  { key: '런타임 JSON 무중단 교체', rule: 'lib/workFeatureData.saveFeatureFile(): 이름/상한(30MB·2MB)/JSON 검증 후 .tmp→renameSync 원자 교체' },
];

const HERMES_MODULES = [
  {
    id: 'fallback',
    metric: 'Claude ↔ Codex',
    tone: 'accent',
    title: '다중 에이전트 쿼터 폴백 라우터 (Multi-Provider Fallback)',
    source: 'hermes-manager.js · selectRunner()',
    detail: 'claude.exe 사용량 홀드(quota-hold)나 rate_limit 오류 발생 시 대기 중단 없이 codex.exe 폴백 경로로 자동 전환 배정합니다.',
  },
  {
    id: 'rescue',
    metric: 'JSONL 무손실 인계',
    tone: 'warn',
    title: '세션 구조 · 계보 인계 (Session Rescue & Lineage Adoption)',
    source: '~/.orbit/hermes-rescue/*.jsonl · adoptLineage()',
    detail: '중단·타임아웃·미완료 종료 세션을 즉시 JSONL로 보존하고, 재개 에이전트 프롬프트에 직전 PR/CHECK 문맥을 자동 인계합니다.',
  },
  {
    id: 'compress',
    metric: '워커 로그 91.1% 압축',
    tone: 'ok',
    title: '중간 턴 궤적 압축기 (Trajectory Compressor)',
    source: 'hermes-manager.js · compressTrajectory()',
    detail: '초기 지시(Head)와 최종 판정·VERDICT(Tail)는 보존하고 중간 대용량 로그를 요약 압축(실측 Orbit 워커 91.1% · 조사관 최대 32.8% 단축).',
  },
  {
    id: 'skills',
    metric: '97/97 SKILL.md',
    tone: 'accent',
    title: '절차 스킬 자가 합성 (Procedural Skill Synthesis)',
    source: 'hermes-skills/<id>/SKILL.md · syncSkills()',
    detail: '조사관이 해결한 playbooks.json 학습 카드 97건을 agentskills.io 표준 SKILL.md 절차 문서로 73ms 내 자동 변환·축적합니다.',
  },
  {
    id: 'lease',
    metric: '20분 정체 회수',
    tone: 'err',
    title: '진행 임대 점검 (Phase-Lease Watchdog)',
    source: 'hermes-manager.js · checkWatchdogLeases()',
    detail: '실행 중 에이전트의 로그 갱신 임대(20분) 및 최대 런타임(2시간)을 주기 점검하여 멈춘 작업을 회수하고 후속 인계를 트리거합니다.',
  },
];

const SOLUTION_BLUEPRINTS = [
  {
    id: 'master',
    no: '01',
    badge: '기준정보 설계',
    tone: 'accent',
    title: '품목 · 다중 포장단위 · 거래처별 단가 관리',
    tables: 'Product · Flower · Country · Farm · CustomerProdCost',
    whenToUse: '박스·단·송이처럼 다단계 포장 단위를 함께 쓰고, 견적서 영문명과 웹 한글명·거래처 전용 단가를 분리 관리할 때',
    designRule: '품목 마스터(환산계수 BunchOf1Box·SteamOf1Box 고정) + 분류 기본값(Flower 무게·부피·관세 fallback) + 거래처×품목 단가표(CustKey+ProdKey) 3단 분리',
    solutionMap: '화훼(국가·농장 · 박스/단/송이) ➔ 식자재·유통(원산지·공급사 · 박스/내포장팩/낱개EA) · 공산품(제조사 · 카톤/묶음/피스)',
    examples: [
      {
        item: '콜롬비아 장미 프리덤 50cm',
        tableKey: 'Product (ProdKey=1042)',
        values: "ProdName='ROSE FREEDOM 50CM'(견적 고정), DisplayName='콜롬비아 장미 프리덤 50'(웹 표시), OutUnit='단', BunchOf1Box=20, SteamOf1Box=500, BoxWeight=14.5, TariffRate=0.25",
        point: '1박스=20단=500송이 비율을 마스터에 고정해 전 화면 환산 기준으로 사용',
      },
      {
        item: '네덜란드 수국 매지컬 그린',
        tableKey: 'Product (ProdKey=2218)',
        values: "ProdName='HYDRANGEA MAGICAL GREEN', DisplayName='네덜란드 수국 그린', OutUnit='송이', BunchOf1Box=1, SteamOf1Box=30, BoxCBM=0.085",
        point: '부피(CBM) 기준 운임 배부 품목은 BoxCBM 필드로 원가 엔진과 연결',
      },
      {
        item: '유오디아 블랙잭',
        tableKey: 'CustomerProdCost (AutoKey · ProdKey=2226)',
        values: "OutUnit='박스', BunchOf1Box=10, SteamOf1Box=100 + CustKey=305 전용 단가 90,909원(VAT 9,091원)",
        point: '기본 품목 마스터를 복제하지 않고 거래처별 계약 단가만 교차 테이블로 분리',
      },
    ],
  },
  {
    id: 'order_ship',
    no: '02',
    badge: '주문·출고 설계',
    tone: 'ok',
    title: '주차별 주문 · 출고 분배 · 미등록 주문 자동흡수',
    tables: 'OrderMaster → OrderDetail · ShipmentMaster → ShipmentDetail',
    whenToUse: '차수(OrderYear+OrderWeek) 단위로 예약을 받고 실물 도착 물량을 거래처별로 배분·확정(isFix=1)해 매출로 집계할 때',
    designRule: '주문 상세는 3단위 동시 환산 저장(조회 시 OutUnit CASE WHEN 1개 선택), 출고 상세는 OutQuantity 단일값 저장(재환산 금지) + 상위 ShipmentMaster.CustKey 기준 귀속',
    solutionMap: '화훼 차수 분배 ➔ 청과·수산 경매 물량 배분 · 의류 시즌 프리오더 할당 · B2B 도매 차수 출고',
    examples: [
      {
        item: '[주문] 콜롬비아 장미 프리덤 50 (2박스 주문)',
        tableKey: "OrderDetail (OrderWeek='46-01', ProdKey=1042)",
        values: 'BoxQuantity=2, BunchQuantity=40, SteamQuantity=1000, UnitPrice=12000, Amount=480000',
        point: "OutUnit='단'이므로 조회 시 40단만 선택 표시(3종 합산 금지)",
      },
      {
        item: '[분배] 콜롬비아 장미 프리덤 50 (35단 실배정)',
        tableKey: 'ShipmentMaster(7071) → ShipmentDetail(SdetailKey=91820)',
        values: 'sm.CustKey=305, sm.isFix=1(매출 확정), OutQuantity=35(단일값), BoxQuantity=1.75, BunchQuantity=35, SteamQuantity=875, sd.isFix=1',
        point: 'ShipmentDetail은 isDeleted 컬럼이 없으며 OutQuantity를 다시 곱하지 않음',
      },
      {
        item: '[우회흡수] 유오디아 블랙잭 1박스 미등록 업체 즉시 분배',
        tableKey: '분배 저장 단일 트랜잭션 (Upsert)',
        values: 'OrderMaster + OrderDetail(ProdKey=2226, Box=1) + 빈 ShipmentMaster 선행 생성 → ShipmentDetail(OutQuantity=1)',
        point: '주문등록 화면을 다녀오는 A→B→A 왕복 없이 원장 헤더 계약을 원자적으로 충족',
      },
    ],
  },
  {
    id: 'import_cost',
    no: '03',
    badge: '수입·원가 설계',
    tone: 'warn',
    title: '해외 인보이스 입고 · 운임 배부 · 도착원가 산출',
    tables: 'WarehouseMaster/Detail · FreightCost/Detail · WebArrivalCostImport/Line',
    whenToUse: '해외 송장(USD/EUR) 물량을 입고 잡고 항공·해상 운임과 관세·통관비를 중량(GW) 또는 부피(CBM) 비율로 배부해 단당 원가를 계산할 때',
    designRule: '실물 입고 원장(Warehouse*)과 웹 원가 계산 리비전(WebArrivalCost*, IsCurrent=1 최신본)을 분리해 원장 훼손 없이 재업로드·비교 허용',
    solutionMap: '화훼 항공·해상 직수입 ➔ 와인·육류·커피생두·전자부품 직수입 도매의 Landed Cost(도착원가) 정산',
    examples: [
      {
        item: '[입고] 콜롬비아 장미 프리덤 50 (10박스 입고)',
        tableKey: 'WarehouseMaster(512) → WarehouseDetail',
        values: "FarmName='ELITE', InputDate='2026-11-16', ProdKey=1042, BoxQuantity=10, BunchQuantity=200, SteamQuantity=5000, TPrice=$1,800",
        point: 'WarehouseDetail은 상위 WarehouseMaster.isDeleted=0 기준으로만 유효 행 판별',
      },
      {
        item: '[운임배부] 프리덤 중량(GW) · 수국 부피(CBM)',
        tableKey: 'FreightCost → FreightCostDetail',
        values: "프리덤(WeightBasis='GW', 145kg × $6.0/kg + 관세 25%) / 수국 그린(WeightBasis='CBM', 0.085CBM 기준 배부)",
        point: '품목 특성에 따라 중량·부피·금액 배부 기준을 스키마 컬럼으로 분기',
      },
      {
        item: '[도착원가] 46-01차 콜롬비아 원가 확정본',
        tableKey: 'WebArrivalCostImport → WebArrivalCostLine',
        values: "OrderYear=2026, OrderWeek='46-01', CountryName='콜롬비아', IsCurrent=1 → 송이당 980원 / 단당 24,500원",
        point: '재계산 시 이전 웹 리비전만 IsCurrent=0 처리하고 Product.Cost 자동 덮어쓰기 방지',
      },
    ],
  },
  {
    id: 'stock_profit',
    no: '04',
    badge: '재고·정산 설계',
    tone: 'err',
    title: '차수 재고 스냅샷 · 불량 차감 · 주간 손익 마감',
    tables: 'StockMaster · ProductStock · WebStockPriceEvidence · WebSalesDefectDeduction · Estimate',
    whenToUse: '주차별 남은 재고 수량과 검증된 단가 근거로 매출이익을 확정하고, 파손·불량 클레임을 원장과 분리해 검토 후 차감할 때',
    designRule: '차수 스냅샷 재고(ProductStock) + 검증된 단가 근거(EvidenceStatus=VERIFIED만 채택) + 불량 검토대장(승인 시에만 Estimate 반영) 3중 안전장치',
    solutionMap: '화훼 주간 손익·클레임 ➔ 신선식품·화장품·의약외품 유통의 로트 재고평가·파손 차감·주간 마감',
    examples: [
      {
        item: '[재고스냅샷] 네덜란드 수국 그린 잔량 90송이',
        tableKey: 'StockMaster → ProductStock (StockKey=884)',
        values: "OrderYear=2026, OrderWeek='46-01', ProdKey=2218, Stock=90",
        point: '차수별 스냅샷 테이블로 보관해 전년도 동일 차수나 실시간 입출고와 섞이지 않음',
      },
      {
        item: '[단가근거] 수국 그린 기말재고 평가단가',
        tableKey: 'WebStockPriceEvidence',
        values: "OrderYear=2026, MajorWeek=46, ProdKey=2218, EvidenceStatus='VERIFIED', VerifiedUnitCost=4200",
        point: '미검증 상태일 때 임의 평균단가 추측을 막아 주간 매출이익 왜곡 원천 차단',
      },
      {
        item: '[불량차감] 콜롬비아 장미 프리덤 50 줄기파손 2단',
        tableKey: 'WebSalesDefectDeduction → Estimate',
        values: "OrderYear=2026, OrderWeek='46-01', CustKey=305, ProdKey=1042, DefectQty=2단",
        point: '웹 클레임 대장 접수와 실제 견적(Estimate) 음수 차감 실행을 분리해 오차감 방지',
      },
    ],
  },
];

const DEVICE_SUITE_SURFACES = [
  { key: 's1', title: '1. 현장 수집면', detail: 'Phone Harness · Nenova Kakao' },
  { key: 's2', title: '2. 브릿지 · 허브', detail: 'Device Hub · 데스크톱 사이드카' },
  { key: 's3', title: '3. 지능형 매칭', detail: 'Hermes 오케스트레이터' },
  { key: 's4', title: '4. 승인 게이트', detail: '네노바웹 승인 큐(WebDeviceWorkQueue)' },
  { key: 's5', title: '5. 시스템 원장', detail: 'ERP 원장' },
];

const DEVICE_SUITE_SESSIONS = [
  {
    id: 's1_phone_hub',
    no: '세션 1',
    badge: '모바일 관제 · 실행',
    tone: 'accent',
    title: 'Phone Harness & Device Hub',
    stack: 'VKCOM/devicehub · phone-harness · RapidOCR',
    role: 'VKCOM/devicehub(30~40fps 웹 화면 확인·Lease 독점 잠금·remoteConnectUrl) + phone-harness(Android adb uiautomator dump + Windows 로컬 RapidOCR 실행 계층)',
    coreArch: 'Android 11~14 공용폰·서브폰 표준화, FLAG_SECURE·보안키패드 시 Lease 반납 → 사람 10초 웹 개입(WAITING_HUMAN) → 에이전트 재개',
    safetyGuard: '패키지 화이트리스트(위챗 열람·카메라·SMS) 외 차단, 고위험 텍스트(송금·이체·결제·전송·보내기·삭제) 감지 시 즉시 Abort, 1대 카나리 48~72시간 검증 후 확대',
    schemaAndItems: 'WebDeviceLease(TTL 120~300초 독점) · 위챗 해외 농장 단톡방 단가표·물량 수집(답장·송금 클릭 원천 차단 Read-Only), 창고 현장 스마트폰 촬영본 즉시 adb pull → 입고 매칭 초안 생성',
    rolloutStage: 'Phase 1 · 사무실 카나리 공용폰 1대 + 창고 Wi-Fi ADB 촬영폰 1대 연결 및 30fps 원격 개입 검증',
  },
  {
    id: 's2_kakao_bridge',
    no: '세션 2',
    badge: '메신저 이중화',
    tone: 'ok',
    title: 'Nenova Kakao & 메신저 이중화',
    stack: 'nenovakakao · kakao_messages · dedup_key',
    role: '수집(Inbound)은 PC nenovakakao + 모바일 공기계 Dual-Path 무중단 이중화, 발송(Outbound)은 검증된 PC 단일 마스터 유지',
    coreArch: 'kakao_messages dedup_key = sha256(norm_room|norm_sender|minute_bucket|body_hash|idx) 및 ON CONFLICT DO UPDATE로 모바일 원본 사진 URL(media_urls) 무중복 병합',
    safetyGuard: '지정 업무방 화이트리스트(영업방·수입방·수입불량방 등)만 수집해 개인 1:1방 수집 원천 금지, 모바일 Outbound 차단, 09:00 보고 --dry-run 및 승인 게이트 준수',
    schemaAndItems: 'kakao_messages(channel, dedup_key, media_urls) · 수입방·위챗 발주/취소 원문 실시간 차수·품목군 대조 연결, 영업 불량 사진 즉시 확보 후 승인 시 WebSalesDefectDeduction DRAFT 적재',
    rolloutStage: 'Phase 1~2 · PC/모바일 dedup_key 일치율 검증 및 /incoming/kakao-summary DB 피드 · 불량 검토 대기열 연결',
  },
  {
    id: 's3_desktop_hub',
    no: '세션 3',
    badge: '데스크톱 로컬 브릿지',
    tone: 'warn',
    title: '데스크톱앱 로컬 디바이스 브릿지',
    stack: 'Electron · nenova-device-sidecar.exe · WSS 역터널',
    role: 'app.asar 외부 선택형 사이드카(nenova-device-sidecar.exe + 경량 adb)가 USB/LAN 폰을 자동 인식해 main.cjs 아웃바운드 WSS 역터널(wss://nenovaweb.com/api/device-hub/tunnel)로 중계(포트포워딩 불필요)',
    coreArch: '가이드 영상 해시 보호를 위해 shell.css·index.html 무변경 상태로 #pmLivePanel 하단에 기기 상태 카드 동적 마운트, 일반 사무직 PC에는 미설치(용량 영향 0)',
    safetyGuard: '127.0.0.1 루프백 + 32B Bearer 토큰 + icacls ACL 격리, lockAccount() 시 터널 즉시 차단, 초안 삽입만 허용(저장·확정 클릭 원천 차단)',
    schemaAndItems: 'data/runtime/device-hub-status.json · 홈 화면에서 수입부 공용폰 온라인 · 승인 대기 1건 확인 및 원클릭 화면 보기, 모바일 촬영 송장·파손 사진이 활성 탭 [data-device-draft] 초안 슬롯으로 즉시 전달',
    rolloutStage: 'Phase 1~2 · bootstrap deviceBridge 카나리 1대 활성 → USB/Wi-Fi 자동 페어링 및 초안 슬롯 실측',
  },
  {
    id: 's4_web_solution',
    no: '세션 4',
    badge: '웹 스키마 · 상용화',
    tone: 'err',
    title: '네노바웹 스키마 & 상용 솔루션 패키지',
    stack: 'WebDeviceNode · WebDeviceLease · WebDeviceWorkQueue',
    role: 'Tier 2 신규 스키마(WebDeviceNode, WebDeviceLease, WebDeviceWorkQueue) + Tier 3 런타임 피드(data/runtime/device-hub-status.json) + NOWLINK / MOYI 상용 패키지화',
    coreArch: 'ApprovedBy <> ProposedBy 승인 게이트와 ExpectedSnapshotJson 검증을 통과해야만 Tier 1 ERP 원장에 반영(원장 직접 오염 원천 차단)',
    safetyGuard: 'GET 경로 런타임 DDL 금지(assertWebSchemaContract), IdempotencyKey 중복 차단, 타임아웃 시 FAILED_UNKNOWN 동결로 이중 발주 방지',
    schemaAndItems: '① 위챗 콜롬비아 장미 프리덤 50cm 5박스 추가 발주 → WebDeviceWorkQueue(DRAFT→APPROVED) → OrderDetail 100단 반영 / ② 창고폰 네덜란드 수국 그린 파손 15송이 사진 → WebSalesDefectDeduction(DRAFT) → 승인 시 Estimate 음수 차감',
    rolloutStage: 'Phase 3~4 · 승인형 원장 반영 20건+ 무사고 검증 후 workspace_id 테넌트 격리 · Watch/Build/Team + Device Add-on 패키지 출시',
  },
];

const RUST_HOTPATHS = [
  {
    id: 'hermes_core',
    metric: '단일 정적 바이너리 · JS Fallback',
    tone: 'accent',
    title: 'hermes-core.exe (PM 대용량 로그 압축 · 해싱 가속기)',
    source: 'hermes-core.exe · JS Fallback 내장',
    detail: '수십 MB 스풀·데몬 로그의 Head/Tail 보존 압축 및 dedup_key SHA-256 대량 해싱을 단일 정적 바이너리(JS Fallback 내장)로 고속 처리합니다.',
  },
  {
    id: 'device_sidecar',
    metric: '3~5MB · 유휴 RAM < 10MB',
    tone: 'ok',
    title: 'nenova-device-sidecar.exe (데스크톱 로컬 디바이스 브릿지 · Rust/Tokio)',
    source: 'tokio · tokio-tungstenite · adb TCP',
    detail: '직원 PC에 80MB 런타임 없이 수 MB 단일 .exe로 배포되어 adb 감지·scrcpy 30fps 역터널 릴레이·유휴 메모리 10MB 미만을 유지합니다.',
  },
  {
    id: 'phash_filter',
    metric: '토큰 · 대역폭 절약',
    tone: 'warn',
    title: '캡처 · 스트림 바이트 필터 (pHash · 중복 프레임 차단)',
    source: 'pHash byte/hash pre-filter',
    detail: '화면 변화가 없는 정지 프레임을 바이트/해시 단계에서 즉시 걸러 비전 해독 토큰과 네트워크 대역폭을 절약합니다.',
  },
];

const VISION_MASTER_STAGES = [
  {
    id: 'p0',
    code: 'P0 · 사내 완성',
    tone: 'accent',
    title: '/pm 사내 자발 정착 & 핵심 자동화 폐루프',
    gate: '직원 70% 이상 주 2회 자발 접속 · 4주 연속 (W45 27% · W46 0% · W47 55%)',
    metrics: 'goals.json g01~g16 통합 관리 · Hermes 97/97 SKILL.md · Rust 389.5KB(3.04~4.36배 가속)',
    nextAction: '보상 루프(g02) 단일 PC 의존 해소 · Phone Harness 카나리 1대 연결(g14)',
  },
  {
    id: 'p1',
    code: 'P1 · 파트너 멀티테넌트',
    tone: 'ok',
    title: 'NOWLINK Watch / Build / Team + Device Add-on 상용 입주',
    gate: '유료 2개사 3개월 연속 유지(해지 0) + 보안 사고 0건',
    metrics: '테넌트 가드 968/998 · 교차접근 60/60 · 실행계층 226/226(g15)',
    nextAction: '코드서명 인증서(Trusted Signing/OV) · 클린 PC 설치 · 과금/DPA 확정',
  },
  {
    id: 'p2',
    code: 'P2 · 업종 라운지 · 번역',
    tone: 'warn',
    title: '회사 식별 차단 업종 라운지 · 직원 소유 프로필 · 글로벌 협업',
    gate: '예시: 외부 비고객 직원 100명 + 주간 라운지 30세션 (P1 말 확정)',
    metrics: '실명/익명 계정 분리 · 급여·인사평가 무관 명문화 · MOYI 채팅/번역 재사용',
    nextAction: '라운지 PoC(g10) 사장님 결정 · 민감어 마스킹 PoC(g08) · 국내 원본 거주 강제',
  },
  {
    id: 'p3',
    code: 'P3 · 검증 레시피 마켓',
    tone: 'err',
    title: '원본 데이터 제외 · 검증 절차/자동화 레시피 거래소',
    gate: '예시: 유료 레시피 거래 10건 + 분쟁 0건 · 법무 검토 선행 (P2 말 확정)',
    metrics: '라이브 매뉴얼(60건/10명) · 골 파이프라인(shadow.js) 원형 확보',
    nextAction: '타사 환경 재생 패키징(mapping.json 표준화) · 정산/판매 동의 체계 구축',
  },
];

const FEASIBILITY_CATEGORIES = [
  ['all', '전체 판정'],
  ['auto', '즉시 자동 가능'],
  ['conditional', '조건부 가능 (승인/우회)'],
  ['blocked', '불가능 · 절대 금지'],
  ['solved_today', '오늘 해결 전환'],
];

const FEASIBILITY_ITEMS = [
  {
    id: 'f_web_excel',
    verdict: 'auto',
    solvedToday: false,
    domain: '웹 ERP · 엑셀',
    title: '네노바웹 DOM 판독 · excel.check(G0) · shadow.js 모의검증',
    reason: 'Chrome UIA 4,750/5,210개 요소 식별 및 엑셀 75/108 시트 산술 앵커 자동 확인 완료',
    guardrail: '127.0.0.1 모의 서버 격리 · 원본 SHA-256 해시 보존 · 실서버 무접촉',
    source: 'EXEC_PATH.md · orbit-app-readability',
  },
  {
    id: 'f_dual_path',
    verdict: 'auto',
    solvedToday: true,
    domain: '업무방 메신저',
    title: 'Dual-Path(PC+모바일) 업무방 수신 & dedup_key 병합',
    reason: '오늘 Phone Harness + Device Hub 설계로 PC 잠금·18시·12장 사진 서랍 공백 해소',
    guardrail: '지정 업무방 화이트리스트 한정 · 모바일 Outbound 차단 · sha256 무중복 병합',
    source: 'session-02 · unified-device-work-solution',
  },
  {
    id: 'f_rust_hermes',
    verdict: 'auto',
    solvedToday: true,
    domain: '로그 · AI 루프',
    title: 'Rust 핫패스 압축/해싱 & Hermes 다중 에이전트 폴백',
    reason: 'hermes-core.exe(389.5KB, 3.04~4.36배 가속) + Claude↔Codex 폴백·JSONL 인계 구현',
    guardrail: 'JS Fallback 병행(HERMES_DISABLE_RUST=1) · 97/97 SKILL.md · 로그 91.1% 압축',
    source: 'hermes-manager.js · hermes-core-rs',
  },
  {
    id: 'f_sidecar_draft',
    verdict: 'auto',
    solvedToday: true,
    domain: '데스크톱 브릿지',
    title: 'Electron 외부 사이드카 WSS 역터널 & [data-device-draft] 초안 전달',
    reason: '아웃바운드 WSS 역터널 + 해시 무변경 홈 카드로 포트포워딩·모바일→PC 단절 해소',
    guardrail: '127.0.0.1 + 32B Bearer · lockAccount() 즉시 차단 · 저장/확정 버튼 자동 클릭 금지',
    source: 'session-03 · Desktop v1.3.40',
  },
  {
    id: 'f_tier2_tier3',
    verdict: 'auto',
    solvedToday: false,
    domain: '웹 스테이징 · 보고',
    title: 'Tier 2(Web*) · Tier 3 JSON 분리 저장 & 나에게 보내기 보고',
    reason: '공유 원장을 건드리지 않고 도착원가/클레임/유출 이력 및 1,200자 본인 카톡 보고 가능',
    guardrail: 'GET 런타임 DDL 금지 · .tmp→renameSync 원자 교체 · SELF_MEMO 수신자 고정',
    source: 'assertWebSchemaContract · kakao-report-mcp',
  },
  {
    id: 'f_erp_write',
    verdict: 'conditional',
    solvedToday: false,
    domain: '공유 ERP 원장',
    title: 'Tier 1 공유 원장 쓰기 (Order* · Shipment* · Estimate · Warehouse*)',
    reason: 'nenova.exe와 DB 공유 — 부분확정·음수재고·전년도 차수 혼입 위험으로 무승인 쓰기 불가',
    guardrail: 'OrderYear+OrderWeek+CustKey+ProdKey · ApprovedBy<>ProposedBy · 409 잠금 · verify:week',
    source: 'WebDeviceWorkQueue · NENOVA_WEB_COMPATIBILITY',
  },
  {
    id: 'f_exe_g5',
    verdict: 'conditional',
    solvedToday: false,
    domain: '데스크톱 EXE(G5)',
    title: 'nenova.exe (DevExpress WinForms) UI 제어 — 매회 승인 필수',
    reason: 'UIA 클릭 히트테스트 0/9(무명 Pane) 및 자동 되돌리기 불가로 G5 최고 주의 등급 적용',
    guardrail: '원본 해상도 VLM 판독 + 매 실행 사람 승인 필수 · 가능 시 네노바웹 API(G1)로 전환',
    source: 'TERMS_AUTOMATION_NOTE · orbit-app-readability',
  },
  {
    id: 'f_waiting_human',
    verdict: 'conditional',
    solvedToday: true,
    domain: '모바일 보안화면',
    title: 'FLAG_SECURE · 가상키패드 · 잠금 PIN · 위챗 슬라이더 대응',
    reason: 'OS 보안 및 안티봇 게이트 자동 돌파 불가 → 오늘 Device Hub WAITING_HUMAN 흐름으로 해결',
    guardrail: '에이전트 즉시 Lease 반납 → 30~40fps 웹 화면에서 담당자 10초 직접 해제 후 재개',
    source: 'session-01 · WebDeviceLease',
  },
  {
    id: 'f_wsl_finance',
    verdict: 'conditional',
    solvedToday: false,
    domain: 'WSL2 · 금융/서명',
    title: 'Windows Docker ADB, 하나은행 OTP·바로빌 인증서, Azure 서명',
    reason: 'WSL2 USB 패스스루 불가 · 은행 보안모듈/공동인증서(-31100) · 제3백신 예외 API 부재',
    guardrail: 'Host ADB(5037)/Edge Box · RapidOCR · 1회 OTP/간편조회 · Trusted Signing/OV · 수동 예외 보고',
    source: 'CODE_SIGNING · BAROBILL_API · hana-bank',
  },
  {
    id: 'f_chrome_store',
    verdict: 'conditional',
    solvedToday: false,
    domain: '확장 · 앱스토어',
    title: '비도메인 PC 웹 수집 & MOYI 스토어(iOS/Android/Web) 출시',
    reason: '비AD PC Chrome 강제확장 무시 · iOS Android 문구 금지 · Play 12명×14일 · Web inverted 반전',
    guardrail: 'UIA Document URL 판별 대체 · useInverted 플랫폼 분기 · OTA(eas update) 우선 배포',
    source: 'orbit-chrome-ext-forcelist · moyi-store',
  },
  {
    id: 'f_bank_auto',
    verdict: 'blocked',
    solvedToday: false,
    domain: '재무 · 자금',
    title: '은행 이체 자동실행 · 결제 · 급여/인사평가 · 무승인 원장 변경',
    reason: '금전 사고·법적 책임 경계 위반 및 원장 되돌리기 불가 — 상용 약관·모든 계층에서 원천 제외',
    guardrail: '조회·대사·초안(DRAFT) 생성만 허용, 실제 이체·결제·최종 확정은 사람이 직접 실행',
    source: 'TERMS_AUTOMATION_NOTE · NOWLINK_PRODUCT_PLAN',
  },
  {
    id: 'f_ecount_write',
    verdict: 'blocked',
    solvedToday: false,
    domain: '회계 ERP(ECOUNT)',
    title: '이카운트 쓰기(입력·수정·저장·삭제·전표) & OAPI 판매현황 Pull',
    reason: '회계 원장 오염 위험으로 조회 전용 절대 준수; OAPI에 기간별 판매현황 조회 endpoint 미존재',
    guardrail: 'prgId 화이트리스트+쓰기 abort 2중 가드 · 조회/엑셀 업로드 비교만(1건 TEST 삭제 검증 예외 제외)',
    source: 'feedback-ecount-readonly · ecount-oapi',
  },
  {
    id: 'f_captcha_av',
    verdict: 'blocked',
    solvedToday: false,
    domain: '보안 · 안티봇',
    title: '캡차 우회 · 은행 보안모듈 무력화 · 백신 탐지 회피 구현',
    reason: '약관·법규 위반 및 백신 오탐 회피는 ISMS/PIA 탈락과 악성코드 판정("제품 자살") 직결',
    guardrail: '공식 코드서명 · WAITING_HUMAN 사람 직접 입력 · IT 관리자 수동 예외 등록으로만 대응',
    source: 'nenova-solution-architecture · DAEMON_SURVIVAL',
  },
  {
    id: 'f_privacy_rooms',
    verdict: 'blocked',
    solvedToday: false,
    domain: '개인정보 · 노무',
    title: '개인방 수집(1:1/가족방) · 개인 웹 수집 · 직원 평가 어휘 · 라운지 역식별',
    reason: '통신비밀·개인정보보호법 리스크 및 직원 거부감 유발(실명/회사 신원 역식별 원천 차단 필요)',
    guardrail: '지정 업무방 화이트리스트 한정 · 직원 소유권 명문화 · 유출 이력은 관리자 전용 열람',
    source: 'PLAN.md · nenova-privacy-gate · workflowReview',
  },
  {
    id: 'f_os_limits',
    verdict: 'blocked',
    solvedToday: false,
    domain: 'OS · 인프라 한계',
    title: 'Windows 단독 iOS 미러링 · 카톡 PC UIA 읽기 · Drive 캡처 업로드 · Turbopack',
    reason: 'macOS 15+/Xcode 필수 · 카톡 UIA 4개 한계 · Drive 403 OOM(502) · Turbopack hydration 전멸 · Drive 빌드 락',
    guardrail: 'Android 11~14 표준화 · Phone Harness · Railway 스풀+CLI · webpack 고정 · 로컬 worktree 후 정리',
    source: 'session-01 · server-oom · turbopack-outage',
  },
  {
    id: 'f_sql_traps',
    verdict: 'blocked',
    solvedToday: false,
    domain: 'SQL · 금융 자격',
    title: 'ShipmentDetail/WarehouseDetail.isDeleted · autoStockAdd · 금결원 도매 단독가입',
    reason: '상세 테이블에 isDeleted 컬럼 부재(SQL 500), autoStockAdd 재고 부풀림, 도매업 KSIC 46xxx 오픈뱅킹 미해당',
    guardrail: '마스터(sm/wm) 필터 · STOCK_INTEGRITY_DESIGN 절차 준수 · 하나/신한 개별 채널 이용',
    source: 'shipmentdetail-no-isdeleted · openbanking-kftc',
  },
];

const ARCH_SECTIONS = [
  ['all', '전체 설계도'],
  ['loops', '1. 자가발전 루프'],
  ['hermes', '2. Hermes 관리'],
  ['schema', '3. 3계층 스키마'],
  ['blueprints', '4. 업종 청사진'],
  ['suite', '5. 디바이스 스위트'],
  ['rust', '6. Rust 핫패스'],
  ['vision', '7. 비전·가능/불가능'],
];

export default function ArchFlowChart({
  timesave = null,
  workflows = null,
  office = null,
  onSelectTab = null,
  mineOnly = false,
  compact = false,
}) {
  const [sectionFocus, setSectionFocus] = useState('all');
  const [selectedId, setSelectedId] = useState('pipeline');
  const [schemaView, setSchemaView] = useState('all');
  const [blueprintId, setBlueprintId] = useState('master');
  const [suiteSessionId, setSuiteSessionId] = useState('s1_phone_hub');
  const [visionPhaseId, setVisionPhaseId] = useState('p0');
  const [feasibilityFilter, setFeasibilityFilter] = useState('all');
  const [liveTs, setLiveTs] = useState(timesave);
  const [liveWf, setLiveWf] = useState(workflows);

  useEffect(() => {
    if (timesave) setLiveTs(timesave);
  }, [timesave]);

  useEffect(() => {
    if (workflows) setLiveWf(workflows);
  }, [workflows]);

  useEffect(() => {
    if (mineOnly) return undefined;
    let alive = true;
    if (!timesave) {
      fetch('/api/my-work/feature?name=timesave', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j?.success && j.data) setLiveTs(j.data);
        })
        .catch(() => {});
    }
    if (!workflows) {
      fetch('/api/my-work/feature?name=workflows', { credentials: 'same-origin' })
        .then((r) => (r.ok ? r.json() : null))
        .then((j) => {
          if (alive && j?.success && j.data) setLiveWf(j.data);
        })
        .catch(() => {});
    }
    return () => { alive = false; };
  }, [mineOnly, timesave, workflows]);

  const activeLoop = LOOPS.find((item) => item.id === selectedId) || LOOPS[0];
  const peopleCount = Array.isArray(liveWf?.people) ? liveWf.people.length : null;
  const workflowCount = Array.isArray(liveWf?.people)
    ? liveWf.people.reduce((sum, p) => sum + (Array.isArray(p.workflows) ? p.workflows.length : 0), 0)
    : null;
  const totals = liveTs?.totals || null;
  const topFeatures = Array.isArray(liveTs?.features) ? liveTs.features.slice(0, 4) : [];
  const unresolvedCount = Array.isArray(office?.tasks)
    ? office.tasks.filter((t) => /승인|3일|오류|실패|미완료/.test(String(t?.state || t?.title || ''))).length
    : null;
  const visibleLayers = schemaView === 'all' ? SCHEMA_LAYERS : SCHEMA_LAYERS.filter((layer) => layer.id === schemaView);
  const activeBlueprint = SOLUTION_BLUEPRINTS.find((bp) => bp.id === blueprintId) || SOLUTION_BLUEPRINTS[0];
  const activeSuiteSession = DEVICE_SUITE_SESSIONS.find((s) => s.id === suiteSessionId) || DEVICE_SUITE_SESSIONS[0];
  const activeVisionPhase = VISION_MASTER_STAGES.find((st) => st.id === visionPhaseId) || VISION_MASTER_STAGES[0];
  const filteredFeasibility = FEASIBILITY_ITEMS.filter((item) => {
    if (feasibilityFilter === 'all') return true;
    if (feasibilityFilter === 'solved_today') return item.solvedToday;
    return item.verdict === feasibilityFilter;
  });
  const autoCount = FEASIBILITY_ITEMS.filter((it) => it.verdict === 'auto').length;
  const condCount = FEASIBILITY_ITEMS.filter((it) => it.verdict === 'conditional').length;
  const blockedCount = FEASIBILITY_ITEMS.filter((it) => it.verdict === 'blocked').length;
  const solvedTodayCount = FEASIBILITY_ITEMS.filter((it) => it.solvedToday).length;
  const showSec = (key) => sectionFocus === 'all' || sectionFocus === key;

  return (
    <section
      className={`pm arch-root ${compact ? 'is-compact' : ''}`}
      data-testid="arch-flow-chart"
      aria-label="자가발전 솔루션 아키텍처 흐름도"
    >
      {/* 상단 기술 명세 헤더 & 1px 수직 구분선 KPI 스트립 */}
      <header className="arch-head">
        <div className="arch-head-main">
          <div className="arch-head-copy">
            <div className="arch-eyebrow">ARCHITECTURAL SPECIFICATION · SELF-EVOLVING WORK SUITE</div>
            <h2>직원 업무 관측 → 자가발전 · 자가치유 → 네노바웹 자동 반영 아키텍처</h2>
            <p className="arch-lede">
              화면·전산 기록의 빈칸을 메우는 4대 순환 엔진(1~4), Hermes 에이전트 오케스트레이션, 3계층 SQL 원장,
              업종 치환 청사진, 5-Surface 디바이스 스위트, Rust 단일 바이너리 핫패스 및 가능/불가능 경계를 한 장의 설계 원장으로 정리합니다.
            </p>
          </div>

          <div className="arch-kpi-strip" aria-label="아키텍처 주요 계측 지표">
            {peopleCount != null ? (
              <div className="arch-kpi-cell">
                <span>관찰 인원</span>
                <b className="arch-num">{peopleCount}명</b>
                <small className="arch-num">업무 {workflowCount}건 구조화</small>
              </div>
            ) : (
              <div className="arch-kpi-cell">
                <span>순환 엔진</span>
                <b className="arch-num">4대 루프</b>
                <small>관측 · 치유 · 압축 · 흡수</small>
              </div>
            )}
            {totals ? (
              <div className="arch-kpi-cell">
                <span>주간 활성 / 단축 후보</span>
                <b className="arch-num">{totals.activeHoursPerWeek}h → -{totals.saveHoursPerWeek}h</b>
                <small className="arch-num">주 {totals.assignedHoursPerWeek}h 업무 특정</small>
              </div>
            ) : (
              <div className="arch-kpi-cell">
                <span>데이터 계층</span>
                <b className="arch-num">3-Tier · 5-Surface</b>
                <small>MSSQL · Web* · JSON</small>
              </div>
            )}
            {unresolvedCount != null ? (
              <div className="arch-kpi-cell">
                <span>PM 관제 연결</span>
                <b className="arch-num">확인 필요 {unresolvedCount}건</b>
                <small>실시간 오류 · 정체 확인</small>
              </div>
            ) : (
              <div className="arch-kpi-cell">
                <span>Hermes · Rust 가속</span>
                <b className="arch-num">97 SKILL · 91.1%</b>
                <small className="arch-num">단일 바이너리 389.5KB</small>
              </div>
            )}
            <div className="arch-kpi-cell">
              <span>가능/불가능 경계</span>
              <b className="arch-num">{autoCount} 자동 · {condCount} 조건 · {blockedCount} 금지</b>
              <small className="arch-num">오늘 해결 전환 {solvedTodayCount}건</small>
            </div>
          </div>
        </div>

        {/* 섹션 탐색 바 */}
        <nav className="arch-sec-nav" aria-label="아키텍처 설계 섹션 선택">
          <span className="arch-nav-lbl">설계 영역</span>
          <div className="arch-schema-filters">
            {ARCH_SECTIONS.map(([id, label]) => (
              <ToggleChip
                key={id}
                on={sectionFocus === id}
                className={`arch-filter-chip ${sectionFocus === id ? 'is-active' : ''}`}
                onClick={() => setSectionFocus(id)}
              >
                {label}
              </ToggleChip>
            ))}
          </div>
        </nav>
      </header>

      {/* 1. 4단계 순환 파이프라인 다이어그램 & 4대 자가발전 엔진 좌우 스플릿 */}
      {showSec('loops') && (
        <section className="arch-section" aria-label="전체 아키텍처 연결도 및 4대 자가발전 루프">
          <div className="arch-sec-head">
            <div>
              <div className="arch-eyebrow">01 · CLOSED-LOOP PIPELINE &amp; 4 ENGINES</div>
              <h3>전체 순환 흐름도 &amp; 4대 자가발전 엔진 명세</h3>
            </div>
            <Badge tone="plain">Closed Loop · 4 Engines</Badge>
          </div>

          <div className="arch-diagram" role="region" aria-label="전체 아키텍처 단계 연결도">
            <div className="arch-nodes">
              {PIPELINE_NODES.map((node, idx) => (
                <div key={node.key} className="arch-node-wrap">
                  <div className={`arch-node arch-node-${node.key}`}>
                    <div className="arch-node-idx arch-num">STEP 0{idx + 1}</div>
                    <div className="arch-node-title">{node.label}</div>
                    <div className="arch-node-sub">{node.sub}</div>
                  </div>
                  {idx < PIPELINE_NODES.length - 1 && (
                    <div className="arch-arrow" aria-hidden="true">→</div>
                  )}
                </div>
              ))}
            </div>

            <svg className="arch-feedback-svg" viewBox="0 0 920 38" preserveAspectRatio="none" aria-hidden="true">
              <path
                d="M 830 2 L 830 22 L 90 22 L 90 8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeDasharray="5 4"
              />
              <polygon points="85,10 90,2 95,10" fill="currentColor" />
            </svg>
            <div className="arch-feedback-label">
              닫힌 피드백 루프(Closed Loop · Hermes 오케스트레이션): 반영 후 실측 단축 수치(timesave) · 확증% 변화 · SKILL.md 학습 자산을 다음 주기에 재투입
            </div>
          </div>

          {/* 좌우 스플릿 뷰: 왼쪽 4대 루프 선택 원장 + 오른쪽 상세 명세 & AS-IS/TO-BE 비교표 */}
          <div className="arch-split-layout">
            <div className="arch-split-rail" role="group" aria-label="4대 자가발전 루프 선택">
              <div className="arch-rail-head">4대 자가발전 엔진 목록</div>
              {LOOPS.map((loop) => {
                const active = loop.id === activeLoop.id;
                return (
                  <SelectCard
                    key={loop.id}
                    on={active}
                    pressed={active}
                    className={`arch-rail-item tone-${loop.tone} ${active ? 'is-on' : ''}`}
                    onClick={() => setSelectedId(loop.id)}
                  >
                    <div className="arch-rail-top">
                      <span className="arch-rail-no arch-num">LOOP 0{loop.no}</span>
                      <Badge className="arch-tag-badge" tone={loop.tone === 'err' ? 'warn' : 'plain'}>{loop.badge}</Badge>
                    </div>
                    <div className="arch-rail-title">{loop.title}</div>
                    <div className="arch-rail-sub">{loop.summary}</div>
                  </SelectCard>
                );
              })}
            </div>

            <article className="arch-split-pane" aria-live="polite">
              <div className="arch-detail-head">
                <div>
                  <div className="arch-eyebrow">LOOP 0{activeLoop.no} · {activeLoop.badge}</div>
                  <h4>{activeLoop.caseTitle}</h4>
                  <p>{activeLoop.caseDetail}</p>
                </div>
                {!mineOnly && onSelectTab && activeLoop.tabTarget && (
                  <Button className="arch-jump-btn" variant="primary" size="sm" onClick={() => onSelectTab(activeLoop.tabTarget)}>
                    {activeLoop.tabLabel} ↗
                  </Button>
                )}
              </div>

              <div className="arch-spec-strip">
                <div className="arch-spec-cell">
                  <b>감지 트리거 (Input)</b>
                  <span>{activeLoop.trigger}</span>
                </div>
                <div className="arch-spec-cell">
                  <b>자가발전 판단·설계 엔진</b>
                  <span>{activeLoop.engine}</span>
                </div>
                <div className="arch-spec-cell">
                  <b>시스템 반영 · 기대 결과 (Output)</b>
                  <span>{activeLoop.outcome}</span>
                </div>
              </div>

              <div className="arch-compare-strip">
                <div className="arch-col arch-before">
                  <div className="arch-col-title">AS-IS · 관측된 기존 수작업 / 오류</div>
                  <ol>
                    {activeLoop.beforeSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
                <div className="arch-col arch-after">
                  <div className="arch-col-title">TO-BE · 자가발전 압축 · 흡수 구조</div>
                  <ol>
                    {activeLoop.afterSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                </div>
              </div>

              {topFeatures.length > 0 && (
                <div className="arch-subledger">
                  <div className="arch-subledger-title">
                    실측 단축 상위 후보 ({liveTs?.generatedAt ? String(liveTs.generatedAt).slice(0, 10) : '최신'} 기준)
                  </div>
                  <div className="arch-table-wrap">
                    <table className="arch-ledger-table">
                      <thead>
                        <tr>
                          <th scope="col">기능 후보</th>
                          <th scope="col">대상 메뉴</th>
                          <th scope="col">주간 단축</th>
                        </tr>
                      </thead>
                      <tbody>
                        {topFeatures.map((feat, idx) => (
                          <tr key={feat.title + idx}>
                            <td className="arch-cell-strong">{feat.title}</td>
                            <td className="arch-cell-muted">{feat.menu || '-'}</td>
                            <td className="arch-num arch-cell-ok">주 {feat.saveHoursPerWeek}h 단축 후보</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </article>
          </div>
        </section>
      )}

      {/* 2. Hermes 에이전트 관리 · 자가학습 오케스트레이션 계층 */}
      {showSec('hermes') && (
        <section className="arch-section" data-testid="arch-hermes-section" aria-label="Hermes 에이전트 관리 및 자가학습 오케스트레이션">
          <div className="arch-sec-head">
            <div>
              <div className="arch-eyebrow">02 · AGENT ORCHESTRATION · NousResearch/hermes-agent</div>
              <h3>Hermes 에이전트 관리 · 자가학습 오케스트레이션 (<code>hermes-manager.js</code>)</h3>
              <p className="arch-lede">
                Claude · Codex · Antigravity 3-툴과 PM 조사관 루프를 하나로 묶어 한도 폴백, 세션 JSONL 인계, 궤적 압축, 절차 스킬 자동 합성을 수행합니다.
              </p>
            </div>
            <div className="arch-meta-strip">
              <span className="arch-meta-kv">
                <em>활성 엔진</em>
                <b className="arch-num">
                  {office?.hermes?.activeProvider || 'claude'}
                  {office?.hermes?.fallbackReady !== false ? ' (codex 폴백)' : ''}
                </b>
              </span>
              <span className="arch-meta-kv">
                <em>합성 스킬</em>
                <b className="arch-num">{office?.hermes?.skillsSynced ?? 97}건 SKILL.md</b>
              </span>
              <span className="arch-meta-kv">
                <em>압축 평균</em>
                <b className="arch-num">{office?.hermes?.avgCompressionPct ?? 91.1}%</b>
              </span>
            </div>
          </div>

          <div className="arch-flow-rail" role="region" aria-label="Hermes 에이전트 관리 흐름">
            <span><b>1. 실행 라우팅</b> <code>selectRunner</code> (Claude ↔ Codex)</span>
            <span className="arch-rail-sep" aria-hidden="true">→</span>
            <span><b>2. 진행 임대 점검</b> <code>checkWatchdogLeases</code></span>
            <span className="arch-rail-sep" aria-hidden="true">→</span>
            <span><b>3. 중단 구조/인계</b> <code>Session Rescue → Lineage</code></span>
            <span className="arch-rail-sep" aria-hidden="true">→</span>
            <span><b>4. 궤적 압축</b> <code>Head/Tail 보호</code></span>
            <span className="arch-rail-sep" aria-hidden="true">→</span>
            <span><b>5. 스킬 자가합성</b> <code>97 CARD → SKILL.md</code></span>
          </div>

          <div className="arch-table-wrap">
            <table className="arch-ledger-table">
              <thead>
                <tr>
                  <th scope="col">핵심 모듈</th>
                  <th scope="col">실측 지표</th>
                  <th scope="col">소스 · 함수</th>
                  <th scope="col">오케스트레이션 동작 명세</th>
                </tr>
              </thead>
              <tbody>
                {HERMES_MODULES.map((mod) => (
                  <tr key={mod.id}>
                    <td className="arch-cell-strong">{mod.title}</td>
                    <td className="arch-num">
                      <Badge className={`arch-tone-${mod.tone}`}>{mod.metric}</Badge>
                    </td>
                    <td><code className="arch-code">{mod.source}</code></td>
                    <td>{mod.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 3. SQL 원장 & 네노바웹 3계층 데이터 스키마 구조도 */}
      {showSec('schema') && (
        <section className="arch-section" aria-label="SQL 원장 및 네노바웹 데이터 스키마 구조도">
          <div className="arch-sec-head">
            <div>
              <div className="arch-eyebrow">03 · DATABASE &amp; DATA SCHEMA ARCHITECTURE</div>
              <h3>SQL 원장 &amp; 네노바웹 3계층 데이터 스키마 구조도</h3>
              <p className="arch-lede">
                전산(nenova.exe)과 공유하는 <b>MSSQL 핵심 원장</b>, 웹 확장을 격리 저장하는 <b>Web* 전용 SQL 스키마</b>,
                그리고 자가발전 분석·PM 관제가 사용하는 <b>data/runtime/*.json</b> 계층의 키·관계·불변 가드를 정리합니다.
              </p>
            </div>
            <div className="arch-schema-filters" role="group" aria-label="스키마 계층 필터">
              {[
                ['all', '전체 구조'],
                ['erp', '공유 MSSQL 원장'],
                ['web', '웹 전용 MSSQL (Web*)'],
                ['runtime', '런타임 JSON (data/runtime)'],
                ['invariants', '불변 가드 규칙'],
              ].map(([id, label]) => (
                <ToggleChip
                  key={id}
                  on={schemaView === id}
                  className={`arch-filter-chip ${schemaView === id ? 'is-active' : ''}`}
                  onClick={() => setSchemaView(id)}
                >
                  {label}
                </ToggleChip>
              ))}
            </div>
          </div>

          <div className="arch-schema-flow" role="region" aria-label="3계층 데이터 흐름 및 테이블 관계도">
            <div className="arch-sf-box tone-accent">
              <b>Tier 1 · 공유 MSSQL ERP 원장</b>
              <code>Customer(CustKey) ──▶ OrderMaster(OrderMasterKey) ──▶ OrderDetail</code>
              <code>Product(ProdKey) ────▶ ShipmentMaster(ShipmentKey) ─▶ ShipmentDetail(SdetailKey)</code>
              <code>WarehouseMaster(WarehouseKey) ─▶ WarehouseDetail(WdetailKey) · FreightCost</code>
              <small>모든 업무 쓰기는 OrderYear + OrderWeek + CustKey + ProdKey · dnSpy 정본 준수</small>
            </div>
            <div className="arch-sf-bridge" aria-hidden="true">
              <span>읽기 참조(JOIN)</span>
              <span>명시 계약 쓰기 ⇄</span>
            </div>
            <div className="arch-sf-box tone-ok">
              <b>Tier 2 · 웹 전용 MSSQL (Web*)</b>
              <code>WebProfitReport · WebCustoms* · WebStockPriceEvidence</code>
              <code>WebRaumPnl / Item · WebSalesDefectDeduction* · WebChinaVolume*</code>
              <code>WebPreShipment* · WebInvoice* · WebMappingStore · WebWorkflowReview</code>
              <small>GET 시 assertWebSchemaContract 읽기 검증 전용(런타임 DDL 금지)</small>
            </div>
            <div className="arch-sf-bridge" aria-hidden="true">
              <span>전산·웹 로그 대조</span>
              <span>산출물 업로드 ⇄</span>
            </div>
            <div className="arch-sf-box tone-warn">
              <b>Tier 3 · 런타임 JSON (data/runtime)</b>
              <code>POST /api/work/feature-data-ingest (.tmp → renameSync)</code>
              <code>workflows · proposals · simulations · storyboards · timesave</code>
              <code>adoption-ledger.json · pm-office · live-pipelines · tech-radar</code>
              <small>MSSQL 무관 원자적 파일 저장 · GET /api/my-work/feature · /api/pm/office 공급</small>
            </div>
          </div>

          {schemaView !== 'invariants' && (
            <div className="arch-schema-layers">
              {visibleLayers.map((layer) => (
                <div key={layer.id} className={`arch-tier-block tone-${layer.tone}`}>
                  <div className="arch-tier-head">
                    <div className="arch-tier-title-wrap">
                      <Badge className={`arch-tone-${layer.tone}`}>{layer.badge}</Badge>
                      <h4>{layer.title}</h4>
                    </div>
                    <div className="arch-layer-rule">{layer.rule}</div>
                  </div>
                  <div className="arch-table-wrap">
                    <table className="arch-ledger-table">
                      <thead>
                        <tr>
                          <th scope="col">테이블 · 저장소</th>
                          <th scope="col">Primary Key</th>
                          <th scope="col">FK · 계약 연결</th>
                          <th scope="col">핵심 컬럼 및 설계 가드</th>
                        </tr>
                      </thead>
                      <tbody>
                        {layer.tables.map((tbl) => (
                          <tr key={tbl.name}>
                            <td className="arch-cell-strong">{tbl.name}</td>
                            <td><code className="arch-code">{tbl.pk}</code></td>
                            <td><code className="arch-code">{tbl.fk}</code></td>
                            <td>
                              <div><code className="arch-code-plain">{tbl.cols}</code></div>
                              <div className="arch-cell-note">{tbl.note}</div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}

          {(schemaView === 'all' || schemaView === 'invariants') && (
            <div className="arch-subledger">
              <div className="arch-subledger-title">핵심 SQL · 스키마 불변 가드 (Invariants · docs/DB_STRUCTURE.md 기준)</div>
              <div className="arch-table-wrap">
                <table className="arch-ledger-table">
                  <thead>
                    <tr>
                      <th scope="col">가드 항목</th>
                      <th scope="col">불변 계약 규칙</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SCHEMA_INVARIANTS.map((item) => (
                      <tr key={item.key}>
                        <td className="arch-cell-strong">{item.key}</td>
                        <td>{item.rule}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* 4. 솔루션화 업무별 스키마 설계 청사진 & 실제 품목 데이터 예시 */}
      {showSec('blueprints') && (
        <section
          className="arch-section"
          data-testid="arch-solution-blueprints"
          aria-label="솔루션화 업무별 스키마 설계 및 품목 예시"
        >
          <div className="arch-sec-head">
            <div>
              <div className="arch-eyebrow">04 · DOMAIN SCHEMA BLUEPRINTS &amp; REAL ITEM DATA</div>
              <h3>솔루션화 업무별 스키마 설계 청사진 &amp; 실제 품목 데이터 예시</h3>
              <p className="arch-lede">
                화훼 ERP에서 검증된 기준정보·주문·수입·재고 테이블 설계를 타 업종 상용 솔루션으로도 바로 이식할 수 있도록
                핵심 설계 원리·치환 공식·실제 품목 저장 예시를 업무별로 정리했습니다.
              </p>
            </div>
            <Badge tone="plain">업종 치환 가능 4대 업무 모델</Badge>
          </div>

          <div className="arch-split-layout">
            <div className="arch-split-rail" role="group" aria-label="솔루션화 업무별 스키마 시나리오 선택">
              <div className="arch-rail-head">업무 청사진 모델</div>
              {SOLUTION_BLUEPRINTS.map((bp) => {
                const active = bp.id === activeBlueprint.id;
                return (
                  <SelectCard
                    key={bp.id}
                    on={active}
                    pressed={active}
                    className={`arch-rail-item tone-${bp.tone} ${active ? 'is-on' : ''}`}
                    onClick={() => setBlueprintId(bp.id)}
                  >
                    <div className="arch-rail-top">
                      <span className="arch-rail-no arch-num">BLUEPRINT {bp.no}</span>
                      <Badge className="arch-tag-badge" tone={bp.tone === 'err' ? 'warn' : 'plain'}>{bp.badge}</Badge>
                    </div>
                    <div className="arch-rail-title">{bp.title}</div>
                    <code className="arch-rail-code">{bp.tables}</code>
                  </SelectCard>
                );
              })}
            </div>

            <div className="arch-split-pane" aria-live="polite">
              <div className="arch-detail-head">
                <div>
                  <div className="arch-eyebrow">BLUEPRINT {activeBlueprint.no} · {activeBlueprint.badge}</div>
                  <h4>{activeBlueprint.title}</h4>
                </div>
                <code className="arch-code">{activeBlueprint.tables}</code>
              </div>

              <div className="arch-spec-strip">
                <div className="arch-spec-cell">
                  <b>언제 이 스키마를 쓰는가</b>
                  <span>{activeBlueprint.whenToUse}</span>
                </div>
                <div className="arch-spec-cell">
                  <b>핵심 테이블 · 키 설계 공식</b>
                  <span>{activeBlueprint.designRule}</span>
                </div>
                <div className="arch-spec-cell is-solution">
                  <b>타 업종 솔루션 치환 공식</b>
                  <span>{activeBlueprint.solutionMap}</span>
                </div>
              </div>

              <div className="arch-subledger">
                <div className="arch-subledger-title">
                  실제 품목 데이터 저장 예시 — {activeBlueprint.no} · {activeBlueprint.title}
                </div>
                <div className="arch-table-wrap">
                  <table className="arch-bp-table">
                    <thead>
                      <tr>
                        <th scope="col">품목 예시</th>
                        <th scope="col">저장 테이블 · 키</th>
                        <th scope="col">실제 컬럼 · 저장값 예시</th>
                        <th scope="col">솔루션 설계 포인트</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeBlueprint.examples.map((ex, idx) => (
                        <tr key={`${activeBlueprint.id}-${idx}`}>
                          <td data-label="품목 예시" className="arch-bp-cell-item">{ex.item}</td>
                          <td data-label="저장 테이블 · 키" className="arch-bp-cell-key"><code>{ex.tableKey}</code></td>
                          <td data-label="실제 컬럼 · 저장값 예시" className="arch-bp-cell-val"><code>{ex.values}</code></td>
                          <td data-label="솔루션 설계 포인트" className="arch-bp-cell-pt">{ex.point}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* 5. 멀티 디바이스 작업화 솔루션 및 부류별 세션 설계 */}
      {showSec('suite') && (
        <section
          className="arch-section"
          data-testid="arch-device-suite-section"
          aria-label="멀티 디바이스 작업화 솔루션 및 부류별 세션 설계"
        >
          <div className="arch-sec-head">
            <div>
              <div className="arch-eyebrow">05 · MULTI-DEVICE WORK SUITE · 5-SURFACE ARCHITECTURE</div>
              <h3>멀티 디바이스 작업화 솔루션 · 부류별(세션 1~4) 통합 설계</h3>
              <p className="arch-lede">
                모바일 공용폰·PC 카톡·데스크톱 사이드카에서 올라오는 비정형 업무를 원장 직접 오염 없이
                <code>WebDeviceWorkQueue</code> 승인 게이트로 연결하는 5-Surface 통합 구조입니다.
              </p>
            </div>
            <div className="arch-meta-strip">
              <Badge tone="plain">5-Surface · 4개 세션 선택 조회</Badge>
              {!mineOnly && onSelectTab && (
                <Button className="arch-jump-btn" variant="primary" size="sm" onClick={() => onSelectTab('suite-sim')}>
                  통합 모션 시뮬레이션 열기 ↗
                </Button>
              )}
            </div>
          </div>

          <div className="arch-flow-rail" role="region" aria-label="5-Surface 연결 흐름 바">
            {DEVICE_SUITE_SURFACES.map((surface, idx) => (
              <span key={surface.key} className="arch-surface-step">
                <b>{surface.title}</b> {surface.detail}
                {idx < DEVICE_SUITE_SURFACES.length - 1 && <span className="arch-rail-sep" aria-hidden="true">→</span>}
              </span>
            ))}
          </div>

          <div className="arch-split-layout">
            <div className="arch-split-rail" role="group" aria-label="부류별 세션 설계 선택">
              <div className="arch-rail-head">부류별 세션 (세션 1~4)</div>
              {DEVICE_SUITE_SESSIONS.map((sess) => {
                const active = sess.id === activeSuiteSession.id;
                return (
                  <SelectCard
                    key={sess.id}
                    on={active}
                    pressed={active}
                    className={`arch-rail-item tone-${sess.tone} ${active ? 'is-on' : ''}`}
                    onClick={() => setSuiteSessionId(sess.id)}
                  >
                    <div className="arch-rail-top">
                      <span className="arch-rail-no arch-num">{sess.no}</span>
                      <Badge className="arch-tag-badge" tone={sess.tone === 'err' ? 'warn' : 'plain'}>{sess.badge}</Badge>
                    </div>
                    <div className="arch-rail-title">{sess.title}</div>
                    <code className="arch-rail-code">{sess.stack}</code>
                  </SelectCard>
                );
              })}
            </div>

            <article className="arch-split-pane" aria-live="polite">
              <div className="arch-detail-head">
                <div>
                  <div className="arch-eyebrow">{activeSuiteSession.no} · {activeSuiteSession.badge}</div>
                  <h4>{activeSuiteSession.title}</h4>
                  <p>{activeSuiteSession.role}</p>
                </div>
                <code className="arch-code">{activeSuiteSession.stack}</code>
              </div>

              <div className="arch-quad-ledger">
                <div className="arch-quad-cell">
                  <b>핵심 구조</b>
                  <span>{activeSuiteSession.coreArch}</span>
                </div>
                <div className="arch-quad-cell is-guard">
                  <b>안전 가드</b>
                  <span>{activeSuiteSession.safetyGuard}</span>
                </div>
                <div className="arch-quad-cell is-solution">
                  <b>스키마 · 품목 작업화 예시</b>
                  <span>{activeSuiteSession.schemaAndItems}</span>
                </div>
                <div className="arch-quad-cell">
                  <b>도입 단계</b>
                  <span>{activeSuiteSession.rolloutStage}</span>
                </div>
              </div>
            </article>
          </div>
        </section>
      )}

      {/* 6. Rust 고효율 핫패스 자동 가속 계층 */}
      {showSec('rust') && (
        <section
          className="arch-section"
          data-testid="arch-rust-hotpaths"
          aria-label="Rust 고효율 핫패스 자동 가속 계층"
        >
          <div className="arch-sec-head">
            <div>
              <div className="arch-eyebrow">06 · RUST NATIVE HOTPATHS · ZERO-RUNTIME SINGLE BINARY</div>
              <h3>Rust 고효율 핫패스 자동 가속 계층 (<code>hermes-core.exe</code> · <code>nenova-device-sidecar.exe</code>)</h3>
              <p className="arch-lede">
                상주 사이드카·대용량 스풀 로그 압축·실시간 프레임 필터만 단일 정적 Rust 바이너리로 전환해 80MB 런타임 부담과 GC 멈춤을 제거합니다.
              </p>
            </div>
            <div className="arch-meta-strip">
              <Badge tone={office?.hermes?.rustAccelerator?.enabled ? 'ok' : 'plain'}>
                {office?.hermes?.rustAccelerator?.enabled ? 'Rust 가속 활성' : 'Rust 핫패스 설계·적용'}
              </Badge>
              <Badge tone="plain">JS Fallback 자동 호환</Badge>
            </div>
          </div>

          <div className="arch-table-wrap">
            <table className="arch-ledger-table">
              <thead>
                <tr>
                  <th scope="col">바이너리 · 핫패스 모듈</th>
                  <th scope="col">규격 · 성능</th>
                  <th scope="col">크레이트 · 경로</th>
                  <th scope="col">처리 역할 및 무중단 Fallback</th>
                </tr>
              </thead>
              <tbody>
                {RUST_HOTPATHS.map((hp) => (
                  <tr key={hp.id}>
                    <td className="arch-cell-strong">{hp.title}</td>
                    <td className="arch-num"><Badge className={`arch-tone-${hp.tone}`}>{hp.metric}</Badge></td>
                    <td><code className="arch-code">{hp.source}</code></td>
                    <td>{hp.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="arch-rule-callout">
            <b>과잉 설계 방지 경계 (Rust vs JS/TS)</b>
            <span>
              웹 UI(Next.js)·비즈니스 규칙·일반 SQL API는 생산성을 위해 JS/TS를 유지하고, CPU·상주 메모리·단일 배포 이득이 확실한 핫패스에만 Rust + JS Fallback을 자동 적용합니다.
            </span>
          </div>
        </section>
      )}

      {/* 7. 솔루션 마스터 목표 & 현실적 가능 · 불가능 판정 기준표 */}
      {showSec('vision') && (
        <section
          className="arch-section"
          data-testid="arch-vision-feasibility"
          aria-label="솔루션 마스터 목표 및 현실적 가능 · 불가능 판정 기준표"
        >
          <div className="arch-sec-head">
            <div>
              <div className="arch-eyebrow">07 · MASTER SOLUTION VISION &amp; FEASIBILITY MATRIX</div>
              <h3>솔루션 마스터 목표 &amp; 현실적 가능 · 불가능 판정 기준표</h3>
              <p className="arch-lede">
                제품 비전(P0~P3 · NOWLINK Watch/Build/Team)의 단계별 통과 관문과, 실제 운영에서 검증한
                즉시 자동 가능 · 조건부 가능 · 불가능(절대 금지) 경계 및 오늘 해결 전환 항목을 대조합니다.
              </p>
            </div>
            <div className="arch-meta-strip">
              <Badge tone="ok" className="arch-num">즉시 자동 {autoCount}건</Badge>
              <Badge tone="warn" className="arch-num">조건부 {condCount}건</Badge>
              <Badge tone="plain" className="arch-num">불가능·금지 {blockedCount}건</Badge>
              <Badge tone="plain" className="arch-num">오늘 해결 {solvedTodayCount}건</Badge>
            </div>
          </div>

          <div className="arch-split-layout">
            <div className="arch-split-rail" role="group" aria-label="상용 솔루션 단계별 마스터 목표 선택">
              <div className="arch-rail-head">솔루션 단계 (P0~P3)</div>
              {VISION_MASTER_STAGES.map((stage) => {
                const active = stage.id === activeVisionPhase.id;
                return (
                  <SelectCard
                    key={stage.id}
                    on={active}
                    pressed={active}
                    className={`arch-rail-item tone-${stage.tone} ${active ? 'is-on' : ''}`}
                    onClick={() => setVisionPhaseId(stage.id)}
                  >
                    <div className="arch-rail-top">
                      <span className="arch-rail-no arch-num">{stage.code}</span>
                      <Badge className="arch-tag-badge" tone={stage.tone === 'ok' ? 'ok' : stage.tone === 'err' ? 'warn' : 'plain'}>
                        관문 기준
                      </Badge>
                    </div>
                    <div className="arch-rail-title">{stage.title}</div>
                    <div className="arch-rail-sub arch-num">{stage.gate}</div>
                  </SelectCard>
                );
              })}
            </div>

            <div className="arch-split-pane" aria-live="polite">
              <div className="arch-detail-head">
                <div>
                  <div className="arch-eyebrow">{activeVisionPhase.code}</div>
                  <h4>{activeVisionPhase.title}</h4>
                </div>
              </div>
              <div className="arch-spec-strip">
                <div className="arch-spec-cell">
                  <b>선택 단계 관문 ({activeVisionPhase.code})</b>
                  <span className="arch-num">{activeVisionPhase.gate}</span>
                </div>
                <div className="arch-spec-cell is-solution">
                  <b>현재 확보 자산 · 실측 수치</b>
                  <span className="arch-num">{activeVisionPhase.metrics}</span>
                </div>
                <div className="arch-spec-cell is-guard">
                  <b>다음 우선 착수 과제</b>
                  <span>{activeVisionPhase.nextAction}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="arch-vf-toolbar">
            <div className="arch-subledger-title arch-num">
              현실적 가능 · 조건부 · 불가능 판정 원장 ({filteredFeasibility.length} / {FEASIBILITY_ITEMS.length}건)
            </div>
            <div className="arch-schema-filters" role="group" aria-label="실현 가능성 분류 필터">
              {FEASIBILITY_CATEGORIES.map(([id, label]) => (
                <ToggleChip
                  key={id}
                  on={feasibilityFilter === id}
                  className={`arch-filter-chip ${feasibilityFilter === id ? 'is-active' : ''}`}
                  onClick={() => setFeasibilityFilter(id)}
                >
                  {label}
                </ToggleChip>
              ))}
            </div>
          </div>

          <div className="arch-table-wrap">
            <table className="arch-bp-table">
              <thead>
                <tr>
                  <th scope="col">판정 · 영역</th>
                  <th scope="col">대상 기능 · 기술 항목</th>
                  <th scope="col">판정 근거 및 제약 한계</th>
                  <th scope="col">허용 대안 · 안전 가드 · 출처</th>
                </tr>
              </thead>
              <tbody>
                {filteredFeasibility.map((row) => {
                  const badgeLabel = row.verdict === 'auto'
                    ? '즉시 자동 가능'
                    : row.verdict === 'conditional'
                      ? '조건부 가능'
                      : '불가능 · 금지';
                  const badgeTone = row.verdict === 'auto'
                    ? 'ok'
                    : row.verdict === 'conditional'
                      ? 'warn'
                      : 'plain';
                  return (
                    <tr key={row.id} className={`arch-vf-row is-${row.verdict}`}>
                      <td data-label="판정 · 영역" className="arch-vf-cell-status">
                        <div className="arch-vf-badges">
                          <Badge tone={badgeTone}>{badgeLabel}</Badge>
                          {row.solvedToday && (
                            <Badge tone="plain">오늘 해결 전환</Badge>
                          )}
                        </div>
                        <div className="arch-vf-domain">{row.domain}</div>
                      </td>
                      <td data-label="대상 기능 · 기술 항목" className="arch-bp-cell-item">{row.title}</td>
                      <td data-label="판정 근거 및 제약 한계" className="arch-vf-cell-reason">{row.reason}</td>
                      <td data-label="허용 대안 · 안전 가드 · 출처" className="arch-bp-cell-pt">
                        <div>{row.guardrail}</div>
                        <code className="arch-vf-src">{row.source}</code>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <style jsx>{`
        .arch-root {
          --arch-bg: rgb(248, 250, 252);
          --arch-surface: rgb(255, 255, 255);
          --arch-surface-2: rgb(241, 245, 249);
          --arch-ink: rgb(15, 23, 42);
          --arch-muted: rgb(71, 85, 105);
          --arch-line: rgb(226, 232, 240);
          --arch-line-strong: rgb(203, 213, 225);
          --arch-accent: rgb(29, 78, 216);
          --arch-accent-tint: rgb(239, 246, 255);
          --arch-ok: rgb(21, 128, 61);
          --arch-ok-bg: rgb(220, 252, 231);
          --arch-warn: rgb(180, 83, 9);
          --arch-warn-bg: rgb(254, 243, 199);
          --arch-err: rgb(185, 28, 28);
          --arch-err-bg: rgb(254, 226, 226);
          --pmk-primary: var(--arch-accent);
          --pmk-primary-hover: rgb(30, 64, 175);
          --pmk-primary-down: rgb(30, 58, 138);
          --pmk-primary-ink: rgb(255, 255, 255);
          --pmk-sec-bg: var(--arch-surface);
          --pmk-sec-hover: var(--arch-surface-2);
          --pmk-sec-ink: var(--arch-ink);
          --pmk-sec-border: var(--arch-line-strong);
          --pmk-chip-bg: var(--arch-surface);
          --pmk-chip-ink: var(--arch-muted);
          --pmk-on-bg: var(--arch-accent);
          --pmk-on-ink: rgb(255, 255, 255);
          --pmk-ink: var(--arch-ink);
          --pmk-link: var(--arch-accent);
          --pmk-tab-ink: var(--arch-muted);
          --pmk-tab-on: var(--arch-accent);
          --pmk-focus: var(--arch-accent);
          --pmk-radius: 4px;
          --pmk-shadow: none;
          --arch-font: 'Pretendard Variable', 'Pretendard', -apple-system, BlinkMacSystemFont, 'Malgun Gothic', '맑은 고딕', 'Segoe UI', sans-serif;
          font-family: var(--pm-font, var(--arch-font));
          font-size: 13.5px;
          line-height: 1.5;
          font-variant-numeric: tabular-nums;
          background: var(--arch-bg);
          color: var(--arch-ink);
          padding: 18px 22px 44px;
          max-width: 1440px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
          box-sizing: border-box;
        }
        .arch-root * {
          box-sizing: border-box;
        }
        .arch-root.is-compact {
          padding: 14px 16px 20px;
          max-width: none;
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 6px;
          margin-bottom: 12px;
        }
        .arch-num {
          font-variant-numeric: tabular-nums;
        }
        .arch-root :global(.pmk) {
          font: inherit;
          cursor: pointer;
          box-shadow: none;
        }
        .arch-root :global(.pmk:focus-visible) {
          outline: 2px solid var(--arch-accent);
          outline-offset: 2px;
        }
        .arch-root :global(.badge) {
          display: inline-flex;
          align-items: center;
          border: 1px solid var(--arch-line-strong);
          background: var(--arch-surface-2);
          color: var(--arch-muted);
          border-radius: 4px;
          padding: 2px 8px;
          font-size: 12.5px;
          font-weight: 700;
          line-height: 1.5;
          white-space: nowrap;
        }
        .arch-root :global(.badge.ok),
        .arch-root :global(.arch-tone-ok) {
          background: var(--arch-ok-bg);
          color: var(--arch-ok);
          border-color: rgba(21, 128, 61, 0.28);
        }
        .arch-root :global(.badge.warn),
        .arch-root :global(.arch-tone-warn) {
          background: var(--arch-warn-bg);
          color: var(--arch-warn);
          border-color: rgba(180, 83, 9, 0.28);
        }
        .arch-root :global(.arch-tone-err) {
          background: var(--arch-err-bg);
          color: var(--arch-err);
          border-color: rgba(185, 28, 28, 0.28);
        }
        .arch-root :global(.arch-tone-accent) {
          background: var(--arch-accent-tint);
          color: var(--arch-accent);
          border-color: rgba(29, 78, 216, 0.28);
        }
        .arch-head {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 6px;
          display: flex;
          flex-direction: column;
        }
        .arch-head-main {
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .arch-eyebrow {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--arch-accent);
          margin-bottom: 4px;
        }
        .arch-head h2 {
          margin: 0 0 6px;
          font-size: 20px;
          font-weight: 700;
          letter-spacing: -0.01em;
          line-height: 1.35;
          color: var(--arch-ink);
        }
        .arch-lede {
          margin: 0;
          color: var(--arch-muted);
          font-size: 14px;
          line-height: 1.6;
          max-width: 84ch;
        }
        .arch-lede code,
        .arch-sec-head h3 code {
          font-family: var(--arch-font);
          font-variant-numeric: tabular-nums;
          font-size: 13px;
          font-weight: 600;
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 3px;
          padding: 1px 6px;
          color: var(--arch-accent);
        }
        .arch-kpi-strip {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          background: var(--arch-surface-2);
          overflow: hidden;
        }
        .arch-kpi-cell {
          padding: 10px 14px;
          border-right: 1px solid var(--arch-line);
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .arch-kpi-cell:last-child {
          border-right: 0;
        }
        .arch-kpi-cell span {
          font-size: 12.5px;
          font-weight: 600;
          color: var(--arch-muted);
        }
        .arch-kpi-cell b {
          font-size: 16px;
          font-weight: 700;
          color: var(--arch-ink);
          line-height: 1.3;
        }
        .arch-kpi-cell small {
          font-size: 12.5px;
          color: var(--arch-accent);
        }
        .arch-sec-nav {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 8px 12px;
          padding: 10px 18px;
          border-top: 1px solid var(--arch-line);
          background: var(--arch-surface-2);
        }
        .arch-nav-lbl {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--arch-muted);
          white-space: nowrap;
        }
        .arch-section {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 6px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .arch-sec-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          flex-wrap: wrap;
          border-bottom: 1px solid var(--arch-line);
          padding-bottom: 10px;
        }
        .arch-sec-head h3 {
          margin: 0 0 4px;
          font-size: 17px;
          font-weight: 700;
          color: var(--arch-ink);
        }
        .arch-schema-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        :global(.arch-filter-chip) {
          background: var(--arch-surface) !important;
          color: var(--arch-muted) !important;
          border: 1px solid var(--arch-line-strong) !important;
          border-radius: 4px !important;
          padding: 5px 11px !important;
          min-height: 30px !important;
          font-size: 13px !important;
          font-weight: 600 !important;
        }
        :global(.arch-filter-chip:hover) {
          border-color: var(--arch-ink) !important;
          color: var(--arch-ink) !important;
        }
        :global(.arch-filter-chip.is-active) {
          background: var(--arch-accent-tint) !important;
          color: var(--arch-accent) !important;
          border-color: var(--arch-accent) !important;
          font-weight: 700 !important;
        }
        :global(.arch-jump-btn) {
          background: var(--arch-accent) !important;
          color: rgb(255, 255, 255) !important;
          border: 1px solid var(--arch-accent) !important;
          border-radius: 4px !important;
          padding: 6px 12px !important;
          min-height: 32px !important;
          font-size: 13px !important;
          font-weight: 700 !important;
          white-space: nowrap;
        }
        :global(.arch-jump-btn:hover) {
          background: rgb(30, 64, 175) !important;
          border-color: rgb(30, 64, 175) !important;
        }
        .arch-diagram {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          padding: 14px 16px 10px;
        }
        .arch-nodes {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
          align-items: stretch;
        }
        .arch-node-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 0;
        }
        .arch-node {
          flex: 1 1 auto;
          min-width: 0;
          background: var(--arch-surface);
          border: 1px solid var(--arch-line-strong);
          border-left: 3px solid var(--arch-accent);
          border-radius: 4px;
          padding: 9px 11px;
        }
        .arch-node-evolve { border-left-color: var(--arch-warn); }
        .arch-node-design { border-left-color: var(--arch-ok); }
        .arch-node-deploy { border-left-color: var(--arch-ink); }
        .arch-node-idx {
          font-size: 12px;
          font-weight: 700;
          color: var(--arch-muted);
          margin-bottom: 2px;
        }
        .arch-node-title {
          font-weight: 700;
          font-size: 14px;
          color: var(--arch-ink);
          margin-bottom: 3px;
        }
        .arch-node-sub {
          font-size: 12.5px;
          color: var(--arch-muted);
          line-height: 1.5;
        }
        .arch-arrow {
          flex: 0 0 auto;
          font-size: 15px;
          font-weight: 700;
          color: var(--arch-accent);
        }
        .arch-feedback-svg {
          width: 100%;
          height: 30px;
          color: var(--arch-accent);
          display: block;
          margin-top: 4px;
        }
        .arch-feedback-label {
          text-align: center;
          font-size: 12.5px;
          color: var(--arch-muted);
          margin-top: -2px;
        }
        /* 좌우 스플릿 워크벤치 (카드 그리드 대신 단일 통합 레일 + 상세 패널) */
        .arch-split-layout {
          display: grid;
          grid-template-columns: 330px minmax(0, 1fr);
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          background: var(--arch-surface);
          overflow: hidden;
        }
        .arch-split-rail {
          display: flex;
          flex-direction: column;
          border-right: 1px solid var(--arch-line);
          background: var(--arch-surface-2);
        }
        .arch-rail-head {
          padding: 8px 12px;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--arch-muted);
          border-bottom: 1px solid var(--arch-line);
          letter-spacing: 0.03em;
        }
        :global(.arch-rail-item) {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          text-align: left;
          gap: 4px;
          width: 100%;
          padding: 11px 12px !important;
          border: 0 !important;
          border-bottom: 1px solid var(--arch-line) !important;
          border-left: 3px solid transparent !important;
          border-radius: 0 !important;
          background: transparent !important;
          color: var(--arch-ink) !important;
          height: auto !important;
        }
        :global(.arch-rail-item:last-child) {
          border-bottom: 0 !important;
        }
        :global(.arch-rail-item:hover) {
          background: var(--arch-surface) !important;
        }
        :global(.arch-rail-item.is-on) {
          background: var(--arch-surface) !important;
          border-left-color: var(--arch-accent) !important;
        }
        .arch-rail-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
        }
        .arch-rail-no {
          font-size: 12px;
          font-weight: 700;
          color: var(--arch-accent);
        }
        .arch-rail-title {
          font-size: 14px;
          font-weight: 700;
          color: var(--arch-ink);
          line-height: 1.4;
        }
        .arch-rail-sub {
          font-size: 12.5px;
          color: var(--arch-muted);
          line-height: 1.45;
        }
        .arch-rail-code {
          font-family: var(--arch-font);
          font-variant-numeric: tabular-nums;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--arch-accent);
          overflow-wrap: anywhere;
        }
        .arch-split-pane {
          padding: 14px 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-width: 0;
          background: var(--arch-surface);
        }
        .arch-detail-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          flex-wrap: wrap;
        }
        .arch-detail-head h4 {
          margin: 0 0 4px;
          font-size: 16.5px;
          font-weight: 700;
          color: var(--arch-ink);
        }
        .arch-detail-head p {
          margin: 0;
          font-size: 13.5px;
          color: var(--arch-muted);
          line-height: 1.55;
        }
        .arch-spec-strip {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          background: var(--arch-surface-2);
          overflow: hidden;
        }
        .arch-spec-cell {
          padding: 10px 12px;
          border-right: 1px solid var(--arch-line);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .arch-spec-cell:last-child {
          border-right: 0;
        }
        .arch-spec-cell b {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--arch-accent);
        }
        .arch-spec-cell.is-solution b {
          color: var(--arch-ok);
        }
        .arch-spec-cell.is-guard b {
          color: var(--arch-warn);
        }
        .arch-spec-cell span {
          font-size: 13px;
          line-height: 1.52;
          color: var(--arch-ink);
        }
        .arch-compare-strip {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          overflow: hidden;
        }
        .arch-col {
          padding: 11px 14px;
          background: var(--arch-surface);
        }
        .arch-before {
          border-right: 1px solid var(--arch-line);
          border-top: 2px solid var(--arch-err);
        }
        .arch-after {
          border-top: 2px solid var(--arch-ok);
        }
        .arch-col-title {
          font-size: 13px;
          font-weight: 700;
          margin-bottom: 7px;
        }
        .arch-before .arch-col-title { color: var(--arch-err); }
        .arch-after .arch-col-title { color: var(--arch-ok); }
        .arch-col ol {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 5px;
          font-size: 13px;
          line-height: 1.55;
          color: var(--arch-ink);
        }
        .arch-subledger {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .arch-subledger-title {
          font-size: 13px;
          font-weight: 700;
          color: var(--arch-muted);
        }
        .arch-meta-strip {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
        }
        .arch-meta-kv {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          border: 1px solid var(--arch-line);
          background: var(--arch-surface-2);
          border-radius: 4px;
          padding: 4px 9px;
          font-size: 12.5px;
        }
        .arch-meta-kv em {
          font-style: normal;
          color: var(--arch-muted);
        }
        .arch-meta-kv b {
          color: var(--arch-ink);
          font-weight: 700;
        }
        .arch-flow-rail {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 6px 8px;
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          padding: 9px 12px;
          font-size: 13px;
          color: var(--arch-ink);
        }
        .arch-flow-rail code,
        .arch-code {
          font-family: var(--arch-font);
          font-variant-numeric: tabular-nums;
          font-size: 12.5px;
          font-weight: 600;
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 3px;
          padding: 1px 6px;
          color: var(--arch-accent);
          overflow-wrap: anywhere;
        }
        .arch-code-plain {
          font-family: var(--arch-font);
          font-variant-numeric: tabular-nums;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--arch-ink);
          overflow-wrap: anywhere;
        }
        .arch-rail-sep {
          color: var(--arch-accent);
          font-weight: 700;
          margin-left: 4px;
        }
        .arch-surface-step {
          display: inline-flex;
          align-items: center;
          gap: 5px;
        }
        .arch-table-wrap {
          overflow-x: auto;
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          background: var(--arch-surface);
        }
        .arch-ledger-table,
        .arch-bp-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 13px;
          line-height: 1.55;
        }
        .arch-ledger-table th,
        .arch-ledger-table td,
        .arch-bp-table th,
        .arch-bp-table td {
          text-align: left;
          vertical-align: top;
          padding: 10px 12px;
          border-bottom: 1px solid var(--arch-line);
          color: var(--arch-ink);
        }
        .arch-ledger-table th,
        .arch-bp-table th {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--arch-muted);
          background: var(--arch-surface-2);
          white-space: nowrap;
        }
        .arch-ledger-table tbody tr:last-child td,
        .arch-bp-table tbody tr:last-child td {
          border-bottom: none;
        }
        .arch-cell-strong {
          font-weight: 700;
          color: var(--arch-ink);
          min-width: 170px;
        }
        .arch-cell-muted {
          color: var(--arch-muted);
        }
        .arch-cell-ok {
          color: var(--arch-ok);
          font-weight: 700;
          white-space: nowrap;
        }
        .arch-cell-note {
          margin-top: 4px;
          font-size: 12.5px;
          color: var(--arch-ok);
        }
        .arch-schema-flow {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr) auto minmax(0, 1fr);
          gap: 8px;
          align-items: stretch;
        }
        .arch-sf-box {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-top: 2px solid var(--arch-accent);
          border-radius: 4px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
        }
        .arch-sf-box.tone-ok { border-top-color: var(--arch-ok); }
        .arch-sf-box.tone-warn { border-top-color: var(--arch-warn); }
        .arch-sf-box b {
          font-size: 13.5px;
          color: var(--arch-ink);
        }
        .arch-sf-box code {
          font-family: var(--arch-font);
          font-variant-numeric: tabular-nums;
          font-size: 12.5px;
          font-weight: 600;
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 3px;
          padding: 2px 6px;
          color: var(--arch-accent);
          overflow-wrap: anywhere;
        }
        .arch-sf-box small {
          font-size: 12.5px;
          color: var(--arch-muted);
          line-height: 1.48;
          margin-top: auto;
        }
        .arch-sf-bridge {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 2px;
          font-size: 12.5px;
          font-weight: 700;
          color: var(--arch-muted);
          white-space: nowrap;
        }
        .arch-schema-layers {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .arch-tier-block {
          border: 1px solid var(--arch-line);
          border-left: 3px solid var(--arch-accent);
          border-radius: 4px;
          padding: 11px 12px;
          background: var(--arch-surface);
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .arch-tier-block.tone-ok { border-left-color: var(--arch-ok); }
        .arch-tier-block.tone-warn { border-left-color: var(--arch-warn); }
        .arch-tier-head {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 10px;
          flex-wrap: wrap;
        }
        .arch-tier-title-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .arch-tier-head h4 {
          margin: 0;
          font-size: 15px;
          color: var(--arch-ink);
        }
        .arch-layer-rule {
          font-size: 12.5px;
          color: var(--arch-muted);
        }
        .arch-quad-ledger {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          overflow: hidden;
        }
        .arch-quad-cell {
          padding: 10px 12px;
          border-right: 1px solid var(--arch-line);
          border-bottom: 1px solid var(--arch-line);
          display: flex;
          flex-direction: column;
          gap: 4px;
          background: var(--arch-surface-2);
        }
        .arch-quad-cell:nth-child(2n) {
          border-right: 0;
        }
        .arch-quad-cell:nth-last-child(-n + 2) {
          border-bottom: 0;
        }
        .arch-quad-cell b {
          font-size: 12.5px;
          color: var(--arch-accent);
        }
        .arch-quad-cell.is-guard b { color: var(--arch-warn); }
        .arch-quad-cell.is-solution b { color: var(--arch-ok); }
        .arch-quad-cell span {
          font-size: 13px;
          line-height: 1.52;
          color: var(--arch-ink);
        }
        .arch-rule-callout {
          border: 1px solid var(--arch-line);
          border-left: 3px solid var(--arch-ok);
          background: var(--arch-surface-2);
          border-radius: 4px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-size: 13px;
          line-height: 1.55;
        }
        .arch-rule-callout b {
          font-size: 12.5px;
          color: var(--arch-ok);
        }
        .arch-bp-cell-item {
          font-weight: 700;
          color: var(--arch-ink);
          min-width: 165px;
        }
        .arch-bp-cell-key { min-width: 175px; }
        .arch-bp-cell-val { min-width: 245px; }
        .arch-bp-cell-key code,
        .arch-bp-cell-val code {
          font-family: var(--arch-font);
          font-variant-numeric: tabular-nums;
          font-size: 12.5px;
          font-weight: 600;
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 3px;
          padding: 2px 6px;
          color: var(--arch-accent);
          display: inline-block;
          overflow-wrap: anywhere;
        }
        .arch-bp-cell-val code {
          color: var(--arch-ink);
        }
        .arch-bp-cell-pt {
          color: var(--arch-ok);
          min-width: 195px;
        }
        .arch-vf-toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          flex-wrap: wrap;
        }
        .arch-vf-cell-status { min-width: 150px; }
        .arch-vf-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 4px;
          margin-bottom: 4px;
        }
        .arch-vf-domain {
          font-size: 12.5px;
          font-weight: 700;
          color: var(--arch-muted);
        }
        .arch-vf-cell-reason {
          min-width: 230px;
          color: var(--arch-ink);
        }
        .arch-vf-row.is-blocked .arch-bp-cell-item {
          color: var(--arch-err);
        }
        .arch-vf-src {
          display: inline-block;
          margin-top: 4px;
          font-family: var(--arch-font);
          font-variant-numeric: tabular-nums;
          font-size: 12.5px;
          font-weight: 600;
          color: var(--arch-accent);
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 3px;
          padding: 1px 6px;
        }
        @media (prefers-reduced-motion: reduce) {
          .arch-root * {
            transition: none !important;
            animation: none !important;
          }
        }
        @media (max-width: 1080px) {
          .arch-kpi-strip,
          .arch-nodes {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .arch-kpi-cell {
            border-bottom: 1px solid var(--arch-line);
          }
          .arch-split-layout,
          .arch-spec-strip,
          .arch-compare-strip,
          .arch-quad-ledger,
          .arch-schema-flow {
            grid-template-columns: 1fr;
          }
          .arch-split-rail,
          .arch-before,
          .arch-spec-cell,
          .arch-quad-cell {
            border-right: 0;
            border-bottom: 1px solid var(--arch-line);
          }
          .arch-sf-bridge {
            flex-direction: row;
            justify-content: flex-start;
          }
          .arch-arrow,
          .arch-feedback-svg {
            display: none;
          }
        }
        @media (max-width: 720px) {
          .arch-root {
            padding: 12px 14px 32px;
          }
          .arch-bp-table thead {
            display: none;
          }
          .arch-bp-table,
          .arch-bp-table tbody,
          .arch-bp-table tr,
          .arch-bp-table td {
            display: block;
            width: 100%;
          }
          .arch-bp-table tr {
            border-bottom: 1px solid var(--arch-line);
            padding: 8px 0;
          }
          .arch-bp-table tr:last-child {
            border-bottom: none;
          }
          .arch-bp-table td {
            border-bottom: none;
            padding: 4px 10px;
            min-width: 0;
          }
          .arch-bp-table td::before {
            content: attr(data-label);
            display: block;
            font-size: 12px;
            font-weight: 700;
            color: var(--arch-muted);
            margin-bottom: 2px;
          }
        }
        @media (max-width: 640px) {
          .arch-kpi-strip,
          .arch-nodes {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
