// Production read-only E040723 adapter. No exports, screenshots, session URLs or source PII logs.
import fs from 'node:fs';
import recovery from '../../lib/ecountCollectorRecovery.cjs';
import links from '../../lib/ecountVerifiedCustomerLinks.cjs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import policy from '../../lib/ecountCustomerLedgerPolicy.cjs';
import schedule from '../../lib/ecountLedgerSchedule.cjs';
import validation from '../../lib/ecountLedgerValidation.cjs';
import { collectBankSnapshot, collectLedgerWithBank, setReportPeriod } from './pending-receipts.mjs';
const HASH='#menuType=MENUTREE_000004&menuSeq=MENUTREE_001903&groupSeq=MENUTREE_000035&prgId=E040723&depth=4';
const STATE=path.join(path.dirname(fileURLToPath(import.meta.url)),'.ledger-schedule.json');
const RECOVERY_REQUEST=path.join(path.dirname(fileURLToPath(import.meta.url)),'.ledger-recovery-request.json');
const number=v=>{
  const s=String(v??'').replace(/[,\s]/g,'');
  if(!/^-?\d*(\.\d+)?$/.test(s))throw new Error('SOURCE_NUMBER_INVALID');
  const n=Number(s);if(!Number.isFinite(n))throw new Error('SOURCE_NUMBER_INVALID');return n;
};
async function api(base,body=null,suffix=''){
  if(!process.env.NENOVA_TOKEN)throw new Error('SYNC_TOKEN_MISSING');
  const response=await fetch(`${base}/api/ecount/customer-ledger-sync${suffix}`,{method:body?'POST':'GET',
    headers:{Authorization:`Bearer ${process.env.NENOVA_TOKEN}`,'Content-Type':'application/json'},
    body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});
  const result=await response.json();if(!response.ok||!result.success)throw new Error('SYNC_API_FAILED');return result;
}
async function waitForReport(page,period=null,identity=null){
  await page.getByRole('columnheader',{name:'일자',exact:true}).waitFor({state:'visible',timeout:30000});
  await page.waitForFunction(({expected,identity})=>{
    const th=Array.from(document.querySelectorAll('th')).find(e=>e.innerText.trim()==='일자'&&e.getClientRects().length);
    if(!th)return false;
    const id=Array.from(document.querySelectorAll('td')).find(e=>e.getClientRects().length&&e.innerText.trim()==='사업자등록번호');
    if(identity&&id?.nextElementSibling?.innerText.replace(/\D/g,'')!==identity)return false;
    if(expected&&!Array.from(document.querySelectorAll('body *')).some(e=>e.children.length===0&&e.getClientRects().length&&e.innerText?.replaceAll('/','-').replace(/\s/g,'')===expected))return false;
    const rows=Array.from(th.closest('table').rows).filter(r=>!r.querySelector('th'));
    return rows.some(r=>/합계|등록된 데이터가 없습니다\./.test(r.innerText))||
      (rows.length===1&&rows[0].cells.length===4&&rows[0].cells[0].innerText.trim()==='이월잔액');
  },{expected:period?`${period.from}~${period.to}`:null,identity},{timeout:30000});
}
export async function collectCustomerLedger(page,base,customer,period){
  let stage='NAVIGATION',sourceCode=customer.sourceCode;
  try{
  // A fresh document prevents customer lookup modals/SPA panels surviving a same-hash navigation.
  await page.goto('about:blank',{waitUntil:'domcontentloaded'});
  await page.goto(base+HASH,{waitUntil:'domcontentloaded'});
  if(recovery.isSourceLoginUrl(page.url()))throw new Error('LOGIN_EXPIRED');
  const search=page.getByRole('button',{name:'검색(F8)',exact:true});
  // The SPA retains the preceding customer's report when revisiting the same hash.
  await page.getByRole('button',{name:/^(검색\(F8\)|Search\(F3\))$/}).first().waitFor({state:'visible',timeout:30000});
  if(!await search.isVisible())await page.getByRole('button',{name:'Search(F3)',exact:true}).click();
  await search.waitFor({state:'visible',timeout:30000});
  stage='FILTERS';
  await page.getByRole('radio',{name:' 전표별',exact:true}).check();
  await page.getByRole('radio',{name:' 거래처관계기준',exact:true}).check();
  const remove=page.getByRole('button',{name:'',exact:true});
  for(let i=0;i<20&&await remove.count();i++)await remove.first().click();
  if(await remove.count())throw new Error('SOURCE_CUSTOMER_NOT_CLEARED');
  const field=page.getByRole('textbox',{name:'거래처',exact:true});
  stage='CUSTOMER_LOOKUP';
  if(customer.lookupName){
    await field.fill(customer.lookupQuery||customer.lookupName);await field.press('Enter');
    const popup=page.getByRole('button',{name:'적용(F8)',exact:true});
    await Promise.race([remove.waitFor({state:'visible',timeout:10000}),popup.waitFor({state:'visible',timeout:10000})]);
    if(await popup.isVisible()){
      const candidates=await page.evaluate(()=>Array.from(document.querySelectorAll('tr'))
        .filter(r=>r.getClientRects().length&&r.cells.length===5&&r.cells[4].innerText.trim()==='내역')
        .map(r=>({code:r.cells[1].innerText.trim(),name:r.cells[2].innerText.trim()})));
      sourceCode=selectVerifiedCode(candidates,customer);
      await page.getByRole('button',{name:'닫기',exact:true}).click();
      for(let i=0;i<20&&await remove.count();i++)await remove.first().click();
      await field.fill(sourceCode);await field.press('Enter');
    }
  }else{await field.fill(sourceCode);await field.press('Enter');}
  // Exact unique code auto-selects; a popup/ambiguity is never resolved by a name guess.
  try{
    const found=await Promise.race([
      remove.waitFor({state:'visible',timeout:10000}).then(()=>true),
      page.getByRole('button',{name:'적용(F8)',exact:true}).waitFor({state:'visible',timeout:10000}).then(()=>false),
    ]);
    if(!found)throw new Error('SOURCE_CUSTOMER_NOT_FOUND_OR_AMBIGUOUS');
  }
  catch{throw new Error('SOURCE_CUSTOMER_NOT_FOUND_OR_AMBIGUOUS');}
  if(await remove.count()!==1||await page.getByRole('button',{name:'적용(F8)',exact:true}).count())throw new Error('SOURCE_CUSTOMER_AMBIGUOUS');
  stage='PERIOD';
  // Shortcut buttons can be hidden by responsive ECOUNT layouts. Set actual date widgets.
  await setReportPeriod(page,period);
  if(!await page.getByRole('radio',{name:' 전표별',exact:true}).isChecked()||!await page.getByRole('radio',{name:' 거래처관계기준',exact:true}).isChecked())throw new Error('SOURCE_MODE_MISMATCH');
  stage='SEARCH_SUBMIT';
  // Click this page's search button; global F8 can be ignored while the legacy tab is active.
  await search.click();
  stage='REPORT';
  await page.waitForLoadState('networkidle',{timeout:15000});
  // A correct complete report, not a search panel's visibility, establishes completion.
  await waitForReport(page,period,sourceCode.startsWith('sha256:')?null:sourceCode);
  const source=await page.evaluate(()=>{
    const th=Array.from(document.querySelectorAll('th')).find(e=>e.innerText.trim()==='일자'&&e.getClientRects().length);
    const table=th.closest('table');
    const headers=Array.from(table.querySelectorAll('th')).map(e=>e.innerText.trim());
    const rows=Array.from(table.rows).filter(r=>!r.querySelector('th')).map(r=>Array.from(r.cells).map(c=>c.innerText.trim()));
    const idCell=Array.from(document.querySelectorAll('td')).find(c=>c.innerText.trim()==='사업자등록번호'&&c.getClientRects().length);
    const periods=Array.from(document.querySelectorAll('body *')).filter(e=>e.children.length===0&&e.getClientRects().length)
      .map(e=>e.innerText?.trim()).filter(s=>/^\d{4}\/\d{2}\/\d{2}\s*~\s*\d{4}\/\d{2}\/\d{2}$/.test(s));
    return {headers,rows,periods,identity:idCell?.nextElementSibling?.innerText.replace(/\D/g,'')};
  });
  return parseLedgerReport(source,customer,period);
  }catch(e){
    if(recovery.isSourceLoginUrl(page.url()))throw new Error('LOGIN_EXPIRED');
    if(/^[A-Z_]+$/.test(e.message))throw e;
    if(stage==='REPORT'){
      let scope;
      try{scope=await page.evaluate(({code,expected})=>{
        const id=Array.from(document.querySelectorAll('td')).find(c=>c.getClientRects().length&&c.innerText.trim()==='사업자등록번호');
        return {hasIdentity:!!id,identity:id?.nextElementSibling?.innerText.replace(/\D/g,'')===code,
          period:Array.from(document.querySelectorAll('body *')).some(c=>!c.children.length&&c.getClientRects().length&&c.innerText?.replaceAll('/','-').replace(/\s/g,'')===expected)};
      },{code:sourceCode,expected:`${period.from}~${period.to}`});}catch{}
      if(scope?.hasIdentity&&!scope.identity)throw new Error('SOURCE_IDENTITY_MISMATCH');
      if(scope?.identity&&!scope.period)throw new Error('SOURCE_REPORT_PERIOD_NOT_UPDATED');
    }
    throw new Error(`SOURCE_${stage}_FAILED`);
  }
}
export function selectVerifiedCode(candidates,customer){
  const matches=candidates.filter(c=>c.name===customer.lookupName&&links.fingerprint(c.code)===links.fingerprint(customer.sourceCode));
  if(matches.length!==1)throw new Error('SOURCE_CUSTOMER_NOT_FOUND_OR_AMBIGUOUS');
  return matches[0].code;
}
export function parseLedgerReport(source,customer,period,collectedAt=new Date()){
  if(source.headers.join('|')!=='일자|적요|판매|수금|잔액'||links.fingerprint(source.identity)!==links.fingerprint(customer.sourceCode))throw new Error('SOURCE_IDENTITY_MISMATCH');
  const expectedPeriod=`${period.from}~${period.to}`;
  if(source.periods.length!==1||source.periods[0].replaceAll('/','-').replace(/\s/g,'')!==expectedPeriod)throw new Error('SOURCE_PERIOD_MISMATCH');
  const empty=source.rows.length===1&&source.rows[0].join('')==='등록된 데이터가 없습니다.';
  let opening=null,totals=null;const rows=[];
  for(const cells of source.rows){
    if(empty)break;
    if(cells.length===4&&cells[0]==='이월잔액'){if(opening!==null)throw new Error('SOURCE_DUPLICATE_OPENING');opening=number(cells[3]);}
    else if(cells.length===4&&cells[0]==='합계'){if(totals)throw new Error('SOURCE_DUPLICATE_TOTAL');totals={sales:number(cells[1]),receipt:number(cells[2]),balance:number(cells[3])};}
    else if(cells.length===5&&/^\d{4}\/\d{2}\/\d{2}$/.test(cells[0]))rows.push({date:cells[0].replaceAll('/','-'),sales:number(cells[2]),receipt:number(cells[3]),balance:number(cells[4])});
    else throw new Error('SOURCE_UNEXPECTED_ROW');
  }
  // ECOUNT renders only 이월잔액, without 합계, when this period has no movements.
  const balanceOnly=source.rows.length===1&&opening!==null&&!totals&&rows.length===0;
  if(balanceOnly){
    if(number(source.rows[0][1])!==0||number(source.rows[0][2])!==0)throw new Error('SOURCE_UNEXPECTED_ROW');
    totals={sales:0,receipt:0,balance:opening};
  }
  const payload={program:policy.PROGRAM,mode:policy.MODE,individual:true,custKey:customer.custKey,
    periodFrom:period.from,periodTo:period.to,rows,opening,totals,empty,screenRowCount:rows.length,
    basis:'relation-v1',balanceOnly,observedCode:customer.sourceCode,observedBusinessIdentity:source.identity,collectedAt:collectedAt.toISOString()};
  validation.validateLedger(payload,collectedAt);
  return payload;
}
export async function collectLedgerBatch({page,getBase,work,upload,recordFailure=async()=>{},collect=collectCustomerLedger,recoverSession,onDeferred=async()=>{},onProgress=async()=>{},resetAfterFailure,now=Date.now,log=console.log}){
  const startedAt=now(),total=work.customers.length;let ok=0,failed=0,deferred=0,contextUnavailable=false;
  for(const customer of work.customers){
    if(now()-startedAt>45*60000){const remaining=work.customers.slice(ok+failed).map(c=>c.custKey);await onDeferred(remaining);deferred=remaining.length;break;}
    try{const payload=await recovery.withSessionRecovery(()=>collect(page,getBase(),customer,work.period),recoverSession);await upload(payload);ok++;}
    catch(e){
      if(e?.message==='SOURCE_CONTEXT_UNAVAILABLE'){const remaining=work.customers.slice(ok+failed).map(c=>c.custKey);await onDeferred(remaining);deferred=remaining.length;contextUnavailable=true;break;}
      failed++;const reason=/^[A-Z_]+$/.test(e.message)?e.message:'SOURCE_LOOKUP_FAILED';
      log(`[ledger723] customerKey=${customer.custKey} failure=${reason}`);
      try{await recordFailure({custKey:customer.custKey,requestedCode:customer.sourceCode,
        periodFrom:work.period.from,periodTo:work.period.to,collectedAt:new Date(now()).toISOString(),
        failure:['SOURCE_CUSTOMER_NOT_FOUND_OR_AMBIGUOUS','SOURCE_CUSTOMER_AMBIGUOUS','SOURCE_IDENTITY_MISMATCH'].includes(reason)?'LINK_CHECK_REQUIRED':'SOURCE_UNAVAILABLE'});}catch{}
      // A failed lookup may leave a modal open in the SPA. Never carry it to another customer.
      try{if(resetAfterFailure)await resetAfterFailure();else await page.goto('about:blank',{waitUntil:'domcontentloaded'});}
      catch{const remaining=work.customers.slice(ok+failed).map(c=>c.custKey);if(remaining.length){await onDeferred(remaining);deferred=remaining.length;}break;}
    }
    await onProgress(work.customers.slice(ok+failed).map(c=>c.custKey));
    if((ok+failed)%10===0||ok+failed===1)log(`[ledger723] progress=${ok+failed}/${total} verified=${ok} failed=${failed}`);
  }
  return {ok,failed,total,...(deferred?{deferred}: {}),...(contextUnavailable?{contextUnavailable:true}: {})};
}
export function startCustomerLedgerSchedule(ctx,getBase,nenova,{recoverSession,onUnavailable}={}){
  let lastAttempt=null,lastRecoveryId=null,continuation=null,busy=false;
  try{const state=JSON.parse(fs.readFileSync(STATE,'utf8'));lastAttempt=state.lastAttempt;lastRecoveryId=state.lastRecoveryId??null;continuation=state.continuation??null;}catch{}
  const saveState=()=>{fs.writeFileSync(STATE+'.tmp',JSON.stringify({lastAttempt,lastRecoveryId,continuation}));fs.renameSync(STATE+'.tmp',STATE);};
  // These are owned read-only tabs, never the user's login/main tab. Discard modal state after each read.
  const bankRead=(base,period,status,secret)=>recovery.withReadPage(ctx,page=>collectBankSnapshot(page,base,period,status,secret));
  const ledgerRead=(customer,period,history)=>recovery.withReadPage(ctx,page=>collectLedgerWithBank({page,bankPage:null,base:getBase(),customer,period,history,collectLedger:collectCustomerLedger,collectBank:(_page,...args)=>bankRead(...args)}));
  const historyRead=period=>recovery.withSessionRecovery(()=>bankRead(getBase(),period,'REFLECTED',process.env.NENOVA_TOKEN),recoverSession);
  const refreshOne=async item=>{
    if(!item)return;
    let success=false,contextUnavailable=false;
    try{
      let history=null;
      try{history=await historyRead(item.period);}catch(e){console.log(`[ledger723] bank history unavailable ${/^[A-Z_]+$/.test(e.message)?e.message:'BANK_LOOKUP_FAILED'}`);}
      const payload=await recovery.withSessionRecovery(()=>ledgerRead(item,item.period,history),recoverSession);
      await api(nenova,payload);success=true;
    }catch(e){
      const reason=/^[A-Z_]+$/.test(e?.message||'')?e.message:'SOURCE_LOOKUP_FAILED';contextUnavailable=reason==='SOURCE_CONTEXT_UNAVAILABLE';
      try{await api(nenova,{custKey:item.custKey,requestedCode:item.sourceCode,periodFrom:item.period.from,periodTo:item.period.to,collectedAt:new Date().toISOString(),failure:['SOURCE_CUSTOMER_NOT_FOUND_OR_AMBIGUOUS','SOURCE_CUSTOMER_AMBIGUOUS','SOURCE_IDENTITY_MISMATCH'].includes(reason)?'LINK_CHECK_REQUIRED':'SOURCE_UNAVAILABLE'});}catch{}
    }finally{
      try{await api(nenova,{refreshRequestId:item.requestId,refreshSuccess:success});}catch{}
      console.log(`[ledger723] userRefresh customerKey=${item.custKey} success=${success}`);
    }
    if(contextUnavailable)onUnavailable?.();
  };
  const tick=async()=>{
    if(busy)return;
    const slot=schedule.dueSlot(Date.now(),lastAttempt);
    let request;try{request=JSON.parse(fs.readFileSync(RECOVERY_REQUEST,'utf8'));}catch{}
    const recoveryId=recovery.recoveryRequestId(request,lastRecoveryId);
    if(slot===null&&!schedule.isRefreshRequestAllowed())return;
    busy=true;
    try{
      const resume=recovery.continuationEligible(continuation);
      let priorityRequest=null;
      if(slot===null&&!recoveryId&&resume)priorityRequest=(await api(nenova,null,'?queue=refresh')).refreshRequest;
      if(slot!==null||recoveryId||(resume&&!priorityRequest)){
        const pending=slot===null&&!recoveryId?continuation:null;
        if(slot!==null)lastAttempt=slot;
        if(recoveryId)lastRecoveryId=recoveryId;
        if(!pending)continuation=null;saveState();
        let ok=0,failed=0,deferred=0,total=0,contextUnavailable=false;
        try{
          const work=await api(nenova);
          if(pending){
            if(pending.period.from!==work.period.from||pending.period.to!==work.period.to){continuation=null;saveState();console.log('[ledger723] stale continuation discarded');return;}
            const keys=new Set(pending.keys);work.customers=work.customers.filter(c=>keys.has(c.custKey));
          }
          total=work.customers.length;
          const checkpoint=async keys=>{continuation=keys.length?recovery.makeContinuation(work,keys):null;if(keys.length&&!continuation)throw new Error('CONTINUATION_SCOPE_INVALID');saveState();};
          const progress=async keys=>{await checkpoint(keys);if(!schedule.isRefreshRequestAllowed())return;try{await refreshOne((await api(nenova,null,'?queue=refresh')).refreshRequest);}catch{console.log('[ledger723] manual dispatcher unavailable');}};
          // Persist the unconfirmed current customer before touching the browser; crashes cannot lose the tail.
          await checkpoint(work.customers.map(c=>c.custKey));
          let history=null;
          try{history=await historyRead(work.period);}catch(e){console.log(`[ledger723] bank history unavailable ${/^[A-Z_]+$/.test(e.message)?e.message:'BANK_LOOKUP_FAILED'}`);}
          ({ok,failed,deferred=0,contextUnavailable=false}=await collectLedgerBatch({page:null,getBase,work,recoverSession,onDeferred:checkpoint,onProgress:progress,resetAfterFailure:async()=>{},collect:(_page,_base,customer,period)=>ledgerRead(customer,period,history),upload:payload=>api(nenova,payload),recordFailure:payload=>api(nenova,payload)}));
        }catch{failed=Math.max(failed,1);}
        finally{console.log(`[ledger723] slot=${slot===null?(pending?'continuation':'requested-recovery'):new Date(slot).toISOString()} total=${total} verified=${ok} failed=${failed} deferred=${deferred}`);}
        if(contextUnavailable)onUnavailable?.();
        return;
      }
      const result=priorityRequest?{refreshRequest:priorityRequest}:await api(nenova,null,'?queue=refresh');
      const item=result.refreshRequest;
      if(!item)return;
      await refreshOne(item);
    }catch{console.log('[ledger723] refresh dispatcher unavailable');}
    finally{busy=false;}
  };
  const timer=setInterval(()=>void tick(),15000);void tick();return ()=>clearInterval(timer);
}
