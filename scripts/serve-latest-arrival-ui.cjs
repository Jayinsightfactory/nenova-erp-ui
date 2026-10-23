// Isolated UI, read-only SQL. No Next instrumentation, login/save or mutation routes.
const path=require('node:path'),http=require('node:http'),fs=require('node:fs');
const bundled=require('next/dist/compiled/webpack/webpack');
process.loadEnvFile('C:/Users/USER/nenova-erp-ui/.env.local');
const out=path.resolve('.local-hotel-ui');
bundled.webpack({mode:'development',entry:path.resolve('scripts/latest-arrival-ui-fixture.jsx'),output:{path:out,filename:'latest.js'},resolve:{extensions:['.js','.jsx']},module:{rules:[{test:/\.jsx?$/,exclude:/node_modules/,use:path.resolve('scripts/hotel-arrival-ui-loader.cjs')}]},devtool:false},(error,stats)=>{
 if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return;}
 http.createServer(async(req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1:19429');
  if(req.method!=='GET'){res.statusCode=405;return res.end();}
  if(url.pathname==='/api/arrival-cost/latest'){
   try {const {loadLatestArrivalReferences}=await import('../lib/latestArrivalReference.js');const {query}=await import('../lib/db.js');
    const safe=(q,p)=>{if(/\b(INSERT|UPDATE|DELETE|CREATE|ALTER|EXEC)\b/i.test(q))throw Error('Read-only guard');return query(q,p)};
    const references=await loadLatestArrivalReferences({orderYear:url.searchParams.get('orderYear'),items:JSON.parse(url.searchParams.get('items'))},safe);
    res.setHeader('Content-Type','application/json');return res.end(JSON.stringify({success:true,references}));
   }catch(error){res.statusCode=500;return res.end(JSON.stringify({success:false,error:'조회 실패'}));}
  }
  if(url.pathname==='/latest.js'){res.setHeader('Content-Type','text/javascript');return res.end(fs.readFileSync(path.join(out,'latest.js')));}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>최신 원가 검증</title><div id="root"></div><script src="/latest.js"></script></html>');
 }).listen(19429,'127.0.0.1',()=>console.log('http://127.0.0.1:19429 PID '+process.pid));
});
