import {chinaInvoiceDescription,chinaStemLength} from './importChinaInvoice.js';
import {normalizePackingMetadata} from './importPackingMetadata.js';

// A JSON-round-trippable, one-use proof of this module's successful validation.
// The token alone is not trusted: the module-private registry also binds every
// parser field after the normal metadata normalization done by the client.
const LOCAL_PROOF_KIND='HUBFRESH_POSITIONED_V1';
const localProofs=new Map();
function proofSnapshot(invoice){
  const {local_parser_proof,pdfSourceHash,pdfReviewRequired,...source}=invoice;
  const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
    ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
  return JSON.stringify(canonical(source));
}
function stampLocalProof(invoice){
  const token=globalThis.crypto?.randomUUID?.();
  if(!token)return;
  invoice.local_parser_proof={kind:LOCAL_PROOF_KIND,token};
  localProofs.set(token,proofSnapshot(normalizePackingMetadata(invoice,'CN')));
  if(localProofs.size>64)localProofs.delete(localProofs.keys().next().value);
}
export function consumeChinaPdfLocalVerification(invoice){
  const proof=invoice?.local_parser_proof;
  if(proof?.kind!==LOCAL_PROOF_KIND||typeof proof.token!=='string')return false;
  const expected=localProofs.get(proof.token);
  if(!expected)return false;
  localProofs.delete(proof.token);
  return expected===proofSnapshot(invoice);
}

// Deliberately narrow: this is a positioned-text reader for the printed
// Hubfresh table, not OCR, a generic Chinese invoice parser, or an AI route.
const PRODUCT_COLUMNS=Object.freeze({
  category:[45,82],chineseName:[82,130],englishName:[130,245],length:[245,275],
  stemsPerBunch:[275,315],bunchesPerBox:[315,355],cartonSpec:[355,395],
  cartonNumbers:[395,440],boxes:[440,480],bunches:[480,520],unitPrice:[520,550],
  stems:[550,580],grossWeight:[580,620],goodsAmount:[620,680],
});
const HEADERS=[
  ['Category',57,418],['Chinese Name',90,418],['English item name',133,418],
  ['Stem',252,422],['Length',250,414],['Order',439,418],
  ['Total of Flower',472,422],['Material',481,414],['单价UNIT',522,426],
  ['Stems',554,418],['A.G.W.T.',583,418],['金额合计AM',617,417],
];
const CATEGORIES=new Set(['配花','康乃馨','大丽花','飞燕草','尤加利叶','乒乓菊','单头玫瑰','松虫草','多头康乃馨','多头玫瑰']);
const reason=(message)=>{throw Error(message);};
const clean=value=>String(value??'').replace(/\s+/g,' ').trim();
const between=(value,[min,max])=>value>=min&&value<max;
const near=(a,b,tolerance)=>Math.abs(a-b)<=tolerance;
const money=n=>Math.round(n*100);
const sum=(rows,key)=>rows.reduce((total,row)=>total+row[key],0);

