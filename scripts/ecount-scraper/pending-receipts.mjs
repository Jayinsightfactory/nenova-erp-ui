// E010205 read-only queries. Raw counterpart/account strings never leave this process.
import crypto from 'node:crypto';
import pending from '../../lib/ecountPendingReceipts.cjs';
const HASH='#menuType=MENUTREE_000001&menuSeq=MENUTREE_002563&groupSeq=MENUTREE_002562&prgId=E010205&depth=3';
const HEADERS=['','입/출금일자','구분','계좌번호','계좌명','거래처코드','거래처명','금액','입금처(출금처)','비 고','원화잔액','지점명/상대은행','회계전표'];
const normalize=s=>String(s??'').normalize('NFC').trim().replace(/\s+/g,' ');
export function sanitizeBankRows(source,status,secret){
  if(!secret||!['PENDING','REFLECTED'].includes(status)||source.headers.join('|')!==HEADERS.join('|'))throw new Error('BANK_SCHEMA_MISMATCH');
  const digest=values=>crypto.createHmac('sha256',secret).update(JSON.stringify(values)).digest('hex');
  if(source.rows.length===1&&source.rows[0].length===1&&source.rows[0][0]==='등록된 데이터가 없습니다.')return [];
  // ECOUNT includes a muted numeric-only footer without a date or checkbox.
  const isFooter=c=>c.length===13&&[0,1,2,3,4,5,6,8,9,11,12].every(i=>c[i]==='')&&[7,10].every(i=>/^-?[\d,]+(?:\.\d+)?$/.test(c[i]));
  return source.rows.filter(c=>!isFooter(c)).map(c=>{
    if(c.length!==13||c[2]!=='입금'||!/^\d{4}\/\d{2}\/\d{2}\s+(오전|오후)\s+\d{1,2}:\d{2}:\d{2}$/.test(normalize(c[1])))throw new Error('BANK_ROW_MISMATCH');
    const amount=Number(c[7].replace(/,/g,'')),balance=Number(c[10].replace(/,/g,''));
    if(!c[3]||!c[10]||!Number.isSafeInteger(amount)||amount<=0||!Number.isFinite(balance)||(status==='PENDING'?!!c[12]:!/^\d{4}\/\d{2}\/\d{2}-\d+$/.test(c[12])))throw new Error('BANK_STATUS_MISMATCH');
    const id=digest([normalize(c[3]),normalize(c[1]),amount,balance,normalize(c[8]),normalize(c[11])]);
    // Own-account transfers can have no payer. Retain their status, but never learn
    // a customer alias from an empty payer shared by unrelated transactions.
    const pattern=c[8]?digest([normalize(c[3]),normalize(c[8]),normalize(c[11])]):digest(['NO_PAYER',id]);
    return {id,pattern,date:c[1].slice(0,10).replaceAll('/','-'),amount,status,
      code:c[5]?pending.codeHash(c[5]):null,self:/네노바|nenova/i.test(normalize(c[6])),postingDate:status==='REFLECTED'?c[12].slice(0,10).replaceAll('/','-'):null};
  });
}
async function readPage(page){
  return page.evaluate(()=>{
    const th=[...document.querySelectorAll('th')].find(e=>e.getClientRects().length&&e.innerText.trim()==='거래처코드');
    if(!th)return null;
    const table=th.closest('table');
    const pager=[...document.querySelectorAll('.wrapper-pagination')].find(e=>e.getClientRects().length);
    const periods=[...document.querySelectorAll('body *')].filter(e=>!e.children.length&&e.getClientRects().length&&/^\d{4}\/\d{2}\/\d{2}\s*~\s*\d{4}\/\d{2}\/\d{2}$/.test(e.innerText?.trim())).map(e=>e.innerText.trim());
    return {headers:[...table.querySelectorAll('th')].map(e=>e.innerText.trim()),rows:[...table.rows].filter(r=>!r.querySelector('th')).map(r=>[...r.cells].map(c=>c.querySelector('input[type=text]')?.value?.trim()||c.innerText.trim())),periods,
      page: Number(pager?.querySelector('li.active')?.innerText||1),pages:pager?Number(pager.innerText.match(/\/\s*(\d+)/)?.[1]):1,
      tab:[...document.querySelectorAll('li.active[data-tabid]')].map(e=>e.dataset.tabid)};
  });
}
async function waitReport(page){
  await page.getByRole('columnheader',{name:'거래처코드',exact:true}).waitFor({state:'visible',timeout:30000});
  await page.waitForLoadState('networkidle',{timeout:15000});
}
export async function setReportPeriod(page,period){
  for(const [date,offset] of [[period.from,0],[period.to,3]]){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('SOURCE_PERIOD_MISMATCH');
    const [year,month,day]=date.split('-');
    for(const [index,value,label] of [[offset,year,year.slice(-2)],[offset+1,month,month]]){
      const field=page.locator(`button[data-cid="ddlSYear_DATE"][data-index="${index}"]:visible`);
      if((await field.innerText()).trim()!==label){
        await field.click();
        await page.locator(`ul.dropdown-menu-selectbox:visible li[data-value="${value}"] a`).click();
      }
      if((await field.innerText()).trim()!==label)throw new Error('SOURCE_PERIOD_MISMATCH');
    }
    const field=page.locator(`input[data-cid="ddlSYear_DATE"][data-index="${offset+2}"]:visible`);
    await field.fill(day);await field.press('Tab');
    if(Number(await field.inputValue())!==Number(day))throw new Error('SOURCE_DAY_INPUT_NOT_COMMITTED');
  }
  // Let date-widget blur/re-render finish before clicking the search button.
  await page.waitForLoadState('networkidle',{timeout:15000});
}
export async function collectBankSnapshot(page,base,period,status,secret){
  const allRows=[];
  const prevFrom=`${period.from.slice(0,7)}-01`,currentFrom=`${period.to.slice(0,7)}-01`;
  const prevTo=new Date(Date.parse(`${currentFrom}T00:00:00Z`)-86400000).toISOString().slice(0,10);
  for(const [from,to] of [[prevFrom,prevTo],[currentFrom,period.to]]){
    await page.goto('about:blank',{waitUntil:'domcontentloaded'});
    await page.goto(base+HASH,{waitUntil:'domcontentloaded'});
    const search=page.getByRole('button',{name:'검색(F8)',exact:true});
    await page.getByRole('button',{name:/^(검색\(F8\)|Search\(F3\))$/}).first().waitFor({state:'visible',timeout:30000});
    if(!await search.isVisible())await page.getByRole('button',{name:'Search(F3)',exact:true}).click();
    await search.waitFor({state:'visible',timeout:30000});
    for(const cid of ['txtACCTNO','txtBkjukyo','txtBkInput_BETWEEN']){
      const fields=page.locator(`input[data-cid="${cid}"]:visible`);
      for(let i=0;i<await fields.count();i++)await fields.nth(i).fill('');
    }
    if(await page.getByRole('button',{name:'',exact:true}).count())throw new Error('BANK_ACCOUNT_FILTER_ACTIVE');
    await page.getByRole('radio',{name:' 입금',exact:true}).check();
    await setReportPeriod(page,{from,to});
    await search.click();
    await waitReport(page);
    const tab=status==='PENDING'?'미반영':'회계반영',tabId=status==='PENDING'?'tabUnReflect':'tabAccountReflect';
    await page.getByRole('link',{name:tab,exact:true}).click();
    await waitReport(page);
    let pages=null;
    for(let n=1;n<=200;n++){
      const source=await readPage(page);
      if(!source||source.periods.length!==1||source.periods[0].replaceAll('/','-').replace(/\s/g,'')!==`${from}~${to}`||!source.tab.includes(tabId)||source.page!==n||!Number.isInteger(source.pages)||source.pages<1)throw new Error('BANK_SCOPE_MISMATCH');
      if(pages!==null&&pages!==source.pages)throw new Error('BANK_PAGING_CHANGED');
      pages=source.pages;
      allRows.push(...sanitizeBankRows(source,status,secret));
      if(n===pages)break;
      if(n===200)throw new Error('BANK_TOO_MANY_PAGES');
      const next=page.locator('.wrapper-pagination:visible').first().getByRole('link',{name:String(n+1),exact:true});
      if(await next.count())await next.click();
      else await page.locator('.wrapper-pagination:visible').first().locator('.next-page a').click();
      await page.waitForFunction(expected=>Number([...document.querySelectorAll('.wrapper-pagination')].find(e=>e.getClientRects().length)?.querySelector('li.active')?.innerText)===expected,n+1,{timeout:30000});
      await waitReport(page);
    }
  }
  return pending.validateBankSnapshot({at:new Date().toISOString(),from:prevFrom,to:period.to,complete:true,rows:allRows});
}
export async function collectLedgerWithBank({page,bankPage,base,customer,period,history,collectLedger,collectBank=collectBankSnapshot,secret=process.env.NENOVA_TOKEN}){
  let before=null;
  try{before=await collectBank(bankPage,base,period,'PENDING',secret);}catch{}
  const ledger=await collectLedger(page,base,customer,period);
  if(!before||!history)return {...ledger,bankEvidence:{unavailable:true}};
  try{
    const after=await collectBank(bankPage,base,period,'PENDING',secret);
    return {...ledger,bankEvidence:{before,after,history}};
  }catch{return {...ledger,bankEvidence:{unavailable:true}};}
}
