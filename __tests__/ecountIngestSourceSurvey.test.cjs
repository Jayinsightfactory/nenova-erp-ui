'use strict';
// scripts/ecount-ingest-source-survey.cjs: source button survey -> parity-inventory / button-matches / audit jsonl.
// Runs against temporary copies of a two-screen subset of the real data; the real data files are never touched.
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const root=path.join(__dirname,'..');
const ingestMod=require('../scripts/ecount-ingest-source-survey.cjs');
const {run,classifyLabel,normalizeLabel,contextGroup,surveyContextName,parsePreset,sanitizeField}=ingestMod;
const {validate}=require('../scripts/check-ecount-button-matches.cjs');
const realInventory=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/parity-inventory.json'),'utf8'));
const realReport=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/button-matches.json'),'utf8'));
const EXISTING='E040708';// screen that already has observed buttons
const FRESH=realInventory.screens.find(s=>s.actions.length===0&&realReport.pages.find(p=>p.program===s.id&&p.buttons.length===0)).id;
const AUDIT_LINE='{"id":"SRC-20261020-FIXTURE","program":"E040708","action":"fixture","classification":"read","result":"fixture","observedOn":"2026-10-20","recordKind":"reported-observation","sourceReporter":"root","coverage":"fixture","sourceMutation":false,"businessValuesRecorded":false}\n';

