'use strict';
// 2026-10-21 P008~P019 72화면 + P020~P039 90화면 조사 → 대상 셸 정의(lib/ecountSurveyScreens.cjs) → SurveyScreen SSR.
// 검증: 72화면 전부 정의, 프로그램별 ID 집합 == button-matches 의 matchId 집합(없는 ID 생성 금지·누락 없음), SSR 에서 ID 전수 출력,
// 관측 프리셋만 활성·미관측은 비활성, 저장 계열 비활성(사유 툴팁), kind/dateMode 판정표, 관측 프리셋 날짜값이 datePreset 과 일치.
// 원본 ECOUNT 기능 동등성은 검증하지 않는다(라벨·문맥·프리셋 날짜만 근거).
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const babel=require('next/dist/compiled/babel/core');
const root=path.join(__dirname,'..'),cache=new Map();
const styles=new Proxy({},{get:(_,key)=>key==='__esModule'?false:key});
function compile(source,filename){return babel.transformSync(source,{filename,babelrc:false,configFile:false,presets:[[require('next/babel'),{'preset-env':{modules:'commonjs'}}]]}).code;}
function load(relative){
  const file=path.resolve(root,relative);if(cache.has(file))return cache.get(file).exports;
  const module={exports:{}};cache.set(file,module);
  const localRequire=id=>id.endsWith('.css')?styles:id.endsWith('.cjs')?require(path.resolve(path.dirname(file),id)):id.startsWith('.')?load(path.relative(root,path.resolve(path.dirname(file),id.endsWith('.js')?id:id+'.js'))):require(id);
  vm.runInNewContext(compile(fs.readFileSync(file,'utf8'),file),{module,exports:module.exports,require:localRequire,process,console,setTimeout,window:undefined},{filename:file});return module.exports;
}
const lib=require('../lib/ecountSurveyScreens.cjs');
const pageActions=require('../lib/ecountPageActions.cjs');
const report=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/button-matches.json'),'utf8'));
const survey=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/evidence/2026-10-21-source-survey-p008-p019.json'),'utf8'));
// P020~P039: 2026-10-21 조사(97화면) + 2026-10-22 이어서 조사(28화면)를 한 묶음으로 본다.
const survey2a=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/evidence/2026-10-21-source-survey-p020-p039.json'),'utf8'));
const survey2b=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/evidence/2026-10-22-source-survey-p020-p039-rest.json'),'utf8'));
const survey2={results:{...survey2a.results,...survey2b.results}};
const component=load('components/ecount/SurveyScreen.js');
const {SurveyScreen,UNCOLLECTED_MESSAGE,SAVE_PENDING_REASON}=component;
const {SOURCE_SAVE_MATCH_ID}=load('components/ecount/InputDraftForm.js');
// vm 모듈 realm 의 객체는 deepStrictEqual 과 prototype 이 달라 로컬 객체로 복사한다.
const presetDraft=args=>({...component.presetDraft(args)});
const SURVEY_PROGRAMS=Object.keys(survey.results).sort();
const SURVEY2_PROGRAMS=Object.keys(survey2.results).sort();
// 2026-10-22 관찰 사용 화면 8 + 선행 조사 5 (scope-decisions.json surveyedUsed).
const survey3=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/evidence/2026-10-22-source-survey-used-p040-p047.json'),'utf8'));
const SURVEY3_PROGRAMS=Object.keys(survey3.results).sort();
const ALL_PROGRAMS=[...SURVEY_PROGRAMS,...SURVEY2_PROGRAMS,...SURVEY3_PROGRAMS].sort();
const RESET=new Set(lib.RESET_LABELS);
function buttons(html){
  const found=[];const re=/<button([^>]*)>([^<]*)<\/button>/g;let m;
  while((m=re.exec(html))){const attrs=m[1];const id=/data-ecount-action-id="([^"]*)"/.exec(attrs);found.push({label:m[2],disabled:/\sdisabled(=""|\s|$)/.test(attrs+' '),id:id?id[1]:undefined,type:(/type="([^"]*)"/.exec(attrs)||[])[1]});}
  return found;
}
function render(screen,props={}){return renderToStaticMarkup(React.createElement(SurveyScreen,{screen,defaultSearchOpen:true,...props}));}
// 라벨 기반 판정표(렌더 형태 선택용, 원본 기능 동등성 아님). 조사 또는 판정 규칙이 바뀌면 여기서 드러난다.
const EXPECTED_KINDS={
  list:['E010101','E010105','E010110','E010112','E040102','E040103','E040104','E040114','E040124'],
  input:['E040203','E040205','E040253','E040301','E040501','E040503','E040507'],
  settings:['E040111','E040113','E040125','E040126','E040607'],
  hub:['C000097','E040627','E040633'],
};
const EXPECTED_SINGLE=['E040211','E040228','E040319','E040703','E040720','E040721','E040722','E040807'];
const EXPECTED_NO_DATE_REPORTS=['E040120','E040122'];
// P020~P039 90화면 판정표(같은 라벨 규칙 + 저장(F8)+저장/전표(F7) 입력 규칙, '26 / 09 /' 날짜 표기 정규화).
const EXPECTED_KINDS_2={
  list:['E010103','E010104','E010107','E010109','E010114','E010118','E010610','E040617','E061001'],
  input:['E010201','E010301','E010303','E010403','E010408','E010505','E010611','E010612','E040601','E040605','E040624'],
  settings:['C000053','E010106','E010111','E010705','E010817','E040602','E040606','E040634','E040802'],
};
const EXPECTED_SINGLE_2=['E010209','E010613','E010813','E010822','E010823','E010844','E040414','E040436','E040619','E041018'];
const EXPECTED_NO_DATE_REPORTS_2=['E010861','E040636','E040804','E040805','E040808','E040809'];

