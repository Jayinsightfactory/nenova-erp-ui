// scripts/docling-metrics-report.mjs — docling 전처리 전/후 2주 비교 로그 요약.
// 서버에서: node scripts/docling-metrics-report.mjs [metrics.jsonl 경로]
import fs from 'node:fs';
import path from 'node:path';

const file=process.argv[2]||path.join(process.cwd(),'data/runtime/import-team/docling/metrics.jsonl');
if(!fs.existsSync(file)){console.log('로그 없음:',file);process.exit(0);}
const rows=fs.readFileSync(file,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l);}catch{return null;}}).filter(Boolean);
const groups={with:[],without:[]};
for(const r of rows)(r.docling?.used?groups.with:groups.without).push(r);
const avg=(list,pick)=>list.length?Math.round(list.reduce((s,r)=>s+(pick(r)||0),0)/list.length):0;
for(const [name,list] of Object.entries(groups)){
  console.log(`\n[docling ${name}] ${list.length}건`);
  if(!list.length)continue;
  console.log(`  평균 입력토큰 ${avg(list,r=>r.inputTokens)} / 출력토큰 ${avg(list,r=>r.outputTokens)}`);
  if(name==='with'){
    console.log(`  평균 docling 대기 ${avg(list,r=>r.docling.waitMs)}ms / 변환 ${avg(list,r=>(r.docling.doclingSec||0)*1000)/1000}s`);
    console.log(`  산술검증: 평균 검사행 ${avg(list,r=>r.docling.arithChecked)} / 평균 플래그행 ${avg(list,r=>r.docling.arithFlagged)}`);
  }else{
    const reasons={};
    for(const r of list)reasons[r.docling?.reason||'?']=(reasons[r.docling?.reason||'?']||0)+1;
    console.log('  미사용 사유:',JSON.stringify(reasons));
  }
  const byCountry={};
  for(const r of list)byCountry[r.country]=(byCountry[r.country]||0)+1;
  console.log('  국가별:',JSON.stringify(byCountry));
}
