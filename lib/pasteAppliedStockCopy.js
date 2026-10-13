import {textWithoutExcludedLines} from './pasteExcludeText.js';
import {parseBaseStockQuantityLine,resolveStockProjectionIdentity,formatStockVector,isBaseStockHeaderLine} from './pasteStockProjection.js';
import {confirmedBaseStockMatch,normalizeBaseStockFlowerContext,baseStockMatchName} from './pasteBaseStockMapping.js';

const english=new Intl.Collator('en',{numeric:false,sensitivity:'base'});
const normalize=value=>String(value||'').normalize('NFKC').toLowerCase().replace(/[^0-9a-z가-힣]/g,'');
const unit=value=>/^(box|boxes|박스)$/i.test(value||'')?'박스':/^(bunch|bunches|단)$/i.test(value||'')?'단':/^(steam|stem|stems|스팀|스템|송이)$/i.test(value||'')?'송이':String(value||'').trim();
const clean=value=>Math.round(value*1e9)/1e9;
const numberText=value=>String(clean(value));

export function buildAppliedStockScope({week='',baseText='',pasteText='',baseWeek='',excludedLines=[],matches=[]}={}) {
  return {week:String(week),baseText:String(baseText),pasteText:String(pasteText),baseWeek:String(baseWeek),excludedKey:JSON.stringify(excludedLines),matchesKey:JSON.stringify(matches.map(row=>[row.idx??null,row.name||'',row.matchName||'',Number(row.prodKey)||null]))};
}

export function appendAppliedStockResult(previous,next,{executionId=globalThis.crypto.randomUUID()}={}) {
  const committed=result=>result?.verified===true&&Number(result.failCount)===0&&!result.undone&&!result.rolledBack&&!result.preflightBlocked;
  if(!next?.stockCopyScope)return next;
  const supported=rows=>(rows||[]).filter(row=>row?.ok===true&&row.verified===true&&['ADD','CANCEL'].includes(row.type));
  const sameScope=previous&&!previous.undone&&JSON.stringify(previous.stockCopyScope)===JSON.stringify(next.stockCopyScope);
  // A later failed transaction cannot erase earlier committed operations.
  // Failure rows themselves are never appended; the current copy stays blocked.
  const prior=sameScope?(Array.isArray(previous.stockCopyDetails)?supported(previous.stockCopyDetails):committed(previous)?supported(previous.details).map((row,index)=>({...row,entryId:`previous:${row.entryId||index}`})):[]):[];
  const fresh=committed(next)?supported(next.details).map((row,index)=>({...row,entryId:`${executionId}:${row.entryId||index}`})):[];
  const unsupported=(sameScope&&previous.stockCopyUnsupported===true)||
    (committed(next)&&(next.details||[]).some(row=>row?.ok===true&&row.verified===true&&!['ADD','CANCEL'].includes(row.type)));
  return {...next,stockCopyDetails:[...prior,...fresh],stockCopyUnsupported:unsupported};
}

// The replacement touches quantity tokens only; source names and punctuation
// remain the user's input. Mixed vectors never silently convert detail units.
function quantityReplacement(raw,parsed,main,detail) {
  const start=raw.indexOf(parsed.name)+parsed.name.length;
  if(start<parsed.name.length)return null;
  const prefix=raw.slice(0,start),tail=raw.slice(start);
  let count=0;
  const updated=tail.replace(/-?[0-9０-９]+(?:\.[0-9０-９]+)?/g,(value,index)=>{
    // Parenthesized notes are not quantity fields.
    if(tail.slice(0,index).includes('('))return value;
    const next=count++===0?main:detail;
    return next==null||Number(value.replace(/[０-９]/g,char=>String(char.charCodeAt(0)-0xff10)))===next?value:numberText(next);
  });
  return count>0?prefix+updated:null;
}

