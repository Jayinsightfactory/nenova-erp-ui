// Deliberately pure: no database, network, browser storage, or executable SQL.
const source = require('../data/ecount-workbench/source-menu.json');
const MENUS = source.menus;
const TABS = MENUS.filter(m => m.depth === 1);
const PRESERVE = ['OrderMaster', 'OrderDetail', 'ShipmentMaster', 'ShipmentDetail', 'WarehouseMaster', 'WarehouseDetail', 'StockMaster', 'ProductStock', 'ShipmentDate', 'ShipmentFarm', 'Estimate', 'WebProfitReport'];
const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, required: true, ...extra });
const number = (key, label, extra = {}) => field(key, label, 'number', { min: 0, precision: 2, ...extra });
const select = (key, label, options) => field(key, label, 'select', { options });
const date = field('date', '기준일', 'date');
const name = field('name', '합성 대상명');
const ref = field('reference', '원천 참조 코드');
const SCHEMAS = {
  master: { label: '기초정보', table: 'WebErpMasterDraft', fields: [field('code','관리 코드'),name,field('category','분류'),select('active','사용 여부',['사용','중지'])], results: [], formula: '코드 중복과 필수 항목 검사' },
  settings: { label: '설정·권한', table: 'WebErpSettingDraft', fields: [field('code','설정 코드'),name,field('value','설정 값'),select('permission','권한 범위',['조회','입력','관리']),select('active','사용 여부',['사용','중지'])], results: [], formula: '설정 초안만 검토. 실제 권한·인증·키 변경 없음' },
  pricing: { label: '단가·환율', table: 'WebErpPriceDraft', fields: [date,field('code','품목/통화 코드'),name,number('price','기준 단가'),number('rate','환산 비율',{min:0.0001,precision:4}),field('unit','단위')], results:['환산금액'], formula: '기준 단가 × 환산 비율 (소수 2자리 반올림)' },
  trade: { label: '영업·구매', table: 'WebErpTradeDraft', fields: [date,ref,name,field('product','합성 품목'),number('quantity','수량',{precision:3,min:0.001}),number('price','단가'),select('tax','세구분',['과세','면세','영세']),field('week','차수 (예: 42-01)')], results:['공급가액','부가세','합계'], formula:'수량 × 단가를 원 단위 반올림, 과세만 공급가액의 10%를 원 단위 반올림. 개발 예시 정책이며 원본 정책 확인 필요' },
  inventory: { label: '재고·로트', table: 'WebErpInventoryDraft', fields: [date,field('code','품목/로트 코드'),name,field('warehouse','창고 코드'),number('opening','기초수량',{precision:3}),number('incoming','증가수량',{precision:3}),number('outgoing','감소수량',{precision:3}),field('week','차수 (예: 42-01)')], results:['기말수량'], formula:'기초 + 증가 − 감소. 음수 기말은 검토 차단, 실제 재고조정 없음' },
  journal: { label: '회계·분개', table: 'WebErpJournalDraft', fields: [date,ref,name,field('debitAccount','차변 계정'),number('debit','차변 금액'),field('creditAccount','대변 계정'),number('credit','대변 금액')], results:['차대차이'], formula:'차변 − 대변 = 0. 이 초안은 1차변/1대변 입력이며 다중 분개·재무제표는 상세 구현 대기' },
  settlement: { label: '채권·채무', table: 'WebErpOpenItemDraft', fields: [date,ref,name,number('opening','기초잔액'),number('increase','발생금액'),number('decrease','수금/지급액'),number('discount','할인/상계액')], results:['미결잔액'], formula:'기초 + 발생 − 수금/지급 − 할인/상계. 초과 배분은 차단' },
  asset: { label: '고정자산', table: 'WebErpAssetDraft', fields: [date,field('code','자산 코드'),name,number('cost','취득가액'),number('residual','잔존가액'),number('months','내용연수 (개월)',{min:1,precision:0}),number('elapsed','경과 개월',{precision:0})], results:['월상각액','누계상각','장부가액'], formula:'정액법 개발 예시: (취득−잔존)/내용개월. 마지막 달 잔액 조정. 실제 상각정책 확인 필요' },
  budget: { label: '예산·계획', table: 'WebErpBudgetDraft', fields: [date,field('code','프로젝트/예산 코드'),name,number('planned','계획 금액'),number('actual','실적 금액')], results:['차이','집행률(%)'], formula:'차이=계획−실적, 집행률=실적/계획. 계획 0이면 비율은 계산하지 않음' },
  cost: { label: '원가·수입비용', table: 'WebErpCostDraft', fields:[date,ref,name,number('cost','매입원가'),number('freight','운임/부대비용'),number('quantity','배부 수량',{min:0.001,precision:3})], results:['도착원가','단위원가'], formula:'도착원가=매입+부대비용, 단위원가=도착원가/수량. 실제 수입원가 규칙은 별도 검증' },
  contract: { label:'계약·청구', table:'WebErpContractDraft', fields:[date,ref,name,field('endDate','종료일','date'),number('periodAmount','회당 청구액'),number('periods','청구 횟수',{min:1,precision:0})], results:['청구예정총액'], formula:'회당 청구액 × 청구 횟수. 달력별 청구 실행은 없음' },
  payroll: { label:'급여', table:'WebErpPayrollDraft', fields:[date,field('code','합성 사원 코드'),name,number('base','기본급'),number('allowance','수당'),number('deduction','공제 합계')], results:['지급총액','차인지급액'], formula:'기본급+수당−입력한 공제. 세금/4대보험 자동산출이 아니며 법정 급여 검증 전' },
  attendance: { label:'근태·휴가', table:'WebErpAttendanceDraft', fields:[date,field('code','합성 사원 코드'),name,number('granted','부여 일수'),number('used','사용 일수'),number('hours','근무 시간',{max:24})], results:['잔여일수'], formula:'부여−사용. 휴가 발생 규정과 야간/연장수당은 상세 구현 대기' },
  personnel: { label:'인사·조직', table:'WebErpPersonnelDraft', fields:[date,field('code','합성 사원 코드'),name,field('department','부서 코드'),field('position','직급/발령'),select('active','재직 상태',['재직','휴직','퇴직'])], results:[], formula:'합성 코드로 발령·조직 초안 검토. 실제 개인정보 입력 금지' },
  service: { label:'A/S·생산', table:'WebErpServiceDraft', fields:[date,ref,name,field('product','합성 품목'),number('quantity','접수/지시 수량',{min:0.001,precision:3}),number('completed','처리 수량',{precision:3})], results:['미처리수량'], formula:'접수/지시−처리. 공정별 자재 소모는 상세 구현 대기' },
  communication: { label:'게시판·일정', table:'WebErpCommunicationDraft', fields:[date,field('name','제목'),field('owner','담당 역할'),field('content','내용','textarea'),select('visibility','공개 범위',['본인','부서','전체'])], results:[], formula:'메시지/문서 초안. 실제 전달·메일·첨부 업로드 없음' },
  bank: { label:'은행·카드·이체', table:'WebErpBankFeedDraft', fields:[date,ref,field('accountRef','합성 계좌/카드 참조 ID'),name,select('direction','입출금',['입금','출금']),number('amount','거래금액'),number('balance','조회잔액')], results:['입금액','출금액'], formula:'금융기관 원천 ID로 중복 방지 설계. 실제 계좌번호 입력 금지' },
  tax: { label:'전자증빙', table:'WebErpTaxDocumentDraft', fields:[date,ref,name,number('supply','공급가액'),number('vat','부가세'),select('tax','세구분',['과세','면세','영세']),field('originalRef','원본 증빙 참조','text',{required:false})], results:['합계'], formula:'공급가액+부가세. 세구분과 VAT 정합성 검토. 실제 발행/국세청 전송 없음' },
};