function fixtureDir(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ecount-survey-'));
  const inventory={...realInventory,screens:realInventory.screens.filter(s=>s.id===EXISTING||s.id===FRESH).map(s=>structuredClone(s))};
  const report={...realReport,pages:realReport.pages.filter(p=>p.program===EXISTING||p.program===FRESH).map(p=>structuredClone(p))};
  fs.writeFileSync(path.join(dir,'parity-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
  fs.writeFileSync(path.join(dir,'button-matches.json'),JSON.stringify(report,null,1)+'\n');
  fs.writeFileSync(path.join(dir,'source-action-audit.jsonl'),AUDIT_LINE);
  return dir;
}
const read=(dir,f)=>fs.readFileSync(path.join(dir,f),'utf8');
const loadJson=(dir,f)=>JSON.parse(read(dir,f));
function writeSurvey(dir,results,observedOn='2026-10-21'){const p=path.join(dir,'survey.json');fs.writeFileSync(p,JSON.stringify({observedOn,results}));return p;}
function validated(dir){const errors=validate(loadJson(dir,'button-matches.json'),loadJson(dir,'parity-inventory.json'));assert.deepEqual(errors,[]);}
const existingScreen=realInventory.screens.find(s=>s.id===EXISTING);
const existingPage=realReport.pages.find(p=>p.program===EXISTING);

test('(a) fresh screen: controls become A01.. actions and buttons with the E040708 button shape',()=>{
  const dir=fixtureDir();
  const survey=writeSurvey(dir,{[FRESH]:{title:'x',panelText:'PANEL_SENTINEL',controls:[
    ['검색(F8)','btnSearch',0,'header-search-btn-group'],['저장','btnSave',0,'DIV.wrapper-toolbar'],['닫기','btnClose',0,'dialog:거래처 조회'],
    ['Option','btnOpt',1,'DIV.wrapper-toolbar toolbar-collapse wrapper'],['알수없음','',0,'body']],
    presets:[['금일','26 10 21 ~ 26 10 21'],['당월','26 10 01 ~ 26 10 31 extra tokens ignored']],
    fields:[['기간','date','from',1,'26/10/21',0]]}});
  const summary=run(survey,{date:'2026-10-21',dataDir:dir});
  assert.equal(summary.programs[FRESH].added,5);assert.equal(summary.programs[FRESH].matched,0);assert.equal(summary.totals.auditAppended,1);
  const inv=loadJson(dir,'parity-inventory.json'),rep=loadJson(dir,'button-matches.json');
  const screen=inv.screens.find(s=>s.id===FRESH),page=rep.pages.find(p=>p.program===FRESH);
  assert.deepEqual(screen.actions.map(a=>a.id),[1,2,3,4,5].map(n=>`${FRESH}-A0${n}`));
  assert.deepEqual(page.buttons.map(b=>b.matchId),screen.actions.map(a=>a.id));
  assert.deepEqual(screen.actions.map(a=>[a.label,a.context,a.classification]),[['검색(F8)','검색 패널','query'],['저장','상단','write'],['닫기','거래처 조회 대화상자','read'],['Option','하단','read'],['알수없음','기타','unknown']]);
  for(const a of screen.actions){assert.equal(a.stage,'observed');assert.equal(a.sourceExecuted,false);assert.deepEqual(a.evidence,[`source-action-audit.jsonl#SRC-20261021-${FRESH}-SURVEY`]);assert.deepEqual(a.testEvidence,[]);}
  assert.equal(screen.stage,'observed');assert.equal(screen.actionCount,null);assert.equal(screen.dimensions.buttons.stage,'observed');
  assert.equal(page.allSourceButtonsKnown,false);assert.equal(page.sourceButtonCount,null);assert.equal(page.status,'미검증');
  const sample=existingPage.buttons[0];
  for(const b of page.buttons){
    assert.deepEqual(Object.keys(b),Object.keys(sample));
    assert.deepEqual(Object.keys(b.source),['stableId','label','context','domId','evidence']);
    assert.deepEqual(Object.keys(b.conditions),Object.keys(sample.conditions));
    assert.deepEqual(Object.keys(b.comparisons.queryValues),Object.keys(sample.comparisons.queryValues));
    assert.equal(b.status,'미검증');assert.equal(b.target.actualStableId,null);assert.equal(b.target.requiredStableId,b.matchId);
    for(const c of ['label','function','window','queryValues'])assert.equal(b.comparisons[c].status,'미검증');
    assert.deepEqual(b.captures,{source:null,target:null});assert.deepEqual(b.limitations,[ingestMod.LIMITATION]);
  }
  assert.equal(page.buttons[0].source.domId,'btnSearch');assert.equal(page.buttons[4].source.domId,null);
  assert.deepEqual(page.sourcePresets,[{label:'금일',from:'2026-10-21',to:'2026-10-21'},{label:'당월',from:'2026-10-01',to:'2026-10-31'}]);
  assert.deepEqual(page.sourceFields,[{label:'기간',type:'date',name:'from',required:1,defaultValue:'26/10/21',readonly:0}]);
  assert.deepEqual(page.sourceSurvey.disabledMatchIds,[`${FRESH}-A04`]);
  const lines=read(dir,'source-action-audit.jsonl').trim().split('\n');assert.equal(lines.length,2);
  const rec=JSON.parse(lines[1]);
  assert.deepEqual(rec,{id:`SRC-20261021-${FRESH}-SURVEY`,program:FRESH,action:'button inventory survey',classification:'read',result:'5 controls, 2 presets observed',observedOn:'2026-10-21',recordKind:'automated-dom-survey',sourceReporter:'root',coverage:'visible controls after opening search panel; dropdown/overlay contents only if open',sourceMutation:false,businessValuesRecorded:false});
  validated(dir);
});

test('(b) existing screen: matchIds unchanged, matched controls skipped (normalized label + loose context), only new controls appended',()=>{
  const dir=fixtureDir();
  const a01=existingScreen.actions[0],a02=existingScreen.actions[1];
  assert.equal(a01.label,'Search(F3)');assert.equal(a02.label,'Option');
  const before=structuredClone(existingScreen.actions),beforeButtons=structuredClone(existingPage.buttons);
  const maxN=Math.max(...existingScreen.actions.map(a=>parseInt(a.id.split('-A')[1],10)));
  const survey=writeSurvey(dir,{[EXISTING]:{title:'일보',controls:[
    ['Search （ F3 ）','x',0,'DIV.wrapper-toolbar'],['Option','y',0,'DIV.wrapper-toolbar'],['완전히새로운버튼','z',1,'DIV.wrapper-toolbar toolbar-collapse wrapper']]}});
  const summary=run(survey,{date:'2026-10-21',dataDir:dir});
  assert.equal(summary.programs[EXISTING].matched,2);assert.equal(summary.programs[EXISTING].added,1);
  const inv=loadJson(dir,'parity-inventory.json'),rep=loadJson(dir,'button-matches.json');
  const screen=inv.screens.find(s=>s.id===EXISTING),page=rep.pages.find(p=>p.program===EXISTING);
  assert.deepEqual(screen.actions.slice(0,before.length),before,'existing actions must be byte-identical');
  assert.deepEqual(page.buttons.slice(0,beforeButtons.length),beforeButtons,'existing buttons must be byte-identical');
  assert.equal(screen.actions.length,before.length+1);assert.equal(page.buttons.length,beforeButtons.length+1);
  const added=screen.actions[screen.actions.length-1];
  assert.equal(added.id,`${EXISTING}-A${String(maxN+1).padStart(2,'0')}`);assert.equal(added.label,'완전히새로운버튼');assert.equal(added.context,'하단');
  assert.equal(page.buttons[page.buttons.length-1].matchId,added.id);
  assert.equal(page.allSourceButtonsKnown,false);assert.equal(page.sourceButtonCount,null);
  assert.equal(page.sourceObservation!==undefined,existingPage.sourceObservation!==undefined,'other page keys preserved');
  validated(dir);
});

test('(c) idempotent: ingesting the same survey twice leaves all three files byte-identical',()=>{
  const dir=fixtureDir();
  const survey=writeSurvey(dir,{[EXISTING]:{controls:[['Search(F3)','x',0,'DIV.wrapper-toolbar'],['신규버튼','n',0,'body']],presets:[['금일','26 10 21 ~ 26 10 21']]},
    [FRESH]:{controls:[['검색(F8)','s',0,'header-search-btn-group'],['삭제','d',0,'DIV.wrapper-toolbar']],fields:[['기간','date','from',1,'',0]]}});
  const first=run(survey,{date:'2026-10-21',dataDir:dir});
  const snap=()=>['parity-inventory.json','button-matches.json','source-action-audit.jsonl'].map(f=>read(dir,f));
  const s1=snap();const second=run(survey,{date:'2026-10-21',dataDir:dir});const s2=snap();
  assert.deepEqual(s1,s2);
  assert.equal(first.totals.added,3);assert.equal(first.totals.auditAppended,2);
  assert.equal(second.totals.added,0);assert.equal(second.totals.auditAppended,0);assert.equal(second.totals.matched,4);
  const dry=run(survey,{date:'2026-10-21',dataDir:dir,dryRun:true});assert.equal(dry.dryRun,true);assert.deepEqual(snap(),s2);
  validated(dir);
});

test('(d) write-classified and unknown controls are never source-executable; query/read may be',()=>{
  const dir=fixtureDir();
  const survey=writeSurvey(dir,{[FRESH]:{controls:[['저장','a',0,'DIV.wrapper-toolbar'],['삭제','b',0,'DIV.wrapper-toolbar'],['회계반영','c',0,'DIV.wrapper-toolbar'],['전송','d',0,'DIV.wrapper-toolbar'],['마감','e',0,'DIV.wrapper-toolbar'],['검색조건저장','f',0,'header-search-btn-group'],['검색(F8)','g',0,'header-search-btn-group'],['닫기','h',0,'dialog:x'],['뭔가','i',0,'body']]}});
  run(survey,{date:'2026-10-21',dataDir:dir});
  const screen=loadJson(dir,'parity-inventory.json').screens.find(s=>s.id===FRESH);
  const by=Object.fromEntries(screen.actions.map(a=>[a.label,a]));
  for(const l of ['저장','삭제','회계반영','전송','마감','검색조건저장']){assert.equal(by[l].classification,'write',l);assert.equal(by[l].sourceExecutionAllowed,false,l);assert.equal(by[l].sourceExecuted,false,l);}
  assert.equal(by['검색(F8)'].classification,'query');assert.equal(by['검색(F8)'].sourceExecutionAllowed,true);assert.equal(by['검색(F8)'].sourceExecuted,false);
  assert.equal(by['닫기'].classification,'read');assert.equal(by['닫기'].sourceExecutionAllowed,true);
  assert.equal(by['뭔가'].classification,'unknown');assert.equal(by['뭔가'].sourceExecutionAllowed,false);
  for(const a of screen.actions)if(!['read','query','download'].includes(a.classification))assert.equal(a.sourceExecutionAllowed&&a.sourceExecuted,false);
  assert.equal(classifyLabel('금일'),'query');assert.equal(classifyLabel('이번주',new Set()),'query');assert.equal(classifyLabel('1개월',new Set([normalizeLabel('1개월')])),'query');
  validated(dir);
});

test('(e) personal data never stored: panelText dropped, person/customer field defaults redacted, order ignored',()=>{
  const dir=fixtureDir();
  const survey=writeSurvey(dir,{[FRESH]:{title:'x',panelText:'PANEL_SENTINEL 홍길동 010-1234-5678',controls:[['검색(F8)','s',0,'header-search-btn-group']],
    fields:[['담당자','text','emp_cd',0,'PERSON_SENTINEL',0],['거래처','text','cust_cd',0,'CUSTOMER_SENTINEL',0],['이메일','text','mail',0,'MAIL_SENTINEL@example.test',0],['기간','date','from',1,'26/10/21',0,'EXTRA_SENTINEL']],order:['ORDER_SENTINEL']}});
  run(survey,{date:'2026-10-21',dataDir:dir});
  const all=['parity-inventory.json','button-matches.json','source-action-audit.jsonl'].map(f=>read(dir,f)).join('\n');
  for(const s of ['PANEL_SENTINEL','홍길동','010-1234','PERSON_SENTINEL','CUSTOMER_SENTINEL','MAIL_SENTINEL','EXTRA_SENTINEL','ORDER_SENTINEL'])assert(!all.includes(s),s);
  const page=loadJson(dir,'button-matches.json').pages.find(p=>p.program===FRESH);
  assert.deepEqual(page.sourceFields.map(f=>[f.label,f.defaultValue,f.defaultRedacted||false]),[['담당자',null,true],['거래처',null,true],['이메일',null,true],['기간','26/10/21',false]]);
  for(const f of page.sourceFields)assert.deepEqual(Object.keys(f).filter(k=>k!=='defaultRedacted'),['label','type','name','required','defaultValue','readonly']);
  validated(dir);
});

test('helpers: label normalization, context groups, presets, field sanitizing, unknown program skipped',()=>{
  assert.equal(normalizeLabel(' Search （F3） '),'Search(F3)');assert.equal(normalizeLabel('검색 (F8)'),'검색(F8)');
  assert.deepEqual(['DIV.wrapper-toolbar','DIV.wrapper-header-search','header-search-btn-group','DIV.wrapper-toolbar toolbar-collapse wrapper','dialog:거래처','body','','상단','검색 패널','하단','매핑 선택창','거래처 검색 오버레이','인쇄 메뉴',undefined].map(contextGroup),
    ['상단','검색 패널','검색 패널','하단','대화상자','기타','기타','상단','검색 패널','하단','대화상자','대화상자','기타','기타']);
  assert.equal(surveyContextName('dialog:거래처 조회'),'거래처 조회 대화상자');assert.equal(surveyContextName('DIV.wrapper-header-search'),'검색 패널');
  assert.deepEqual(parsePreset(['금일','26 10 21 ~ 26 10 21']),{label:'금일',from:'2026-10-21',to:'2026-10-21'});
  assert.deepEqual(parsePreset(['이상','garbage']),{label:'이상',from:null,to:null});
  assert.deepEqual(sanitizeField(['기간','date','from',1,'26/10/21',1]),{label:'기간',type:'date',name:'from',required:1,defaultValue:'26/10/21',readonly:1});
  const dir=fixtureDir();const survey=writeSurvey(dir,{E999999:{controls:[['x','y',0,'body']]}});
  const summary=run(survey,{date:'2026-10-21',dataDir:dir});assert.deepEqual(summary.unknownPrograms,['E999999']);assert.equal(summary.totals.programs,0);
  assert.equal(read(dir,'source-action-audit.jsonl'),AUDIT_LINE);
  assert.throws(()=>run(writeSurvey(dir,{},null),{dataDir:dir}),/--date/);
});
