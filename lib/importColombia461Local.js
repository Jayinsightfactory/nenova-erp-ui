import {readTibaOcrTable} from './importTibaOcr.js';
// Exact-source recovery profile for a source independently checked offline.
// Unknown documents fail closed; no external AI, SQL, or cache mutation.
export function inspectColombia461Local(source){
const expectedHash='88c28b75c418261a9411d00d00d7d210f11af837543f59ba1f61cb015f454a65';
if(source.sourceHash!==expectedHash)return {result:null,reason:'검증되지 않은 콜롬비아 서식입니다. 원문 확인이 필요합니다.'};
const num=s=>Number(String(s).replace(/[$\s]/g,'').replace(/,/g,''));
const eu=s=>Number(String(s).replace(/[$\s.]/g,'').replace(',','.'));
const rows=n=>{
 const groups=[];
 for(const item of source.pages[n-1].items){if(!item.str?.trim())continue;let row=groups.find(x=>Math.abs(x.y-item.y)<2);if(!row){row={y:item.y,items:[]};groups.push(row);}row.items.push(item);}
 return groups.sort((a,b)=>b.y-a.y).map(r=>r.items.sort((a,b)=>a.x-b.x).map(x=>x.str).join(' ').replace(/\\s+/g,' ').trim());
};
const defs=[
 [2,'COLIBRI','FA-125527',8064,38400,128,'colibri'],
 [4,'FILLCO','53905',315,1500,5,'fillco'],
 [6,'DON EUSEBIO','133495',4659,21000,70,'eusebio'],
 [8,'TURFLOR','142313',600,3000,10,'daflor'],
 [9,'TEUCALI','TFE-30927',3751.5,18300,61,'teucali'],
 [10,'VERDNATURA','FEV2114',3279,15600,52,'verd'],
 [11,'Flores El Zorro','5351',2244,10200,34,'zorro'],
 [13,'Superior Blooms','282963',990,4500,15,'superior'],
 [15,'ECOFLOR','EC-5991',1140,5700,19,'eco'],
 [16,'AYURA','17806',30,300,1,'ayura'],
 [17,'AYURA','17805',9814.5,45300,151,'ayura',18],
 [20,'INVERPALMAS','256342',1260,6000,20,'inver'],
 [21,'FAGUA','FVEF1682',1512,7200,24,'fagua'],
 [22,'INVOS','FC02164',1515.11,6500,25,'invos'],
 [23,'NATUFLORA','VE324080',3172,8600,86,'nat',24],
 [25,'ESPERANCE','FEER4346',621,1500,15,'esperance'],
 [26,'EL MILAGRO','001075526',122,300,3,'milagro'],
 [27,'FLORES TIBA','44053',342,800,8,'visual'],
 [28,'DAFLOR','1606',631.8,1960,16,'daflor'],
 [29,'KIKUYAL','CJAR4430',483,1100,11,'kikuyal'],
 [31,'EL REDIL','19622',402,1100,11,'daflor'],
 [32,'SUNSHINE','202875',410,1200,12,'sunshine'],
 [33,'CIRCASIA','INV-018631',320,900,9,'circasia'],
 [34,'THE GREEN GENIE','18924',5723.75,52375,83,'ruscus'],
 [35,'MONIKA','47329',1489.6,7840,49,'zorro'],
 [36,'FUNZA','FE203978',1368.6,7520,47,'funza'],
 [38,'LA GAITANA','358846',192,900,3,'gaitana'],
 [39,'UNIQUE','3440',64,200,2,'ayura'],
 [40,'MATINA','80043160',2094,4700,47,'matina'],
 [42,'MULTIFLORA','A2659626',7080,33000,110,'multiflora'],
 [43,'FLORA CONCEPT','2191857',515,1000,10,'flora']
];
const invoices=[];
for(const [page,supplier,invoice,total,expectedStems,expectedPieces,kind,last=page] of defs){
 const products=[];let pending=null,currentQuote='';
 const add=(description,stems,price,amount,pieces=null,bunches=null,sourcePage=page,raw_quote=currentQuote)=>products.push({description,raw_quote,stems:Number(stems),unitPricePerStem:Number(price),amount:Number(amount),pieces:pieces==null?null:Number(pieces),bunches:bunches==null?null:Number(bunches),sourcePage});
 for(let pn=page;pn<=last;pn++){
  const rr=rows(pn);
  for(let i=0;i<rr.length;i++){
   let s=rr[i],m;currentQuote=s;
   if(kind==='colibri'&&(m=s.match(/^(\d+)\s+H\s+(.+?)\s+300\s+(\d+)\s+ST\s+([\d.]+)\s+([\d,.]+)$/)))add(m[2].replace(/\s+\d{6}.*$/,''),m[3],num(m[4]),num(m[5]),m[1]);
   if(kind==='fillco'&&(m=s.match(/^(\d+)\s+HB\s+300\s+(\d+)\s+(.+?)\s+SO\s+.*?\s+Stems\s+(\d+)\s+US\$\s+([\d.]+)\s+US\$\s+[\d.]+\s+US\$\s*(.*)$/))){const next=rr[i+1]||'';const tail=m[6].trim()||next.match(/([\d.]+)\s*$/)?.[1];if(tail)add(m[3]+' '+next.replace(/[\d.]+\s*$/,'').trim(),m[4],num(m[5]),num(tail),m[1],m[2]);}
   if(kind==='eusebio'&&(m=s.match(/^(\d+)H\s+(\d+)\s+SE\s+(.+?)\s+300\s+CO-[\d.]+\s+([\d.]+)\s+([\d,.]+)$/)))add(m[3],m[2],num(m[4]),num(m[5]),m[1]);
   if(kind==='teucali'&&(m=s.match(/^CO-\d+\s+(.+?)\s+HB\s+[\d.]+\s+(\d+)\s+\d+\s+([\d,]+)\s+STEMS\s+DUTY FREE\s+([\d.]+)\s+([\d.]+)/)))add(m[1],num(m[3]),num(m[4]),num(m[5]),m[2]);
   if(kind==='verd'&&(m=s.match(/^\d+\s+\d+\s+CLAVEL\s+(.+?)\s+Select\s+(\d+)\s+([\d.]+)\s+94\s+(?:QB|HB)\s+([\d,]+)\s+([\d,.]+)$/)))add(m[1],eu(m[3]),eu(m[4]),eu(m[5]),m[2]);
   if(kind==='zorro'&&(m=s.match(/^(.+?)\s+(?:CO-)?\d{10}\s+(\d+)\s+HB\s+(\d+)\s+(\d+)\s+([\d,]+)\s+([\d.]+)\s+\$\s*([\d,.]+)$/)))add(m[1],num(m[5]),num(m[6]),num(m[7]),m[2],Number(m[2])*Number(m[3]));
   if(kind==='superior'&&(m=s.match(/^(\d+)\s+H\s+(.+?)\s+(\d+)\s+(\d+)\s+([\d,]+)\s+([\d.]+)\s+([\d,.]+)$/)))add(m[2],num(m[5]),num(m[6]),num(m[7]),m[1],num(m[5])/Number(m[3]));
   if(kind==='eco'&&(m=s.match(/^CARNATION\s+(.+?)\s+(\d+)\s+HB\s+[\d,]+\s+SELECT\s+\d+\s+(.+?)\s+(\d+)\s+([\d,]+)\s+([\d.,]+)$/)))add(m[1]+' '+m[3],m[4],eu(m[5]),eu(m[6]),m[2]);
   if(kind==='ayura'&&(m=s.match(/^(\d+)\s+HB\s+(\d+)\s+(.+?)\s+Stems\s+(\d+)\s+US\$\s+([\d.]+)\s+(\d+)\s+US\$\s+[\d.]+\s+US\$\s*(.*)$/))){
    const next=rr[i+1]||'',tail=m[7].trim()||next.match(/([\d,]+\.\d+)\s*$/)?.[1];
    const desc=m[3].replace(/0603[\d.]+\s*-?\s*.*$/,'').trim()+' '+(m[7].trim()?'':next.replace(/[\d,]+\.\d+\s*$/,'').replace(/\bCO\b/g,'').trim());
    if(tail)add(desc.trim(),m[4],num(m[5]),num(tail),m[1],m[6],pn);
   }
   if(kind==='inver'&&(m=s.match(/^(\d+)\s+H\s+(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s+CO\s*([\d.]+)\s+([\d,.]+)$/)))add(m[5],m[4],num(m[6]),num(m[7]),m[1],Number(m[1])*Number(m[2]));
   if(kind==='fagua'&&(m=s.match(/^\d+\s+(\d+)\s+HB\s+(.+?)\s+300\s+(\d+)\s+Und\.\s+([\d,]+)\s+([\d,.]+)$/)))add(m[2],m[3],eu(m[4]),eu(m[5]),m[1]);
   if(kind==='invos'&&(m=s.match(/^\d+\s+(.+?)\s+(?:\w+)\s+(\d+)\s+Quarter\s+[\d,]+\s+(\d+)\s+([\d,]+)\s+([\d,]+)$/)))add(m[1],m[3],eu(m[4]),eu(m[5]),m[2]);
   if(kind==='nat'&&(m=s.match(/^\d+\s+\w+\s+(.+?)\s+unidad\s+([\d,.]+)\s+USD\s+([\d.]+)\s+USD\s+0\.00\s+USD\s+([\d,.]+)$/)))add(m[1],num(m[2]),num(m[3]),num(m[4]),null,null,pn);
   if(kind==='esperance'&&(m=s.match(/^\d+\s+\d+\s+(.+?)\s+(\d+)\s+Und\.\s*([\d,]+)\s+([\d,.]+)$/)))add(m[1],m[2],eu(m[3]),eu(m[4]));
   if(kind==='milagro'&&(m=s.match(/^(\d+)\s+Q\s+(.+?)\s+\d{6}\s+10\s+10\s+100\s+(\d+)\s+([\d,]+)\s+([\d,]+)$/)))add(m[2],m[3],eu(m[4]),eu(m[5]),m[1]);
   if(kind==='daflor'&&(m=s.match(/^(\d+)\s+(?:QB|HB)\s+(.+?)\s+(\d+)\s+(\d+)\s+Stems\s+\$([\d.]+)\s+\$([\d,.]+)$/)))add(m[2].replace(/\s+(?:POC|FINCA|CO-).*/,'').replace(/\s+-\s+-.*$/,''),m[4],num(m[5]),num(m[6]),m[1]);
   if(kind==='kikuyal'&&(m=s.match(/^\d+\s+(.+?)\s+([\d.]+)\s+([\d.]+)\s+([\d,.]+)$/)))add(m[1],num(m[2]),num(m[3]),num(m[4]));
   if(kind==='sunshine'&&(m=s.match(/^(ROSE .+?)\s+\d{10}\s+\d{10}\s+(\d+)\s+([\d.]+)\s+([\d.]+)$/)))add(m[1],m[2],num(m[3]),num(m[4]));
   if(kind==='circasia'&&(m=s.match(/^(\d+)\s+Q\s+(.+?)\s+100\s+(\d+)\s+ST\s+([\d.]+)\s+([\d.]+)$/)))add(m[2].replace(/\s+\d{6}.*$/,'').replace(/\s+50\s+0603.*$/,''),m[3],num(m[4]),num(m[5]),m[1]);
   if(kind==='ruscus'&&(m=s.match(/^(\d+)\s+HB\s+0\.5\s+RUSCUS\s+(\d+)\s+cm\s+\d+\s+\d+\s+(\d+)\s+\$([\d.]+)\s+\$([\d.]+)$/)))add('RUSCUS '+m[2]+'cm',m[3],num(m[4]),num(m[5]),m[1]);
   if(kind==='funza'&&(m=s.match(/^[\d.]+\s+(ALSTROEMERIA .+?)\s+(\d+)\s+TAB\s+.*?\s+([\d,]+)\s+Stem\s+\$([\d.]+)\s+\$([\d,.]+)$/)))add(m[1],num(m[3]),num(m[4]),num(m[5]),m[2]);
   if(kind==='gaitana'&&(m=s.match(/^(.+?)\s+HB\s+(\d+)\s+(\d+)\s+(\d+)\s+\d+\s+(\d+)\s+([\d,]+)\s+([\d,]+)$/)))add(m[1],m[5],eu(m[6]),eu(m[7]),m[2],Number(m[2])*Number(m[3]));
   if(kind==='matina'){
    if(/^(?:QB\s+)?16X30X102 CM/.test(s))pending=s.replace(/^(?:QB\s+)?16X30X102 CM\s*/,'');
    else if(pending&&(m=s.match(/^(\d+)\s+(?:QB\s+)?\$[\d.]+\s+(\d+)\s+\$([\d.]+)\s+\$([\d,.]+)$/))){add(pending,m[2],num(m[3]),num(m[4]),m[1],Number(m[2])/10);pending=null;}
   }
   if(kind==='multiflora'&&(m=s.match(/^SC\s+(?:-\s+)?\w+\s+(.+?)\s+(\d+)\s+Half\s+300\s+([\d,]+)\s+([\d.]+)\s+([\d,.]+)\s+[\d.]+$/)))add(m[1],num(m[3]),num(m[4]),num(m[5]),m[2]);
   if(kind==='flora'&&(m=s.match(/^(.+?)\s+(\d+)\s+HALF\s+100\s+(\d+)\s+(\d+)\s+([\d.]+)\s+[\d.]+\s+([\d.]+)\s+[\d.]+$/)))add(m[1],m[3],num(m[5]),num(m[6]),m[2],m[4]);
  }
 }
 if(kind==='visual'){
  const v=readTibaOcrTable(source.pages[26]);
  for(const x of v.products)add(x.description,x.totalStems,x.unitPrice,x.amount,null,x.bunches,page,x.raw_quote);
 }
 const charges=kind==='invos'?48.11:kind==='funza'?15:0;
 const sums={stems:products.reduce((a,x)=>a+x.stems,0),amount:Math.round((products.reduce((a,x)=>a+x.amount,0)+charges)*100)/100,pieces:products.every(x=>x.pieces!==null)?products.reduce((a,x)=>a+x.pieces,0):null};
 const issues=[];
 for(const [index,p] of products.entries())if(Math.abs(p.stems*p.unitPricePerStem-p.amount)>.011)issues.push({code:'LINE_AMOUNT',line:index+1});
 if(sums.stems!==expectedStems)issues.push({code:'STEMS',expected:expectedStems,actual:sums.stems});
 if(Math.abs(sums.amount-total)>.011)issues.push({code:'INVOICE_TOTAL',expected:total,actual:sums.amount});
 if(sums.pieces!==null&&sums.pieces!==expectedPieces)issues.push({code:'PIECES',expected:expectedPieces,actual:sums.pieces});
 if(sums.pieces===null)issues.push({code:'ROW_PIECES_UNAVAILABLE',printedTotal:expectedPieces});
 if(invoice==='SOURCE_ID_PENDING')issues.push({code:'INVOICE_ID_PENDING'});
 invoices.push({supplier,invoice,currency:'USD',pages:[page,last],printedTotal:total,printedStems:expectedStems,printedPieces:expectedPieces,charges,products,sums,issues,status:issues.length?'REVIEW_REQUIRED':'NUMERICALLY_VALIDATED'});
}
const report={sourceSha256:expectedHash,paidApiCalls:0,erpWrites:0,preservedCompletedChunks:[1,2,3],sourcePagesProcessed:[1,43],invoices,manifestIssues:[{code:'HAWB_PRINTED_PREFIX_CONFLICT',invoice:'FEER4346',manifest:'AFBG00568432',invoicePrinted:'AFBH00568432',action:'REVIEW_REQUIRED; user approved continuing other invoices, not replacement'}],mergedWithServerChunks:false,status:'LOCAL_VALIDATION_ONLY'};

const numericIssues=invoices.flatMap(i=>i.issues.filter(x=>['LINE_AMOUNT','STEMS','INVOICE_TOTAL','PIECES','INVOICE_ID_PENDING'].includes(x.code)).map(x=>({invoice:i.invoice,...x})));
if(numericIssues.length)return {result:null,reason:'콜롬비아 무료 분석의 원본 수량·금액 대조가 실패했습니다.',issues:numericIssues};
return {result:report};
}