test('every surveyed program (72) has a screen definition built only from button-matches ids',()=>{
  assert.equal(SURVEY_PROGRAMS.length,72);
  assert.equal(SURVEY2_PROGRAMS.length,125);
  assert.deepEqual(SURVEY_PROGRAMS.filter(program=>SURVEY2_PROGRAMS.includes(program)),[],'no program in both surveys');
  assert.deepEqual(lib.PROGRAMS,ALL_PROGRAMS);
  assert.equal(SURVEY3_PROGRAMS.length,13);
  assert.equal(lib.PROGRAMS.length,210);
  assert.deepEqual(lib.SKIPPED,[]);
  assert.deepEqual(lib.MISSING,[],'survey controls without a button-matches id must be reported, never invented');
  assert.deepEqual(lib.UNMAPPED,[]);
  let total=0;
  for(const program of SURVEY_PROGRAMS){
    const screen=lib.SCREENS[program];
    const page=report.pages.find(item=>item.program===program);
    const expected=page.buttons.map(button=>button.matchId).sort();
    assert.deepEqual([...screen.ids].sort(),expected,`${program} id set`);
    assert.equal(new Set(screen.ids).size,screen.ids.length,`${program} duplicate ids`);
    assert.ok(screen.ids.every(id=>id.startsWith(program+'-A')),`${program} foreign id`);
    // 모든 컨트롤이 정확히 한 그룹에만 속한다.
    const grouped=[...screen.toolbar,...screen.searchPanel.formButtons,...screen.searchPanel.presets,...screen.footer,...screen.other].map(item=>item.id).concat([screen.searchPanel.searchId,screen.searchPanel.resetId].filter(Boolean));
    assert.deepEqual([...grouped].sort(),expected,`${program} grouped ids`);
    assert.ok(lib.KINDS.includes(screen.kind)&&lib.DATE_MODES.includes(screen.searchPanel.dateMode),program);
    assert.ok(screen.title,program);
    total+=screen.ids.length;
  }
  assert.equal(total,974);
  let total2=0;
  for(const program of SURVEY2_PROGRAMS){
    const screen=lib.SCREENS[program];
    const expected=report.pages.find(item=>item.program===program).buttons.map(button=>button.matchId).sort();
    assert.deepEqual([...screen.ids].sort(),expected,`${program} id set`);
    assert.ok(screen.ids.every(id=>id.startsWith(program+'-A')),`${program} foreign id`);
    const grouped=[...screen.toolbar,...screen.searchPanel.formButtons,...screen.searchPanel.presets,...screen.footer,...screen.other].map(item=>item.id).concat([screen.searchPanel.searchId,screen.searchPanel.resetId].filter(Boolean));
    assert.deepEqual([...grouped].sort(),expected,`${program} grouped ids`);
    total2+=screen.ids.length;
  }
  assert.equal(total2,1696);
  const oldSummary=lib.summary(Object.fromEntries(SURVEY_PROGRAMS.map(program=>[program,lib.SCREENS[program]])));
  assert.deepEqual(oldSummary.kinds,{list:9,input:7,report:48,settings:5,hub:3});
  assert.deepEqual(oldSummary.dateModes,{range:38,single:8,none:26});
  assert.deepEqual(oldSummary.presets,{total:307,enabled:307,unverified:0});
  const summary=lib.summary();
  console.log('SURVEY_SCREENS',JSON.stringify(summary));
  assert.equal(summary.screens,210);
  assert.equal(summary.ids,2794);
  assert.deepEqual(summary.kinds,{list:18,input:20,report:153,settings:16,hub:3});
  assert.deepEqual(summary.dateModes,{range:124,single:20,none:66});
  assert.deepEqual(summary.presets,{total:904,enabled:903,unverified:1});
  // DATASETS(기존 33화면) 프로그램은 조사 셸 대상이 아니다.
  const workbench=fs.readFileSync(path.join(root,'pages/ecount/workbench.js'),'utf8');
  const datasets=Object.keys(Function(`return (${/const DATASETS = (\{[^}]*\})/.exec(workbench)[1]})`)());
  assert.equal(datasets.length,33);
  assert.deepEqual(lib.PROGRAMS.filter(program=>datasets.includes(program)),[]);
  assert.throws(()=>lib.mergeSurveys([{results:{E010101:{}}},{results:{E010101:{}}}]),/DUPLICATE_SURVEY_PROGRAM:E010101/);
});
test('P020~P039 kind and dateMode classification table',()=>{
  for(const [kind,programs] of Object.entries(EXPECTED_KINDS_2))for(const program of programs)assert.equal(lib.SCREENS[program].kind,kind,program);
  const reports=SURVEY2_PROGRAMS.filter(program=>!Object.values(EXPECTED_KINDS_2).flat().includes(program));
  assert.equal(reports.length,96);
  for(const program of reports){
    const screen=lib.SCREENS[program];
    assert.equal(screen.kind,'report',program);
    assert.ok(screen.searchPanel.searchId,`${program} report needs 검색(F8)`);
    const expectedMode=EXPECTED_SINGLE_2.includes(program)?'single':EXPECTED_NO_DATE_REPORTS_2.includes(program)?'none':'range';
    assert.equal(screen.searchPanel.dateMode,expectedMode,program);
  }
  for(const program of [...EXPECTED_KINDS_2.input,...EXPECTED_KINDS_2.settings])assert.equal(lib.SCREENS[program].searchPanel.dateMode,'none',program);
  for(const program of EXPECTED_KINDS_2.list){assert.equal(lib.SCREENS[program].searchPanel.dateMode,'none',program);assert.ok(lib.SCREENS[program].searchToggleId,`${program} list has Search(F3)`);}
  // 조사 ctx 'other' 로 기록된 Search(F3) 는 도구줄 토글로 옮겨지고 ID 는 그대로다.
  const toggle=lib.SCREENS.E010103.toolbar.find(button=>button.role==='toggle');
  assert.equal(toggle.id,lib.SCREENS.E010103.searchToggleId);
  assert.equal(report.pages.find(page=>page.program==='E010103').buttons.find(button=>button.matchId===toggle.id).source.label,'Search(F3)');
  assert.equal(lib.SCREENS.E010851.searchPanel.dateLabel,'발송일자');
  assert.equal(lib.SCREENS.E061003.searchPanel.dateLabel,'이체요청일자');
  assert.equal(lib.SCREENS.E040414.searchPanel.dateLabel,'기준일(영업주기)');
  assert.equal(lib.compactDates('기준일자 26 / 09 / ~ 26 / 10 / 26/10 2026/10/21'),'기준일자 26/09 ~ 26/10 26/10 2026/10/21');
  // 7종 계약 밖 입력 화면은 InputDraftForm 없이 읽기 전용 입력칸 + 저장 계열 비활성.
  for(const program of EXPECTED_KINDS_2.input){assert.ok(!SOURCE_SAVE_MATCH_ID[program],program);assert.ok(lib.SCREENS[program].fields.length>0,program);}
});
test('kind and dateMode classification table',()=>{
  for(const [kind,programs] of Object.entries(EXPECTED_KINDS))for(const program of programs)assert.equal(lib.SCREENS[program].kind,kind,program);
  const reports=SURVEY_PROGRAMS.filter(program=>!Object.values(EXPECTED_KINDS).flat().includes(program));
  assert.equal(reports.length,48);
  for(const program of reports){
    const screen=lib.SCREENS[program];
    assert.equal(screen.kind,'report',program);
    assert.ok(screen.searchPanel.searchId,`${program} report needs 검색(F8)`);
    const expectedMode=EXPECTED_SINGLE.includes(program)?'single':EXPECTED_NO_DATE_REPORTS.includes(program)?'none':'range';
    assert.equal(screen.searchPanel.dateMode,expectedMode,program);
  }
  for(const program of [...EXPECTED_KINDS.input,...EXPECTED_KINDS.settings,...EXPECTED_KINDS.hub])assert.equal(lib.SCREENS[program].searchPanel.dateMode,'none',program);
  for(const program of EXPECTED_KINDS.list){assert.equal(lib.SCREENS[program].searchPanel.dateMode,'none',program);assert.ok(lib.SCREENS[program].searchToggleId,`${program} list has Search(F3)`);}
  assert.equal(lib.SCREENS.E040211.searchPanel.dateLabel,'기준일자(영업주기)');
  assert.equal(lib.SCREENS.E040319.searchPanel.dateLabel,'기준일(영업주기)');
  assert.equal(lib.SCREENS.E040730.searchPanel.dateLabel,'전표일자');
  assert.equal(lib.SCREENS.E040254.searchPanel.dateLabel,'결제요청일자');
  assert.equal(lib.SCREENS.E040716.searchPanel.dateLabel,'작업일자');
  assert.equal(lib.SCREENS.E040230.searchPanel.dateLabel,'기준일자');
  // 입력 화면은 읽기 전용 입력칸을 가진다(조사 sourceFields 기준, 개인정보 기본값 없음).
  for(const program of EXPECTED_KINDS.input)assert.ok(lib.SCREENS[program].fields.length>0,program);
  assert.ok(lib.SCREENS.E040203.fields.every(field=>typeof field.label==='string'&&typeof field.type==='string'&&typeof field.required==='boolean'));
});
test('presets: only labels mapped by presetIdForLabel are enabled; unverified labels stay placeholders',()=>{
  const unverified=[];
  for(const program of ALL_PROGRAMS){
    const screen=lib.SCREENS[program];
    for(const preset of screen.searchPanel.presets){
      let id=null,unverifiedLabel=false;
      try{id=pageActions.presetIdForLabel(preset.label);}catch(e){unverifiedLabel=e.message==='UNVERIFIED_PRESET';assert.ok(unverifiedLabel,`${program} ${preset.label} unknown label listed as preset`);}
      assert.equal(preset.enabled,id!=null&&preset.observed,`${program} ${preset.label}`);
      if(!preset.enabled)unverified.push(`${program}:${preset.label}`);
    }
  }
  assert.deepEqual(unverified,['E040637:3개월']);
});
// P020~P039 중 관측 날짜를 대조할 수 없는 화면: E010813 재무상태표는 기준일자가 년/월 위젯('26 / 10')인데 조사 판독이 뒤 숫자를 일(day)로 읽었다.
// 날짜값이 비어(null) 판독되지 않은 관측(E010819·E040414·E040436·E040637)은 아래에서 건너뛰고 수를 고정한다.
const UNREADABLE_DATE_PROGRAMS=new Set(['E010813']);
test('observed preset date values match datePreset (range screens from~to, single screens end date)',()=>{
  let checked=0,unread=0;
  for(const program of ALL_PROGRAMS){
    const screen=lib.SCREENS[program];
    if(/unreliable/i.test(screen.note)||UNREADABLE_DATE_PROGRAMS.has(program))continue;
    const page=report.pages.find(item=>item.program===program);
    let currentTo=null;
    for(const observed of page.sourcePresets||[]){
      if(observed.label==='initial'||RESET.has(observed.label)){currentTo=observed.to;continue;}
      const preset=screen.searchPanel.presets.find(item=>item.label===observed.label);
      if(!preset||!preset.enabled){currentTo=observed.to;continue;}
      if(observed.from==null&&observed.to==null){assert.ok(SURVEY2_PROGRAMS.includes(program),`${program} ${observed.label} unread`);unread++;currentTo=null;continue;}
      const expected=pageActions.datePreset(pageActions.presetIdForLabel(observed.label),page.sourceSurvey?.observedOn||'2026-10-21',{weekStartsOn:0,currentTo});// 조사일 기준(2026-10-22 이어서 조사분 포함)
      if(screen.searchPanel.dateMode==='range')assert.deepEqual({from:observed.from,to:observed.to},expected,`${program} ${observed.label}`);
      else assert.equal(observed.to,expected.to,`${program} ${observed.label} end date`);
      currentTo=observed.to;checked++;
    }
  }
  console.log('PRESET_VALUES_CHECKED',checked,'unread',unread);
  assert.ok(checked>=290+383,`checked ${checked}`);
  assert.equal(unread,64);
});
test('SSR renders every button-matches id exactly once with the observed activation rules',()=>{
  let active=0,placeholders=0;
  for(const program of ALL_PROGRAMS){
    const screen=lib.SCREENS[program];
    const html=render(screen);
    const rendered=buttons(html);
    const ids=rendered.map(button=>button.id).filter(Boolean);
    assert.deepEqual([...ids].sort(),[...screen.ids].sort(),`${program} rendered ids`);
    assert.equal(new Set(ids).size,ids.length,`${program} id rendered twice`);
    assert.ok(html.includes(`data-ecount-survey-screen="${program}"`));
    for(const button of rendered){
      const expectActive=button.id===screen.searchToggleId||button.id===screen.searchPanel.searchId||button.id===screen.searchPanel.resetId||screen.searchPanel.presets.some(preset=>preset.id===button.id&&preset.enabled)||screen.searchPanel.formButtons.some(item=>item.id===button.id&&item.lookup);
      assert.equal(!button.disabled,expectActive,`${program} ${button.label} (${button.id}) enabled=${!button.disabled}`);
      if(expectActive)active++;else placeholders++;
      if(/^저장/.test(button.label)){assert.ok(button.disabled,`${program} ${button.label}`);assert.ok(html.includes(`title="${SAVE_PENDING_REASON}"><button data-ecount-action-id="${button.id}"`),`${program} ${button.label} reason tooltip`);}
    }
    if(screen.searchPanel.searchId)assert.equal(rendered.find(button=>button.id===screen.searchPanel.searchId).type,'submit');
    if(screen.kind==='input'&&!SOURCE_SAVE_MATCH_ID[program]){assert.ok(html.includes('입력 화면 자리표시입니다.'),program);assert.ok(!html.includes('웹 전용 초안(ecount_work.InputDraft)'),`${program} must not attach InputDraftForm`);assert.equal((html.match(/<(?:input|select|textarea)[^>]*disabled/g)||[]).length,screen.fields.length,`${program} read-only fields`);}
    else if(screen.kind==='input'){assert.ok(html.includes('웹 전용 초안(ecount_work.InputDraft)'),`${program} draft form notice`);assert.ok(html.includes('입력 항목(읽기 전용'),program);assert.ok(!html.includes(UNCOLLECTED_MESSAGE),program);assert.equal((html.match(/<(?:input|select|textarea)[^>]*disabled/g)||[]).length,screen.fields.length,`${program} read-only fields`);}
    else if(screen.kind!=='hub')assert.ok(html.includes(UNCOLLECTED_MESSAGE),program);
    if(screen.searchPanel.dateMode==='range'){assert.match(html,/aria-label="조회 시작일"/);assert.match(html,/aria-label="조회 종료일"/);}
    else if(screen.searchPanel.dateMode==='single'){assert.match(html,/aria-label="기준일자"/);assert.doesNotMatch(html,/aria-label="조회 종료일"/);}
    else assert.doesNotMatch(html,/type="date"/);
  }
  console.log('SURVEY_SCREEN_BUTTONS active',active,'placeholders',placeholders);
  assert.equal(active+placeholders,2794);
  const screens=ALL_PROGRAMS.map(program=>lib.SCREENS[program]);
  const expectedActive=screens.filter(screen=>screen.searchToggleId).length+screens.filter(screen=>screen.searchPanel.searchId).length+screens.filter(screen=>screen.searchPanel.resetId).length+screens.reduce((total,screen)=>total+screen.searchPanel.presets.filter(preset=>preset.enabled).length,0)+screens.reduce((total,screen)=>total+screen.searchPanel.formButtons.filter(item=>item.lookup).length,0);
  assert.equal(active,expectedActive);
});
test('Search(F3) screens hide the search panel until toggled; toggle keeps its id and aria state',()=>{
  const screen=lib.SCREENS.E010101;
  const closed=buttons(renderToStaticMarkup(React.createElement(SurveyScreen,{screen})));
  assert.equal(closed.length,screen.toolbar.length+screen.footer.length+screen.other.length);
  const toggle=closed.find(button=>button.id===screen.searchToggleId);
  assert.ok(toggle&&!toggle.disabled&&toggle.label==='Search(F3)');
  const open=render(screen);
  assert.match(open,/aria-expanded="true"/);
  assert.ok(buttons(open).some(button=>button.id===screen.searchPanel.searchId));
  const always=lib.SCREENS.E040806;
  assert.equal(always.searchToggleId,null);
  assert.ok(buttons(renderToStaticMarkup(React.createElement(SurveyScreen,{screen:always}))).some(button=>button.id===always.searchPanel.searchId),'no-toggle screens show the panel by default');
  const busy=buttons(render(screen,{busy:true}));
  assert.ok(busy.every(button=>button.disabled));
});
test('presetDraft changes dates only: range screens from~to, single screens one date; unverified/unknown labels refuse',()=>{
  const range=lib.SCREENS.E040806,single=lib.SCREENS.E040721,endOnly=lib.SCREENS.E040211;
  assert.deepEqual(presetDraft({screen:range,label:'전월',today:'2026-10-21'}),{from:'2026-09-01',to:'2026-09-30'});
  assert.deepEqual(presetDraft({screen:range,label:'금주(~오늘)',today:'2026-10-21'}),{from:'2026-10-18',to:'2026-10-21'});
  assert.deepEqual(presetDraft({screen:lib.SCREENS.E040704,label:'종료일',draft:{from:'2026-10-01',to:'2026-10-21'},today:'2026-10-21'}),{from:'2026-10-21',to:'2026-10-21'});
  assert.throws(()=>presetDraft({screen:lib.SCREENS.E040704,label:'종료일',today:'2026-10-21'}),/CURRENT_END_REQUIRED/);
  assert.deepEqual(presetDraft({screen:single,label:'말일',today:'2026-10-21'}),{from:'2026-10-31',to:'2026-10-31'});
  assert.deepEqual(presetDraft({screen:endOnly,label:'전월',today:'2026-10-21'}),{from:'2026-09-30',to:'2026-09-30'});
  // 연말/연초·윤년
  assert.deepEqual(presetDraft({screen:range,label:'전월',today:'2026-01-01'}),{from:'2025-12-01',to:'2025-12-31'});
  assert.deepEqual(presetDraft({screen:single,label:'말일',today:'2028-02-10'}),{from:'2028-02-29',to:'2028-02-29'});
  assert.deepEqual(presetDraft({screen:lib.SCREENS.E040254,label:'최근7일',today:'2026-10-21'}),{from:'2026-10-14',to:'2026-10-21'});
  assert.throws(()=>presetDraft({screen:lib.SCREENS.E040637,label:'3개월',today:'2026-10-21'}),/PRESET_NOT_ENABLED/);
  assert.throws(()=>presetDraft({screen:range,label:'거래처',today:'2026-10-21'}),/PRESET_NOT_ENABLED/);
});
test('buildScreens never invents ids: a survey control without a button is reported as missing, extra buttons as unmapped',()=>{
  const page=structuredClone(report.pages.find(item=>item.program==='E040806'));
  const result=structuredClone(survey.results.E040806);
  result.controls.push(['새버튼','',0,'wrapper-toolbar']);
  page.buttons.push({...structuredClone(page.buttons[0]),matchId:'E040806-A99',source:{...page.buttons[0].source,stableId:'E040806-A99',label:'남는버튼',context:'하단'}});
  const built=lib.buildScreens({pages:[page]},{observedOn:'2026-10-21',results:{E040806:result}});
  assert.deepEqual(built.missing,[{program:'E040806',label:'새버튼',context:'상단'}]);
  assert.deepEqual(built.unmapped,[{program:'E040806',id:'E040806-A99'}]);
  assert.ok(!built.screens.E040806.ids.includes('E040806-A100'));
  assert.deepEqual(lib.buildScreens({pages:[]},{results:{E040806:result}}).skipped,['E040806']);
});
test('survey lookup windows: only 거래처/품목/창고 search-panel buttons are active, ids unchanged, others stay placeholders',()=>{
  const found=[];
  for(const program of lib.PROGRAMS)for(const button of lib.SCREENS[program].searchPanel.formButtons)if(button.lookup)found.push(`${program}:${button.label}:${button.lookup}`);
  assert.deepEqual(found,['E010101:거래처:customer','E040103:품목:product','E040122:품목:product']);
  assert.equal(lib.lookupOf('거래처(F2)'),'customer');
  assert.equal(lib.lookupOf('사원'),null);
  assert.equal(lib.lookupOf('프로젝트'),null);
  for(const program of lib.PROGRAMS){
    const expected=report.pages.find(page=>page.program===program).buttons.map(button=>button.matchId).sort();
    assert.deepEqual([...lib.SCREENS[program].ids].sort(),expected);
    const html=render(lib.SCREENS[program]);
    const screen=lib.SCREENS[program];
    for(const button of buttons(html)){
      const lookup=screen.searchPanel.formButtons.find(item=>item.id===button.id&&item.lookup);
      if(lookup)assert.equal(button.disabled,false,`${button.id} lookup button must be active`);
      else if(screen.searchPanel.formButtons.some(item=>item.id===button.id))assert.equal(button.disabled,true,`${button.id} placeholder must stay disabled`);
    }
  }
});
