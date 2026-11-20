// Pure, read-only interpretation of collected import-room text. Never an ERP order writer.
import { messageDay, readImportDay, todaySeoul, validItem } from './importKakaoAdditions.js';
const clean = value => String(value ?? '').normalize('NFKC').trim().replace(/\s+/g, ' ');
const fold = value => clean(value).toLowerCase();
const flowers = /수국|카네이션|알스트로메리아|알스트로|루스커스|튤립|히야신스|아스틸베|장미|카라|거베라|국화|안개|안시리움|스키미아|유칼립투스|작약|다알리아|달리아|호접|덴파레|모카라|스타티스|라넌큘러스|줄맨드라미|네리네|아이리스|클레마티스|수선화/;
const countries = /콜롬비아|네덜란드|에콰도르|중국|태국|베트남|호주|미국|(?:^|\s)콜(?=\s|수국|장미|카네이션)/;
const englishFlowers = [[/hydrangea/i,'수국'],[/carnation/i,'카네이션'],[/alstroemeria/i,'알스트로'],[/ruscus/i,'루스커스'],[/astilbe/i,'아스틸베'],[/tulip/i,'튤립'],[/hyacinth/i,'히야신스'],[/anthurium/i,'안시리움'],[/gypsophil/i,'안개'],[/skimmia/i,'스키미아'],[/rose/i,'장미'],[/clematis/i,'클레마티스'],[/daffodil/i,'수선화'],[/nerine/i,'네리네'],[/\biris\b/i,'아이리스']];
const addIntent = /발주|주문|추가|구매|보내\s*주세요|부탁(?:합니다|드립니다)|해\s*주세요/;
const information = /문의|정보\s*요청|사진\s*요청|단가|가격|네고|가능\s*(?:여부|할|한)|있을까요|받아\s*볼|추천|불량|클레임|검품|포장|혼적|입고\s*완료|도착\s*완료|온\s*\d+박스|보내었습니다|이런\s*실수|\bprice\s*:|\bseason\s*:/i;
const change = /취소|대체|정정|변경|반품|넘겨|넘긴|이월|미컨펌|미확보|발주\s*확인|원본이\s*다른|삭제되었습니다|안\s*해주셔도|수정했습니다/;
const codePattern = /\b[A-Z]*CL[A-Z0-9_-]*\b/i;
const companyCodeHeading = /^([가-힣A-Za-z][가-힣A-Za-z0-9 .()&]{0,23}?)\s+([A-Z]*CL)\s*-?\s*(\d{1,5})$/i;
const quantityLine = /^(.*?)\s*[:：]?\s*(\d+(?:,\d{3})*(?:\.\d{1,3})?)\s*(박스|boxes?|box|단|bunch(?:es)?|스팀|스템|송이|stems?|st|봉|개)?\s*((?:추가|취소|대체|정정|발주|주문|부탁|보내|해주|해주세요|\(|（|\[|[-–]\s*총|$).*)$/i;

function category(text) { return text.match(flowers)?.[0]?.replace('알스트로메리아','알스트로') || englishFlowers.find(([re])=>re.test(text))?.[1] || ''; }
function country(text) { const c=clean(text.match(countries)?.[0]); return c==='콜'?'콜롬비아':c; }
function week(text) { const m=text.match(/(?:^|\s)(\d{1,2})\s*-\s*(\d{1,2})(?:차|\s|$)/); return m?`${Number(m[1])}-${String(Number(m[2])).padStart(2,'0')}`:text.match(/(?:^|\s)(\d{1,2})차/)?.[1]||''; }
function unit(text) { return /^(st|stems?|스팀|스템|송이)$/i.test(text)?'송이':/^(boxes?|박스)$/i.test(text)?'박스':/^(bunch(?:es)?|단)$/i.test(text)?'단':text; }
function stripBullet(text) { return clean(text).replace(/^[*★•·\->]+\s*/, '').replace(/^\d+[.)]\s*/, ''); }
function parseLine(line) {
  const text=stripBullet(line), match=text.match(quantityLine);
  if (!match || !/[a-z가-힣]/i.test(match[1]) || /[+\-~→>]\s*$/.test(match[1])) return null;
  const product=match[1].replace(/[:：]\s*$/, '').trim();
  if(/^[A-Z]*CL$/i.test(product))return null;
  // Prose quantities (complaints, prices, received goods) are never product lines.
  if (/발주|주문|추가|문의|가격|단가|필요|이번|박스\s*중|총\s*$|사진|ETA|차수|도착|취소|변경|불량|그럼|부탁|보내|차에\s*$|\d\s*(박스|단|스팀|스템|송이|봉)/.test(product)) return null;
  return { product, quantity:match[2].replace(/,/g,''), unit:unit(match[3]||''), note:clean(match[4]).replace(/^(?:추가|발주|주문)\s*/, '') };
}

// Only unambiguous raw-customer -> confirmed-customer evidence is reused.
export function importCustomerAliases(values) {
  const candidates=new Map();
  for(const row of values.slice(1)) {
    const name=clean(row[19]||row[8]), raw=clean(row[7]);
    if(!raw||!name)continue;
    for(const key of [raw,raw.match(codePattern)?.[0]].filter(Boolean)) {
      const id=fold(key); if(!candidates.has(id))candidates.set(id,new Set()); candidates.get(id).add(name);
    }
  }
  return new Map([...candidates].filter(([,v])=>v.size===1).map(([k,v])=>[k,[...v][0]]));
}
function customerName(text, aliases) {
  const raw=clean(text), code=raw.match(codePattern)?.[0];
  return aliases.get(fold(raw)) || (code && aliases.get(fold(code))) || raw;
}

export function analyzeImportMessage(message, aliases=new Map()) {
  const text=String(message.text||'').normalize('NFKC'), lines=text.split(/\r?\n/).map(stripBullet).filter(Boolean);
  const explicit=/발주|주문|추가/.test(text), altered=change.test(text);
  const issue=information.test(text);
  let context={country:'',group:'',week:'',customer:''}, items=[], unparsed=[], retained=[];
  for(let index=0;index<lines.length;index++) {
    const line=lines[index], next=lines[index+1]||'';
    const keep=line.match(/^기존(?:대로|처럼)\s+(.+?)\s*(\d+(?:,\d{3})*)\s*(박스|단|송이|스팀|스템|봉|개)(?:만)?\s*(?:받겠습니다|유지합니다|유지해주세요)[.!]?$/);
    if(keep){retained.push({product:clean(keep[1]),quantity:keep[2].replace(/,/g,''),unit:unit(keep[3])});continue;}
    // Header establishes context only inside this message (never across unrelated chats).
    if (/발주|주문|추가|변경사항/.test(line) && !parseLine(line) && (week(line)||country(line)||category(line))) {
      context.country=country(line)||context.country;
      context.group=category(line)||context.group;
      context.week=week(line)||context.week;
      const code=line.match(codePattern)?.[0]; if(code)context.customer=customerName(code,aliases);
      const named=line.replace(/\d{1,2}(?:-\d{1,2})?차?/g,'').replace(countries,'').replace(flowers,'').replace(/선?발주|주문|추가|변경사항|요청/g,'').trim();
      if(!code && /^[가-힣A-Za-z]{2,12}(?:\s*호텔)?$/.test(named) && !/고정|긴급|확인|수정|취소|완료|선발주/.test(named))context.customer=customerName(named,aliases);
      if(/\d\s*(박스|단|스팀|스템|송이|봉)/.test(line))unparsed.push(line);
      continue;
    }
    if (/^(?:ETA|\d{1,2}월|메시지가 삭제|\(?총\s*\d|#.*합계)/i.test(line))continue;
    const companyCode = line.match(companyCodeHeading);
    if (companyCode && !category(companyCode[1]) && !information.test(line) && !change.test(line) && !addIntent.test(line)) {
      const name = companyCode[1].trim(), code = companyCode[2].toUpperCase() + companyCode[3];
      context.customer = aliases.get(fold(line)) || aliases.get(fold(code)) || aliases.get(fold(name)) || `${name} ${code}`;
      continue;
    }
    if (!parseLine(line) && (country(line)||category(line)) && !information.test(line) && !addIntent.test(line) && line.length<25) {
      const rest=line.replace(countries,'').replace(flowers,'').replace(/\d{1,2}-\d{1,2}차?/,'').trim();
      if(!rest){context.country=country(line)||context.country;context.group=category(line)||context.group;context.week=week(line)||context.week;continue;}
    }
    // Company heading: CL, confirmed alias, hotel/name heading immediately before an item.
    if (!parseLine(line) && (codePattern.test(line) && line.length<40 || aliases.has(fold(line)) || (parseLine(next) && line.length<=24 && !/[.?!,]/.test(line) && !information.test(line) && !change.test(line) && !addIntent.test(line) && !/차|사진|전산|농장/.test(line)))) {
      const label=line.replace(/\s*건\s*$/, '');
      context.customer=customerName(/에\s*추가|해주세요|해주세용/.test(label)?label.match(codePattern)?.[0]||label:label,aliases);
      if(items.length && (text.match(/\b[A-Z]*CL[A-Z0-9_-]*\b/gi)||[]).length===1 && items.every(i=>!i.customer))items=items.map(i=>({...i,customer:context.customer}));
      continue;
    }
    let value=line, customer=context.customer;
    const prefix=line.match(/^([^:：]{1,30})\s*[:：]\s*(.+)$/);
    if(prefix && parseLine(prefix[2])) { customer=customerName(prefix[1],aliases); value=prefix[2]; }
    const parsed=parseLine(value);
    if(parsed) {
      let rawProduct=parsed.product.replace(/^\d{1,2}(?:-\d{1,2})?차?\s+/,'').trim(), group=category(rawProduct)||context.group;
      const source=message.items?.find(item=>fold(item.rawProduct)===fold(rawProduct));
      if (source?.correctedProduct) rawProduct=source.correctedProduct;
      group=category(rawProduct)||group||category(source?.group||'');
      // Remove only the explicit category prefix; retain cultivar, colour, grade and size.
      let product=rawProduct.replace(new RegExp('^'+(group||'(?!)')+'\\s*[/ ]\\s*','i'),'').trim();
      if(!product||/^\d+(?:[~-]\d+)?\s*cm$/i.test(product))product=rawProduct;
      // Verified literal spelling variant, scoped by category in aggregation.
      if (/^(문라이트|moon\s*light)$/i.test(product))product='Moon Light';
      const itemCountry=country(rawProduct)||context.country;
      const itemWeek=context.week||week(text);
      items.push({...parsed,key:JSON.stringify([message.id,index]),sourceLine:line,product,group,country:itemCountry,
        week:itemWeek,year:clean(message.time).match(/^\d{4}/)?.[0]||'',customer:customer||source?.correctedCustomer||source?.customer||'',
        reviewReason:!parsed.unit?'단위 확인 필요':!itemWeek?'차수 확인 필요':''});
    } else if (/\d\s*(?:박스|단|스팀|스템|송이|st\b)|[:：]\s*\d/i.test(line) && !information.test(line) && !/^\*/.test(line)) {
      unparsed.push(line);
    }
  }
  // A standalone item list is a candidate, but conversations about quantities are not orders.
  const relevant=explicit && (items.length>0||altered||unparsed.length>0||/추가(?:에요|입니다)|발주\s*(?:추가|해주세요|부탁|진행)/.test(text)&&!issue) || items.length>0 && !issue || unparsed.length>0&&addIntent.test(text)&&!issue || altered && /취소|대체|넘겨|이월/.test(text);
  if(!relevant)return {kind:'excluded',items:[]};
  let reason=altered?'취소·대체·변경·차수 이동 확인':issue?'문의·조건부 요청 확인':unparsed.length?'해석하지 못한 수량 행 확인':!items.length?'연결할 품목·수량 확인':'';
  // Missing heading/intent on a naked list requires confirmation instead of manufacturing intent.
  if(!explicit && !addIntent.test(text) && !reason)reason='발주 의도 확인';
  // An explicit addition can include a separate item whose unit is missing.
  // Keep that row unchecked without withholding the fully specified items.
  const partialAddition = !reason
    && /발주\s*추가|추가\s*발주/.test(text.split('\n').find(line => line.trim()) || '')
    && items.some(item => item.reviewReason === '단위 확인 필요')
    && items.every(item => !item.reviewReason || item.reviewReason === '단위 확인 필요')
    && items.some(item => !item.reviewReason && validItem(item));
  if (partialAddition) return { kind: 'addition', reason: '', items, unparsed, retained };
  reason=reason||items.find(i=>i.reviewReason)?.reviewReason||'';
  if(reason)items=items.map(item=>({...item,reviewReason:reason}));
  return {kind:reason?'review':'addition',reason,items,unparsed,retained};
}

export function classifyImportFeed(feed, aliases=new Map(), {audit=false}={}) {
  const selected=[], review=[], identities=new Map(), omitted=[]; let duplicates=0, excluded=0;
  // Prefer deleted variants as a review warning; do not count their non-deleted snapshot again.
  const ordered=[...feed.messages].sort((a,b)=>Number(/삭제되었습니다/.test(b.text))-Number(/삭제되었습니다/.test(a.text)));
  for(const message of ordered) {
    const key=JSON.stringify([message.time,message.sender||'',fold(message.text.replace(/메시지가 삭제되었습니다\./g,'')).replace(/\s/g,'')]);
    if(identities.has(key)){duplicates++;if(audit)omitted.push({id:message.id,time:message.time,text:message.text,reason:'동일 작성자·시각·원문 중복',duplicateOf:identities.get(key)});continue;}identities.set(key,message.id);
    const result=analyzeImportMessage(message,aliases);
    if(result.kind==='excluded'){excluded++;if(audit)omitted.push({id:message.id,time:message.time,text:message.text,reason:information.test(message.text)?'문의·가격·품질 등 발주 외 대화':'품목·수량 또는 발주 의도 불명',quantityCandidate:/\d\s*(박스|단|송이|스팀|스템|st\b|box)/i.test(message.text)});continue;}
    const {sender,...publicMessage}=message;
    const parsed={...publicMessage,...result};
    (result.kind==='addition'?selected:review).push(parsed);
  }
  // Preserve the already established newest-first order after the deletion preference pass.
  const changed=review.filter(m=>change.test(m.text)).flatMap(m=>m.items.map(item=>({...item,changeId:m.id})));
  for(let index=selected.length-1;index>=0;index--) {
    const m=selected[index];
    const affected=changed.filter(other=>m.items.some(item=>item.year===other.year && item.week && item.week===other.week && fold(item.product)===fold(other.product) && item.unit===other.unit && (!other.country||!item.country||item.country===other.country) && (!other.group||!item.group||item.group===other.group) && (!other.customer||!item.customer||fold(item.customer)===fold(other.customer))));
    if(affected.length){selected.splice(index,1);const reason='같은 차수·품목의 취소/변경 요청 대조 필요';review.push({...m,kind:'review',reason,relatedChanges:[...new Set(affected.map(r=>r.changeId))].sort(),items:m.items.map(item=>({...item,reviewReason:reason}))});}
  }
  const order=new Map(feed.messages.map((m,i)=>[m.id,i]));
  selected.sort((a,b)=>order.get(a.id)-order.get(b.id));review.sort((a,b)=>order.get(a.id)-order.get(b.id));
  // A new review reason/related cancellation invalidates previous browser inclusion.
  // Identical refreshes keep keys stable so deliberate review edits remain intact.
  const reviewRows=review.map(m=>({...m,items:m.items.map(item=>({...item,key:JSON.stringify([item.key,m.reason,m.relatedChanges||[]])}))}));
  return {...feed,messages:selected,review:reviewRows,...(audit?{audit:omitted.sort((a,b)=>order.get(a.id)-order.get(b.id))}:{}),stats:{scanned:feed.messages.length,selected:selected.length,review:review.length,excluded,duplicates}};
}

// Calendar days without orders must not hide the last actual order work.
// Classify before selecting dates so subsequent cancellation/revision evidence is retained.
export function readLatestOrderImports(values, now=new Date(), options={}) {
  const through=todaySeoul(now), aliases=importCustomerAliases(values);
  const messages=readImportDay(values,through,'0000-01-01');
  return latestImportFeed(messages, through, aliases, options);
}

export function latestImportFeed(messages, through, aliases, options={}) {
  const all=classifyImportFeed({messages},aliases);
  const orders=[...all.messages,...all.review.filter(m=>m.relatedChanges?.length)];
  const orderDays=[...new Set(orders.filter(m=>m.items.some(validItem)).map(m=>messageDay(m.time)))].sort().reverse().slice(0,2);
  const from=orderDays.at(-1)||through;
  const scoped=classifyImportFeed({messages:messages.filter(m=>messageDay(m.time)>=from)},aliases,options);
  return {...scoped,orderDays,from:orderDays.at(-1)||'',to:orderDays[0]||'',reviewThrough:through,latest:messages[0]?.time||''};
}
