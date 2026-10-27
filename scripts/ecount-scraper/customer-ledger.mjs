// Production read-only E040723 adapter. No exports, screenshots, session URLs or source PII logs.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import policy from '../../lib/ecountCustomerLedgerPolicy.cjs';
import schedule from '../../lib/ecountLedgerSchedule.cjs';
import validation from '../../lib/ecountLedgerValidation.cjs';
const HASH='#menuType=MENUTREE_000004&menuSeq=MENUTREE_001903&groupSeq=MENUTREE_000035&prgId=E040723&depth=4';
const STATE=path.join(path.dirname(fileURLToPath(import.meta.url)),'.ledger-schedule.json');
const number=v=>{
  const s=String(v??'').replace(/[,\s]/g,'');
  if(!/^-?\d*(\.\d+)?$/.test(s))throw new Error('SOURCE_NUMBER_INVALID');
  const n=Number(s);if(!Number.isFinite(n))throw new Error('SOURCE_NUMBER_INVALID');return n;
};
async function api(base,body){
  if(!process.env.NENOVA_TOKEN)throw new Error('SYNC_TOKEN_MISSING');
  const response=await fetch(`${base}/api/ecount/customer-ledger-sync`,{method:body?'POST':'GET',
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
  let stage='NAVIGATION';
  try{
  // A fresh document prevents customer lookup modals/SPA panels surviving a same-hash navigation.
  await page.goto('about:blank',{waitUntil:'domcontentloaded'});
  await page.goto(base+HASH,{waitUntil:'domcontentloaded'});
  const search=page.getByRole('button',{name:'검색(F8)',exact:true});
  // The SPA retains the preceding customer's report when revisiting the same hash.
  await page.getByRole('button',{name:/^(검색\(F8\)|Search\(F3\))$/}).first().waitFor({state:'visible',timeout:30000});
  if(!await search.isVisible())await page.getByRole('button',{name:'Search(F3)',exact:true}).click();
  await search.waitFor({state:'visible',timeout:30000});
  stage='FILTERS';
  await page.getByRole('radio',{name:' 전표별',exact:true}).check();
  await page.getByRole('radio',{name:' 개별거래처기준',exact:true}).check();
  const remove=page.getByRole('button',{name:'',exact:true});
  for(let i=0;i<20&&await remove.count();i++)await remove.first().click();
  if(await remove.count())throw new Error('SOURCE_CUSTOMER_NOT_CLEARED');
  const field=page.getByRole('textbox',{name:'거래처',exact:true});
  stage='CUSTOMER_LOOKUP';
  await field.fill(customer.sourceCode);await field.press('Enter');
  // Exact unique code auto-selects; a popup/ambiguity is never resolved by a name guess.
  try{await remove.waitFor({state:'visible',timeout:10000});}
  catch{throw new Error('SOURCE_CUSTOMER_NOT_FOUND_OR_AMBIGUOUS');}
  if(await remove.count()!==1||await page.getByRole('button',{name:'적용(F8)',exact:true}).count())throw new Error('SOURCE_CUSTOMER_AMBIGUOUS');
  stage='PERIOD';
  // Date shortcuts immediately search in ECOUNT. Reopen the filter before setting exact days.
  await page.getByRole('button',{name:'전월+금월',exact:true}).click();
  await waitForReport(page,null,customer.sourceCode);
  const reopen=page.getByRole('button',{name:'Search(F3)',exact:true});
  if(!await search.isVisible()){await reopen.waitFor({state:'visible',timeout:30000});await reopen.click();}
  for(const [date,offset] of [[period.from,0],[period.to,3]]){
    const [year,month,day]=date.split('-');
    for(const [index,value] of [[offset,year.slice(-2)],[offset+1,month]]){
      const label=await page.locator(`button[data-cid="ddlSYear_DATE"][data-index="${index}"]:visible`).innerText();
      if(label.trim()!==value)throw new Error('SOURCE_PERIOD_MISMATCH');
    }
    const dayField=page.locator(`input[data-cid="ddlSYear_DATE"][data-index="${offset+2}"]:visible`);
    await dayField.fill(day);
    // Commit and read back ECOUNT's edited day before requesting the report.
    await dayField.press('Tab');
    if(Number(await dayField.inputValue())!==Number(day))throw new Error('SOURCE_PERIOD_MISMATCH');
  }
  if(!await page.getByRole('radio',{name:' 전표별',exact:true}).isChecked()||!await page.getByRole('radio',{name:' 개별거래처기준',exact:true}).isChecked())throw new Error('SOURCE_MODE_MISMATCH');
  stage='SEARCH_CLICK';
  await search.click();
  stage='REPORT';
  // A correct complete report, not a search panel's visibility, establishes completion.
  await waitForReport(page,period,customer.sourceCode);
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
  }catch(e){if(/^[A-Z_]+$/.test(e.message))throw e;throw new Error(`SOURCE_${stage}_FAILED`);}
}
export function parseLedgerReport(source,customer,period,collectedAt=new Date()){
  if(source.headers.join('|')!=='일자|적요|판매|수금|잔액'||source.identity!==customer.sourceCode)throw new Error('SOURCE_IDENTITY_MISMATCH');
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
    balanceOnly,observedCode:customer.sourceCode,observedBusinessIdentity:source.identity,collectedAt:collectedAt.toISOString()};
  validation.validateLedger(payload,collectedAt);
  return payload;
}
export async function collectLedgerBatch({page,getBase,work,upload,recordFailure=async()=>{},collect=collectCustomerLedger,now=Date.now,log=console.log}){
  const startedAt=now(),total=work.customers.length;let ok=0,failed=0;
  for(const customer of work.customers){
    if(now()-startedAt>45*60000){failed+=total-ok-failed;break;}
    try{const payload=await collect(page,getBase(),customer,work.period);await upload(payload);ok++;}
    catch(e){
      failed++;const reason=/^[A-Z_]+$/.test(e.message)?e.message:'SOURCE_LOOKUP_FAILED';
      log(`[ledger723] customerKey=${customer.custKey} failure=${reason}`);
      try{await recordFailure({custKey:customer.custKey,requestedCode:customer.sourceCode,
        periodFrom:work.period.from,periodTo:work.period.to,collectedAt:new Date(now()).toISOString(),
        failure:['SOURCE_CUSTOMER_NOT_FOUND_OR_AMBIGUOUS','SOURCE_CUSTOMER_AMBIGUOUS','SOURCE_IDENTITY_MISMATCH'].includes(reason)?'LINK_CHECK_REQUIRED':'SOURCE_UNAVAILABLE'});}catch{}
      // A failed lookup may leave a modal open in the SPA. Never carry it to another customer.
      try{await page.goto('about:blank',{waitUntil:'domcontentloaded'});}
      catch{failed+=total-ok-failed;break;}
    }
    if((ok+failed)%10===0||ok+failed===1)log(`[ledger723] progress=${ok+failed}/${total} verified=${ok} failed=${failed}`);
  }
  return {ok,failed,total};
}
export function startCustomerLedgerSchedule(ctx,getBase,nenova){
  let lastAttempt=null,busy=false;
  try{lastAttempt=JSON.parse(fs.readFileSync(STATE,'utf8')).lastAttempt;}catch{}
  const tick=async()=>{
    const slot=schedule.dueSlot(Date.now(),lastAttempt,process.env.ECOUNT_LEDGER_BOOTSTRAP==='1');
    if(slot===null||busy)return;
    busy=true;lastAttempt=slot;
    let page,ok=0,failed=0,total=0;
    try{
      // Claim before collection, including across process restarts. No midnight/weekend catch-up.
      fs.writeFileSync(STATE,JSON.stringify({lastAttempt:slot}));
      const work=await api(nenova);total=work.customers.length;
      page=await ctx.newPage();
      ({ok,failed}=await collectLedgerBatch({page,getBase,work,upload:payload=>api(nenova,payload),recordFailure:payload=>api(nenova,payload)}));
    }catch{failed=Math.max(failed,1);}
    finally{
      if(page)await page.close().catch(()=>{});
      console.log(`[ledger723] slot=${new Date(slot).toISOString()} total=${total} verified=${ok} failed=${failed}`);
      busy=false;
    }
  };
  const timer=setInterval(()=>void tick(),15000);void tick();
  return ()=>clearInterval(timer);
}
