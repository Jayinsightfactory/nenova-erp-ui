'use strict';
// 2026-10-21 P008~P019 72화면·P020~P039 90화면 원본 조사(버튼 라벨·문맥·활성 여부, 입력칸 라벨·유형, 간편검색 프리셋 결과만 관측; 동작·새창·값 미검증)를
// /ecount/workbench 대상 셸 화면 정의로 바꾼다. ID 의 근거는 data/ecount-workbench/button-matches.json 의 matchId 뿐이며 여기서 새 ID 를 만들지 않는다.
// 조사 컨트롤 중 button-matches 에 대응 버튼이 없는 항목은 정의에 넣지 않고 missing 으로 돌려준다.
// kind/dateMode 는 렌더 형태를 고르기 위한 라벨 기반 추정이고 원본 기능 동등성을 뜻하지 않는다.
const report=require('../data/ecount-workbench/button-matches.json');
// P008~P019(72화면) + P020~P039(90화면) 조사 결과를 하나로 합친다. 같은 프로그램이 두 조사에 있으면 정의 근거가 모호하므로 로드 시 실패한다.
const SURVEY_FILES=Object.freeze([
  'data/ecount-workbench/evidence/2026-10-21-source-survey-p008-p019.json',
  'data/ecount-workbench/evidence/2026-10-21-source-survey-p020-p039.json',
  'data/ecount-workbench/evidence/2026-10-22-source-survey-p020-p039-rest.json',
  'data/ecount-workbench/evidence/2026-10-22-source-survey-used-p040-p047.json',
]);
const SURVEYS=[
  require('../data/ecount-workbench/evidence/2026-10-21-source-survey-p008-p019.json'),
  require('../data/ecount-workbench/evidence/2026-10-21-source-survey-p020-p039.json'),
  require('../data/ecount-workbench/evidence/2026-10-22-source-survey-p020-p039-rest.json'),
  require('../data/ecount-workbench/evidence/2026-10-22-source-survey-used-p040-p047.json'),
];
function mergeSurveys(surveys){
  const results={};
  for(const data of surveys)for(const [program,result] of Object.entries(data.results||{})){
    if(Object.hasOwn(results,program))throw new Error(`DUPLICATE_SURVEY_PROGRAM:${program}`);
    results[program]=result;
  }
  return {observedOn:surveys.map(data=>data.observedOn).filter(Boolean).sort().pop()||null,results};
}
const survey=mergeSurveys(SURVEYS);
const {presetIdForLabel}=require('./ecountPageActions.cjs');

