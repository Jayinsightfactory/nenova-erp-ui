'use strict';
// Refresh docs/session-backups/<date>_ecount-resume-inventory.json page statuses from button-matches.json
// target DOM evidence (scripts/ecount-merge-dom-evidence.cjs) and the step-1 classifier.
// Usage: node scripts/ecount-update-resume-inventory.cjs <inventory.json> [--release "PR#"]
const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');
const {classify}=require('./ecount-step1-summary.cjs');
const args=process.argv.slice(2);const file=args.find(a=>!a.startsWith('--'));const opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
if(!file){console.error('inventory path required');process.exit(2);}
const inv=JSON.parse(fs.readFileSync(path.resolve(root,file),'utf8'));
const report=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/button-matches.json'),'utf8'));
const today=new Date().toISOString().slice(0,10);
let touched=0;
for(const page of inv.pages){
  const rp=report.pages.find(p=>p.program===page.program);if(!rp?.buttons?.length)continue;
  const c={'구현':0,'미구현':0,'미관측':0,'API설계전용':0};for(const b of rp.buttons)c[classify(b)]++;
  page.targetDom={asOf:today,buttons:rp.buttons.length,implemented:c['구현'],placeholder:c['미구현'],missing:c['미관측'],externalApiDesignOnly:c['API설계전용'],labelMatched:rp.buttons.filter(b=>b.comparisons.label.status==='일치').length,fullParity:false};
  page.status='partial-observation-target-dom-classified-full-parity-unverified';
  page.next=c['미관측']?`Add ${c['미관측']} missing target controls; observe source behaviour for ${c['미구현']} placeholders`:`Observe source behaviour for ${c['미구현']} placeholders; verify function/window/value dimensions`;
  touched++;
}
inv.asOf=today;
inv.history=inv.history||[];inv.history.push({date:today,note:'Target DOM crawl evidence merged; ACTION_IDS gap for 11 datasets fixed',release:opt('--release')||null,touchedPages:touched});
fs.writeFileSync(path.resolve(root,file),JSON.stringify(inv,null,1)+'\n');
console.log('updated pages',touched);
