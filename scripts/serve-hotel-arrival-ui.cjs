const path=require('node:path'),http=require('node:http'),fs=require('node:fs');
const bundled=require('next/dist/compiled/webpack/webpack');
const out=path.resolve('.local-hotel-ui');
bundled.webpack({mode:'development',entry:path.resolve('scripts/hotel-arrival-ui-fixture.jsx'),output:{path:out,filename:'bundle.js'},resolve:{extensions:['.js','.jsx']},module:{rules:[{test:/\.jsx?$/,exclude:/node_modules/,use:path.resolve('scripts/hotel-arrival-ui-loader.cjs')}]},devtool:false},(error,stats)=>{
 if(error||stats.hasErrors()){console.error(error||stats.toString({all:false,errors:true}));process.exitCode=1;return;}
 http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.setHeader('Content-Type','text/javascript');res.end(fs.readFileSync(path.join(out,'bundle.js')));}else{res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="ko"><meta charset="utf-8"><title>도착원가 격리 검증</title><div id="root"></div><script src="/bundle.js"></script></html>');}}).listen(19428,'127.0.0.1',()=>console.log('http://127.0.0.1:19428 · fixture only · PID '+process.pid));
});
