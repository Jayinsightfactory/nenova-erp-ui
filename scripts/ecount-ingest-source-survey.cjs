'use strict';
// Ingest an ECOUNT source button survey (root session, logged-in browser, read-only DOM observation) into the
// persistent parity records:
//   data/ecount-workbench/parity-inventory.json   screens[].actions
//   data/ecount-workbench/button-matches.json     pages[].buttons (+ sourcePresets / sourceFields / sourceSurvey)
//   data/ecount-workbench/source-action-audit.jsonl  one line per surveyed program
// Evidence level: a control with this label exists in this context (and was enabled or not) on the source
// screen at survey time. It proves nothing about behavior, windows or query values; every comparison stays 미검증.
// Existing matchIds are never renumbered or relabelled; only controls that match no existing action
// (normalized label + loose context group) are appended with the next A-number.
// Running the same survey twice changes nothing (idempotent).
//
// Usage: node scripts/ecount-ingest-source-survey.cjs <survey.json> [--date YYYY-MM-DD] [--data-dir data/ecount-workbench] [--dry-run]
// Survey shape: { observedOn, results: { [program]: { title, panelText, controls:[[label,domId,disabled,ctx]...],
//                fields:[[label,type,name,required,defaultValue,readonly]...], presets:[[label,"yy mm dd ~ yy mm dd"]...] } } }
// panelText and any `order` entry are never stored.
const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');
const DEFAULT_DATA_DIR='data/ecount-workbench';
const LIMITATION='원본 버튼 목록 자동 수집(라벨·문맥·활성 여부만); 동작·새창·값 미검증';
const GROUPS=['상단','검색 패널','하단','대화상자','기타'];

