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
// ---- Conditional states -------------------------------------------------------------------------------
// Some target controls only render after a UI state the generic click loop never reaches (aggregate mode,
// multi-kind selection, a Search(F3) inside a dialog, a date-basis menu). STATE_STEPS lists, per program, a
// named state with the reason and an ordered list of async(page) steps; a snapshot is merged after every step
// under context "state:<name>:<step>". Click targets are addressed by data-ecount-action-id (resolved from
// ACTION_IDS in components/ecount/ObservedPageControls.js, never typed by hand) or by aria-label.
const controlsSrc=fs.readFileSync(path.join(root,'components/ecount/ObservedPageControls.js'),'utf8');
const ACTION_IDS=(()=>{const start=controlsSrc.indexOf('const ACTION_IDS = ')+'const ACTION_IDS = '.length;let depth=0,pos=start,inStr=false;for(;pos<controlsSrc.length;pos++){const ch=controlsSrc[pos];if(inStr){if(ch==='\\')pos++;else if(ch==='"')inStr=false;continue;}if(ch==='"')inStr=true;else if(ch==='{')depth++;else if(ch==='}'){depth--;if(!depth)break;}}return JSON.parse(controlsSrc.slice(start,pos+1));})();
function aid(dataset,label,context='unknown'){const id=ACTION_IDS[dataset]?.[context+'|'+label];if(!id)throw new Error(`ACTION_IDS missing ${dataset} ${context}|${label}`);return id;}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const sel=t=>t.id?`[data-ecount-action-id="${t.id}"]`:`[aria-label="${t.aria}"]`;
async function click(page,target,wait=700){const s=sel(target);await page.waitForSelector(s,{timeout:5000});const ok=await page.$eval(s,e=>{if(e.disabled)return false;e.scrollIntoView({block:'center'});e.click();return true;});if(!ok)throw new Error('disabled '+s);await sleep(wait);}
async function keydown(page,key){await page.evaluate(k=>document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true})),key);await sleep(500);}
// Toggle the search panel to the wanted state: F3 keydown first (what the generic loop uses), Search(F3) button as fallback.
async function search(page,open){const isOpen=()=>page.evaluate(()=>!!document.getElementById('ecount-source-search'));if(await isOpen()===open)return;await keydown(page,'F3');if(await isOpen()===open)return;await page.click('[aria-controls="ecount-source-search"]');await sleep(500);if(await isOpen()!==open)throw new Error('search panel could not be '+(open?'opened':'closed'));}
async function escape(page){await keydown(page,'Escape');}
const STATE_STEPS={
  E040708:[{state:'kinds-all',reason:'거래처 집계 라디오는 종류 2개 이상 선택 시에만 렌더(종류 선택창 전체 선택 → 적용(F8))',steps:[
    p=>search(p,true),p=>click(p,{id:aid('daySale','종류 검색','검색 패널')}),p=>click(p,{id:aid('daySale','전체 선택','종류 선택창')}),p=>click(p,{id:aid('daySale','적용(F8)','종류 선택창')},900)]}],
  E040209:[{state:'aggregate',reason:'집계조건1 검색·항목추가 대화상자(new-window)는 집계 모드 라디오 선택 후 렌더',steps:[
    p=>search(p,true),p=>click(p,{id:aid('orderStat','집계','검색 모드')}),p=>click(p,{id:aid('orderStat','집계조건1 검색','검색 패널')},900),p=>escape(p)]},
   {state:'fn-menu',reason:'Fn 드롭다운(설정)은 검색 패널이 닫힌 상태에서만 렌더',steps:[
    p=>search(p,false),p=>click(p,{id:aid('orderStat','Fn','상단')}),p=>escape(p)]}],
  E040306:[{state:'aggregate',reason:'집계조건1 검색·집계조건검색 대화상자(new-window)는 집계 모드 라디오 선택 후 렌더',steps:[
    p=>search(p,true),p=>click(p,{id:aid('poStat','집계','검색 모드')}),p=>click(p,{id:aid('poStat','집계조건1 검색','검색 패널')},900),p=>escape(p)]}],
  E040208:[{state:'detail-mode',reason:'전표별은 검색 모드 현황(detail) 전환 후 렌더(기본 집계)',steps:[
    p=>search(p,true),p=>click(p,{id:aid('quoteStat','현황','검색 모드')})]}],
  E040609:[{state:'date-range',reason:'종료연도/월 선택은 날짜기준 메뉴에서 기준일자(date_range) 선택 후 렌더',steps:[
    p=>search(p,true),p=>click(p,{id:aid('unpSale','날짜 기준 선택','검색 패널')}),p=>click(p,{id:aid('unpSale','기준일자','날짜 기준 메뉴')})]}],
  E010205:[{state:'mapping-search',reason:'매핑 검색 패널·유형은 매핑조회 대화상자 안 Search(F3) 클릭 후 렌더',steps:[
    p=>click(p,{id:aid('cash','매핑조회')},900),p=>click(p,{id:aid('cash','Search(F3)','매핑 선택창')}),p=>escape(p)]}],
  E040711:[{state:'vertical-mode',reason:'현황(종)은 검색 모드 창고별(종) 라디오 선택 후 렌더(기본 창고별(횡))',steps:[
    p=>search(p,true),p=>click(p,{id:aid('whStock','창고별(종)','검색 모드')})]}],
};
// Controls the crawler knowingly does not reach. Recorded in __meta.unreached so the gap is explicit, not silent.
const UNREACHED={
  E040218:[{ids:['E040218-A09','E040218-A10','E040218-A11'],reason:'login-required: 결과 행 버튼은 자료 로드(로그인) 후에만 렌더; 비로그인 크롤(401)에서는 도달 불가'},
           {ids:['E040218-A33','E040218-A34','E040218-A35'],reason:'login-required: 발송상태 탭은 자료 로드(로그인) 후에만 렌더; 비로그인 크롤(401)에서는 도달 불가'}],
  E040728:[{ids:['E040728-A14'],reason:'structure-differs: 대상은 인쇄 버튼이 직접 메뉴 트리거(ObservedDropdown label="인쇄")라 별도 "인쇄 드롭다운" ID가 렌더되지 않음; 크롤 변경 아님'}],
  E040726:[{ids:['E040726-A13'],reason:'structure-differs: 대상은 인쇄 버튼이 직접 메뉴 트리거(ObservedDropdown label="인쇄")라 별도 "인쇄 드롭다운" ID가 렌더되지 않음; 크롤 변경 아님'}],
  E040727:[{ids:['E040727-A14'],reason:'structure-differs: 대상은 인쇄 버튼이 직접 메뉴 트리거(ObservedDropdown label="인쇄")라 별도 "인쇄 드롭다운" ID가 렌더되지 않음; 크롤 변경 아님'}],
  E040702:[{ids:['E040702-A46'],reason:'structure-differs: 대상은 인쇄 버튼이 직접 메뉴 트리거(ObservedDropdown label="인쇄")라 별도 "인쇄 드롭다운" ID가 렌더되지 않음; 크롤 변경 아님'}],
  E040719:[{ids:['E040719-A25'],reason:'structure-differs: 대상은 인쇄 버튼이 직접 메뉴 트리거(ObservedDropdown label="인쇄")라 별도 "인쇄 드롭다운" ID가 렌더되지 않음; 크롤 변경 아님'}],
  E040304:[{ids:['E040304-A14'],reason:'no-render-site: ACTION_IDS 키(원본위치상세미확인|이름없는드롭다운)만 있고 컴포넌트에 렌더 지점이 없음'}],
  E040609:[{ids:['E040609-A07'],reason:'no-render-site: ACTION_IDS 키(하단|오천건이상조회)만 있고 컴포넌트에 렌더 지점이 없음'}],
};
const SNAP=()=>[...document.querySelectorAll('[data-ecount-action-id]')].map(e=>({id:e.dataset.ecountActionId,tag:e.tagName,type:e.type||'',disabled:!!e.disabled,label:(e.getAttribute('aria-label')||e.textContent||'').trim().slice(0,40),dialog:!!e.closest('[role=dialog],[role=menu]')}));
function mergeInto(r,items,ctx){const added=[];for(const it of items){const k=it.id;if(!r[k]){r[k]={...it,contexts:[ctx]};added.push(k);}else{if(!it.disabled)r[k].disabled=false;if(r[k].contexts.length<6&&!r[k].contexts.includes(ctx))r[k].contexts.push(ctx);}}return added;}
async function runStates(page,results,errors,list){
  const byProg=Object.fromEntries(list.map(([m,p])=>[p,m]));
  for(const [prog,states] of Object.entries(STATE_STEPS)){
    const r=results[prog];if(!r)continue;const menuId=byProg[prog];r.__meta.states=[];
    for(const st of states){
      const rec={state:st.state,reason:st.reason,ok:true,newIds:[]};
      try{
        // Reset: hop to another menu and back so mode/dialog state starts from the component defaults.
        const other=list.find(([,p])=>p!==prog)?.[0];
        await page.evaluate(()=>{window.open=()=>null;});
        if(other){await page.evaluate(id=>{location.hash='menu='+id;},other);await sleep(700);}
        await page.evaluate(id=>{location.hash='menu='+id;},menuId);await sleep(1500);
        for(let i=0;i<st.steps.length;i++){await st.steps[i](page);rec.newIds.push(...mergeInto(r,await page.evaluate(SNAP),`state:${st.state}:${i+1}`));}
      }catch(e){rec.ok=false;rec.error=String(e.message||e).slice(0,160);errors.push(`state ${prog} ${st.state} ${rec.error}`);}
      // Leave the page clean for the next state/program.
      await escape(page).catch(()=>{});
      r.__meta.states.push(rec);
    }
  }
  for(const [prog,items] of Object.entries(UNREACHED)){if(results[prog])results[prog].__meta.unreached=items.map(it=>({...it,ids:it.ids.filter(id=>!results[prog][id])}));}
}
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
    // Conditional states (STATE_STEPS) + knowingly unreached controls (UNREACHED) — union into the same results.
    await runStates(page,results.results,results.errors,list);
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
    const payload={observedOn:new Date().toISOString().slice(0,10),site:url,auth:'unauthenticated shell (data fetch 401)',method:'puppeteer-core headless Chrome; hash menu select, F3 keydown, click each enabled non-submit data-ecount-action-id button, snapshot [data-ecount-action-id] after each step; window.open stubbed; per-program STATE_STEPS reach conditional states (aggregate mode, multi-kind selection, dialog Search(F3), date-basis menu) and snapshot after every step (__meta.states); knowingly unreached controls listed in __meta.unreached',privacy:{rawBusinessValues:false,personalData:false,accountValues:false,credentials:false,sessionUrls:false},...results};
    fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(payload,null,0)+'\n');
    const counts=Object.fromEntries(Object.entries(results.results).map(([p,r])=>[p,Object.keys(r).length-1]));
    const states=Object.fromEntries(Object.entries(results.results).filter(([,r])=>r.__meta?.states?.length).map(([p,r])=>[p,r.__meta.states.map(s=>`${s.state}:${s.ok?'ok':'FAIL'}:+${s.newIds.length}`)]));
    const unreached=Object.fromEntries(Object.entries(results.results).filter(([,r])=>r.__meta?.unreached?.length).map(([p,r])=>[p,r.__meta.unreached.reduce((a,u)=>a+u.ids.length,0)]));
    console.log(JSON.stringify({out:path.relative(root,out),programs:Object.keys(counts).length,ids:Object.values(counts).reduce((a,b)=>a+b,0),errors:results.errors.length,states,unreached,counts}));
    if(results.errors.length)console.error('errors',results.errors);
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1);});
