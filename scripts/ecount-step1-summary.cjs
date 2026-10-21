'use strict';
// Step-1 closure table for the 33 partially observed ECOUNT programs.
// Classifies every observed source button by what the target build currently shows, without inventing 100%.
// Classes (mutually exclusive, in this order):
//   API설계전용 : external-integration control (mail/chat/bank/tax/barcode/approval...) — UI+storage design only
//   구현         : target control rendered and enabled in a crawled build
//   미구현       : target control rendered but disabled (placeholder with reason)
//   조건부       : not rendered in any crawl, but the control exists in code (ACTION_IDS key + component context literal); it only renders under a state the crawler did not reach (aggregate mode, multi-kind selection, disabled dropdown)
//   미관측       : no target control rendered in any crawled build and none found in code
// 검증대기 counts buttons whose function/window/query comparisons are still 미검증 (always ≥ 구현 for now).
// Usage: node scripts/ecount-step1-summary.cjs [--out docs/ecount-migration/step1-closure-YYYY-MM-DD.md]
const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');
const args=process.argv.slice(2);const opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
const report=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/button-matches.json'),'utf8'));
const packets=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/parity-packets.json'),'utf8')).packets;
const DS={E040609:'unpSale',E040708:'daySale',E040728:'relStock',E040726:'bomStock',E040727:'stkBalance',E040702:'stkLedger',E040719:'stockMove',E040711:'whStock',E040320:'buyTaxStat',E040223:'taxStat',E040219:'buyTax',E040701:'stock',E040218:'salesTax',E010701:'journal',E010205:'cash',E040214:'ar',E040309:'ap',E040207:'sales',E040202:'quote',E040304:'purchase',E040305:'buyStatus',E040302:'poQuery',E040217:'receipt',E040310:'payment',E040216:'discount',E040313:'buyDisc',E040206:'saleQuery',E040212:'unsold',E040307:'unbought',E040208:'quoteStat',E040204:'orderQuery',E040209:'orderStat',E040306:'poStat'};
const controlsSrc=fs.readFileSync(path.join(root,'components/ecount/ObservedPageControls.js'),'utf8');
const mapStart=controlsSrc.indexOf('const ACTION_IDS = ')+'const ACTION_IDS = '.length;
let depth=0,pos=mapStart,inStr=false;for(;pos<controlsSrc.length;pos++){const ch=controlsSrc[pos];if(inStr){if(ch==='\\')pos++;else if(ch==='"')inStr=false;continue;}if(ch==='"')inStr=true;else if(ch==='{')depth++;else if(ch==='}'){depth--;if(!depth)break;}}
const ACTION_IDS=JSON.parse(controlsSrc.slice(mapStart,pos+1));
const componentCode=fs.readdirSync(path.join(root,'components/ecount')).map(f=>fs.readFileSync(path.join(root,'components/ecount',f),'utf8')).join('\n')+fs.readFileSync(path.join(root,'pages/ecount/workbench.js'),'utf8')+fs.readFileSync(path.join(root,'pages/ecount/lookup.js'),'utf8');
function codePresent(program,b){const key=Object.entries(ACTION_IDS[DS[program]]||{}).find(([k,v])=>v===b.matchId&&!k.startsWith('unknown|'));return !!key&&componentCode.includes(key[0].split('|')[0]);}
const EXTERNAL=/^(Email|Email 드롭다운|카카오톡|대화방|E Note|사용자|북마크|보내기|보내기 드롭다운|자동알림|즉시조회|통장등록|입금보고서작성|수집처별확인사항|전자결재|바코드\(품목\)|바코드\(품목\) 드롭다운|바코드\(시리얼\/로트No\.\)|바코드\(전표\)|웹자료올리기|문서발송내역|Fax|SMS)$/;
function classify(b,program){
  const label=String(b.source.label).trim();
  if(EXTERNAL.test(label))return 'API설계전용';
  const d=b.target.domState;
  if(d?.present&&d.enabled)return '구현';
  if(d?.present)return '미구현';
  if(program&&codePresent(program,b))return '조건부';
  return '미관측';
}
const rows=[];const byProgram={};
for(const p of report.pages){
  if(!p.buttons?.length)continue;
  const c={program:p.program,title:p.title,buttons:p.buttons.length,sourceKnown:p.allSourceButtonsKnown,'구현':0,'미구현':0,'조건부':0,'미관측':0,'API설계전용':0,'검증대기':0,'라벨일치':0};
  for(const b of p.buttons){c[classify(b,p.program)]++;if(b.comparisons.function.status==='미검증'||b.comparisons.window.status==='미검증')c['검증대기']++;if(b.comparisons.label.status==='일치')c['라벨일치']++;}
  byProgram[p.program]=c;rows.push(c);
}
const lines=[];
lines.push(`# ECOUNT 1단계(부분관측 33화면) 닫기 현황 — ${new Date().toISOString().slice(0,10)}`,'',
'버튼 확정 수는 원본에서 관측한 버튼 수이며 원본 전체 버튼 수(allSourceButtonsKnown)는 모든 화면에서 아직 미확정이다. 구현=대상 컨트롤이 렌더되고 활성, 미구현=렌더되지만 비활성(사유 표시), 조건부=코드에 컨트롤이 있으나 크롤이 도달하지 못한 상태(집계모드·복수종류 선택·비활성 드롭다운 내부)에서만 렌더, 미관측=대상에 컨트롤 없음, API설계전용=외부연동(메일/메신저/은행/바코드/결재 등)으로 UI·저장계약까지만 범위. 검증대기=기능/새창 비교가 아직 미검증인 버튼 수. 어떤 화면도 100% 동등성 승인 아님.','',
'| 묶음 | 프로그램 | 화면 | 버튼 확정 수 | 구현 | 미구현 | 조건부 | 미관측 | API설계전용 | 검증대기 | 라벨일치 |','|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
const tot={buttons:0,'구현':0,'미구현':0,'조건부':0,'미관측':0,'API설계전용':0,'검증대기':0,'라벨일치':0};
for(const pk of packets){for(const id of pk.screenIds){const c=byProgram[id];if(!c)continue;lines.push(`| ${pk.id} | ${c.program} | ${c.title} | ${c.buttons} | ${c['구현']} | ${c['미구현']} | ${c['조건부']} | ${c['미관측']} | ${c['API설계전용']} | ${c['검증대기']} | ${c['라벨일치']} |`);for(const k of Object.keys(tot))tot[k]+=c[k];}}
lines.push(`| 합계 | 33 | | ${tot.buttons} | ${tot['구현']} | ${tot['미구현']} | ${tot['조건부']} | ${tot['미관측']} | ${tot['API설계전용']} | ${tot['검증대기']} | ${tot['라벨일치']} |`,'');
for(const cls of ['미관측','조건부']){lines.push(`## ${cls==='미관측'?'미관측(대상 컨트롤 없음)':'조건부(코드 존재, 크롤 미도달)'} 버튼 목록`,'');
for(const p of report.pages){if(!p.buttons?.length)continue;const miss=p.buttons.filter(b=>classify(b,p.program)===cls);if(!miss.length)continue;lines.push(`- ${p.program} ${p.title}: `+miss.map(b=>`${b.matchId.split('-')[1]} ${b.source.label}@${b.source.context}`).join(', '));}lines.push('');}
const out=opt('--out');
if(out){fs.writeFileSync(path.resolve(root,out),lines.join('\n')+'\n');console.log('written',out);}
console.log(JSON.stringify(tot));
module.exports={classify};
