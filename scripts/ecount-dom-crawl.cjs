'use strict';
// Crawl the deployed ECOUNT workbench shell (unauthenticated: data fetches return 401) and record every
// rendered data-ecount-action-id control per program, including controls that appear after opening the
// search panel, dropdown menus, lookup overlays and dialogs. Output is a safe evidence file: IDs, labels,
// enabled state only. No business data, credentials or session URLs are stored.
// Usage: node scripts/ecount-dom-crawl.cjs [--url https://nenovaweb.com/ecount/workbench] [--out file] [--programs E040708,...]
const fs=require('fs');const path=require('path');const puppeteer=require('puppeteer-core');
const root=path.join(__dirname,'..');
const args=process.argv.slice(2);const opt=(k,d)=>{const i=args.indexOf(k);return i>=0?args[i+1]:d;};
const url=opt('--url','https://nenovaweb.com/ecount/workbench');
const out=opt('--out',path.join(root,'data/ecount-workbench/evidence',new Date().toISOString().slice(0,10)+'-production-dom-crawl.json'));
const only=opt('--programs',null)?.split(',');
const catalog=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/source-menu.json'),'utf8'));
const report=JSON.parse(fs.readFileSync(path.join(root,'data/ecount-workbench/button-matches.json'),'utf8'));
const programs=report.pages.filter(p=>p.buttons?.length&&(!only||only.includes(p.program))).map(p=>p.program);
const list=programs.map(program=>{const menus=catalog.menus.filter(m=>m.program===program);const canon=menus.find(m=>!/MyPage/.test(m.path[0]))||menus[0];return [canon.id,program];});
const exe=[process.env.CHROME_PATH,'C:\Program Files\Google\Chrome\Application\chrome.exe','/usr/bin/google-chrome','/usr/bin/chromium-browser'].filter(Boolean).find(p=>fs.existsSync(p));
if(!exe){console.error('chrome executable not found; set CHROME_PATH');process.exit(2);}
(async()=>{
  const browser=await puppeteer.launch({executablePath:exe,headless:'new',protocolTimeout:1800000,args:['--no-sandbox','--disable-dev-shm-usage','--window-size=1920,1080']});
  try{
    const page=await browser.newPage();await page.setViewport({width:1920,height:945});
    await page.goto(url,{waitUntil:'networkidle2',timeout:60000});await new Promise(r=>setTimeout(r,3000));
    const results=await page.evaluate(async LIST=>{
      window.open=()=>null;const sleep=ms=>new Promise(r=>setTimeout(r,ms));const results={},errors=[];
      const snap=()=>[...document.querySelectorAll('[data-ecount-action-id]')].map(e=>({id:e.dataset.ecountActionId,tag:e.tagName,type:e.type||'',disabled:!!e.disabled,label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,40),dialog:!!e.closest('[role=dialog],[role=menu]')}));
      const merge=(prog,items,ctx)=>{const r=results[prog];for(const it of items){const k=it.id;if(!r[k])r[k]={...it,contexts:[ctx]};else{if(!it.disabled)r[k].disabled=false;if(r[k].contexts.length<6&&!r[k].contexts.includes(ctx))r[k].contexts.push(ctx);}}};
      const closeAll=async()=>{document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));await sleep(120);for(let i=0;i<3;i++){const c=[...document.querySelectorAll('[role=dialog] button, [class*=overlay] button')].find(b=>/^닫기$/.test(b.textContent.trim())&&!b.disabled);if(!c)break;c.click();await sleep(150);}};
      for(const [menuId,prog] of LIST){
        location.hash='menu='+menuId;await sleep(1500);results[prog]={};merge(prog,snap(),'initial');
        document.dispatchEvent(new KeyboardEvent('keydown',{key:'F3',bubbles:true}));await sleep(800);merge(prog,snap(),'F3');
        const clicked=new Set();
        for(let round=0;round<4;round++){
          const btns=[...document.querySelectorAll('button[data-ecount-action-id]:not(:disabled)')].filter(b=>!clicked.has(b.dataset.ecountActionId)&&!(b.form&&b.type==='submit')&&!/^(닫기|취소|close|Search(F3))$/.test((b.textContent||b.getAttribute('aria-label')||'').trim()));
          if(!btns.length)break;
          for(const b of btns){const id=b.dataset.ecountActionId;clicked.add(id);
            const live=document.querySelector('[data-ecount-action-id="'+id+'"]');if(!live||live.disabled){clicked.delete(id);continue;}try{live.click();await sleep(900);merge(prog,snap(),'after:'+id);}catch(e){errors.push(prog+' '+id+' '+e.message);}
            await closeAll();
            if(!location.hash.includes(menuId)){location.hash='menu='+menuId;await sleep(1200);}
            if(!document.getElementById('ecount-source-search')){document.dispatchEvent(new KeyboardEvent('keydown',{key:'F3',bubbles:true}));await sleep(300);}
          }
        }
        results[prog].__meta={clicked:[...clicked],title:document.title};
      }
      return {results,errors};
    },list);
    // Lookup windows (orderStat 항목추가 / poStat 집계조건검색) render on a separate page opened via window.open.
    const uuid=()=>'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g,c=>{const r=Math.random()*16|0;return (c==='x'?r:(r&3|8)).toString(16);});
    for(const [dataset,program] of [['orderStat','E040209'],['poStat','E040306']]){
      if(!results.results[program])continue;
      try{
      const lookupUrl=new URL(url);lookupUrl.pathname='/ecount/lookup';lookupUrl.search='?dataset='+dataset+'&nonce='+uuid();lookupUrl.hash='';
      await page.goto(lookupUrl.toString(),{waitUntil:'networkidle2',timeout:60000});await new Promise(r=>setTimeout(r,1500));
      const items=await page.evaluate(()=>[...document.querySelectorAll('[data-ecount-action-id]')].map(e=>({id:e.dataset.ecountActionId,tag:e.tagName,type:e.type||'',disabled:!!e.disabled,label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,40),dialog:true})));
      for(const it of items){const r=results.results[program];if(!r[it.id])r[it.id]={...it,contexts:['lookup-page']};}
      results.results[program].__meta.lookupPageIds=items.length;
      }catch(e){results.errors.push('lookup '+dataset+' '+e.message.slice(0,120));}
    }
    // Union with a previous crawl of the same output (timing differences must never drop evidence).
    if(fs.existsSync(out)){try{const prev=JSON.parse(fs.readFileSync(out,'utf8'));for(const [prog,r] of Object.entries(prev.results||{})){const cur=results.results[prog]||(results.results[prog]={__meta:{clicked:[],title:''}});for(const [id,v] of Object.entries(r)){if(id==='__meta')continue;if(!cur[id])cur[id]={...v,contexts:[...(v.contexts||[]),'previous-run'].slice(0,6)};else if(!v.disabled)cur[id].disabled=false;}}}catch(e){results.errors.push('union '+e.message.slice(0,80));}}
    const payload={observedOn:new Date().toISOString().slice(0,10),site:url,auth:'unauthenticated shell (data fetch 401)',method:'puppeteer-core headless Chrome; hash menu select, F3 keydown, click each enabled non-submit data-ecount-action-id button, snapshot [data-ecount-action-id] after each step; window.open stubbed',privacy:{rawBusinessValues:false,personalData:false,accountValues:false,credentials:false,sessionUrls:false},...results};
    fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(payload,null,0)+'\n');
    const counts=Object.fromEntries(Object.entries(results.results).map(([p,r])=>[p,Object.keys(r).length-1]));
    console.log(JSON.stringify({out:path.relative(root,out),programs:Object.keys(counts).length,ids:Object.values(counts).reduce((a,b)=>a+b,0),errors:results.errors.length,counts}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