function numeric(raw,label,{integer=false,allowDash=false}={}){
  const value=clean(raw);
  if(allowDash&&value==='-')return null;
  if(!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(value))reason(`malformed ${label}`);
  if(integer&&!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(value))reason(`malformed ${label}`);
  const parsed=Number(value.replaceAll(',',''));
  if(!Number.isFinite(parsed)||parsed>1e10||(integer&&!Number.isSafeInteger(parsed)))reason(`malformed ${label}`);
  return parsed;
}
function ordered(items){return [...items].sort((a,b)=>b.y-a.y||a.x-b.x);}
function column(items,name){return ordered(items.filter(item=>between(item.x,PRODUCT_COLUMNS[name])));}
function joined(items){return ordered(items).map(item=>clean(item.str)).filter(Boolean).join(' ');}
function single(items,name){
  if(items.length!==1)reason(`missing or duplicate ${name}`);
  return clean(items[0].str);
}
function evidence(item,page,value=item?.str){
  return {value,quote:clean(item?.str),page,bbox:null};
}
function packingSpecification(raw,bunches,stems){
  const compact=clean(raw).replace(/\s+/g,'').toLowerCase();
  const english=compact.match(/^(\d{1,2})(?:-(\d{1,2}))?stem\/bunch(?:(\d{2,4})(?:g|克)(?:\/扎|\/)?)?$/);
  const chinese=compact.match(/^(\d{1,2})枝(\d{2,4})克\/扎$/);
  if(!english&&!chinese)reason('unknown stems-per-bunch specification');
  const min=Number((english||chinese)[1]),max=english&&english[2]?Number(english[2]):min;
  const printed=stems/bunches;
  if(min<=0||max<min||max>99||!Number.isSafeInteger(printed)||printed<min||printed>max)reason('stems-per-bunch specification mismatch');
  return {min,max,printed};
}
function cartonDimensions(raw){
  const compact=clean(raw).replace(/\s+/g,'');
  const match=compact.match(/^(\d{2,3})\*(\d{2,3})\*(\d{1,3}(?:\.\d{1,2})?)$/);
  if(!match||match.slice(1).some(value=>Number(value)<=0))reason('unknown carton dimensions');
  return compact;
}
function cartonNumbers(raw,boxes){
  const compact=clean(raw).replace(/\s+/g,'').replace(/,$/,'');
  if(!/^\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/.test(compact))reason('malformed carton number range');
  const ranges=compact.split(',').map(part=>{
    const [first,last=first]=part.split('-').map(Number);
    if(first<1||last<first||last-first>10000)reason('malformed carton number range');
    return {first,last};
  });
  for(let i=1;i<ranges.length;i++)if(ranges[i].first<=ranges[i-1].last)reason('overlapping carton ranges');
  const numbered=ranges.reduce((count,range)=>count+range.last-range.first+1,0);
  if(numbered>boxes||ranges.length===1&&numbered!==boxes)reason('carton range does not match boxes');
  return {ranges,numbered,unlisted:boxes-numbered};
}
const normalizeChargeLabel=value=>clean(value).toLowerCase().replace(/[\s\p{P}\p{S}]/gu,'');
const CHARGE_LABELS=[
  'BOXING AND PACKING/纸箱打包',
  'Documents / 单证文件/Phytosanitary Certificate, Customs ，CO Declaration / 植物检疫证书，产地证，报关单',
  'SEA FREIGHT CHARGE/海运+冷链运输/Logistics Fee / 物流费',
  '代加工 PROCESS COST',
  '检疫箱 Quarantine box',
  'Temperature Data Logger /温度记录仪',
  'Loading and Unloading Fee / 装卸费',
  '花材金额',
].map(normalizeChargeLabel);
function headerAndMetadata(first){
  for(const [label,x,y] of HEADERS){
    const hits=first.filter(item=>clean(item.str)===label);
    if(hits.length!==1||!near(hits[0].x,x,5)||!near(hits[0].y,y,7))reason('unsupported Hubfresh column geometry');
  }
  const supplier=first.filter(item=>/\bKUN\s*MING\s+HUBFRESH\s+SUPPLY\s+CHAIN\s+MANAGEMENT\s+CO[.,\s]*LTD\b/i.test(clean(item.str)));
  if(supplier.length!==1||supplier[0].y<485)reason('unknown supplier');
  const invoice=first.filter(item=>/INVOICE\s*NO\./i.test(item.str));
  const date=first.filter(item=>/日期\s*DATE\s*:/i.test(item.str));
  const currency=first.filter(item=>clean(item.str)==='(CNY)'&&between(item.x,[615,650])&&near(item.y,401,7));
  if(invoice.length!==1||date.length!==1||currency.length!==1||!between(invoice[0].x,[545,565])||!between(date[0].x,[545,565]))reason('missing or ambiguous invoice metadata');
  const number=clean(invoice[0].str).match(/INVOICE\s*NO\.\s*([^\s]+)/i)?.[1];
  const rawDate=clean(date[0].str).match(/日期\s*DATE\s*:\s*(\d{1,2}[/.-]\d{1,2}[/.-]\d{4})/i)?.[1];
  if(!number||!rawDate||!near(invoice[0].y,467,12)||!near(date[0].y,478,12))reason('missing or ambiguous invoice metadata');
  const parts=rawDate.split(/[/.-]/).map(Number);
  const plausible=(day,month)=>{const d=new Date(Date.UTC(parts[2],month-1,day));return d.getUTCFullYear()===parts[2]&&d.getUTCMonth()===month-1&&d.getUTCDate()===day;};
  if(!plausible(parts[0],parts[1])&&!plausible(parts[1],parts[0]))reason('invalid printed date');
  return {supplier:clean(supplier[0].str),invoice:number,raw_date:rawDate,date_source_raw:rawDate,date:null,date_order:null,date_kind:'invoice',
    metadata_evidence:{date:{quote:clean(date[0].str),page:1,bbox:null},invoice:{quote:clean(invoice[0].str),page:1,bbox:null},
      currency:{quote:clean(currency[0].str),page:1,bbox:null}}};
}
function subtotalLocation(pages){
  const candidates=[];
  for(let p=0;p<pages.length;p++){
    const items=pages[p];
    for(const box of items.filter(item=>between(item.x,[438,452])&&/^\d[\d,]*$/.test(clean(item.str)))){
      const row=items.filter(item=>near(item.y,box.y,2));
      if(row.some(item=>between(item.x,[45,82])&&CATEGORIES.has(clean(item.str))))continue;
      const parts=[[[438,475],'boxes'],[[480,515],'bunches'],[[550,580],'stems'],[[580,620],'grossWeight'],[[620,680],'goodsAmount']];
      if(parts.every(([range])=>row.filter(item=>between(item.x,range)).length===1))candidates.push({page:p,y:box.y,items:row});
    }
  }
  if(candidates.length!==1)reason('missing or ambiguous product subtotal');
  const found=candidates[0];
  const value=range=>numeric(single(found.items.filter(item=>between(item.x,range)),'subtotal'),'subtotal');
  return {...found,boxes:value([438,475]),bunches:value([480,515]),stems:value([550,580]),grossWeight:value([580,620]),goodsAmount:value([620,680])};
}
function productFamily(category){
  if(category==='多头玫瑰')return 'SPRAY_ROSE';
  if(category==='单头玫瑰')return 'ROSE';
  if(category==='多头康乃馨')return 'SPRAY_CARN';
  if(category==='康乃馨')return 'CARNATION';
  return null;
}
function parseProducts(pages,subtotal){
  const products=[];
  const usedCartons=new Set();
  let previousCarton=0;
  for(let p=0;p<=subtotal.page;p++){
    const items=pages[p];
    const low=p===subtotal.page?subtotal.y+12:65;
    const high=p===0?398:565;
    const categoryItems=items.filter(item=>between(item.x,PRODUCT_COLUMNS.category)&&item.y>low&&item.y<high);
    if(categoryItems.some(item=>!CATEGORIES.has(clean(item.str))))reason('unknown product category or table layout');
    const anchors=categoryItems.sort((a,b)=>b.y-a.y);
    if(!anchors.length)reason('missing product table page');
    const covered=new Set();
    for(let i=0;i<anchors.length;i++){
      const anchor=anchors[i],page=p+1;
      if(i&&anchors[i-1].y-anchor.y<18)reason('overlapping product rows');
      const band=items.filter(item=>Math.abs(item.y-anchor.y)<=12);
      for(const entry of band)if(between(entry.x,[82,680]))covered.add(entry);
      const at=name=>column(band,name);
      const read=(name,options)=>numeric(single(at(name),name),name,options);
      const category=clean(anchor.str),name=joined(at('englishName'));
      const chineseName=joined(at('chineseName'));
      const lengthItems=at('length'),lengthRaw=ordered(lengthItems).map(item=>clean(item.str)).join(' ').replace(/-\s+/g,'-');
      const cartonRaw=joined(at('cartonNumbers'));
      if(!name||!chineseName||!lengthRaw||!joined(at('stemsPerBunch'))||!joined(at('bunchesPerBox'))||!joined(at('cartonSpec')))reason('incomplete product row');
      const boxes=read('boxes',{integer:true}),bunches=read('bunches',{integer:true}),stems=read('stems',{integer:true});
      const grossWeight=read('grossWeight'),priceRaw=single(at('unitPrice'),'unit price'),amountRaw=single(at('goodsAmount'),'goods amount');
      const unitPrice=numeric(priceRaw,'unit price',{allowDash:true}),amount=numeric(amountRaw,'goods amount',{allowDash:true});
      if(boxes<=0||bunches<=0||stems<=0||grossWeight<=0||(unitPrice===null)!==(amount===null))reason('incomplete product quantities or price');
      const bpbRaw=joined(at('bunchesPerBox')).replace(/\s+/g,'');
      const bpbMatch=bpbRaw.match(/^(\d{1,3})(?:百盛美)?$/);
      if(!bpbMatch||Number(bpbMatch[1])<=0||boxes*Number(bpbMatch[1])!==bunches)reason('bunches-per-box mismatch');
      packingSpecification(joined(at('stemsPerBunch')),bunches,stems);
      cartonDimensions(joined(at('cartonSpec')));
      const carton=cartonNumbers(cartonRaw,boxes);
      if(carton.ranges[0].first<=previousCarton)reason('reordered carton numbers');
      previousCarton=carton.ranges[0].first;
      for(const range of carton.ranges)for(let number=range.first;number<=range.last;number++){
        if(usedCartons.has(number))reason('duplicate carton number');
        usedCartons.add(number);
      }
      if(unitPrice!==null&&money(bunches*unitPrice)!==money(amount))reason('product line amount mismatch');
      const family=productFamily(category),description=chinaInvoiceDescription(name,family,lengthRaw);
      const sourceCells={};
      sourceCells.description={value:description,quote:name,page,bbox:null};
      for(const [field,columnName,value] of [['pcs','boxes',boxes],['total_bunch','bunches',bunches],['total_stems','stems',stems],['u_price','unitPrice',unitPrice],['t_price','goodsAmount',amount],['gross_weight','grossWeight',grossWeight]]){
        sourceCells[field]=evidence(at(columnName)[0],page,value);
      }
      sourceCells.carton_no={value:cartonRaw,quote:cartonRaw,page,bbox:null};
      if(carton.unlisted>0)sourceCells.pcs.quote=`${clean(at('boxes')[0].str)} boxes; Ctn No ${cartonRaw}: ${carton.numbered} numbered, ${carton.unlisted} not listed`;
      products.push({description,source_description:name,source_format:'china_invoice_pdf',source_page:page,
        source_row:products.length+1,source_quote:name,source_cells:sourceCells,category,chinese_name:chineseName,
        family,stem_length:lengthRaw,length:chinaStemLength(lengthRaw),specification:joined(at('stemsPerBunch')),
        carton_no:cartonRaw,carton_number_audit:{numbered:carton.numbered,unlisted:carton.unlisted,requires_review:carton.unlisted>0},
        pcs:boxes,total_bunch:bunches,total_stems:stems,
        bunch_st:stems/bunches,steam_box:stems/boxes,u_price:unitPrice,t_price:amount,gross_weight:grossWeight});
    }
    const orphan=items.find(entry=>entry.y>low&&entry.y<high&&!covered.has(entry)
      &&(between(entry.x,PRODUCT_COLUMNS.englishName)
        ||(between(entry.x,[440,680])&&/^(?:\d[\d,.]*|-)$/.test(clean(entry.str)))));
    if(orphan)reason('unanchored product text or amount');
  }
  if(!products.length)reason('no product rows');
  if(sum(products,'pcs')!==subtotal.boxes||sum(products,'total_bunch')!==subtotal.bunches||sum(products,'total_stems')!==subtotal.stems||money(sum(products,'gross_weight'))!==money(subtotal.grossWeight)||money(sum(products,'t_price'))!==money(subtotal.goodsAmount))reason('product subtotal mismatch');
  return products;
}
function parseFees(pages,subtotal){
  const rows=[];
  let previousLabelIndex=-1;
  const coveredByPage=pages.map(()=>new Set());
  for(let p=subtotal.page;p<pages.length;p++){
    const items=pages[p];
    const numbered=items.filter(item=>between(item.x,[64,74])&&/^\d{1,2}$/.test(clean(item.str))&&(p===subtotal.page?item.y<subtotal.y:item.y>0));
    for(const anchor of numbered){
      const number=Number(clean(anchor.str));
      if(number!==rows.length+1)reason('missing or reordered charge row');
      const band=items.filter(item=>near(item.y,anchor.y,2));
      for(const entry of band)if(between(entry.x,[190,280]))coveredByPage[p].add(entry);
      const at=range=>band.filter(item=>between(item.x,range));
      const qty=numeric(single(at([190,210]),'charge quantity'),'charge quantity');
      const unit=numeric(single(at([220,245]),'charge unit price'),'charge unit price');
      const amount=numeric(single(at([248,274]),'charge amount'),'charge amount');
      if(qty<=0||money(qty*unit)!==money(amount))reason('charge line amount mismatch');
      const label=joined(items.filter(item=>between(item.x,[90,190])&&Math.abs(item.y-anchor.y)<=12));
      if(!label)reason('missing charge label');
      const labelIndex=CHARGE_LABELS.indexOf(normalizeChargeLabel(label));
      if(labelIndex<0||labelIndex<=previousLabelIndex)reason('unknown or reordered charge label');
      previousLabelIndex=labelIndex;
      rows.push({number,label,qty,unit,amount,page:p+1,quote:clean(at([248,274])[0].str)});
    }
  }
  if(rows.length<2)reason('missing charge table');
  const repeats=rows.filter(row=>/花材金额|flower\s*(?:material\s*)?(?:amount|total)/i.test(row.label));
  if(repeats.length!==1||repeats[0]!==rows.at(-1)||money(repeats[0].amount)!==money(subtotal.goodsAmount))reason('missing or mismatched repeated flower amount');
  const fees=rows.slice(0,-1);
  const costTotal=sum(fees,'amount');
  const totals=[];
  for(let p=subtotal.page;p<pages.length;p++){
    const items=pages[p];
    for(const label of items.filter(item=>/Total additional charges\s*\/\s*附加费用合计/i.test(clean(item.str)))){
      const amount=items.filter(item=>between(item.x,[248,280])&&near(item.y,label.y,2));
      if(amount.length===1){
        coveredByPage[p].add(amount[0]);
        totals.push({page:p+1,item:amount[0],label,value:numeric(amount[0].str,'invoice grand total')});
      }
    }
  }
  if(totals.length!==1||totals[0].page!==pages.length||money(totals[0].value)!==money(subtotal.goodsAmount+costTotal))reason('invoice grand total mismatch');
  for(let p=subtotal.page;p<pages.length;p++){
    if(p>subtotal.page&&!rows.some(row=>row.page===p+1)&&!totals.some(total=>total.page===p+1))reason('unrecognized charge page');
    const orphan=pages[p].find(entry=>(p>subtotal.page||entry.y<subtotal.y)
      &&between(entry.x,[190,280])&&/^(?:\d[\d,.]*|-)$/.test(clean(entry.str))&&!coveredByPage[p].has(entry));
    if(orphan)reason('unanchored charge amount');
  }
  const additional_costs=fees.map(row=>({description:row.label,quantity:row.qty,unit_price:row.unit,amount:row.amount,
    source_page:row.page,source_row:row.number,source_quote:`${row.label} ${row.quote}`,bbox:null}));
  return {additional_costs,costTotal,grandTotal:totals[0]};
}

