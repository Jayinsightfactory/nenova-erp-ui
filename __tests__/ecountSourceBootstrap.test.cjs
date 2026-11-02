const {test}=require('node:test'),assert=require('node:assert/strict');
const {isSourceLoginUrl,isSourceErpUrl}=require('../lib/ecountCollectorRecovery.cjs');
const ERP='https://logincc.ecount.com/ec56/view/erp',LOGIN='https://logincc.ecount.com/ec56/view/login/erp_login';
test('observed ECOUNT login redirect is auth, never an ERP base; strict host/path and year-version scope',()=>{
 for(const value of ['https://login.ecount.com/',LOGIN,LOGIN+'?sample=1',LOGIN.replace('ec56','ec57')]){assert.equal(isSourceLoginUrl(value),true);assert.equal(isSourceErpUrl(value),false);}
 for(const value of [ERP,ERP+'?ec_req_sid=fixture#report']){assert.equal(isSourceErpUrl(value),true);assert.equal(isSourceLoginUrl(value),false);}
 for(const value of ['about:blank','https://logincc.ecount.com.evil.invalid/ec56/view/erp','https://evil.invalid/?next='+ERP,'https://logincc.ecount.com/ec56/view/erp_login','https://logincc.ecount.com/ec56/view/erp/extra','http://logincc.ecount.com/ec56/view/erp','https://logincc.ecount.com/ECERP/Popup.Common/LoginInfoSearch']){assert.equal(isSourceErpUrl(value),false);assert.equal(isSourceLoginUrl(value),false);}
});
test('bootstrap waits for bounded DOM load, does not require network-idle, and retains only actual ERP base',async()=>{
 const {ensureBooted}=await import('../scripts/ecount-scraper/scrape-core.mjs');let current=ERP+'?ec_req_sid=fixture#report',visits=0;
 const page={url:()=>current,waitForLoadState:async(state,o)=>{assert.equal(state,'domcontentloaded');assert.equal(o.timeout,15000);},waitForTimeout:async n=>assert.equal(n,2500),goto:async(_url,o)=>{visits++;assert.equal(o.waitUntil,'domcontentloaded');assert.equal(o.timeout,30000);current=LOGIN;}};
 assert.equal(await ensureBooted(page),ERP+'?ec_req_sid=fixture');assert.equal(visits,0);
 current=LOGIN;assert.equal(await ensureBooted(page),null);assert.equal(visits,1);
 current='about:blank';page.goto=async()=>{throw Error('navigation');};assert.equal(await ensureBooted(page),null);
 current=ERP;page.waitForLoadState=async()=>{current=LOGIN;throw Error('bounded timeout');};page.goto=async()=>{};assert.equal(await ensureBooted(page),null);
 current='about:blank';page.goto=async()=>{current=ERP+'?ec_req_sid=renewed#menu';};assert.equal(await ensureBooted(page),ERP+'?ec_req_sid=renewed');
});