const RESET_LABELS=Object.freeze(['다시 작성','다시작성']);
const SEARCH_LABEL='검색(F8)';
const TOGGLE_LABEL='Search(F3)';
const KINDS=Object.freeze(['list','input','report','settings','hub']);
const DATE_MODES=Object.freeze(['range','single','none']);
// 조사 ctx 코드(T/S/B/D/O 확장형) → button-matches source.context 와 같은 5개 그룹. scripts/ecount-ingest-source-survey.cjs 의 contextGroup 과 같은 규칙.
function contextGroup(ctx){
  const s=String(ctx==null?'':ctx).trim();
  if(!s)return '기타';
  if(/^dialog:/i.test(s))return '대화상자';
  if(/toolbar-collapse/i.test(s))return '하단';
  if(/header-search|btn-group/i.test(s))return '검색 패널';
  if(/wrapper-toolbar/i.test(s))return '상단';
  if(/대화상자|오버레이|선택창|dialog|popup|modal/i.test(s))return '대화상자';
  if(/하단/.test(s))return '하단';
  if(/검색/.test(s))return '검색 패널';
  if(/상단/.test(s))return '상단';
  return '기타';
}
function buttonGroup(context){return /대화상자$/.test(String(context||''))?'대화상자':contextGroup(context);}
function normalizeLabel(label){
  return String(label==null?'':label).normalize('NFKC').replace(/[\s​-‍﻿]+/g,'').replace(/[（]/g,'(').replace(/[）]/g,')').replace(/[［]/g,'[').replace(/[］]/g,']');
}
function presetState(label){
  try{return presetIdForLabel(label)==null?'reset':'enabled';}
  catch(error){return error.message==='UNVERIFIED_PRESET'?'unverified':'not-preset';}
}
// 라벨 기반 화면 종류. 우선순위: input(찾기(F3)+저장(F8)) > settings(저장(F8)만) > list(신규(F2)+사용중단/재사용) > report(검색(F8)) > hub(전표입력만 또는 조사 메모의 hub/folder/landing) > settings(그 밖).
function kindOf(labels,note=''){
  const has=label=>labels.has(normalizeLabel(label));
  if(has('찾기(F3)')&&has('저장(F8)'))return 'input';
  // P020~P039 매출전표 I·매입전표 I 처럼 찾기(F3) 없이 저장(F8)+저장/전표(F7) 를 가진 전표 입력 화면(P008~P019 72화면 판정은 바뀌지 않음).
  if(has('저장(F8)')&&has('저장/전표(F7)'))return 'input';
  if(has('저장(F8)'))return 'settings';
  if(has('신규(F2)')&&has('사용중단/재사용'))return 'list';
  if(has(SEARCH_LABEL))return 'report';
  if(has('전표입력')||/hub|folder|landing/i.test(String(note||'')))return 'hub';
  return 'settings';
}
const DATE_TOKEN=/^\d{2}\/\d{2}$/;
// P020~P039 조사 panelText 는 날짜 위젯을 '26 / 09 /' 처럼 공백·끝 슬래시를 넣어 적었다. 판정 전에 '26/09' 형태로만 붙인다(P008~P019 의 '26/10' 은 그대로).
function compactDates(panelText){
  return String(panelText||'').replace(/(?<![\d/])(\d{2})\s*\/\s*(\d{2})(?:\s*\/(?=\s|$))?(?![\d/])/g,'$1/$2');
}
// panelText 의 날짜 위젯 읽기: 'yy/mm ~ yy/mm' 이면 range, 'yy/mm' 하나면 single, 없으면 none. 검색(F8) 이 있는 화면에서만 판정한다.
function dateModeOf(panelText,kind){
  if(!['list','report'].includes(kind))return 'none';
  const text=compactDates(panelText);
  if(/\d{2}\/\d{2}\s*~\s*\d{2}\/\d{2}/.test(text))return 'range';
  if(/\d{2}\/\d{2}/.test(text))return 'single';
  return 'none';
}
// 날짜 토큰 바로 앞의 라벨(직접입력·프리셋 라벨은 건너뜀). 없으면 기준일자.
function dateLabelOf(panelText,presetLabels){
  const tokens=compactDates(panelText).split(/\s+/).filter(Boolean);
  const index=tokens.findIndex(token=>DATE_TOKEN.test(token));
  if(index<0)return '기준일자';
  let cursor=index-1;
  while(cursor>=0&&(tokens[cursor]==='직접입력'||presetLabels.has(normalizeLabel(tokens[cursor]))||presetState(tokens[cursor])!=='not-preset'))cursor--;
  return cursor>=0?tokens[cursor]:'기준일자';
}
// 검색 패널 폼 버튼 중 기존 새창(overlay)이 있는 거래처/품목/창고만 lookup 종류를 붙인다. '거래처(F2)' 같은 변형 포함, 그 밖 라벨은 자리표시 유지.
const LOOKUP_KINDS=Object.freeze({'거래처':'customer','품목':'product','창고':'warehouse'});
function lookupOf(label){
  const m=/^(거래처|품목|창고)(?:\(F\d+\))?$/.exec(normalizeLabel(label));
  return m?LOOKUP_KINDS[m[1]]:null;
}
function reasonFor(label){
  const n=normalizeLabel(label);
  if(/^저장/.test(n))return '원본 저장 계약 확정 전입니다.';
  if(/잔량재집계|회계반영/.test(n))return '원본 재집계·회계반영 동작은 클릭 금지 대상으로 기록되었습니다.';
  return null;// getStaticProps 직렬화를 위해 undefined 대신 null
}
function control(button,disabledIds){
  return {id:button.matchId,label:String(button.source.label||'').trim(),context:button.source.context,disabled:true,observedDisabled:disabledIds.has(button.matchId),reason:reasonFor(button.source.label)};
}
function fieldOf(field){
  const label=String(field.label||field.name||'').trim();
  if(!label)return null;
  return {label,type:String(field.type||'text').trim().toLowerCase()||'text',required:!!field.required};
}
function buildScreen(page,result){
  const program=page.program;
  const disabledIds=new Set(page.sourceSurvey?.disabledMatchIds||[]);
  const buttons=page.buttons.map(button=>control(button,disabledIds));
  // 조사 컨트롤 ↔ 버튼: 정규화 라벨+문맥 그룹으로 순서대로 하나씩 소비. 남는 컨트롤은 missing, 남는 버튼은 unmapped.
  const pool=new Map();
  buttons.forEach((button,index)=>{const key=`${normalizeLabel(button.label)}|${buttonGroup(button.context)}`;if(!pool.has(key))pool.set(key,[]);pool.get(key).push(index);});
  const used=new Set(),missing=[];
  for(const entry of Array.isArray(result.controls)?result.controls:[]){
    const [rawLabel,rawDomId,,ctx]=Array.isArray(entry)?entry:[entry?.label,entry?.domId,entry?.disabled,entry?.ctx];
    let label=String(rawLabel==null?'':rawLabel).trim();
    if(!label&&rawDomId)label=`[${String(rawDomId).trim()}]`;
    if(!label)continue;
    const free=pool.get(`${normalizeLabel(label)}|${contextGroup(ctx)}`);
    if(free&&free.length){used.add(free.shift());continue;}
    missing.push({program,label,context:contextGroup(ctx)});
  }
  const unmapped=buttons.filter((_,index)=>!used.has(index)).map(button=>button.id);
  const labels=new Set(buttons.map(button=>normalizeLabel(button.label)));
  const note=typeof result.note==='string'?result.note:'';
  const kind=kindOf(labels,note);
  const surveyPresetLabels=new Set((Array.isArray(result.presets)?result.presets:[]).map(entry=>normalizeLabel(Array.isArray(entry)?entry[0]:entry?.label)).filter(label=>label&&label!=='initial'));
  const dateMode=dateModeOf(result.panelText,kind);
  const groups={'상단':[],'검색 패널':[],'하단':[],'기타':[],'대화상자':[]};
  for(const button of buttons)groups[buttonGroup(button.context)].push(button);
  // P020~P039 조사는 Search(F3) 를 ctx 'other'(기타)로 기록했다. 상단에 없으면 기타에서 찾아 도구줄 맨 앞 토글로 옮긴다(ID 그대로, 한 그룹에만 속함).
  const isToggle=button=>normalizeLabel(button.label)===normalizeLabel(TOGGLE_LABEL);
  let toggle=groups['상단'].find(isToggle)||null;
  if(!toggle){toggle=groups['기타'].find(isToggle)||null;if(toggle){groups['기타']=groups['기타'].filter(button=>button!==toggle);groups['상단'].unshift(toggle);}}
  const toolbar=groups['상단'].map(button=>button===toggle?{...button,disabled:false,role:'toggle'}:button);
  const presets=[],formButtons=[];let searchId=null,resetId=null,resetLabel=null;
  for(const button of groups['검색 패널']){
    const n=normalizeLabel(button.label);
    if(n===normalizeLabel(SEARCH_LABEL)&&!searchId){searchId=button.id;continue;}
    if(RESET_LABELS.map(normalizeLabel).includes(n)&&!resetId){resetId=button.id;resetLabel=button.label;continue;}
    const state=presetState(button.label);
    if(state==='enabled'||state==='unverified'){presets.push({id:button.id,label:button.label,enabled:state==='enabled'&&surveyPresetLabels.has(n),observed:surveyPresetLabels.has(n)});continue;}
    const lookup=lookupOf(button.label);
    formButtons.push(lookup?{...button,lookup}:button);
  }
  const fields=(Array.isArray(page.sourceFields)?page.sourceFields:[]).map(fieldOf).filter(Boolean);
  return {
    program,title:String(page.title||result.title||program),kind,note,
    toolbar,searchToggleId:toggle?toggle.id:null,
    searchPanel:{dateMode,dateLabel:dateMode==='none'?null:dateLabelOf(result.panelText,surveyPresetLabels),presets,searchId,resetId,resetLabel,formButtons},
    footer:groups['하단'],other:[...groups['기타'],...groups['대화상자']],fields,
    ids:buttons.map(button=>button.id),missing,unmapped
  };
}
// report.pages × survey.results 교집합만 정의한다(둘 중 하나라도 없으면 화면을 만들지 않는다).
function buildScreens(reportData=report,surveyData=survey){
  const pages=new Map((reportData.pages||[]).map(page=>[page.program,page]));
  const screens={},missing=[],unmapped=[],skipped=[];
  for(const program of Object.keys(surveyData.results||{}).sort()){
    const page=pages.get(program);
    if(!page||!Array.isArray(page.buttons)){skipped.push(program);continue;}
    const screen=buildScreen(page,surveyData.results[program]||{});
    screens[program]=screen;
    missing.push(...screen.missing);
    unmapped.push(...screen.unmapped.map(id=>({program,id})));
  }
  return {screens,missing,unmapped,skipped,observedOn:surveyData.observedOn};
}
const built=buildScreens();
const SCREENS=Object.freeze(built.screens);
// 페이지 props 용 축약본: 렌더에 필요 없는 ids/missing/unmapped/observedDisabled 를 빼 getStaticProps 직렬화 크기를 줄인다(ID 는 각 컨트롤 id 에 그대로 있다).
function clientScreens(screens=SCREENS){
  const slim=button=>{const {observedDisabled,...rest}=button;return rest;};
  return Object.fromEntries(Object.entries(screens).map(([program,screen])=>[program,{program:screen.program,title:screen.title,kind:screen.kind,toolbar:screen.toolbar.map(slim),searchToggleId:screen.searchToggleId,searchPanel:{...screen.searchPanel,formButtons:screen.searchPanel.formButtons.map(slim)},footer:screen.footer.map(slim),other:screen.other.map(slim),fields:screen.fields}]));
}
function getScreen(program){return typeof program==='string'&&Object.hasOwn(SCREENS,program)?SCREENS[program]:null;}
function summary(screens=SCREENS){
  const list=Object.values(screens);
  const count=(key,values)=>Object.fromEntries(values.map(value=>[value,list.filter(screen=>(key==='dateMode'?screen.searchPanel.dateMode:screen[key])===value).length]));
  const presets=list.flatMap(screen=>screen.searchPanel.presets);
  return {screens:list.length,ids:list.reduce((total,screen)=>total+screen.ids.length,0),kinds:count('kind',KINDS),dateModes:count('dateMode',DATE_MODES),presets:{total:presets.length,enabled:presets.filter(preset=>preset.enabled).length,unverified:presets.filter(preset=>!preset.enabled).length}};
}
module.exports={SURVEY_FILES,mergeSurveys,SCREENS,clientScreens,PROGRAMS:Object.keys(SCREENS),MISSING:built.missing,UNMAPPED:built.unmapped,SKIPPED:built.skipped,SURVEY_OBSERVED_ON:built.observedOn,KINDS,DATE_MODES,RESET_LABELS,SEARCH_LABEL,TOGGLE_LABEL,buildScreens,buildScreen,getScreen,summary,kindOf,dateModeOf,dateLabelOf,contextGroup,normalizeLabel,compactDates,presetState,reasonFor,lookupOf,LOOKUP_KINDS};