export function buildAppliedStockCopy({baseText='',pasteText='',week='',resolvedMatches,products=[],result,currentScope,baseExcludedLineNos=[],baseStockMatches}={}) {
  const warnings=[];
  const blocked=message=>({ready:false,text:'',warnings:[message],appliedCount:0,changeRows:[]});
  if(!result||result.verified!==true||Number(result.failCount)!==0||result.rolledBack||result.undone||result.preflightBlocked)return blocked('등록·분배 저장이 완료된 뒤 적용재고를 복사할 수 있습니다.');
  if(result.stockCopyUnsupported)return blocked('분배만 처리한 결과는 실제 증감 근거를 확인한 뒤 적용재고를 복사할 수 있습니다.');
  const scope=result.stockCopyScope;
  if(!scope||scope.week!==week||scope.baseText!==baseText||scope.pasteText!==pasteText||!currentScope||JSON.stringify(scope)!==JSON.stringify(currentScope))return blocked('현재 기초재고·원문·차수와 일치하는 저장 결과를 확인해 주세요.');
  if(Array.isArray(baseStockMatches)&&(
    buildAppliedStockScope({matches:baseStockMatches}).matchesKey!==currentScope.matchesKey
    || JSON.stringify(baseExcludedLineNos)!==currentScope.excludedKey
  ))return blocked('현재 기초재고 행 매칭·제외 설정과 일치하는 자료를 확인해 주세요.');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(week))return blocked('적용재고의 연도·차수를 확인해 주세요.');
  const original=textWithoutExcludedLines(baseText,baseExcludedLineNos.filter(value=>typeof value==='object'))
    .split(/\r?\n/).map((line,index)=>baseExcludedLineNos.includes(index)?'':line),chunks=[];
  let flowerContext='';
  for(let index=0;index<original.length;index++) {
    const trimmed=original[index].trim();
    const header=isBaseStockHeaderLine(trimmed)||/^[\s\-_=ㅡ─]{4,}$/.test(trimmed);
    if(header){if(/잔량|재고/.test(trimmed))flowerContext='';}
    const flowerOnly=normalizeBaseStockFlowerContext(trimmed);
    if(flowerOnly&&!/[0-9０-９]/.test(trimmed)){flowerContext=flowerOnly;chunks.push({lines:[original[index]]});continue;}
    const headerFlower=normalizeBaseStockFlowerContext((trimmed.match(/(수국|장미|카네이션|카네|알스트로(?:메리아)?|루스커스|호주|레몬잎|호접|덴파레|리시안셔스|리시안|튤립)/)||[])[1]);
    if(headerFlower&&/변경사항|차\s*$/.test(trimmed)){flowerContext=headerFlower;chunks.push({lines:[original[index]]});continue;}
    const sourceIdx=index;
    let parsed=header?null:parseBaseStockQuantityLine(original[index]);
    let lines=[original[index]],quantityLine=0;
    // Existing stock inputs also use a name and quantity on separate lines.
    if(!Array.isArray(baseStockMatches)&&!header&&!parsed&&original[index].trim()&&/^\s*-?[0-9０-９]+(?:\.[0-9０-９]+)?(?:\s*(?:박스|단|송이|개))?(?:\s*\+\s*[0-9０-９]+(?:\.[0-9０-９]+)?\s*(?:스팀|송이|단|개|stem|stems|bunch|ea))?(?:\s*\([^()]*\))?\s*$/.test(original[index+1]||'')) {
      parsed=parseBaseStockQuantityLine(`${original[index].trim()} ${original[index+1].trim()}`);
      if(parsed){lines.push(original[++index]);quantityLine=1;}
    }
    if(!parsed){if(Array.isArray(baseStockMatches)&&trimmed&&!header)warnings.push(`${sourceIdx+1}줄: 기초재고 품목명과 수량을 확인해 주세요.`);chunks.push({lines});continue;}
    const rowForMatch={...parsed,idx:sourceIdx,flowerContext,matchName:baseStockMatchName(parsed.name,flowerContext)};
    const explicit=Array.isArray(baseStockMatches)
      ? confirmedBaseStockMatch(rowForMatch,baseStockMatches,products) : null;
    const identity=Array.isArray(baseStockMatches)
      ? {prodKey:explicit?.prodKey||null} : resolveStockProjectionIdentity(parsed.name,resolvedMatches,normalize);
    const product=products.find(row=>Number(row.ProdKey)===identity.prodKey);
    if(!identity.prodKey||!product){warnings.push(`${sourceIdx+1}줄 ${parsed.name}: 저장된 품목 매칭을 확인해 주세요.`);}
    chunks.push({lines,parsed,quantityLine,lineNo:sourceIdx+1,prodKey:identity.prodKey,product,main:parsed.qty,detail:parsed.detailQty??null,addedMain:0,addedDetail:0,cancelledMain:0,cancelledDetail:0});
  }
  const baseRows=chunks.filter(row=>row.parsed),byKey=new Map();
  for(const row of baseRows){if(byKey.has(row.prodKey)&&row.prodKey){const first=byKey.get(row.prodKey);warnings.push(`${first.lineNo}줄 ${first.parsed.name} / ${row.lineNo}줄 ${row.parsed.name}: 기초재고에 같은 전산 품목이 중복되어 있습니다.`);}else byKey.set(row.prodKey,row);}
  const seen=new Set();let appliedCount=0,verifiedCount=0;
  for(const detail of result.stockCopyDetails||result.details||[]) {
    if(detail?.ok!==true||detail.verified!==true||!['ADD','CANCEL'].includes(detail.type))continue;
    verifiedCount++;
    if(String(detail.orderYear)!==week.slice(0,4)||String(detail.orderWeek)!==week.slice(5)){warnings.push('저장 결과의 연도·차수가 현재 작업과 다릅니다.');continue;}
    const row=byKey.get(Number(detail.prodKey));
    if(!row){warnings.push(`${detail.inputName||detail.prodName||detail.prodKey}: 기초재고에 없는 처리 품목입니다.`);continue;}
    const entry=detail.entryId||`${detail.custKey}:${detail.prodKey}:${detail.type}:${detail.inputIndex??''}`;
    if(seen.has(entry)){warnings.push(`${row.parsed.name}: 처리 결과가 중복되어 있습니다.`);continue;}seen.add(entry);
    const before=Number(detail.outQtyBefore),after=Number(detail.outQtyAfter);
    if(detail.outQtyBefore==null||detail.outQtyAfter==null||!Number.isFinite(before)||!Number.isFinite(after)){warnings.push(`${row.parsed.name}: 실제 분배 전후 수량을 확인할 수 없습니다.`);continue;}
    const changed=clean(after-before);
    if(changed===0)continue;
    if((detail.type==='ADD'&&changed<0)||(detail.type==='CANCEL'&&changed>0)){warnings.push(`${row.parsed.name}: 실제 분배 변경 방향을 확인해 주세요.`);continue;}
    const quantity=Number(detail.delta??detail.qty);
    if(!Number.isFinite(quantity)||quantity<=0){warnings.push(`${row.parsed.name}: 저장된 입력 수량을 확인해 주세요.`);continue;}
    const change=detail.type==='ADD'?-quantity:quantity;
    const changeUnit=unit(detail.unit||row.parsed.unit||'박스'),mainUnit=unit(row.parsed.unit||'박스');
    const counter=detail.type==='ADD'?'added':'cancelled';
    if(changeUnit===mainUnit){row.main=clean(row.main+change);row[`${counter}Main`]=clean(row[`${counter}Main`]+quantity);}
    else if(row.parsed.detailUnit&&changeUnit===unit(row.parsed.detailUnit)){row.detail=clean(Number(row.detail)+change);row[`${counter}Detail`]=clean(row[`${counter}Detail`]+quantity);}
    else {warnings.push(`${row.parsed.name}: ${detail.unit||'미확인'} 단위를 기초재고 단위로 바꿀 근거가 없습니다.`);continue;}
    appliedCount++;
  }
  if(!verifiedCount)warnings.push('현재 원문에 대해 저장·검증된 추가·취소 분배 결과가 없습니다.');
  if(!baseRows.length)warnings.push('복사할 기초재고 원문이 없습니다.');
  for(const row of baseRows){if(row.main<0||(row.detail!=null&&row.detail<0))warnings.push(`${row.parsed.name}: 적용재고가 음수입니다. 기초재고와 처리 수량을 확인해 주세요.`);}
  if(warnings.length)return {ready:false,text:'',warnings:[...new Set(warnings)],appliedCount,changeRows:[]};
  // Display and clipboard share the same verified calculation. Keep zero rows in
  // the change table so the user can see why they disappear from the copy text.
  const changeRows=[...baseRows].sort((a,b)=>english.compare(a.product.ProdName||'',b.product.ProdName||'')).map(row=>{
    const mainUnit=row.parsed.unit||'박스',detailUnit=row.parsed.detailUnit||'';
    const vector=(main,detail)=>({main,detail,unit:mainUnit,detailUnit});
    const start=vector(row.parsed.qty,row.parsed.detailQty??null);
    const added=vector(row.addedMain,detailUnit?row.addedDetail:null);
    const cancelled=vector(row.cancelledMain,detailUnit?row.cancelledDetail:null);
    const applied=vector(row.main,row.detail);
    const label=value=>formatStockVector(value.main,value.detail,value.unit,value.detailUnit);
    return {prodKey:row.prodKey,name:row.parsed.name,start,added,cancelled,applied,startText:label(start),addedText:label(added),cancelledText:label(cancelled),appliedText:label(applied),changed:row.addedMain>0||row.addedDetail>0||row.cancelledMain>0||row.cancelledDetail>0};
  });
  // A product's source block (including a separate quantity line) moves intact.
  // Headers and separators keep their source positions and section boundaries.
  const rendered=[];let block=[];
  const flush=()=>{block.sort((a,b)=>english.compare(a.product.ProdName||'',b.product.ProdName||''));for(const row of block){if(row.main===0&&(row.detail==null||row.detail===0))continue;const lines=[...row.lines];if(row.quantityLine===1){const combined=`${row.parsed.name} ${lines[1]}`;const updated=quantityReplacement(combined,row.parsed,row.main,row.detail);lines[1]=updated.slice(row.parsed.name.length+1);}else lines[0]=quantityReplacement(lines[0],row.parsed,row.main,row.detail);rendered.push(...lines);}block=[];};
  for(const chunk of chunks){if(chunk.parsed)block.push(chunk);else if(block.length&&chunk.lines.every(line=>!line.trim()))block[block.length-1].lines.push(...chunk.lines);else{flush();rendered.push(...chunk.lines);}}flush();
  return {ready:true,text:rendered.join('\n'),warnings:[],appliedCount,changeRows};
}