function normalizeLabel(label){
  return String(label==null?'':label).normalize('NFKC').replace(/[\s​-‍﻿]+/g,'').replace(/[（]/g,'(').replace(/[）]/g,')').replace(/[［]/g,'[').replace(/[］]/g,']');
}
// Context group for either a raw survey ctx ("DIV.wrapper-toolbar", "dialog:거래처") or an inventory context name
// ("상단", "검색 패널", "인쇄 메뉴", "매핑 선택창", "거래처 대화상자"). Loose on purpose: five groups only.
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
// Context name stored for a newly added action/button.
function surveyContextName(ctx){
  const s=String(ctx==null?'':ctx).trim();
  const m=/^dialog:(.*)$/i.exec(s);
  if(m){const title=m[1].trim();return title?`${title} 대화상자`:'대화상자';}
  return contextGroup(s);
}
const WRITE_RE=/저장|삭제|입력|신규|전송|반영|발행|마감|등록|수정|추가|승인|확정|생성|복원|save|delete|send|submit|create|update/i;
const QUERY_RE=/검색|조회|search|f8|f3|금일|전일|당일|당월|전월|금월|금주|전주|어제|오늘|이번주|지난주|당년|전년|금년|올해|작년/i;
const READ_RE=/닫기|close|option|옵션|도움말|help|펼침|접기|더보기|새로고침|refresh/i;
function classifyLabel(label,presetLabels){
  const n=normalizeLabel(label);
  if(WRITE_RE.test(n))return 'write';
  if(QUERY_RE.test(n)||(presetLabels&&presetLabels.has(n)))return 'query';
  if(READ_RE.test(n))return 'read';
  return 'unknown';
}
function toIsoDate(yy,mm,dd){
  if(!/^\d{2}(\d{2})?$/.test(yy)||!/^\d{1,2}$/.test(mm)||!/^\d{1,2}$/.test(dd))return null;
  const y=yy.length===2?`20${yy}`:yy;
  return `${y}-${mm.padStart(2,'0')}-${dd.padStart(2,'0')}`;
}
// ["금일","26 10 21 ~ 26 10 21"] -> {label, from:"2026-10-21", to:"2026-10-21"}; only the first 7 tokens are read.
function parsePreset(entry){
  const label=Array.isArray(entry)?entry[0]:entry&&entry.label;
  const range=Array.isArray(entry)?entry[1]:entry&&entry.range;
  const t=String(range==null?'':range).trim().split(/\s+/).slice(0,7);
  let from=null,to=null;
  if(t.length>=7&&t[3]==='~'){from=toIsoDate(t[0],t[1],t[2]);to=toIsoDate(t[4],t[5],t[6]);}
  else if(t.length>=3){from=toIsoDate(t[0],t[1],t[2]);to=from;}
  return {label:String(label==null?'':label).trim(),from,to};
}
// Field defaults that could carry a person/customer identity are never stored.
const PERSONAL_RE=/담당|사용자|성명|이름|연락|전화|휴대|이메일|e-?mail|\btel|phone|mobile|주소|addr|계좌|account|사업자|주민|생년|birth|비밀번호|password|user|emp|거래처|고객|cust|client|\bhp\b/i;
function sanitizeField(entry){
  const [label,type,name,required,defaultValue,readonly]=Array.isArray(entry)?entry:[entry&&entry.label,entry&&entry.type,entry&&entry.name,entry&&entry.required,entry&&entry.defaultValue,entry&&entry.readonly];
  const f={label:String(label==null?'':label).trim(),type:String(type==null?'':type).trim(),name:String(name==null?'':name).trim(),required:required?1:0,defaultValue:null,readonly:readonly?1:0};
  const personal=PERSONAL_RE.test(f.label)||PERSONAL_RE.test(f.name);
  if(personal){f.defaultValue=null;f.defaultRedacted=defaultValue!=null&&String(defaultValue)!=='';}
  else{const v=defaultValue==null?'':String(defaultValue).trim();f.defaultValue=v?v.slice(0,60):null;}
  return f;
}
function nextActionNumber(screen){
  let max=0;
  for(const a of screen.actions){const m=new RegExp(`^${screen.id}-A(\\d+)$`).exec(a.id);if(m)max=Math.max(max,parseInt(m[1],10));}
  for(const a of screen.retractedActions||[]){const m=new RegExp(`^${screen.id}-A(\\d+)$`).exec(a.id||'');if(m)max=Math.max(max,parseInt(m[1],10));}
  return max+1;
}
function actionId(program,n){return `${program}-A${String(n).padStart(2,'0')}`;}
function unverified(extra){return Object.assign({status:'미검증',evidence:[]},extra||{});}
function buildButton(matchId,label,context,domId,evidenceRef){
  return {
    matchId,
    source:{stableId:matchId,label,context,domId,evidence:[evidenceRef]},
    target:{requiredStableId:matchId,actualStableId:null,label:null,evidence:[],codeMappingStableId:null},
    status:'미검증',
    conditions:{status:'미검증',evidence:[],filterProfile:null,periodFrom:null,periodTo:null,permissionProfile:null,sortProfile:null,pagingProfile:null,currency:null,sourceObservedAt:null,targetObservedAt:null,timeZone:'Asia/Seoul',sameSnapshotVerified:false},
    comparisons:{
      label:unverified(),function:unverified(),window:unverified(),
      queryValues:unverified({
        rowCount:unverified({source:null,target:null}),
        totals:unverified({comparedFieldCount:null,mismatchCount:null}),
        rows:unverified({matchingRule:null,comparedRows:null,comparedFields:null,mismatchCount:null,rawValuesStored:false}),
        queryApplicable:null,notApplicableReason:null,applicabilityEvidence:[]
      })
    },
    captures:{source:null,target:null},
    limitations:[LIMITATION]
  };
}
function buildAction(id,label,context,classification,disabled,evidenceRef){
  const allowed=classification==='read'||classification==='query';
  return {id,label,context,classification,stage:'observed',sourceExecutionAllowed:allowed,sourceExecuted:false,evidence:[evidenceRef],testEvidence:[],
    behavior:`Label/context observed by automated DOM survey${disabled?' (disabled at observation)':''}; unexecuted control`};
}
function compactDate(date){return String(date).replace(/-/g,'');}
function auditId(date,program){return `SRC-${compactDate(date)}-${program}-SURVEY`;}
function markDimension(screen,key,ref){
  const d=screen.dimensions&&screen.dimensions[key];
  if(!d)return;
  if(d.stage==='unknown')d.stage='observed';
  if(!d.evidence.includes(ref)&&(d.stage==='observed'))d.evidence.push(ref);
}
const NOT_SURVEYED='Original page actions and windows not surveyed';
const SURVEY_BLOCKER='Automated button survey only; control behavior, windows and full source coverage unverified';

