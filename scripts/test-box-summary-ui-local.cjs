// Serve the actual built page against isolated SQL readbacks. Never forwards an API.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const root=path.resolve(__dirname,'..'),secret=randomUUID(),env={...process.env,JWT_SECRET:secret};
for(const k of Object.keys(env))if(/^(DB_|MSSQL|SQL_|NENOVAWEB_SERVICE)/.test(k))delete env[k];
assert(!fs.existsSync(path.join(root,'.env.local'))&&!fs.existsSync(path.join(root,'.env')));
const rows=['CO','AU','US'].flatMap((country,i)=>JSON.parse(fs.readFileSync(path.join(root,'.local-box-summary',country+'.json'),'utf8')).rows.map(r=>({...r,WarehouseKey:Number(r.WarehouseKey)+i*1000000})));
const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','--hostname','127.0.0.1','-p','19451'],{cwd:root,env,stdio:'ignore',windowsHide:true});
const token=require('jsonwebtoken').sign({userId:'invoice-fixture',authority:1,accountActive:true},secret,{expiresIn:'2h'});
const server=http.createServer(async(req,res)=>{
 const u=new URL(req.url,'http://127.0.0.1:19452'),route=u.pathname;
 const send=(v,status=200)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(v));};
 if(route==='/__test/stop'&&req.method==='POST'){send({ok:true});server.closeAllConnections();server.close();child.kill();return;}
 if(req.method!=='GET')return send({error:'READ_ONLY_TEST'},405);
 if(route.startsWith('/api/')){
  if(route==='/api/warehouse/boxes')return send({success:true,rows:rows.filter(r=>r.OrderYear>=u.searchParams.get('year')&&r.OrderYear<=u.searchParams.get('toYear'))});
  if(route==='/api/auth/me')return send({success:true,user:{userId:'invoice-fixture',authority:1,accountActive:true}});
  return send({success:true,rows:[],items:[]});
 }
 if(route!=='/incoming/boxes'&&!route.startsWith('/_next/')&&!/\.(ico|svg|png|woff2?)$/.test(route))return send({error:'NOT_ALLOWED'},403);
 const upstream=http.request({hostname:'127.0.0.1',port:19451,path:req.url,headers:{...req.headers,host:'127.0.0.1:19451',cookie:'nenovaToken='+token}},r=>{res.writeHead(r.statusCode,{...r.headers,'set-cookie':'nenovaToken='+token+'; Path=/; HttpOnly; SameSite=Strict','content-security-policy':"connect-src 'self' blob: data:; form-action 'self';"});r.pipe(res);});upstream.on('error',()=>send({error:'FRONTEND_NOT_READY'},503));upstream.end();
});
server.listen(19452,'127.0.0.1',()=>console.log('BOX_SUMMARY_UI http://127.0.0.1:19452/incoming/boxes?popup=1'));
process.on('SIGINT',()=>{server.closeAllConnections();server.close();child.kill();});
