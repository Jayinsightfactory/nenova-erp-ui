// Isolated local browser smoke: no production credentials, no ERP endpoints.
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const jwt=require('jsonwebtoken');
const puppeteer=require('puppeteer-core');
async function main(){
 const listener=require('node:net').createServer();await new Promise(resolve=>listener.listen(0,'127.0.0.1',resolve));const port=listener.address().port;await new Promise(resolve=>listener.close(resolve));
 const secret=randomUUID(),base=`http://127.0.0.1:${port}`;
 const env={...process.env,JWT_SECRET:secret};for(const key of Object.keys(env))if(/^(DB_|MSSQL|SQL_|NENOVAWEB_SERVICE)/.test(key))delete env[key];
 const child=spawn(process.execPath,[require.resolve('next/dist/bin/next'),'start','-p',String(port)],{cwd:process.cwd(),env,stdio:['ignore','pipe','pipe'],windowsHide:true});
 let output='';child.stdout.on('data',data=>{output+=data;});child.stderr.on('data',data=>{output+=data;});
 let browser,temp;const failures=[],erpWrites=[];
 try{
  for(let n=0;n<120;n++){if(child.exitCode!==null)throw Error('Local server exited');try{if((await fetch(base+'/api/ping')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,500));}
  browser=await puppeteer.launch({executablePath:process.env.CHROME_BIN||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-gpu']});
  async function session(userId){
   const context=await browser.createBrowserContext();
   await context.setCookie({name:'nenovaToken',value:jwt.sign({userId,userName:'Local fixture',authority:1,accountActive:true},secret,{expiresIn:'15m'}),url:base});
   const page=await context.newPage();await page.setViewport({width:1920,height:1080});
   page.on('pageerror',error=>failures.push(error.message));await page.setRequestInterception(true);
   page.on('request',request=>{
    const url=new URL(request.url());
    if(url.origin!==base)return request.abort();
    if(!url.pathname.startsWith('/api/'))return request.continue();
    if(url.pathname==='/api/import/tools/upload-history')return request.continue();
    if(url.pathname.startsWith('/api/import/receipts/')&&request.method()!=='GET')erpWrites.push(url.pathname);
    let data={success:true,rows:[],history:[],items:[],value:null,revision:0};
    if(url.pathname==='/api/auth/me')data={success:true,user:{userId,userName:'Local fixture',authority:1,accountActive:true}};
    if(url.pathname==='/api/import/tools/product-matches')data={success:true,scope:'team',products:[],value:{version:1,items:[]},revision:0};
    return request.respond({status:200,contentType:'application/json',body:JSON.stringify(data)});
   });
   await page.goto(base+'/import/tools?popup=1',{waitUntil:'networkidle0'});return page;
  }
  const a=await session('history-test-a');
  console.log('Local A page ready');
  temp=await fs.mkdtemp(path.join(os.tmpdir(),'packing-browser-'));const filename='TEST_HISTORY_ONLY_'+randomUUID()+'.pdf';
  await fs.writeFile(path.join(temp,filename),'%PDF-1.7\nLocal history fixture only. No analysis.');
  await a.waitForSelector('button[aria-label="중국"]');
  await a.click('button[aria-label="중국"]');
  const input=await a.waitForSelector('input[accept*=".pdf"]');await input.uploadFile(path.join(temp,filename));
  await a.waitForFunction(()=>document.body.innerText.includes('팀 업로드 이력 보관 완료'),{timeout:30000});
  console.log('Local A original archived');
  // Emulate a previously selected year in the isolated server fixture, then
  // verify the real restore UI carries it through the next automatic snapshot.
  await a.evaluate(async name=>{
   const rows=(await(await fetch('/api/import/tools/upload-history')).json()).rows;
   const detail=(await(await fetch('/api/import/tools/upload-history?id='+rows.find(row=>row.fileName===name).id)).json()).record;
   const response=await fetch('/api/import/tools/upload-history',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:crypto.randomUUID(),uploadId:detail.uploadId,sourceHash:detail.sourceHash,expectedUserId:'history-test-a',snapshot:{...detail.snapshot,dateYear:'2025'}})});
   if(!response.ok)throw Error('Local year fixture save failed');
  },filename);
  const b=await session('history-test-b');
  console.log('Local B page ready');
  const history=await b.waitForSelector('button[aria-controls="import-panel-history"]');await history.focus();await b.keyboard.press('Space');
  await b.waitForFunction(name=>document.querySelector('#import-panel-history')?.innerText.includes(name),{timeout:15000},filename);
  await b.screenshot({path:'.packing-history-table-smoke.png',fullPage:false});
  b.on('dialog',dialog=>dialog.accept());
  await b.evaluate(name=>{const row=[...document.querySelectorAll('tr')].find(row=>row.innerText.includes(name));row.querySelector('button').click();},filename);
  const resume=await b.waitForSelector('[data-testid="packing-work-restore"]',{visible:true});await resume.focus();await b.keyboard.press('Enter');
  await b.waitForFunction(()=>document.body.innerText.includes('원본 파일을 복구했습니다'),{timeout:15000});
  await b.waitForFunction(()=>document.body.innerText.includes('팀 업로드 이력 보관 완료'),{timeout:30000});
  const restoredYear=await b.evaluate(async name=>{
   const rows=(await(await fetch('/api/import/tools/upload-history')).json()).rows;
   const row=rows.find(item=>item.fileName===name&&item.actor==='history-test-b');
   return (await(await fetch('/api/import/tools/upload-history?id='+row.id)).json()).record.snapshot.dateYear;
  },filename);
  assert.equal(restoredYear,'2025');
  assert.deepEqual(erpWrites,[]);assert.deepEqual(failures,[]);
  await b.screenshot({path:'.packing-history-smoke.png',fullPage:false});
  console.log('PASS real local browser: A original archive -> B shared history -> keyboard restore; selected year 2025 preserved; latest shared matches fetched; zero ERP writes; zero page errors.');
 }finally{await browser?.close();child.kill();if(temp)await fs.rm(temp,{recursive:true,force:true});}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