// Mutates inventory/report in place. Returns {summary, auditLines} where auditLines are the NEW jsonl records.
function ingest(survey,opts){
  const {inventory,report}=opts;
  const date=opts.date||survey.observedOn;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))throw new Error('--date YYYY-MM-DD (or survey.observedOn) required');
  const observedOn=survey.observedOn||date;
  const existingAuditIds=new Set(opts.auditIds||[]);
  const screens=new Map(inventory.screens.map(s=>[s.id,s]));
  const pages=new Map(report.pages.map(p=>[p.program,p]));
  const summary={date,observedOn,programs:{},unknownPrograms:[],totals:{programs:0,added:0,matched:0,auditAppended:0,skippedUnlabeled:0}};
  const auditLines=[];
  for(const program of Object.keys(survey.results||{}).sort()){
    const r=survey.results[program]||{};
    const screen=screens.get(program),page=pages.get(program);
    if(!screen||!page){summary.unknownPrograms.push(program);continue;}
    const ref=`source-action-audit.jsonl#${auditId(date,program)}`;
    const controls=Array.isArray(r.controls)?r.controls:[];
    const presets=Array.isArray(r.presets)?r.presets.map(parsePreset).filter(p=>p.label):[];
    const presetLabels=new Set(presets.map(p=>normalizeLabel(p.label)));
    const fields=Array.isArray(r.fields)?r.fields.map(sanitizeField).filter(f=>f.label||f.name):[];
    const s=summary.programs[program]={title:page.title,existingButtons:page.buttons.length,matched:0,added:0,skippedUnlabeled:0,presets:presets.length,fields:fields.length,auditAppended:false};
    // Existing actions keyed by normalized label + context group; each key is consumed once per survey control.
    const pool=new Map();
    for(const a of screen.actions){const k=`${normalizeLabel(a.label)}|${contextGroup(a.context)}`;if(!pool.has(k))pool.set(k,[]);pool.get(k).push(a.id);}
    const buttonIds=new Set(page.buttons.map(b=>b.matchId));
    let n=nextActionNumber(screen);
    const disabledIds=[];
    for(const c of controls){
      const [rawLabel,rawDomId,disabled,ctx]=Array.isArray(c)?c:[c&&c.label,c&&c.domId,c&&c.disabled,c&&c.ctx];
      const domId=rawDomId==null||String(rawDomId).trim()===''?null:String(rawDomId).trim();
      let label=String(rawLabel==null?'':rawLabel).trim();
      if(!label&&domId)label=`[${domId}]`;
      if(!label){s.skippedUnlabeled++;continue;}
      const key=`${normalizeLabel(label)}|${contextGroup(ctx)}`;
      const free=pool.get(key);
      if(free&&free.length){const id=free.shift();s.matched++;if(disabled)disabledIds.push(id);continue;}
      const id=actionId(program,n++);
      const context=surveyContextName(ctx);
      const classification=classifyLabel(label,presetLabels);
      screen.actions.push(buildAction(id,label,context,classification,!!disabled,ref));
      if(!buttonIds.has(id)){page.buttons.push(buildButton(id,label,context,domId,ref));buttonIds.add(id);}
      if(disabled)disabledIds.push(id);
      s.added++;
    }
    if(screen.stage==='metadata')screen.stage='observed';
    markDimension(screen,'buttons',ref);
    if(fields.length)markDimension(screen,'fields',ref);
    if(presets.length)markDimension(screen,'filters',ref);
    if(controls.some(c=>/^dialog:/i.test(String((Array.isArray(c)?c[3]:c&&c.ctx)||''))))markDimension(screen,'dialogs',ref);
    const bi=screen.blockers.indexOf(NOT_SURVEYED);
    if(bi>=0)screen.blockers.splice(bi,1,SURVEY_BLOCKER);
    else if(!screen.blockers.includes(SURVEY_BLOCKER)&&!screen.blockers.length)screen.blockers.push(SURVEY_BLOCKER);
    page.allSourceButtonsKnown=false;page.sourceButtonCount=null;
    if(presets.length)page.sourcePresets=presets;
    if(fields.length)page.sourceFields=fields;
    page.sourceSurvey={observedOn,evidence:ref,controlCount:controls.length-s.skippedUnlabeled,disabledMatchIds:disabledIds};
    const aid=auditId(date,program);
    if(!existingAuditIds.has(aid)){
      auditLines.push({id:aid,program,action:'button inventory survey',classification:'read',result:`${controls.length-s.skippedUnlabeled} controls, ${presets.length} presets observed`,observedOn,recordKind:'automated-dom-survey',sourceReporter:'root',coverage:'visible controls after opening search panel; dropdown/overlay contents only if open',sourceMutation:false,businessValuesRecorded:false});
      existingAuditIds.add(aid);s.auditAppended=true;summary.totals.auditAppended++;
    }
    summary.totals.programs++;summary.totals.added+=s.added;summary.totals.matched+=s.matched;summary.totals.skippedUnlabeled+=s.skippedUnlabeled;
  }
  return {summary,auditLines};
}

