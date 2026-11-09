// Exact-source private job diagnostics. File reads only; no SQL, provider or mutations.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
const key='8a2a558fa2ebd093aaf2d0a45adea7534992e30527bde0c7968208e2edc8705b';
const root='/var/www/nenova-erp/data/runtime/import-team/pdf-jobs';
const read=f=>{try{if(fs.statSync(f).size>5*1024*1024)return null;return JSON.parse(fs.readFileSync(f,'utf8'));}catch{return null;}};
const safeId=x=>typeof x==='string'&&/^[a-f0-9-]{36}$/.test(x);
for(const uid of ['nenovaSS3','nenovass3']){
 const dir=path.join(root,hash(uid));if(!fs.existsSync(dir))continue;
 const jobs=fs.readdirSync(dir).filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>read(path.join(dir,n))).filter(j=>j?.key===key).sort((a,b)=>b.createdAt-a.createdAt).slice(0,5);
 console.log(JSON.stringify({kind:'packing_jobs',ownerHash:hash(uid).slice(0,12),jobs:jobs.map(j=>({id:j.jobId,status:j.status,at:j.createdAt,progress:j.chunkProgress,chunks:(j.chunks||[]).map((c,i)=>({index:i,status:c?.status||'MISSING',hasResult:!!c?.result,hasResponse:!!c?.responseRef,resultHash:c?.result?hash(JSON.stringify(c.result)):null}))}))}));
 for(const job of jobs.slice(0,2)){
  const fragments=[];
  for(const [index,c] of (job.chunks||[]).entries()){
   let result=c?.result;
   if(!result&&safeId(c?.responseRef?.jobId)&&Number.isInteger(c.responseRef.index)){
    const file=path.join(dir,'responses',c.responseRef.jobId+'-'+c.responseRef.index+'.json'),saved=read(file);
    if(saved?.key===key){const text=(saved.data?.content||[]).filter(x=>x.type==='text').map(x=>x.text).join('');try{result=JSON.parse(text.slice(text.indexOf('{'),text.lastIndexOf('}')+1));}catch{}}
   }
   if(result)fragments.push({index,result});
  }
  const invoices=new Map();for(const f of fragments)for(const inv of f.result.invoices||[]){const k=JSON.stringify([inv.supplier,inv.invoice,inv.currency]);let a=invoices.get(k);if(!a){a={invoice:inv.invoice,invoiceTotal:inv.invoice_total,freight:inv.freight_total,products:[],segments:[]};invoices.set(k,a);}else{if(a.invoiceTotal==null&&inv.invoice_total!=null)a.invoiceTotal=inv.invoice_total;if(a.freight==null&&inv.freight_total!=null)a.freight=inv.freight_total;}a.products.push(...(inv.products||[]));a.segments.push(f.index+1);}
  console.log(JSON.stringify({kind:'packing_totals',id:job.jobId,fragments:fragments.length,invoices:[...invoices.values()].map(i=>{const goods=i.products.reduce((n,p)=>n+Number(p.t_price),0),delta=goods+Number(i.freight)-Number(i.invoiceTotal);return {invoice:i.invoice,segments:i.segments,rows:i.products.length,goods,freight:i.freight,invoiceTotal:i.invoiceTotal,delta,...(Math.abs(delta)>.02?{lines:i.products.map(p=>({description:p.description,quantity:p.total_stems,pcs:p.pcs,stemsBox:p.steam_box,price:p.u_price,amount:p.t_price,page:p.review_evidence?.t_price?.page}))}:{})};})}));
 }
}
