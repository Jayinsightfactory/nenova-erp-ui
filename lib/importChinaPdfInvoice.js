import {chinaInvoiceDescription,chinaStemLength} from './importChinaInvoice.js';

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
    return {result:{invoices:[invoice]},reason:null};
  }catch(error){return {result:null,reason:String(error?.message||'UNSUPPORTED_LAYOUT')};}
}
