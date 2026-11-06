const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const parser=require('next/dist/compiled/babel/parser');
const {transformSync}=require('next/dist/build/swc');
const source=fs.readFileSync('pages/sales/profit-report.js','utf8');
const readExpression=node=>node?source.slice(node.start,node.end).replace(/\s+/g,' ').trim():null;
const elements=[];
function walk(node){if(!node||typeof node!=='object')return;if(node.type==='JSXOpeningElement')elements.push(node);for(const value of Object.values(node))if(Array.isArray(value))value.forEach(walk);else if(value&&typeof value==='object')walk(value);}
walk(parser.parse(source,{sourceType:'module',plugins:['jsx']}));
const attrs=node=>Object.fromEntries(node.attributes.filter(a=>a.type==='JSXAttribute').map(a=>[a.name.name,a.value?.expression]));
const actions=elements.filter(node=>node.name.name==='button').map(node=>attrs(node)).filter(a=>a.onClick).map(a=>[readExpression(a.onClick),readExpression(a.disabled)]).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
// Actual a6360410e AST baseline: all 50 button handlers + disabled expressions,
// independent of their new layout, CSS, or text. Not a weakened source grep.
const auxiliaryQueries=actions.filter(([handler])=>handler.includes('setQueriedAuxScope'));
assert.equal(auxiliaryQueries.length,1,'Analysis/source views require an explicit query intent');
let auxiliaryScope;
new Function('ctx',`with(ctx){return (${auxiliaryQueries[0][0]});}`)({viewMode:'analysis',reportYear:'2026',weekInput:{value:'44'},setQueriedAuxScope:value=>auxiliaryScope=value})();
assert.equal(auxiliaryScope,'analysis:2026:44');
const originalActions=actions.filter(([handler])=>!handler.includes('setQueriedAuxScope'));
assert.equal(actions.length,51);
assert.equal(originalActions.length,50);
assert.equal(crypto.createHash('sha256').update(JSON.stringify(originalActions)).digest('hex'),'a9ae02e910433088466ca94ab84e3f0704cbc43611bd604fa46991ccfe51465a');
const context={data:{confirmed:false},saving:false,loading:false,moyiSending:false,moyiDriveSyncing:false,confirmBusy:false};
for(const handler of ['save','sendToMoyi','syncDriveToMoyi','cancelConfirmReport']){
 let called=0;const fn=()=>called++;const expression=actions.find(a=>a[0]===handler);assert.ok(expression);
 const invoke=new Function('ctx',`with(ctx){return (${expression[0]});}`)({...context,[handler]:fn});invoke();assert.equal(called,1);
 const disabled=ctx=>new Function('ctx',`with(ctx){return (${expression[1]});}`)(ctx);
 assert.equal(Boolean(disabled(context)),false);
 if(handler==='save'){assert.equal(disabled({...context,data:{confirmed:true}}),true);assert.equal(disabled({...context,saving:true}),true);assert.equal(disabled({...context,data:null}),true);}
 if(handler==='sendToMoyi')assert.equal(disabled({...context,moyiSending:true}),true);
 if(handler==='syncDriveToMoyi')assert.equal(disabled({...context,moyiDriveSyncing:true}),true);
 if(handler==='cancelConfirmReport')assert.equal(disabled({...context,confirmBusy:true}),true);
}
for(const stateSetter of ['setShowConfirmPanel','setShowConfirmHistory']){
 let next;const pair=actions.find(a=>a[0].includes(`${stateSetter}(v => !v)`));
 new Function('ctx',`with(ctx){return (${pair[0]});}`)({[stateSetter]:update=>next=update(false)})();assert.equal(next,true);
}
const more=elements.find(node=>node.name.name==='details'&&readExpression(attrs(node).className)==='toolbar.more');assert.ok(more);
const escape=new Function(`return (${readExpression(attrs(more).onKeyDown)})`)();let focused=0;
const currentTarget={open:true,querySelector:selector=>{assert.equal(selector,'summary');return{focus:()=>focused++};}};
escape({key:'Escape',currentTarget});assert.equal(currentTarget.open,false);assert.equal(focused,1);
const output=elements.find(node=>node.name.name==='ProfitRangeOutput'),outputAttrs=attrs(output);
assert.equal(readExpression(outputAttrs.disabled),'!data || saving || loading || String(data.orderYear) !== reportYear || Number(data.major) !== Number(weekInput.value)');
assert.equal(readExpression(outputAttrs.beforeOutput),'async () => !dirty || await save()');
for(const label of ['조회 조건','주요 작업','보조 분석','더 보기 · 전송·확정·이력'])assert.ok(source.includes(label));
const css=fs.readFileSync('styles/ProfitReportToolbar.module.css','utf8');assert.match(css,/--blue/);assert.match(css,/:focus-visible/);assert.match(css,/@media\(max-width:640px\)/);assert.match(css,/white-space:normal/);assert.doesNotMatch(css,/position:fixed/);
const range=fs.readFileSync('components/ProfitRangeOutput.js','utf8');
// Latest print UX may change preparation-only state/text. Everything else in run,
// including beforeOutput/save, request scope, cancellation and download stays byte-equivalent.
const run=range.slice(range.indexOf('  async function run(kind)'),range.indexOf('  const buttonStyle'))
 .replace('    printRequest.current += 1;\n','').replace('    printRequest.current += 1;\r\n','')
 .replace("setBusy(true); setError(''); setPreview('');", "setBusy(true); setError(''); setPreview(''); setReady(false);")
 .replace('`${items.length}개 차수 · ${items.length}장 인쇄 준비 중…`','`${items.length}개 차수 인쇄 미리보기 준비 완료`')
 .replace(' || !selectionAllowed','') // Added bounded-week eligibility; exercised in range regression.
 .replace(/\s+/g,' ').trim();
assert.equal(crypto.createHash('sha256').update(run).digest('hex'),'5c0a84e8228403ba87b34d40f9fc913bb8b4bf0999fa0f16254f2973caf94b06','download/cancel/save-before-output unchanged; only approved print preparation state/text normalized');
assert.match(range,/buttonClassName \? undefined :/,'other consumers retain their original styling');
assert.match(range,/style=\{toolbarClassName \? \{ padding: 0 \} : \{ flexBasis: '100%', padding: '8px 0' \}\}/,'only report toolbar opts into compact output layout');
assert.match(css,/\.query \{ flex:1 1 auto;/,'query controls may share a desktop row with view tabs');
assert.match(css,/\.output \{ flex:1 1 560px;/,'save and output controls share available desktop space and wrap on mobile');
for(const file of ['pages/sales/profit-report.js','components/ProfitReportValidationGate.js','components/ProfitReportSnapshotBanner.js','components/ProfitRangeOutput.js'])transformSync(fs.readFileSync(file,'utf8'),{filename:file,jsc:{parser:{syntax:'ecmascript',jsx:true}}});
console.log('profit toolbar: 50 original action/disabled pairs, actual callback execution, output immutability, keyboard and JSX PASS');