function externalFor(menu) {
  const p = menu.program, text = menu.path.join(' / ');
  if (['E061003','E061002','E090117'].includes(p)) return {kind:'transfer',label:'은행 이체',states:['지급초안','검토대기','연동대기'],gate:'은행 계약·권한·수취 확인·이중 승인',idempotency:'회사+지급요청ID',reconcile:'응답 불명 시 원거래 조회 후 재시도'};
  if (['E010205','E010206','E010215','E010207','E040254','E040255'].includes(p)) return {kind:'collection',label:'은행·카드·PG 수집',states:['수집조건초안','연동대기'],gate:'기관별 지원·인증·조회기간 확인',idempotency:'기관+계좌토큰+원천거래ID',reconcile:'수집 커서·전체 건수·취소/정정 이력 대사'};
  if (/홈택스/.test(text) || ['E010729','E010732'].includes(p)) return {kind:'taxCollection',label:'홈택스 수집',states:['수집조건초안','연동대기'],gate:'조회 인증·문서 종류·수집 기간 확인',idempotency:'회사+국세청승인번호+문서버전',reconcile:'수집 작업ID 및 승인번호별 결과 재조회'};
  if (p==='E010849') return {kind:'issue',label:'전자세금계산서 발행',states:['작성초안','검토대기','연동대기'],gate:'발행 계약·인증서·세구분·수정사유 검증',idempotency:'회사+내부문서ID+버전',reconcile:'발행 응답 불명 시 동일 문서키 조회; 국세청 상태 별도 보관'};
  if (/전자계약/.test(text)) return {kind:'signature',label:'전자서명',states:['계약초안','검토대기','연동대기'],gate:'서명 사업자·서명자·문서 해시 확정',idempotency:'계약ID+문서버전',reconcile:'서명 문서 해시 및 이벤트 순서 검증'};
  if (/4대보험|피부양자/.test(text)) return {kind:'filing',label:'기관 신고',states:['신고초안','검토대기','연동대기'],gate:'신고 규격·담당자·기관 연동 확인',idempotency:'회사+신고종류+대상토큰+기간+버전',reconcile:'접수번호와 반려 사유 별도 기록'};
  if (/Webmail|API인증키|경영요약보고서신청|문서발송|쪽지수발신/.test(text)) return {kind:'delivery',label:'외부 서비스',states:['설정초안','검토대기','연동대기'],gate:'서비스별 인증과 발송/발급 권한 확인',idempotency:'요청ID+버전',reconcile:'전송 이력과 실제 결과 상태 분리'};
  return null;
}
function familyFor(menu) {
  const text=menu.path.join(' / '), label=menu.label;
  if (menu.tab==='MENUTREE_000008') return 'settings';
  if (/홈택스|세금|계산서요약|현금영수증/.test(text)) return 'tax';
  if (/계좌|카드매입|카드매출|결제대행사매출|이체|입출금/.test(label)) return 'bank';
  if (/단가|외화등록/.test(label)) return 'pricing';
  if (/고정자산|감가상각/.test(text)) return 'asset';
  if (/근태|휴가|출\/퇴근|출퇴근|지각/.test(text)) return 'attendance';
  if (/급여계산|급여조회|급여현황|수당|공제|근무확정/.test(label)) return 'payroll';
  if (/인사|조직도|사원등록|인원현황|증명서/.test(text)) return 'personnel';
  if (/게시판|공지사항|일정관리|커뮤니케이션|쪽지|문서발송/.test(text)) return 'communication';
  if (/A\/S|생산|작업지시|작업내역/.test(text)) return 'service';
  if (/채권|채무|수금|지급현황|수표/.test(label)) return 'settlement';
  if (/수입비용|이익관리|원가|비용관리/.test(text)) return 'cost';
  if (/계약|청구예정/.test(text)) return 'contract';
  if (/예산|계획/.test(text)) return 'budget';
  if (/기초등록|등록|설정|매핑|코드변경|기본사항/.test(text)) return 'master';
  if (/재고현황|기타이동|실사|재고조정|수불|시리얼|로트|재고변동|잔량/.test(text)) return 'inventory';
  if (menu.tab==='MENUTREE_000001' || /회계거래|전표|장부|분개|현금출납/.test(label)) return 'journal';
  return 'trade';
}
function getFeature(id) {
  const menu=MENUS.find(m=>m.id===id);
  if(!menu) return null;
  const family=familyFor(menu), schema=SCHEMAS[family], external=externalFor(menu);
  const topic = ['견적','주문','판매','발주','구매','채권','채무','수표','자가사용','불량','재고조정','창고이동'].find(t=>menu.path.join('/').includes(t)) || family;
  // Identical programs in favorites and report aliases use one logical dataset.
  const canonical=MENUS.find(m=>m.program===menu.program && m.tab!=='MPGU_RT00000004') || menu;
  const canonicalFamily=familyFor(canonical);
  const canonicalTopic=['master','settings','pricing'].includes(canonicalFamily)?canonical.program:['견적','주문','판매','발주','구매','채권','채무','수표','자가사용','불량','재고조정','창고이동'].find(t=>canonical.path.join('/').includes(t)) || canonicalFamily;
  const isFolder=menu.hasChildren && /^(C|P|MPGU)/.test(menu.program);
  const mode=isFolder?'folder':/현황|조회|대장|분석|보고서|명세|시산|재무|손익|원장|집계|인쇄|일보|월보|연보|비교|이력/.test(menu.label)?'report':'entry';
  return { ...menu, family:canonicalFamily, schema:SCHEMAS[canonicalFamily], external:externalFor(canonical)||external,
    entity:canonicalFamily+':'+canonicalTopic, mode, topic,
    implementation:'기능군 공통 초안 · 원본 상세 검증 대기', storageMode:'memory-only', canExecuteExternal:false };
}
function decimal(value,precision=2) {
  const text=String(value??'').trim();
  if(!/^\d+(?:\.\d+)?$/.test(text)) return null;
  const [whole,fraction='']=text.split('.');
  if(fraction.length>precision) return null;
  const scaled=Number(whole)*10**precision+Number(fraction.padEnd(precision,'0'));
  return Number.isSafeInteger(scaled)&&scaled<=1e12?scaled:null;
}
const round=(n,places=2)=>Math.round((n+Number.EPSILON)*10**places)/10**places;
function calculate(family,values) {
  const n=k=>Number(values[k]);
  switch(family){
    case 'pricing':return {'환산금액':round(n('price')*n('rate'))};
    case 'trade':{const supply=Math.round(n('quantity')*n('price')); const vat=values.tax==='과세'?Math.round(supply*.1):0;return {'공급가액':supply,'부가세':vat,'합계':supply+vat};}
    case 'inventory':return {'기말수량':round(n('opening')+n('incoming')-n('outgoing'),3)};
    case 'journal':return {'차대차이':round(n('debit')-n('credit'))};
    case 'settlement':return {'미결잔액':round(n('opening')+n('increase')-n('decrease')-n('discount'))};
    case 'asset':{const depreciable=n('cost')-n('residual');const elapsed=Math.min(n('elapsed'),n('months'));const monthly=round(depreciable/n('months'));const total=elapsed===n('months')?depreciable:Math.min(depreciable,round(monthly*elapsed));return {'월상각액':monthly,'누계상각':total,'장부가액':round(n('cost')-total)};}
    case 'budget':return {'차이':round(n('planned')-n('actual')),'집행률(%)':n('planned')===0?null:round(n('actual')/n('planned')*100)};
    case 'cost':return {'도착원가':round(n('cost')+n('freight')),'단위원가':round((n('cost')+n('freight'))/n('quantity'))};
    case 'contract':return {'청구예정총액':round(n('periodAmount')*n('periods'))};
    case 'payroll':return {'지급총액':round(n('base')+n('allowance')),'차인지급액':round(n('base')+n('allowance')-n('deduction'))};
    case 'attendance':return {'잔여일수':round(n('granted')-n('used'))};
    case 'service':return {'미처리수량':round(n('quantity')-n('completed'),3)};
    case 'bank':return {'입금액':values.direction==='입금'?n('amount'):0,'출금액':values.direction==='출금'?n('amount'):0};
    case 'tax':return {'합계':round(n('supply')+n('vat'))};
    default:return {};
  }
}
function validate(feature,values,context) {
  const errors=[];
  if(!feature || feature.mode==='folder') return ['입력할 기능을 선택하세요.'];
  if(!context || !Number.isInteger(context.year)||context.year<2000||context.year>2100||!/^DEMO-[A-Z0-9-]+$/.test(context.company||'')) errors.push('합성 회사 코드와 기준 연도를 확인하세요.');
  for(const f of feature.schema.fields){
    const v=values[f.key];
    if(v==null||String(v).trim()===''){if(f.required) errors.push(`${f.label}: 필수 항목입니다.`);continue;}
    if(String(v).length>2000)errors.push(`${f.label}: 2,000자 이내로 입력하세요.`);
    if(f.type==='number'){
      if(decimal(v,f.precision)==null) errors.push(`${f.label}: 소수 ${f.precision}자리 이내의 유효한 숫자를 입력하세요.`);
      else if(Number(v)<f.min || Number(v)>(f.max??1e9))errors.push(`${f.label}: 허용 범위를 확인하세요.`);
    }
    if(f.type==='select'&&!f.options.includes(v)) errors.push(`${f.label}: 목록에서 선택하세요.`);
    if(f.type==='date'){
      const d=new Date(`${v}T00:00:00Z`);
      if(!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(d.getTime())||d.toISOString().slice(0,10)!==v)errors.push(`${f.label}: 유효한 날짜를 입력하세요.`);
    }
  }
  if(values.date && Number(values.date.slice(0,4))!==context?.year) errors.push('기준일의 연도와 선택 연도가 다릅니다.');
  if(values.week && !/^(?:0?[1-9]|[1-4]\d|5[0-3])-(?:0?[1-9]|\d{2})$/.test(values.week)) errors.push('차수는 01~53과 세부차수 형식으로 입력하세요.');
  if(values.endDate && values.date && values.endDate<values.date) errors.push('종료일은 시작일 이후여야 합니다.');
  if(errors.length)return errors;
  const result=calculate(feature.family,values);
  if(feature.family==='journal'&&result['차대차이']!==0) errors.push('차변과 대변 합계가 일치해야 합니다.');
  for(const key of ['기말수량','미결잔액','차인지급액','잔여일수','미처리수량'])if(result[key]<0)errors.push(`${key}: 음수가 됩니다. 입력 범위를 확인하세요.`);
  if(feature.family==='asset'&&Number(values.residual)>Number(values.cost))errors.push('잔존가액은 취득가액 이하로 입력하세요.');
  if(feature.family==='tax'&&values.tax!=='과세'&&Number(values.vat)!==0)errors.push('면세/영세의 부가세는 0이어야 합니다.');
  if(Object.values(result).some(v=>v!==null&&(!Number.isFinite(v)||Math.abs(v)>1e12)))errors.push('계산 결과가 지원 범위를 초과합니다.');
  return errors;
}
function sampleValues(feature,year=2026) {
  const values={};
  for(const f of feature.schema.fields) values[f.key]=f.type==='number'?'0':f.type==='select'?f.options[0]:f.type==='date'?`${year}-10-20`:f.required?'예시 자료':'';
  const samples={code:'DEMO-001',name:'합성 업무 예시',reference:'DEMO-DOC-001',category:'기본',value:'예시 값',price:'1500',rate:'1',unit:'단',product:'예시 품목',quantity:'10',week:'42-01',warehouse:'DEMO-WH',opening:'100',incoming:'20',outgoing:'10',debitAccount:'예시 비용',creditAccount:'예시 현금',debit:'10000',credit:'10000',increase:'200',decrease:'50',discount:'0',cost:'120000',residual:'0',months:'12',elapsed:'3',planned:'100000',actual:'75000',freight:'12000',endDate:`${year}-12-31`,periodAmount:'50000',periods:'3',base:'2000000',allowance:'100000',deduction:'200000',granted:'15',used:'3',hours:'8',department:'DEMO-TEAM',position:'합성 역할',completed:'2',owner:'개발 담당',content:'개발 검토용 합성 자료입니다.',accountRef:'DEMO-ACCOUNT-TOKEN',amount:'10000',balance:'90000',supply:'10000',vat:'1000'};
  for(const f of feature.schema.fields) if(Object.hasOwn(samples,f.key)) values[f.key]=samples[f.key];
  return values;
}
function savePlan(feature,values,context) {
  const errors=validate(feature,values,context);
  return {mode:'DESIGN_ONLY',executable:false,storage:'browser-memory',featureId:feature.id,program:feature.program,
    identity:{company:context.company,year:context.year,entity:feature.entity,documentId:'client-generated',revision:'optimistic-lock',...(values.week?{OrderYear:context.year,OrderWeek:values.week,CustKey:'mapping-required',ProdKey:'mapping-required'}:{})},
    proposedTables:[feature.schema.table,'WebErpDraftRevision',...(feature.external?['WebIntegrationOutbox','WebIntegrationStatusEvent']:[])],
    transaction:['권한 및 필수값 검증','업무키/원천코드/기간 재검증','동일 문서 revision 잠금 및 멱등성 확인','헤더·상세·변경이력 원자 저장',...(feature.external?['외부 요청은 별도 Outbox에 대기; 지금 호출하지 않음']:[]),'동일 업무키 재조회·대사'],
    payload:Object.fromEntries(feature.schema.fields.map(f=>[f.key,values[f.key]??''])),
    results:errors.length?{}:calculate(feature.family,values),errors,preserve:PRESERVE,
    external:feature.external?{...feature.external,enabled:false}:null,
    prerequisites:['원본 상세 동작 검증','계약 JSON 및 fixture','스키마 승인/SSMS 적용','서버 권한·멱등성 구현','ERP 연결 시 실제 dnSpy 및 SELECT probe'],
  };
}
function createState(){return {sequence:0,records:[],history:[]};}
function applyDraft(state,command) {
  const feature=getFeature(command.featureId),context=command.context;
  if(!feature)throw Error('알 수 없는 기능입니다.');
  if(command.type==='executeExternal'||command.type==='persist')throw Error('실제 DB 저장과 외부 호출은 제공하지 않습니다.');
  const previous=command.id?state.records.find(r=>r.id===command.id):null;
  if(command.id&&!previous)throw Error('초안을 찾을 수 없습니다.');
  if(previous&&(previous.company!==context.company||previous.year!==context.year||previous.entity!==feature.entity))throw Error('다른 회사·연도·업무의 초안은 변경할 수 없습니다.');
  if(previous&&previous.revision!==command.revision)throw Error('초안이 변경되었습니다. 다시 선택하세요.');
  if(previous?.status==='취소(연습)')throw Error('취소된 초안은 변경할 수 없습니다.');
  const values=command.values||previous?.values;
  if(!values)throw Error('초안 값이 없습니다.');
  const errors=validate(feature,values,context);
  if(errors.length)throw Error(errors.join('\n'));
  if(!['save','review','cancel'].includes(command.type))throw Error('지원하지 않는 동작입니다.');
  if(command.type!=='save'&&!previous)throw Error('먼저 초안을 추가하세요.');
  if(command.type==='cancel'&&!String(command.reason||'').trim())throw Error('취소 사유를 입력하세요.');
  if(values.code&&state.records.some(r=>r.id!==previous?.id&&r.company===context.company&&r.year===context.year&&r.entity===feature.entity&&r.status!=='취소(연습)'&&r.values.code===values.code))throw Error('같은 범위에 동일 코드가 있습니다.');
  const sequence=state.sequence+1;
  const record={id:previous?.id||`DRAFT-${sequence}`,company:context.company,year:context.year,entity:feature.entity,featureId:feature.id,revision:(previous?.revision||0)+1,values:{...values},results:calculate(feature.family,values),status:command.type==='cancel'?'취소(연습)':command.type==='review'?(feature.external?'연동대기(설계)':'검토됨(연습)'):'초안',isSynthetic:true};
  return {sequence,records:previous?state.records.map(r=>r.id===record.id?record:r):[...state.records,record],history:[...state.history,{sequence,id:record.id,action:command.type,revision:record.revision,company:context.company,year:context.year,reason:command.reason||'',before:previous?{...previous}:null,after:{...record}}]};
}
function rowsFor(state,feature,context){return state.records.filter(r=>r.company===context.company&&r.year===context.year&&r.entity===feature.entity);}
function csvCell(value){const s=String(value??'');return '"'+(/^[=+@\-\t\r]/.test(s)?"'"+s:s).replace(/"/g,'""')+'"';}
function toCsv(rows,headers){return '\uFEFF'+[headers,...rows].map(r=>r.map(csvCell).join(',')).join('\r\n');}
module.exports={MENUS,TABS,SCHEMAS,PRESERVE,getFeature,decimal,calculate,validate,sampleValues,savePlan,createState,applyDraft,rowsFor,toCsv};
