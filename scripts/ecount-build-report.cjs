'use strict';
// Build the ECOUNT button comparison workbook from the persisted report model.
// Uses the plain `xlsx` package (the earlier codex builder needed @oai/artifact-tool, unavailable here), so
// captures are listed by path on their own sheet instead of embedded images; that limitation is written into
// the workbook. Never claims completion: counts come straight from button-matches.json.
// Usage: node scripts/ecount-build-report.cjs [--out outputs/ecount-parity-YYYYMMDD/ECOUNT_버튼별_비교보고서.xlsx]
const fs=require('fs');const path=require('path');const crypto=require('crypto');
const XLSX=require('xlsx');
const root=path.join(__dirname,'..');
const {flattenReport}=require('./lib/ecount-report-model.cjs');
const {classify}=require('./ecount-step1-summary.cjs');
const args=process.argv.slice(2);const opt=k=>{const i=args.indexOf(k);return i>=0?args[i+1]:null;};
const stamp=new Date().toISOString().slice(0,10).replace(/-/g,'');
const out=path.resolve(root,opt('--out')||`outputs/ecount-parity-${stamp}/ECOUNT_버튼별_비교보고서.xlsx`);
const read=name=>JSON.parse(fs.readFileSync(path.join(root,name),'utf8'));
const report=read('data/ecount-workbench/button-matches.json');
const inventory=read('data/ecount-workbench/parity-inventory.json');
const packets=read('data/ecount-workbench/parity-packets.json');
const model=flattenReport(report,inventory,packets);
const wb=XLSX.utils.book_new();
const addSheet=(name,columns,rows)=>{const ws=XLSX.utils.aoa_to_sheet([columns,...rows]);ws['!cols']=columns.map((c,i)=>({wch:Math.min(60,Math.max(10,...[c,...rows.map(r=>String(r[i]??''))].map(v=>String(v).length+2)))}));XLSX.utils.book_append_sheet(wb,ws,name.slice(0,31));};
// Cover: counts and the completion claim, verbatim from the model (never computed as a percentage).
const classCounts={'구현':0,'미구현':0,'조건부':0,'미관측':0,'API설계전용':0};let observed=0;
for(const p of report.pages)for(const b of p.buttons||[]){observed++;classCounts[classify(b,p.program)]++;}
addSheet('표지',['항목','값'],[
 ['제목',model.title],['완료 주장',model.completionClaim],['생성일',new Date().toISOString()],
 ['프로그램 수',report.pages.length],['버튼 관측 프로그램',report.pages.filter(p=>p.buttons?.length).length],['관측 버튼 ID',observed],
 ...Object.entries(classCounts).map(([k,v])=>[`대상 분류 · ${k}`,v]),
 ['기능·새창·조회값 비교',"전부 미검증 (일치 0)"],
 ['캡처','이 통합문서는 이미지를 삽입하지 않는다. 캡처 시트에 경로만 기재(평문 xlsx 빌더 제한).'],
 ['원본 정책','ECOUNT 조회·다운로드만, 입력·수정·저장·삭제 없음. ERP 공유 원장 쓰기 없음.'],
]);
for(const sheet of model.sheets)addSheet(sheet.name,sheet.columns,sheet.rows);
// Target DOM classification sheet (step-1 closure view).
const rows=[];
for(const p of report.pages){if(!p.buttons?.length)continue;for(const b of p.buttons){const d=b.target.domState||{};rows.push([p.program,p.title,b.matchId,b.source.label,b.source.context,classify(b,p.program),d.present?'예':'아니오',d.present?(d.enabled?'활성':'비활성'):'',b.comparisons.label.status,b.comparisons.function.status,b.comparisons.window.status,b.comparisons.queryValues.status,(b.target.verificationScope||'').slice(0,200)]);}}
addSheet('대상DOM분류',['프로그램','화면','버튼ID','원본 라벨','원본 문맥','분류','대상 렌더','활성','라벨비교','기능비교','새창비교','조회값비교','검증범위'],rows);
fs.mkdirSync(path.dirname(out),{recursive:true});
XLSX.writeFile(wb,out);
const buf=fs.readFileSync(out);
console.log(JSON.stringify({out:path.relative(root,out),bytes:buf.length,sha256:crypto.createHash('sha256').update(buf).digest('hex'),sheets:wb.SheetNames,classCounts}));
