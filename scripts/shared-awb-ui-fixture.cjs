// Loopback-only real component/calculator/exporter fixture. No SQL or provider.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),crypto=require('node:crypto');
const babel=require('next/dist/compiled/babel/core');
(async()=>{
 const {calculateSharedAwbCost}=await import('../lib/invoiceSharedAwbCost.js');
 const {createSharedAwbCostWorkbook}=await import('../lib/invoiceReceiptCostExport.js');
 const {stemsPerBunchCO}=await import('../lib/importPacking.js');
 const source=process.argv[2],hash='a'.repeat(64);
 const invoices=source?JSON.parse(JSON.parse(fs.readFileSync(source,'utf8')).content[0].text).invoices:
  [{supplier:'연습 농장 A',invoice:'TEST-A',products:[{description:'ROSE RED',total_stems:100,pcs:1,u_price:1,t_price:100}]},
   {supplier:'연습 농장 B',invoice:'TEST-B',products:[{description:'CARNATION WHITE',total_stems:300,pcs:1,u_price:.2,t_price:60}]}];
 let seq=0;const receiptLines=[];
 const members=invoices.map((i,n)=>{
  const rows=i.products.map(p=>{const lineId=crypto.randomUUID(),prodKey=900000+(++seq),row={lineId,prodKey,originalName:p.description,actualQuantity:Number(p.total_stems),unit:'STEM',receiptUnit:'STEM',unitPrice:Number(p.u_price),lineAmount:Number(p.t_price),currency:'USD',boxQuantity:Number(p.pcs),stemQuantity:Number(p.total_stems)};
   receiptLines.push({...row,originalName:p.description,outQuantity:row.actualQuantity,outUnit:'송이',priceUnit:'송이',bunchQuantity:null});return row;});
  const group=row=>/RUSCUS/i.test(row.originalName)?'RUSCUS':/ALSTRO/i.test(row.originalName)||i.invoice==='47329'||i.invoice==='FE203978'||i.invoice==='1606'&&!/ROS[AE]/i.test(row.originalName)?'ALSTROMERIA':/ROS[AE]/i.test(row.originalName)||['VE324080','FEER 4346','001075526','44053','CJAR 4430','19622','202875','INV-018631','3440','80043160','2191857'].includes(i.invoice)?'ROSE':'CARNATION';
  return{documentId:crypto.randomUUID(),revision:1,sourceHash:hash,orderYear:'2026',orderWeek:'46-01',country:'CO',currency:'USD',awb:'86514699602',farmName:i.supplier,invoiceNo:i.invoice,rows,lineInputs:rows.map(row=>({lineId:row.lineId,groupId:/Ocean Song/i.test(row.originalName)?'ROSE':group(row),tariffRate:0,stemsPerBunch:stemsPerBunchCO(row.originalName,group(row)==='CARNATION'?20:10),bunchesPerBox:row.boxQuantity>0?row.stemQuantity/(row.boxQuantity*stemsPerBunchCO(row.originalName,10)):null}))};
 });
 const manifest={orderYear:'2026',orderWeek:'46-01',awb:'86514699602',currency:'USD',members:members.map(({documentId,revision,sourceHash})=>({documentId,revision,sourceHash}))};
 const document={documentId:members[0].documentId,revision:1,orderYear:'2026',orderWeek:'46-01',invoiceNo:'AWB 86514699602',receiptStatus:'SHARED_AWB_PREVIEW',costStatus:'PREVIEW_ONLY',receiptLines,reviewedMetadata:{country:'CO',transportMode:'AIR',inputDate:'2026-11-06',farmName:'TEST_ONLY 격리 재생',awb:'86514699602'}};
 const component=fs.readFileSync('components/import-tools/SharedAwbCostReview.js','utf8');
 const compiled=babel.transformSync(component,{presets:[[require('next/dist/compiled/babel/preset-react'),{runtime:'classic'}]],plugins:[require('next/dist/compiled/babel/plugin-transform-modules-commonjs')],configFile:false,babelrc:false}).code;
 const bundle=`const exports={},module={exports};function require(id){if(id==='react')return React;if(id==='../WorkflowGuide')return ()=>null;return new Proxy({},{get:(_,k)=>k==='__esModule'?false:String(k)});} ${compiled}\nReactDOM.render(React.createElement(module.exports.default,{document:${JSON.stringify(document)}}),document.getElementById('app'));`;
 const counts={prepare:0,preview:0,download:0,productionWrites:0,providerCalls:0};
 const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1'),send=(body,status=200,type='application/json')=>{res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store'});res.end(type==='application/json'?JSON.stringify(body):body);};
  try{
   if(url.pathname==='/fixture-status')return send(counts);
   if(url.pathname==='/api/import/receipts/shared-awb-cost'){
    let text='';for await(const c of req)text+=c;const b=JSON.parse(text);
    if(b.action==='prepare'){counts.prepare++;return send({success:true,persisted:false,baselineDigest:'TEST_ONLY',manifest,members});}
    if(!['preview','download'].includes(b.action)||b.baselineDigest!=='TEST_ONLY'||b.completeManifestConfirmed!==true)throw Error('시험용 전체 송장 확인이 필요합니다.');
    // Same production calculator. Only test matching IDs and explicit test fees.
    const selected=members.map(m=>({...m,lineInputs:m.lineInputs.map(l=>({...l,...b.lineInputs?.find(v=>v.lineId===l.lineId)}))}));
    const input={...b.input,exchangeRateType:'TEST_ONLY',costSourceId:'TEST_ONLY:isolated-replay'},result=calculateSharedAwbCost({manifest,members:selected,input});
    if(b.action==='preview'){counts.preview++;return send({success:true,persisted:false,result});}
    if(result.status!=='CALCULATED')throw Error('계산 검증이 필요합니다.');
    const bytes=await createSharedAwbCostWorkbook({document:{...document,reviewedMetadata:{...document.reviewedMetadata,gw:Number(input.gw),cw:Number(input.cw)}},input:{...input,nativeCurrency:'USD',exchangeRateKRW:input.exchangeRate,formulaEffectiveDate:'2026-11-06',costGroups:result.costGroups,lineInputs:result.lineInputs},result});
    counts.download++;res.setHeader('Content-Disposition','attachment; filename="TEST_ONLY-46-1-cost.xlsx"');return send(bytes,200,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
   }
   if(url.pathname.startsWith('/api/'))return send({success:false,error:'격리 서버: 이 API는 차단되었습니다.'},403);
   if(url.pathname==='/bundle.js')return send(bundle,200,'text/javascript; charset=utf-8');
   if(url.pathname==='/react.js'||url.pathname==='/react-dom.js'){const f=path.join('node_modules',url.pathname==='/react.js'?'react/umd/react.development.js':'react-dom/umd/react-dom.development.js');return send(fs.readFileSync(f),200,'text/javascript; charset=utf-8');}
   if(url.pathname==='/style.css')return send(fs.readFileSync('styles/InvoiceReceipt.module.css','utf8'),200,'text/css');
   return send('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/style.css"><body style="font-family:Arial,sans-serif;padding:20px;color:#17365c"><h1>TEST_ONLY · 도착원가 격리 검증</h1><p>실제 웹 컴포넌트·계산기·엑셀 생성기. 품목키·입고는 격리 fixture이며 운영 DB에 연결하지 않습니다. 중량·비용은 시험값입니다.</p><main id="app"></main><script src="/react.js"></script><script src="/react-dom.js"></script><script src="/bundle.js"></script></html>',200,'text/html; charset=utf-8');
  }catch(e){send({success:false,error:e.message},422);}
 });
 server.listen(0,'127.0.0.1',()=>console.log(`SHARED_AWB_FIXTURE http://127.0.0.1:${server.address().port} invoices=${members.length} lines=${seq}`));
 process.on('SIGINT',()=>server.close());process.on('SIGTERM',()=>server.close());
})().catch(e=>{console.error(e.message);process.exitCode=1;});
