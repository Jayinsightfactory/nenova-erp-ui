'use strict';
const fs=require('fs');
const path=require('path');
const root=path.resolve(__dirname,'..');
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const REQUIRED=['fields','columns','sorting','filters','buttons','newWindows','dialogs','resultPropagation','validation','downloads','keyboard','permissions','errorStates'];
const STAGES=['unknown','observed','specified','implemented','verified'];
function complete(s){return Number.isInteger(s.actionCount)&&s.actionCount===s.actions.length&&Number.isInteger(s.windowCount)&&s.windowCount===s.windows.length&&!s.blockers.length&&!s.exclusions.length&&s.aliases.every(a=>a.contextVerified&&a.evidence.length)&&REQUIRED.every(k=>s.dimensions[k]?.stage==='verified'&&s.dimensions[k].evidence.length&&s.dimensions[k].testEvidence.length)&&[...s.actions,...s.windows].every(a=>a.stage==='verified'&&a.evidence.length&&a.testEvidence.length);}
function validate(inventory,plan,menus){const errors=[];const assert=(ok,msg)=>{if(!ok)errors.push(msg);};const ids=new Set(),aliases=new Set();const menuMap=new Map(menus.map(m=>[m.id,m]));
assert(REQUIRED.every(k=>inventory.dimensions.includes(k)),'required dimensions missing');
assert(JSON.stringify(inventory.sourcePolicy.allowed)===JSON.stringify(['read','query','download']),'source allowlist changed');assert(inventory.sourcePolicy.unknownAction==='do-not-execute','unknown action must be blocked');
for(const s of inventory.screens){assert(!ids.has(s.id),'duplicate screen '+s.id);ids.add(s.id);assert(['metadata','observed','specified','implemented','verified'].includes(s.stage),'invalid screen stage');assert(s.aliases.length>0,'screen without alias');
for(const a of s.aliases){assert(!aliases.has(a.menuId),'duplicate alias '+a.menuId);aliases.add(a.menuId);assert(menuMap.get(a.menuId)?.program===s.id,'alias canonical mismatch '+a.menuId);assert(JSON.stringify(menuMap.get(a.menuId)?.path)===JSON.stringify(a.path),'alias path mismatch');}
for(const key of REQUIRED){const d=s.dimensions[key];assert(d&&STAGES.includes(d.stage),'invalid dimension '+key);if(d?.stage==='verified')assert(d.evidence?.length&&d.testEvidence?.length,'verified dimension lacks evidence');}
for(const [count,items]of [[s.actionCount,s.actions],[s.windowCount,s.windows]])assert(count===null||(Number.isInteger(count)&&count>=0&&count===items.length),'unknown count cannot be fabricated');
for(const a of s.actions){assert(['read','query','download','write','save','modify','delete','issue','transmit','transfer','unknown'].includes(a.classification),'invalid action classification');assert(STAGES.includes(a.stage),'invalid action stage');if(!['read','query','download'].includes(a.classification))assert(a.sourceExecutionAllowed===false&&a.sourceExecuted===false,'source mutation or unknown action executed');if(a.stage==='verified')assert(a.evidence?.length&&a.testEvidence?.length,'action lacks evidence');}
for(const w of s.windows){assert(['popup','new-window','dialog','tab','drawer'].includes(w.kind),'unknown window kind');assert(STAGES.includes(w.stage),'invalid window stage');if(w.stage==='verified')assert(w.evidence?.length&&w.testEvidence?.length,'window lacks evidence');}
if(s.stage==='verified')assert(complete(s),'screen falsely verified '+s.id);
}
const {getFeature}=require('../lib/ecountWorkbench.cjs');for(const m of menus)if(getFeature(m.id).mode!=='folder')assert(aliases.has(m.id),'unassigned menu '+m.id);
const assigned=new Set();const depIds=new Set(plan.foundations.map(x=>x.id));for(const p of plan.packets){assert(p.screenIds.length>0&&p.screenIds.length<=10,'packet size');assert(p.dependsOn.every(d=>depIds.has(d)),'missing dependency');for(const id of p.screenIds){assert(ids.has(id)&&!assigned.has(id),'duplicate/unknown packet member '+id);assigned.add(id);}}assert(assigned.size===ids.size,'unassigned canonical screen');return errors;
}
if(require.main===module){const inventory=read('data/ecount-workbench/parity-inventory.json'),plan=read('data/ecount-workbench/parity-packets.json'),menus=read('data/ecount-workbench/source-menu.json').menus;const errors=validate(inventory,plan,menus);if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else{const verified=inventory.screens.filter(complete).length;console.log(JSON.stringify({canonicalScreens:inventory.screens.length,menuPaths:inventory.screens.reduce((n,s)=>n+s.aliases.length,0),packets:plan.packets.length,verifiedScreens:verified,complete:verified===inventory.screens.length}));if(process.argv.includes('--require-complete')&&verified!==inventory.screens.length)process.exitCode=2;}}
module.exports={validate,complete,REQUIRED};
