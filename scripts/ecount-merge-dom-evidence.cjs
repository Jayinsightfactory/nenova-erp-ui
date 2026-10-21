'use strict';
// Merge browser DOM crawls of the ECOUNT workbench (scripts/ecount-dom-crawl.cjs output) into
// data/ecount-workbench/button-matches.json.
// Evidence level: a rendered element carrying data-ecount-action-id exists (and is enabled or not) in the
// crawled build. It proves the target control exists with its label; it does NOT prove behaviour, window or
// query-value equivalence. Those dimensions stay 미검증. A static ACTION_IDS claim that no crawl reproduces
// is revoked (actualStableId -> null) and the revocation is recorded, so the report never over-claims.
// Usage: node scripts/ecount-merge-dom-evidence.cjs --prod <crawl.json> [--local <crawl.json>] [--deploy <sha>] [--commit <sha>]
const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');
const args=process.argv.slice(2);const opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
const sources=[['production',opt('--prod'),opt('--deploy')||'unknown'],['local',opt('--local'),opt('--commit')||'working-tree']].filter(s=>s[1]);
if(!sources.length){console.error('--prod and/or --local crawl path required');process.exit(2);}
const crawls=sources.map(([kind,file,build])=>{const c=JSON.parse(fs.readFileSync(file,'utf8'));return {kind,build,rel:path.relative(root,path.resolve(file)).replace(/\\/g,'/'),date:c.observedOn,results:c.results||{}};});
const reportPath=path.join(root,'data/ecount-workbench/button-matches.json');
const report=JSON.parse(fs.readFileSync(reportPath,'utf8'));
const summary={};
for(const page of report.pages){
  if(!page.buttons?.length)continue;
  const seenPage=crawls.some(c=>c.results[page.program]);if(!seenPage)continue;
  const s=summary[page.program]={title:page.title,buttons:page.buttons.length,present:0,enabled:0,disabled:0,absent:0,labelMatch:0,newlyMapped:0,revoked:0};
  for(const b of page.buttons){
    const hits=crawls.map(c=>({c,dom:c.results[page.program]?.[b.matchId]})).filter(h=>h.dom);
    if(!hits.length){
      s.absent++;
      b.target.domState={present:false,observedIn:crawls.map(c=>`${c.kind}:${c.build}:${c.date}`)};
      if(b.target.actualStableId){
        s.revoked++;
        b.target.revokedStaticClaim={previousActualStableId:b.target.actualStableId,previousEvidence:b.target.evidence.slice(),reason:'No crawled build rendered this data-ecount-action-id; static map claim not reproduced'};
        b.target.actualStableId=null;b.target.verificationScope='Static claim revoked: control not rendered in crawled builds. Target control unobserved/unimplemented.';
      }
      continue;
    }
    s.present++;const enabled=hits.some(h=>!h.dom.disabled);if(enabled)s.enabled++;else s.disabled++;
    if(!b.target.actualStableId)s.newlyMapped++;
    b.target.actualStableId=b.matchId;
    const primary=hits[0].dom;
    b.target.label=b.target.label||primary.label||null;
    const evidence=hits.map(h=>`${h.c.rel}#${page.program}/${b.matchId}`);
    for(const e of evidence)if(!b.target.evidence.includes(e))b.target.evidence.push(e);
    b.target.domState={present:true,enabled,inDialog:hits.some(h=>h.dom.dialog),tag:primary.tag,observations:hits.map(h=>({kind:h.c.kind,build:h.c.build,observedOn:h.c.date,enabled:!h.dom.disabled,contexts:h.dom.contexts}))};
    b.target.verificationScope=`Browser DOM attribute observed in ${hits.map(h=>`${h.c.kind} (${h.c.build}, ${h.c.date})`).join(' and ')}: control rendered, enabled=${enabled}. Behavior, window and query-value equivalence unverified.`;
    const sourceLabel=String(b.source.label).trim(),targetLabel=String(primary.label||'').trim();
    if(sourceLabel&&targetLabel&&(sourceLabel===targetLabel||targetLabel.startsWith(sourceLabel))){
      s.labelMatch++;
      if(b.comparisons.label.status==='미검증')b.comparisons.label.status='일치';
      for(const e of evidence)if(!b.comparisons.label.evidence.includes(e))b.comparisons.label.evidence.push(e);
    }
  }
}
fs.writeFileSync(reportPath,JSON.stringify(report,null,1)+'\n');
console.log(JSON.stringify(summary,null,1));
const tot=Object.values(summary).reduce((a,s)=>{for(const k of ['buttons','present','enabled','disabled','absent','labelMatch','newlyMapped','revoked'])a[k]=(a[k]||0)+s[k];return a;},{});
console.log('TOTAL',JSON.stringify(tot));
