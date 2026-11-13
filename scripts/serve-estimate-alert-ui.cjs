// Loopback fixture only. Never reads .env or connects to a database.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const output='C:/Users/USER/nenova-alert-check-20261113/browser';
require('next/dist/compiled/webpack/webpack').webpack({mode:'development',entry:path.resolve('scripts/estimate-alert-ui-fixture.jsx'),output:{path:output,filename:'ui.js'},resolve:{extensions:['.js','.jsx']},module:{rules:[{test:/\.jsx?$/,exclude:/node_modules/,use:path.resolve('scripts/hotel-arrival-ui-loader.cjs')}]},devtool:false},(error,stats)=>{
 if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return;}
 http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:19437');
  if(req.method!=='GET'){res.statusCode=405;return res.end();}
  if(url.pathname==='/ui.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(output,'ui.js')));}
  if(url.pathname==='/api/estimate/ledger-alerts'){
   const week=Number(url.searchParams.get('week'));
   res.setHeader('Content-Type','application/json; charset=utf-8');
   if(week===41){res.statusCode=500;return res.end(JSON.stringify({success:false,error:'연습용 SQL 조회 실패'}));}
   const rows=[{Kind:week===42?'missing-linked-deduction':'deleted-product-shipment',OrderWeek:`${week}-01`,CustKey:999,CustName:'연습 업체',ProdKey:999,ProdName:'연습용 다이브 긴 품목명 · 표시 확인',Quantity:10,Unit:'단',Amount:week===42?null:109091,ReferenceKey:999}];
   const data={success:true,scope:{year:'2026',week},total:week===40||week===39?0:1,rows:week===40||week===39?[]:rows,linkedDeductionCheck:week===39?'unavailable':'checked'};
   return setTimeout(()=>res.end(JSON.stringify(data)),week===37?1800:30);
  }
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>견적서 알림 연습</title><style>button{padding:6px 10px;margin:4px}table{border-collapse:collapse}th,td{border:1px solid #ccd5df;padding:8px;text-align:left}summary{cursor:pointer;padding:8px}@media print{.no-print{display:none}}</style><div id="root"></div><script src="/ui.js"></script></html>');
 }).listen(19437,'127.0.0.1',()=>console.log('Fixture http://127.0.0.1:19437 PID '+process.pid));
});
