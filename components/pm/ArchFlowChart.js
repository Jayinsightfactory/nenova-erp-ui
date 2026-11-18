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

export default function ArchFlowChart({
  timesave = null,
  workflows = null,
  office = null,
  onSelectTab = null,
  mineOnly = false,
  compact = false,
}) {
  const [selectedId, setSelectedId] = useState('pipeline');
  const [schemaView, setSchemaView] = useState('all');
  const [blueprintId, setBlueprintId] = useState('master');
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

  return (
    <section className={`arch-root ${compact ? 'is-compact' : ''}`} aria-label="자가발전 솔루션 아키텍처 흐름도">
      <header className="arch-head">
        <div>
          <div className="arch-eyebrow">SELF-EVOLVING WORK INTELLIGENCE ARCHITECTURE</div>
          <h2>직원 업무 관측 → 자가발전 · 자가치유 → 네노바웹 자동 반영 아키텍처</h2>
          <p className="arch-lede">
            단순 화면 기록 조회를 넘어, 매일 데이터의 빈칸을 스스로 메우고(①), 실시간 오류 로그를 직접 고치며(②),
            긴 수작업 연쇄(③)와 불필요한 화면 왕복(④)을 찾아 실제 전산·웹 로직으로 재설계하는 순환 구조입니다.
          </p>
        </div>
        <div className="arch-kpis">
          {peopleCount != null && (
            <div className="arch-kpi">
              <span>관찰 인원</span>
              <b>{peopleCount}명</b>
              <small>업무 {workflowCount}건 구조화</small>
            </div>
          )}
          {totals && (
            <div className="arch-kpi">
              <span>주간 활성 / 절감 후보</span>
              <b>{totals.activeHoursPerWeek}h → -{totals.saveHoursPerWeek}h</b>
              <small>주 {totals.assignedHoursPerWeek}h 업무 특정</small>
            </div>
          )}
          {unresolvedCount != null && (
            <div className="arch-kpi">
              <span>PM 관제 연결</span>
              <b>확인 필요 {unresolvedCount}건</b>
              <small>실시간 오류 · 정체 확인</small>
            </div>
          )}
          {!peopleCount && !totals && (
            <div className="arch-kpi">
              <span>순환 엔진</span>
              <b>4대 자가발전 루프</b>
              <small>관측 · 치유 · 압축 · 흡수</small>
            </div>
          )}
        </div>
      </header>

      {/* 전체 아키텍처 SVG/플로우 다이어그램 */}
      <div className="arch-diagram" role="region" aria-label="전체 아키텍처 단계 연결도">
        <div className="arch-nodes">
          {PIPELINE_NODES.map((node, idx) => (
            <div key={node.key} className="arch-node-wrap">
              <div className={`arch-node arch-node-${node.key}`}>
                <div className="arch-node-title">{node.label}</div>
                <div className="arch-node-sub">{node.sub}</div>
              </div>
              {idx < PIPELINE_NODES.length - 1 && (
                <div className="arch-arrow" aria-hidden="true">→</div>
              )}
            </div>
          ))}
        </div>

        {/* 닫힌 피드백 루프 바 */}
        <svg className="arch-feedback-svg" viewBox="0 0 920 46" preserveAspectRatio="none" aria-hidden="true">
          <path
            d="M 830 4 L 830 28 L 90 28 L 90 10"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeDasharray="6 5"
          />
          <polygon points="84,12 90,2 96,12" fill="currentColor" />
        </svg>
        <div className="arch-feedback-label">
          닫힌 피드백 루프(Closed Loop · Hermes 오케스트레이션): 반영 후 실측 단축 시간(timesave) · 확증% 변화 · SKILL.md 학습 자산을 다음 주기에 재투입
        </div>
      </div>

      {/* 4대 자가발전 엔진 카드 선택기 */}
      <div className="arch-loops-grid" role="group" aria-label="4대 자가발전 루프 선택">
        {LOOPS.map((loop) => {
          const active = loop.id === activeLoop.id;
          return (
            <SelectCard
              key={loop.id}
              on={active}
              pressed={active}
              className={`arch-loop-card tone-${loop.tone} ${active ? 'is-on' : ''}`}
              onClick={() => setSelectedId(loop.id)}
            >
              <div className="arch-loop-top">
                <span className="arch-loop-no">LOOP {loop.no}</span>
                <Badge className="arch-loop-badge" tone={loop.tone === 'err' ? 'warn' : 'plain'}>{loop.badge}</Badge>
              </div>
              <div className="arch-loop-title">{loop.title}</div>
              <div className="arch-loop-summary">{loop.summary}</div>
            </SelectCard>
          );
        })}
      </div>

      {/* 선택한 루프의 상세 동작 + Before -> After 설계 흐름 */}
      <article className="arch-detail" aria-live="polite">
        <div className="arch-detail-head">
          <div>
            <span className="arch-detail-pill">LOOP {activeLoop.no} · {activeLoop.badge}</span>
            <h3>{activeLoop.caseTitle}</h3>
            <p>{activeLoop.caseDetail}</p>
          </div>
          {!mineOnly && onSelectTab && activeLoop.tabTarget && (
            <Button className="arch-jump-btn" variant="primary" size="sm" onClick={() => onSelectTab(activeLoop.tabTarget)}>
              {activeLoop.tabLabel} ↗
            </Button>
          )}
        </div>

        <div className="arch-spec-row">
          <div className="arch-spec">
            <b>감지 트리거 (Input)</b>
            <span>{activeLoop.trigger}</span>
          </div>
          <div className="arch-spec-arrow" aria-hidden="true">→</div>
          <div className="arch-spec">
            <b>자가발전 판단·설계 엔진</b>
            <span>{activeLoop.engine}</span>
          </div>
          <div className="arch-spec-arrow" aria-hidden="true">→</div>
          <div className="arch-spec">
            <b>시스템 반영 · 기대 결과 (Output)</b>
            <span>{activeLoop.outcome}</span>
          </div>
        </div>

        <div className="arch-compare">
          <div className="arch-col arch-before">
            <div className="arch-col-title">AS-IS · 관측된 기존 수작업 / 오류</div>
            <ol>
              {activeLoop.beforeSteps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </div>
          <div className="arch-col-mid" aria-hidden="true">⟹</div>
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
          <div className="arch-live-features">
            <div className="arch-live-title">
              실측 절감 상위 후보 ({liveTs?.generatedAt ? String(liveTs.generatedAt).slice(0, 10) : '최신'} 기준)
            </div>
            <div className="arch-live-chips">
              {topFeatures.map((feat, idx) => (
                <div key={feat.title + idx} className="arch-live-chip">
                  <b>{feat.title}</b>
                  <span>주 {feat.saveHoursPerWeek}h 절감 후보{feat.menu ? ` · ${feat.menu}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </article>

      {/* Hermes 에이전트 관리 · 자가학습 오케스트레이션 계층 */}
      <section className="arch-hermes" data-testid="arch-hermes-section" aria-label="Hermes 에이전트 관리 및 자가학습 오케스트레이션">
        <div className="arch-schema-head">
          <div>
            <div className="arch-eyebrow">AGENT ORCHESTRATION &amp; CLOSED LEARNING LOOP · NousResearch/hermes-agent</div>
            <h3>Hermes 에이전트 관리 · 자가학습 오케스트레이션 (<code>hermes-manager.js</code>)</h3>
            <p className="arch-lede">
              Claude · Codex · Antigravity 3-툴과 PM 조사관 루프를 하나로 묶어 한도 폴백, 세션 JSONL 인계, 궤적 압축, 절차 스킬 자동 합성을 수행합니다.
            </p>
          </div>
          <div className="arch-hermes-badges">
            <Badge tone="plain">
              활성 엔진: {office?.hermes?.activeProvider || 'claude'}
              {office?.hermes?.fallbackReady !== false ? ' (codex 폴백 대기)' : ''}
            </Badge>
            <Badge tone="plain">
              합성 스킬: {office?.hermes?.skillsSynced ?? 97}건 SKILL.md
            </Badge>
            <Badge tone="plain">
              압축 평균: {office?.hermes?.avgCompressionPct ?? 91.1}%
            </Badge>
          </div>
        </div>

        <div className="arch-hermes-flow" role="region" aria-label="Hermes 에이전트 관리 흐름">
          <span><b>1. 실행 라우팅</b> <code>selectRunner</code> (Claude ↔ Codex)</span>
          <span className="arch-hermes-arrow" aria-hidden="true">→</span>
          <span><b>2. 진행 임대 점검</b> <code>checkWatchdogLeases</code></span>
          <span className="arch-hermes-arrow" aria-hidden="true">→</span>
          <span><b>3. 중단 구조/인계</b> <code>Session Rescue → Lineage</code></span>
          <span className="arch-hermes-arrow" aria-hidden="true">→</span>
          <span><b>4. 궤적 압축</b> <code>Head/Tail 보호</code></span>
          <span className="arch-hermes-arrow" aria-hidden="true">→</span>
          <span><b>5. 스킬 자가합성</b> <code>97 CARD → SKILL.md</code></span>
        </div>

        <div className="arch-hermes-grid">
          {HERMES_MODULES.map((mod) => (
            <div key={mod.id} className={`arch-hermes-card tone-${mod.tone}`}>
              <div className="arch-hermes-top">
                <span className="arch-detail-pill">{mod.metric}</span>
                <code>{mod.source}</code>
              </div>
              <div className="arch-hermes-title">{mod.title}</div>
              <p className="arch-hermes-desc">{mod.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* SQL 원장 & 네노바웹 3계층 데이터 스키마 구조도 */}
      <section className="arch-schema" aria-label="SQL 원장 및 네노바웹 데이터 스키마 구조도">
        <div className="arch-schema-head">
          <div>
            <div className="arch-eyebrow">DATABASE &amp; DATA SCHEMA ARCHITECTURE</div>
            <h3>SQL 원장 &amp; 네노바웹 3계층 데이터 스키마 구조도</h3>
            <p className="arch-lede">
              전산(nenova.exe)과 공유하는 <b>MSSQL 핵심 원장</b>, 웹 확장을 격리 저장하는 <b>Web* 전용 SQL 스키마</b>,
              그리고 자가발전 분석·PM 관제가 사용하는 <b>data/runtime/*.json</b> 계층의 키·관계·불변 가드를 한눈에 보여줍니다.
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

        {/* 3계층 관계 ER/데이터 흐름도 */}
        <div className="arch-schema-flow" role="region" aria-label="3계층 데이터 흐름 및 테이블 관계도">
          <div className="arch-sf-box tone-accent">
            <b>Tier 1 · 공유 MSSQL ERP 원장</b>
            <code>Customer(CustKey) ──▶ OrderMaster(OrderMasterKey) ──▶ OrderDetail</code>
            <code>Product(ProdKey) ────▶ ShipmentMaster(ShipmentKey) ─▶ ShipmentDetail(SdetailKey)</code>
            <code>WarehouseMaster(WarehouseKey) ─▶ WarehouseDetail(WdetailKey) · FreightCost</code>
            <small>모든 업무 쓰기는 OrderYear + OrderWeek + CustKey + ProdKey · dnSpy 정본 준수</small>
          </div>
          <div className="arch-sf-bridge" aria-hidden="true">
            <span>읽기 참조(JOIN) /</span>
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
            <span>전산·웹 로그 대조 →</span>
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

        {/* 선택한 계층의 상세 스키마 카드 */}
        {schemaView !== 'invariants' && (
          <div className="arch-schema-layers">
            {visibleLayers.map((layer) => (
              <div key={layer.id} className={`arch-layer-card tone-${layer.tone}`}>
                <div className="arch-layer-head">
                  <div>
                    <span className="arch-detail-pill">{layer.badge}</span>
                    <h4>{layer.title}</h4>
                  </div>
                  <div className="arch-layer-rule">{layer.rule}</div>
                </div>
                <div className="arch-tables-grid">
                  {layer.tables.map((tbl) => (
                    <div key={tbl.name} className="arch-tbl">
                      <div className="arch-tbl-name">{tbl.name}</div>
                      <div className="arch-tbl-keys">
                        <span><b>PK</b> <code>{tbl.pk}</code></span>
                        <span><b>FK/연결</b> <code>{tbl.fk}</code></span>
                      </div>
                      <div className="arch-tbl-cols"><b>주요 컬럼:</b> <code>{tbl.cols}</code></div>
                      <div className="arch-tbl-note">{tbl.note}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 핵심 SQL & 스키마 불변 가드 요약 */}
        {(schemaView === 'all' || schemaView === 'invariants') && (
          <div className="arch-invariants">
            <div className="arch-live-title">핵심 SQL · 스키마 불변 가드 (Invariants · docs/DB_STRUCTURE.md 기준)</div>
            <div className="arch-inv-grid">
              {SCHEMA_INVARIANTS.map((item) => (
                <div key={item.key} className="arch-inv-item">
                  <b>{item.key}</b>
                  <span>{item.rule}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* 솔루션화 업무별 스키마 설계 청사진 & 실제 품목 데이터 예시 */}
      <section
        className="arch-blueprints"
        data-testid="arch-solution-blueprints"
        aria-label="솔루션화 업무별 스키마 설계 및 품목 예시"
      >
        <div className="arch-schema-head">
          <div>
            <div className="arch-eyebrow">DOMAIN SCHEMA BLUEPRINTS &amp; REAL ITEM DATA</div>
            <h3>솔루션화 업무별 스키마 설계 청사진 &amp; 실제 품목 데이터 예시</h3>
            <p className="arch-lede">
              화훼 ERP에서 검증된 기준정보·주문·수입·재고 테이블 설계를 타 업종 상용 솔루션으로도 바로 이식할 수 있도록
              핵심 설계 원리·치환 공식·실제 품목 저장 예시를 업무별로 정리했습니다.
            </p>
          </div>
          <div className="arch-bp-pill-wrap">
            <Badge tone="plain">업종 치환 가능 4대 업무 모델</Badge>
          </div>
        </div>

        <div className="arch-bp-grid" role="group" aria-label="솔루션화 업무별 스키마 시나리오 선택">
          {SOLUTION_BLUEPRINTS.map((bp) => {
            const active = bp.id === activeBlueprint.id;
            return (
              <SelectCard
                key={bp.id}
                on={active}
                pressed={active}
                className={`arch-loop-card arch-bp-card tone-${bp.tone} ${active ? 'is-on' : ''}`}
                onClick={() => setBlueprintId(bp.id)}
              >
                <div className="arch-loop-top">
                  <span className="arch-loop-no">BLUEPRINT {bp.no}</span>
                  <Badge className="arch-loop-badge" tone={bp.tone === 'err' ? 'warn' : 'plain'}>{bp.badge}</Badge>
                </div>
                <div className="arch-loop-title">{bp.title}</div>
                <code className="arch-bp-tables">{bp.tables}</code>
              </SelectCard>
            );
          })}
        </div>

        <div className="arch-bp-detail" aria-live="polite">
          <div className="arch-bp-summary">
            <div className="arch-bp-sum-card">
              <b>언제 이 스키마를 쓰는가</b>
              <span>{activeBlueprint.whenToUse}</span>
            </div>
            <div className="arch-bp-sum-card">
              <b>핵심 테이블 · 키 설계 공식</b>
              <span>{activeBlueprint.designRule}</span>
            </div>
            <div className="arch-bp-sum-card tone-solution">
              <b>타 업종 솔루션 치환 공식</b>
              <span>{activeBlueprint.solutionMap}</span>
            </div>
          </div>

          <div className="arch-bp-examples">
            <div className="arch-live-title">
              실제 품목 데이터 저장 예시 — {activeBlueprint.no} · {activeBlueprint.title}
            </div>
            <div className="arch-bp-table-wrap">
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
      </section>

      <style jsx>{`
        .arch-root {
          --arch-bg: var(--pm-bg, rgb(14, 16, 22));
          --arch-surface: var(--pm-surface, rgb(18, 21, 28));
          --arch-surface-2: var(--pm-surface2, rgb(24, 28, 38));
          --arch-ink: var(--pm-ink, rgb(231, 234, 240));
          --arch-muted: var(--pm-muted, rgb(152, 161, 178));
          --arch-line: var(--pm-line, rgb(44, 51, 64));
          --arch-accent: var(--pm-accent, rgb(88, 166, 255));
          --arch-ok: var(--pm-ok, rgb(63, 185, 80));
          --arch-warn: var(--pm-idle, rgb(227, 179, 65));
          --arch-err: var(--pm-err, rgb(248, 81, 73));
          color: var(--arch-ink);
          padding: 18px 22px 36px;
          max-width: 1440px;
          margin: 0 auto;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }
        .arch-root.is-compact {
          padding: 12px 14px 18px;
          max-width: none;
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 10px;
          margin-bottom: 12px;
        }
        .arch-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 16px;
          flex-wrap: wrap;
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 12px;
          padding: 16px 18px;
        }
        .arch-eyebrow {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--arch-accent);
          margin-bottom: 4px;
        }
        .arch-head h2 {
          margin: 0 0 6px;
          font-size: 19px;
          line-height: 1.35;
        }
        .arch-lede {
          margin: 0;
          color: var(--arch-muted);
          font-size: 13px;
          line-height: 1.55;
          max-width: 78ch;
        }
        .arch-kpis {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
        }
        .arch-kpi {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 10px;
          padding: 8px 12px;
          min-width: 145px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .arch-kpi span {
          font-size: 11px;
          color: var(--arch-muted);
        }
        .arch-kpi b {
          font-size: 15px;
          color: var(--arch-ink);
        }
        .arch-kpi small {
          font-size: 11px;
          color: var(--arch-accent);
        }
        .arch-diagram {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 12px;
          padding: 16px 18px 12px;
        }
        .arch-nodes {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
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
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-top: 3px solid var(--arch-accent);
          border-radius: 10px;
          padding: 10px 12px;
        }
        .arch-node-evolve { border-top-color: var(--arch-warn); }
        .arch-node-design { border-top-color: var(--arch-ok); }
        .arch-node-deploy { border-top-color: var(--arch-err); }
        .arch-node-title {
          font-weight: 700;
          font-size: 13.5px;
          margin-bottom: 4px;
        }
        .arch-node-sub {
          font-size: 12px;
          color: var(--arch-muted);
          line-height: 1.4;
        }
        .arch-arrow {
          flex: 0 0 auto;
          font-size: 18px;
          font-weight: 700;
          color: var(--arch-accent);
        }
        .arch-feedback-svg {
          width: 100%;
          height: 36px;
          color: var(--arch-accent);
          opacity: 0.85;
          display: block;
        }
        .arch-feedback-label {
          text-align: center;
          font-size: 12px;
          color: var(--arch-muted);
          margin-top: -4px;
        }
        .arch-loops-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        :global(.arch-loop-card) {
          display: flex;
          flex-direction: column;
          align-items: stretch;
          text-align: left;
          gap: 6px;
          padding: 12px 14px !important;
          border-radius: 10px !important;
          border: 1px solid var(--arch-line) !important;
          background: var(--arch-surface) !important;
          color: var(--arch-ink) !important;
          cursor: pointer;
          height: auto !important;
        }
        :global(.arch-loop-card.is-on) {
          background: var(--arch-surface-2) !important;
          border-color: var(--arch-accent) !important;
          box-shadow: 0 0 0 2px color-mix(in srgb, var(--arch-accent) 25%, transparent);
        }
        :global(.arch-loop-badge) {
          font-size: 11px;
          font-weight: 700;
          padding: 1px 8px;
          border-radius: 999px;
          border: 1px solid var(--arch-line);
          color: var(--arch-muted);
          background: var(--arch-surface-2);
        }
        :global(.arch-jump-btn) {
          background: var(--arch-accent);
          color: rgb(255, 255, 255);
          border: 1px solid var(--arch-accent);
          border-radius: 6px;
          padding: 6px 12px;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          cursor: pointer;
          white-space: nowrap;
        }
        :global(.arch-jump-btn:hover) {
          opacity: 0.92;
        }
        .arch-loop-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
        }
        .arch-loop-no {
          font-size: 11px;
          font-weight: 700;
          color: var(--arch-accent);
        }
        .arch-loop-title {
          font-weight: 700;
          font-size: 14px;
          line-height: 1.35;
        }
        .arch-loop-summary {
          font-size: 12px;
          color: var(--arch-muted);
          line-height: 1.45;
        }
        .arch-detail {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .arch-detail-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 12px;
          flex-wrap: wrap;
        }
        .arch-detail-pill {
          display: inline-block;
          font-size: 11px;
          font-weight: 700;
          color: var(--arch-accent);
          border: 1px solid var(--arch-accent);
          border-radius: 999px;
          padding: 1px 9px;
          margin-bottom: 6px;
        }
        .arch-detail-head h3 {
          margin: 0 0 4px;
          font-size: 16px;
        }
        .arch-detail-head p {
          margin: 0;
          font-size: 13px;
          color: var(--arch-muted);
          line-height: 1.5;
        }
        .arch-spec-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 24px minmax(0, 1fr) 24px minmax(0, 1fr);
          gap: 8px;
          align-items: center;
        }
        .arch-spec {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          height: 100%;
          box-sizing: border-box;
        }
        .arch-spec b {
          font-size: 11.5px;
          color: var(--arch-accent);
        }
        .arch-spec span {
          font-size: 12.5px;
          line-height: 1.45;
        }
        .arch-spec-arrow {
          text-align: center;
          font-size: 16px;
          font-weight: 700;
          color: var(--arch-muted);
        }
        .arch-compare {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 30px minmax(0, 1fr);
          gap: 10px;
          align-items: stretch;
        }
        .arch-col {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 10px;
          padding: 12px 14px;
        }
        .arch-before { border-left: 4px solid var(--arch-err); }
        .arch-after { border-left: 4px solid var(--arch-ok); }
        .arch-col-title {
          font-size: 12px;
          font-weight: 700;
          margin-bottom: 8px;
        }
        .arch-before .arch-col-title { color: var(--arch-err); }
        .arch-after .arch-col-title { color: var(--arch-ok); }
        .arch-col ol {
          margin: 0;
          padding-left: 18px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12.5px;
          line-height: 1.45;
        }
        .arch-col-mid {
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
          color: var(--arch-accent);
        }
        .arch-live-features {
          border-top: 1px solid var(--arch-line);
          padding-top: 12px;
        }
        .arch-live-title {
          font-size: 12px;
          font-weight: 700;
          color: var(--arch-muted);
          margin-bottom: 8px;
        }
        .arch-live-chips {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
          gap: 8px;
        }
        .arch-live-chip {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 8px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 2px;
          font-size: 12px;
        }
        .arch-live-chip span {
          color: var(--arch-ok);
          font-size: 11.5px;
        }
        .arch-hermes {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .arch-hermes-badges {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
          align-items: center;
        }
        .arch-hermes-flow {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 8px;
          padding: 10px 12px;
          font-size: 12px;
        }
        .arch-hermes-flow code, .arch-hermes-top code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          background: color-mix(in srgb, var(--arch-bg) 75%, transparent);
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          padding: 1px 5px;
          color: var(--arch-accent);
        }
        .arch-hermes-arrow {
          color: var(--arch-accent);
          font-weight: 700;
        }
        .arch-hermes-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
          gap: 10px;
        }
        .arch-hermes-card {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-top: 3px solid var(--arch-accent);
          border-radius: 10px;
          padding: 11px 13px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .arch-hermes-card.tone-ok { border-top-color: var(--arch-ok); }
        .arch-hermes-card.tone-warn { border-top-color: var(--arch-warn); }
        .arch-hermes-card.tone-err { border-top-color: var(--arch-err); }
        .arch-hermes-top {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 6px;
          flex-wrap: wrap;
        }
        .arch-hermes-title {
          font-weight: 700;
          font-size: 13px;
          color: var(--arch-ink);
        }
        .arch-hermes-desc {
          margin: 0;
          font-size: 12px;
          line-height: 1.5;
          color: var(--arch-muted);
        }
        .arch-schema {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .arch-schema-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 14px;
          flex-wrap: wrap;
        }
        .arch-schema-head h3 {
          margin: 0 0 4px;
          font-size: 17px;
        }
        .arch-schema-filters {
          display: flex;
          flex-wrap: wrap;
          gap: 6px;
        }
        :global(.arch-filter-chip) {
          background: var(--arch-surface-2) !important;
          color: var(--arch-muted) !important;
          border: 1px solid var(--arch-line) !important;
          border-radius: 999px !important;
          padding: 5px 11px !important;
          font: inherit;
          font-size: 12px !important;
          font-weight: 600 !important;
          cursor: pointer;
        }
        :global(.arch-filter-chip.is-active) {
          background: color-mix(in srgb, var(--arch-accent) 18%, var(--arch-surface)) !important;
          color: var(--arch-ink) !important;
          border-color: var(--arch-accent) !important;
          font-weight: 700 !important;
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
          border-top: 3px solid var(--arch-accent);
          border-radius: 10px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 5px;
          min-width: 0;
        }
        .arch-sf-box.tone-ok { border-top-color: var(--arch-ok); }
        .arch-sf-box.tone-warn { border-top-color: var(--arch-warn); }
        .arch-sf-box b {
          font-size: 13px;
          color: var(--arch-ink);
        }
        .arch-sf-box code, .arch-tbl code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          background: color-mix(in srgb, var(--arch-bg) 75%, transparent);
          border: 1px solid var(--arch-line);
          border-radius: 4px;
          padding: 2px 6px;
          color: var(--arch-accent);
          overflow-wrap: anywhere;
        }
        .arch-sf-box small {
          font-size: 11px;
          color: var(--arch-muted);
          line-height: 1.4;
          margin-top: auto;
        }
        .arch-sf-bridge {
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          gap: 2px;
          font-size: 11px;
          font-weight: 700;
          color: var(--arch-muted);
          white-space: nowrap;
        }
        .arch-schema-layers {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .arch-layer-card {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-left: 4px solid var(--arch-accent);
          border-radius: 10px;
          padding: 12px 14px;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .arch-layer-card.tone-ok { border-left-color: var(--arch-ok); }
        .arch-layer-card.tone-warn { border-left-color: var(--arch-warn); }
        .arch-layer-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-end;
          gap: 10px;
          flex-wrap: wrap;
        }
        .arch-layer-head h4 {
          margin: 0;
          font-size: 15px;
        }
        .arch-layer-rule {
          font-size: 11.5px;
          color: var(--arch-muted);
        }
        .arch-tables-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
          gap: 10px;
        }
        .arch-tbl {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 8px;
          padding: 10px 12px;
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 12px;
        }
        .arch-tbl-name {
          font-weight: 700;
          font-size: 13px;
          color: var(--arch-ink);
        }
        .arch-tbl-keys {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .arch-tbl-keys b, .arch-tbl-cols b {
          color: var(--arch-muted);
          font-size: 11px;
          margin-right: 4px;
        }
        .arch-tbl-cols {
          line-height: 1.5;
        }
        .arch-tbl-note {
          font-size: 11.5px;
          color: var(--arch-ok);
          line-height: 1.45;
          margin-top: auto;
          padding-top: 4px;
          border-top: 1px dashed var(--arch-line);
        }
        .arch-invariants {
          border-top: 1px solid var(--arch-line);
          padding-top: 12px;
        }
        .arch-inv-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
          gap: 8px;
        }
        .arch-inv-item {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 8px;
          padding: 8px 10px;
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-size: 12px;
          line-height: 1.45;
        }
        .arch-inv-item b {
          color: var(--arch-warn);
          font-size: 12px;
        }
        .arch-blueprints {
          background: var(--arch-surface);
          border: 1px solid var(--arch-line);
          border-radius: 12px;
          padding: 16px 18px;
          display: flex;
          flex-direction: column;
          gap: 14px;
        }
        .arch-bp-pill-wrap {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .arch-bp-grid {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 10px;
        }
        :global(.arch-bp-card) {
          border-top: 3px solid var(--arch-accent) !important;
        }
        :global(.arch-bp-card.tone-ok) {
          border-top-color: var(--arch-ok) !important;
        }
        :global(.arch-bp-card.tone-warn) {
          border-top-color: var(--arch-warn) !important;
        }
        :global(.arch-bp-card.tone-err) {
          border-top-color: var(--arch-err) !important;
        }
        .arch-bp-tables {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11px;
          color: var(--arch-accent);
          background: color-mix(in srgb, var(--arch-bg) 75%, transparent);
          border: 1px solid var(--arch-line);
          border-radius: 5px;
          padding: 3px 6px;
          overflow-wrap: anywhere;
          margin-top: auto;
        }
        .arch-bp-detail {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .arch-bp-summary {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 10px;
        }
        .arch-bp-sum-card {
          background: var(--arch-surface-2);
          border: 1px solid var(--arch-line);
          border-radius: 10px;
          padding: 11px 13px;
          display: flex;
          flex-direction: column;
          gap: 5px;
        }
        .arch-bp-sum-card b {
          font-size: 11.5px;
          color: var(--arch-accent);
        }
        .arch-bp-sum-card.tone-solution {
          border-left: 3px solid var(--arch-ok);
        }
        .arch-bp-sum-card.tone-solution b {
          color: var(--arch-ok);
        }
        .arch-bp-sum-card span {
          font-size: 12.5px;
          line-height: 1.5;
          color: var(--arch-ink);
        }
        .arch-bp-examples {
          border-top: 1px solid var(--arch-line);
          padding-top: 12px;
        }
        .arch-bp-table-wrap {
          overflow-x: auto;
          border: 1px solid var(--arch-line);
          border-radius: 10px;
          background: var(--arch-surface-2);
        }
        .arch-bp-table {
          width: 100%;
          border-collapse: collapse;
          font-size: 12.5px;
          line-height: 1.5;
        }
        .arch-bp-table th,
        .arch-bp-table td {
          text-align: left;
          vertical-align: top;
          padding: 10px 12px;
          border-bottom: 1px solid var(--arch-line);
        }
        .arch-bp-table th {
          font-size: 11.5px;
          font-weight: 700;
          color: var(--arch-muted);
          background: color-mix(in srgb, var(--arch-bg) 55%, var(--arch-surface-2));
          white-space: nowrap;
        }
        .arch-bp-table tbody tr:last-child td {
          border-bottom: none;
        }
        .arch-bp-cell-item {
          font-weight: 700;
          color: var(--arch-ink);
          min-width: 170px;
        }
        .arch-bp-cell-key {
          min-width: 185px;
        }
        .arch-bp-cell-val {
          min-width: 260px;
        }
        .arch-bp-cell-key code,
        .arch-bp-cell-val code {
          font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
          font-size: 11.5px;
          background: color-mix(in srgb, var(--arch-bg) 78%, transparent);
          border: 1px solid var(--arch-line);
          border-radius: 4px;
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
          min-width: 200px;
        }
        @media (max-width: 1040px) {
          .arch-nodes, .arch-loops-grid, .arch-bp-grid {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }
          .arch-bp-summary {
            grid-template-columns: 1fr;
          }
          .arch-schema-flow {
            grid-template-columns: 1fr;
          }
          .arch-sf-bridge {
            flex-direction: row;
            justify-content: flex-start;
          }
          .arch-arrow, .arch-feedback-svg {
            display: none;
          }
          .arch-spec-row, .arch-compare {
            grid-template-columns: 1fr;
          }
          .arch-spec-arrow, .arch-col-mid {
            display: none;
          }
        }
        @media (max-width: 720px) {
          .arch-bp-table thead {
            display: none;
          }
          .arch-bp-table,
          .arch-bp-table tbody,
          .arch-bp-table tr,
          .arch-bp-table td {
            display: block;
            width: 100%;
            box-sizing: border-box;
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
            padding: 4px 12px;
            min-width: 0;
          }
          .arch-bp-table td::before {
            content: attr(data-label);
            display: block;
            font-size: 11px;
            font-weight: 700;
            color: var(--arch-muted);
            margin-bottom: 2px;
          }
        }
        @media (max-width: 640px) {
          .arch-nodes, .arch-loops-grid, .arch-bp-grid {
            grid-template-columns: 1fr;
          }
        }
      `}</style>
    </section>
  );
}
