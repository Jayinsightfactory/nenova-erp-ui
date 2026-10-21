const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const jwt=require('jsonwebtoken'),crypto=require('node:crypto');
const session=require('../lib/rememberDeviceSession.cjs');
require('./profitProductionSmoke.test.cjs');
const root=path.resolve(__dirname,'..'),dir=fs.mkdtempSync(path.join(os.tmpdir(),'nenova-device-test-'));
const source=f=>fs.readFileSync(path.join(root,f),'utf8');
function load(file,scope,expression){
 const code=source(file).replace(/^import .*;\r?\n/gm,'').replace(/^export \{[^}]+\};\r?\n/gm,'').replace(/export default /g,'').replace(/export /g,'').replace("await import('./db')","await Promise.resolve(db)");
 return new Function(...Object.keys(scope),code+'\nreturn '+expression)(...Object.values(scope));
}
const user={UserID:'fixture',UserName:'Fixture',Password:'fixture-password-only',Authority:6,DeptName:'Test',isDeleted:false};
let at=Date.parse('2025-12-31T12:00:00Z'), current={...user},queryCount=0;
const store=session.createStore({dir,secret:'fixture-secret',now:()=>at});
const deviceSession={...session,createStore:()=>store};
const db={sql:{NVarChar:'NVarChar'},query:async(sql,params)=>{assert.match(sql,/^SELECT /);assert.equal(params.id.value,user.UserID);queryCount++;return {recordset:current?[current]:[]};}};
const access={effectiveAuthority:u=>u.Authority,applyEffectiveWebAccess:u=>u};
const env={JWT_SECRET:'fixture-secret',NODE_ENV:'production',NENOVAWEB_SERVICE_TOKEN:'fixture-service'};
const auth=load('lib/auth.js',{jwt,crypto,deviceSession,db,...access,process:{env},trackApiCall:()=>{},activityHttp:{attachRequestAudit:()=>{}}},'{withAuth,verifyReqUser,createToken,deviceSessionStore}');
const login=load('pages/api/auth/login.js',{query:db.query,sql:db.sql,...auth,deviceSession,...access,activityHttp:{attachRequestAudit:()=>{}},global:{},process:{env}},'handler');
const logout=load('pages/api/auth/logout.js',{...auth,deviceSession},'handler');
const response=()=>({statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},getHeader(k){return this.headers[k];},status(n){this.statusCode=n;return this;},json(v){this.body=v;return this;},end(){return this;}});
const request=(token)=>({method:'GET',headers:{},cookies:token?{nenovaToken:token}:{},url:'/api/fixture'});
const cookieToken=r=>r.headers['Set-Cookie'].match(/^nenovaToken=([^;]+)/)[1];
(async()=>{try{
 assert.equal(session.isDeviceToken('../../escape'),false);
 for(const rememberDevice of [undefined,false,'true',true]){
  const req={...request(),method:'POST',body:{userId:user.UserID,password:user.Password,rememberDevice}},res=response();await login(req,res);
  assert.equal(res.statusCode,200);const token=cookieToken(res);
  assert.equal(session.isDeviceToken(token),rememberDevice===true);
  assert.match(res.headers['Set-Cookie'],/HttpOnly.*Path=\/.*SameSite=Strict/);
  assert.equal(jwt.decode(res.body.token).exp-jwt.decode(res.body.token).iat,28800,'Bearer tokens stay 8h even when cookie is remembered');
  assert.ok(!JSON.stringify(res.body).includes('nd1.'),'persistent secret never exposed in JSON');
 }
 const first=store.create(user),second=store.create(user);
 const files=fs.readdirSync(dir).filter(x=>x.endsWith('.json')).map(x=>fs.readFileSync(path.join(dir,x),'utf8')).join('');
 assert.ok(!files.includes(first)&&!files.includes(user.Password),'no raw secret on disk');
 at+=9*60*60*1000;
 assert.ok(await session.createStore({dir,secret:'fixture-secret',now:()=>at}).authenticate(first,async()=>user),'restart and 8h boundary');
 const out=response();await auth.withAuth((req,res)=>res.json({user:req.user}))(request(first),out);assert.equal(out.body.user.userId,user.UserID);
 current={...user,Authority:2};assert.equal((await auth.verifyReqUser(request(first),response())).authority,2,'current permissions');
 const disabledToken=store.create(user),changedToken=store.create(user);
 current={...user,isDeleted:1};assert.equal(await auth.verifyReqUser(request(disabledToken),response()),null);
 current={...user,Password:'changed-fixture'};assert.equal(await auth.verifyReqUser(request(changedToken),response()),null);current={...user};
 assert.equal(await auth.verifyReqUser(request(changedToken),response()),null,'old session cannot revive if password later restored');
 assert.equal(await auth.verifyReqUser(request(disabledToken),response()),null,'reactivation requires fresh login');
 at+=session.RENEW_MS;const renewed=response();assert.ok(await auth.verifyReqUser(request(first),renewed));assert.ok(renewed.headers['Set-Cookie']);
 const desktopToken=store.create(user);at+=session.RENEW_MS;
 const desktopResponse=response();assert.ok(await auth.verifyReqUser({...request(desktopToken),headers:{'user-agent':'Fixture NenovaDesktop/1.3.4'}},desktopResponse));
 assert.equal(desktopResponse.headers['Set-Cookie'],undefined,'legacy desktop must not stop work views on cookie renewal');
 const deny=response();await auth.withAuth(()=>{throw Error('must not execute')})(request('nd1.'+'a'.repeat(43)),deny);assert.equal(deny.statusCode,401);
 assert.equal(await auth.verifyReqUser({headers:{authorization:'Bearer '+first}},response()),null,'device token cannot become automation bearer');
 const count=queryCount;const ordinary=auth.createToken(user);assert.ok(await auth.verifyReqUser({headers:{authorization:'Bearer '+ordinary}}));assert.equal(queryCount,count);
 assert.throws(()=>jwt.verify(ordinary,env.JWT_SECRET,{clockTimestamp:jwt.decode(ordinary).exp+1}),/expired/);
 assert.ok(await auth.verifyReqUser({headers:{authorization:'Bearer '+env.NENOVAWEB_SERVICE_TOKEN}}));assert.equal(queryCount,count);
 const logres=response();logout({...request(first),method:'POST'},logres);assert.equal(logres.statusCode,200);assert.match(logres.headers['Set-Cookie'],/Max-Age=0/);
 assert.equal(await store.authenticate(first,async()=>user),null);assert.ok(await store.authenticate(second,async()=>user),'other device remains');
 const raced=store.create(user);assert.equal(await store.authenticate(raced,async()=>{store.revoke(raced);return user;}),null,'logout during account query');
 const noRead=store.create(user);await assert.rejects(()=>store.authenticate(noRead,async()=>{throw Error('DB unavailable')}),/DB unavailable/);
 const old=store.create(user);at+=session.MAX_AGE*1000+1;assert.equal(await store.authenticate(old,async()=>user),null,'400 days inactivity expires');
 const failed=response();await login({...request(),method:'POST',body:{userId:user.UserID,password:'wrong-fixture',rememberDevice:true}},failed);assert.equal(failed.statusCode,401);assert.equal(failed.headers['Set-Cookie'],undefined);
 for(const file of ['pages/login.js','pages/m/login.js']){assert.match(source(file),/\[rememberDevice, setRememberDevice\] = useState\(false\)/);assert.match(source(file),/JSON\.stringify\(\{ userId: id, password: pw, rememberDevice \}\)/);}
 const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.endsWith('.js')?[path.join(d,e.name)]:[]);
 for(const file of walk(path.join(root,'pages'))){const text=fs.readFileSync(file,'utf8');for(const m of text.matchAll(/verifyReqUser\(req(?:,\s*res)?\)/g))assert.match(text.slice(Math.max(0,m.index-6),m.index),/await\s$/,'must await auth: '+file);}
 assert.match(session.sessionCookie('fixture',1,true),/; Secure$/);assert.doesNotMatch(session.sessionCookie('fixture',1,true),/Domain=/);
 console.log('PASS remember-device: explicit opt-in, 8h legacy/Bearer, 400d renewal/restart/year boundary, current access, password/disabled rejection, per-device logout/race, no plaintext, DB fail-closed, SSR awaits');
}finally{const resolved=path.resolve(dir);assert.ok(resolved.startsWith(path.join(os.tmpdir(),'nenova-device-test-')));fs.rmSync(resolved,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