function readAuditIds(file){
  if(!fs.existsSync(file))return [];
  return fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(l=>{try{return JSON.parse(l).id;}catch(e){return null;}}).filter(Boolean);
}
function run(surveyPath,options){
  const opts=options||{};
  const dataDir=path.isAbsolute(opts.dataDir||'')?opts.dataDir:path.join(root,opts.dataDir||DEFAULT_DATA_DIR);
  const invPath=path.join(dataDir,'parity-inventory.json'),reportPath=path.join(dataDir,'button-matches.json'),auditPath=path.join(dataDir,'source-action-audit.jsonl');
  const survey=JSON.parse(fs.readFileSync(surveyPath,'utf8'));
  const inventory=JSON.parse(fs.readFileSync(invPath,'utf8'));
  const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
  const {summary,auditLines}=ingest(survey,{inventory,report,date:opts.date,auditIds:readAuditIds(auditPath)});
  const rel=path.relative(root,path.resolve(surveyPath));
  summary.survey=(rel.startsWith('..')||path.isAbsolute(rel)?path.resolve(surveyPath):rel).replace(/\\/g,'/');
  summary.dryRun=!!opts.dryRun;
  if(!opts.dryRun){
    fs.writeFileSync(invPath,JSON.stringify(inventory,null,2)+'\n');
    fs.writeFileSync(reportPath,JSON.stringify(report,null,1)+'\n');
    if(auditLines.length){
      const prev=fs.existsSync(auditPath)?fs.readFileSync(auditPath,'utf8'):'';
      fs.writeFileSync(auditPath,prev+(prev&&!prev.endsWith('\n')?'\n':'')+auditLines.map(l=>JSON.stringify(l)).join('\n')+'\n');
    }
  }
  return summary;
}

if(require.main===module){
  const args=process.argv.slice(2);
  const opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
  const surveyPath=args.find((a,i)=>!a.startsWith('--')&&(i===0||!args[i-1].startsWith('--')||args[i-1]==='--dry-run'));
  if(!surveyPath){console.error('usage: node scripts/ecount-ingest-source-survey.cjs <survey.json> [--date YYYY-MM-DD] [--data-dir dir] [--dry-run]');process.exit(2);}
  const summary=run(surveyPath,{date:opt('--date'),dataDir:opt('--data-dir'),dryRun:args.includes('--dry-run')});
  console.log(JSON.stringify(summary,null,1));
}
module.exports={ingest,run,normalizeLabel,contextGroup,surveyContextName,classifyLabel,parsePreset,sanitizeField,nextActionNumber,buildButton,buildAction,auditId,LIMITATION,GROUPS};