/** Return an invoice only when every printed table and independent total agrees. */
function compactHubfresh(pages) {
  const first=pages[0],last=pages.at(-1),page=pages.length;
  for(const [label,x,y] of [['Category',55.92,629.74],['English item name',113.78,629.74],['Order',347.95,629.74],['Total of Flower',372.91,632.86],['Stems',435.58,629.74],['UNT (CNY)',485.02,620.38]]) {
    const hits=first.filter(i=>clean(i.str)===label&&near(i.x,x,2)&&near(i.y,y,2));
    if(hits.length!==1)reason('unsupported compact Hubfresh headers');
  }
  const supplier=single(first.filter(i=>/KUN\s*MING\s+HUBFRESH\s+SUPPLY\s+CHAIN\s+MANAGEMENT/i.test(i.str)),'supplier');
  const invoiceText=single(first.filter(i=>/INVOICE NO\./.test(i.str)),'invoice');
  const dateText=single(first.filter(i=>/日期DATE:/.test(i.str)),'date');
  const invoiceNo=invoiceText.match(/INVOICE NO\.\s*(\S+)/)?.[1],rawDate=dateText.match(/(\d{1,2}\/\d{1,2}\/\d{4})/)?.[1];
  if(!invoiceNo||!rawDate)reason('missing compact invoice identity');
  const subtotal=last.filter(i=>clean(i.str)==='合计 Total');
  if(subtotal.length!==1)reason('missing compact subtotal');
  const columns={category:[50,78],chineseName:[78,111],englishName:[111,155],length:[198,222],spec:[222,250],bpb:[250,267],carton:[286,314],cartonNo:[314,340],pcs:[340,370],total_bunch:[370,407],u_price:[407,434],total_stems:[434,455],gross_weight:[455,483],t_price:[483,520]};
  const categories=new Set(['草花','水晶草','满天星','飞燕草','尤加利','喷泉草','乒乓菊','B级单头玫瑰','A级单头玫瑰','多头玫瑰','单头康乃馨','多丁康乃馨']);
  const products=[];
  for(let p=0;p<pages.length;p++) {
    const items=pages[p],low=p===pages.length-1?subtotal[0].y+10:65,high=p===0?615:740;
    const anchors=items.filter(i=>between(i.x,columns.category)&&i.y>low&&i.y<high).sort((a,b)=>b.y-a.y);
    if(!anchors.length||anchors.some(i=>!categories.has(clean(i.str))))reason('unknown compact category');
    const covered=new Set();
    for(let index=0;index<anchors.length;index++) {
      const a=anchors[index];if(index&&anchors[index-1].y-a.y<24)reason('overlapping compact goods');
      const band=items.filter(i=>Math.abs(i.y-a.y)<=11);
      band.forEach(i=>covered.add(i));
      const at=name=>band.filter(i=>between(i.x,columns[name]));
      const name=joined(at('englishName')),length=joined(at('length')).replace(/-\s+/g,'-');
      if(!name||!length||!joined(at('chineseName')))reason('incomplete compact goods');
      const values={};
      for(const field of ['pcs','total_bunch','u_price','total_stems','gross_weight','t_price']) values[field]=numeric(single(at(field),field),field,{integer:['pcs','total_bunch','total_stems'].includes(field)});
      if(values.pcs<=0||values.total_bunch<=0||values.total_stems<=0||values.gross_weight<=0)reason('invalid compact quantity');
      const bpb=numeric(single(at('bpb'),'bunches per box'),'bunches per box',{integer:true});
      if(bpb*values.pcs!==values.total_bunch||money(values.total_bunch*values.u_price)!==money(values.t_price))reason('compact row quantity or amount mismatch');
      const specText=joined(at('spec')).replace(/\s+/g,'');
      let printedBunchSt=values.total_stems/values.total_bunch,quantityWarning=null;
      try { packingSpecification(specText,values.total_bunch,values.total_stems); }
      catch(error) {
        const exact=specText.match(/^(\d{1,2})(?:stem\/bunch|枝)(?:\d{2,4}(?:g|克)(?:\/扎|\/)?)?$/i);
        if (/^[AB]级[AB]-grade$/i.test(specText)) printedBunchSt=null;
        else {
          if(error.message!=='stems-per-bunch specification mismatch'||!exact||Number(exact[1])<=0)reason(`${name}: ${error.message}`);
          printedBunchSt=Number(exact[1]);
          quantityWarning=`송이 수 확인: ${values.total_bunch}단 × ${printedBunchSt}송이 = ${values.total_bunch*printedBunchSt}송이, 원문 총 ${values.total_stems}송이. 원가는 ${values.total_bunch}단 기준이며 송이 수는 직접 수정할 수 있습니다.`;
        }
      }
      cartonDimensions(joined(at('carton')));
      const carton=cartonNumbers(joined(at('cartonNo')),values.pcs);
      const category=clean(a.str),family=/单头玫瑰/.test(category)?'ROSE':category==='多头玫瑰'?'SPRAY_ROSE':category==='单头康乃馨'?'CARNATION':category==='多丁康乃馨'?'SPRAY_CARN':null;
      const description=chinaInvoiceDescription(name,family,length);
      const source_cells=Object.fromEntries(Object.keys(values).map(field=>[field,evidence(at(field)[0],p+1,values[field])]));
      source_cells.description={value:description,quote:name,page:p+1,bbox:null};
      products.push({...values,description,source_description:name,source_format:'china_invoice_pdf',source_page:p+1,source_row:products.length+1,
        source_quote:name,source_cells,category,family,stem_length:length,length:chinaStemLength(length),
        specification:joined(at('spec')),carton_no:joined(at('cartonNo')),carton_number_audit:{numbered:carton.numbered,unlisted:carton.unlisted,requires_review:carton.unlisted>0},
        bunch_st:printedBunchSt,steam_box:values.total_stems/values.pcs,...(quantityWarning?{quantity_warning:quantityWarning}:{})});
    }
    if(items.some(i=>i.y>low&&i.y<high&&!covered.has(i)&&between(i.x,[340,520])&&/^\d[\d,.]*$/.test(clean(i.str))))reason('unanchored compact numeric row');
  }
  const totals={};
  for(const field of ['pcs','total_bunch','total_stems','gross_weight','t_price']) {
    totals[field]=numeric(single(last.filter(i=>near(i.y,subtotal[0].y,1)&&between(i.x,columns[field])),field),field);
    if(money(sum(products,field))!==money(totals[field]))reason('compact subtotal mismatch');
  }
  const charges=last.filter(i=>between(i.x,[63,66])&&i.y<subtotal[0].y&&/^\d+$/.test(clean(i.str))).sort((a,b)=>b.y-a.y);
  if(charges.length!==8)reason('incomplete compact charges');
  const fees=charges.map((a,index)=>{
    if(Number(a.str)!==index+1)reason('reordered compact charge');
    const number=(range)=>numeric(single(last.filter(i=>near(i.y,a.y,1)&&between(i.x,range)),'charge'),'charge');
    const quantity=number([158,175]),unit_price=number([176,200]),amount=number([201,226]);
    const description=joined(last.filter(i=>Math.abs(i.y-a.y)<=6&&between(i.x,[80,156])));
    if(normalizeChargeLabel(description)!==CHARGE_LABELS[index]||money(quantity*unit_price)!==money(amount))reason('compact charge mismatch');
    return {description,quantity,unit_price,amount,source_page:page,source_row:index+1,source_quote:description,bbox:null};
  });
  if(money(fees.at(-1).amount)!==money(totals.t_price))reason('compact repeated goods mismatch');
  const label=last.filter(i=>/Total additional charges/.test(i.str));
  if(label.length!==1)reason('missing compact grand total');
  const total=numeric(single(last.filter(i=>near(i.y,label[0].y,1)&&between(i.x,[201,226])),'grand total'),'grand total');
  if(money(total)!==money(sum(fees,'amount')))reason('compact grand total mismatch');
  const invoice={supplier,invoice:invoiceNo,raw_date:rawDate,date_source_raw:rawDate,date:null,date_order:null,date_kind:'invoice',awb:'',currency:'CNY',source_format:'china_invoice_pdf',products,
    additional_costs:fees.slice(0,-1),freight:sum(fees.slice(0,-1),'amount'),item_subtotal:totals.t_price,invoice_total:total,total_value:total,
    total_boxes:totals.pcs,total_bunches:totals.total_bunch,total_stems:totals.total_stems,gross_weight:totals.gross_weight,vol_weight:null,
    metadata_evidence:{date:{quote:dateText,page:1,bbox:null},invoice:{quote:invoiceText,page:1,bbox:null},currency:{quote:'UNT (CNY)',page:1,bbox:null},invoice_total:{quote:`${label[0].str} ${total}`,page,bbox:null}},
    review_evidence:{gross_weight:{value:totals.gross_weight,quote:`A.G.W.T. ${totals.gross_weight}`,page,bbox:null,unit:'kg'},freight:{value:sum(fees.slice(0,-1),'amount'),quote:fees.slice(0,-1).map(f=>`${f.description} ${f.amount}`).join(' | '),page,bbox:null}}};
  stampLocalProof(invoice);return {result:{invoices:[invoice]},reason:null};
}
export function inspectChinaPdfInvoice(input){
  try{
    if(!input||!Array.isArray(input.pages)||input.pages.length<2||input.pages.length>20)reason('malformed positioned PDF pages');
    const pages=input.pages.map(page=>{
      if(!Array.isArray(page?.items)||page.items.length<1||page.items.length>5000)reason('missing positioned PDF text');
      return page.items.map(item=>{
        if(typeof item?.str!=='string'||item.str.length>500||!Number.isFinite(item.x)||!Number.isFinite(item.y)||!Number.isFinite(item.width)||item.width<0)reason('malformed positioned PDF text');
        return item;
      });
    });
    if(pages.slice(1).some(items=>items.some(item=>/INVOICE\s*NO\.|日期\s*DATE\s*:/i.test(clean(item.str)))))reason('multiple invoice metadata');
    if(pages[0].some(item=>clean(item.str)==='English item name'&&near(item.x,113.78,2)&&near(item.y,629.74,2)))return compactHubfresh(pages);
    const meta=headerAndMetadata(pages[0]);
    const subtotal=subtotalLocation(pages);
    if(subtotal.page===pages.length-1)reason('missing charge continuation page');
    const products=parseProducts(pages,subtotal);
    const fees=parseFees(pages,subtotal);
    const grossItem=subtotal.items.find(item=>between(item.x,[580,620]));
    const invoice={...meta,awb:'',currency:'CNY',source_format:'china_invoice_pdf',products,
      additional_costs:fees.additional_costs,freight:fees.costTotal,item_subtotal:subtotal.goodsAmount,
      invoice_total:fees.grandTotal.value,total_value:fees.grandTotal.value,
      total_boxes:subtotal.boxes,total_bunches:subtotal.bunches,total_stems:subtotal.stems,
      gross_weight:subtotal.grossWeight,vol_weight:null,
      metadata_evidence:{...meta.metadata_evidence,invoice_total:{quote:`${clean(fees.grandTotal.label.str)} ${clean(fees.grandTotal.item.str)}`,page:fees.grandTotal.page,bbox:null}},
      review_evidence:{gross_weight:{...evidence(grossItem,subtotal.page+1,subtotal.grossWeight),quote:`A.G.W.T. ${clean(grossItem.str)}`,unit:'kg'},
        freight:{value:fees.costTotal,quote:fees.additional_costs.map(cost=>cost.source_quote).join(' | '),page:fees.additional_costs[0].source_page,bbox:null},
        invoice_total:{...evidence(fees.grandTotal.item,fees.grandTotal.page,fees.grandTotal.value),quote:`${clean(fees.grandTotal.label.str)} ${clean(fees.grandTotal.item.str)}`}}};
    stampLocalProof(invoice);
    return {result:{invoices:[invoice]},reason:null};
  }catch(error){return {result:null,reason:String(error?.message||'UNSUPPORTED_LAYOUT')};}
}
