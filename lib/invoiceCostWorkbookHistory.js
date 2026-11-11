// File-only append. Historical cells/formulas stay intact; selection flags are cleared
// so editing the current calculation cannot edit a grouped historical worksheet.
import JSZip from 'jszip';
import {createHash} from 'node:crypto';
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const unesc=s=>s.replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)="([^"]*)"/g)].map(m=>[m[1],unesc(m[2])]));
const nodes=(s,tag)=>[...s.matchAll(new RegExp(`<${tag}\\b[^>]*?(?:\\/>|>[\\s\\S]*?<\\/${tag}>)`,'g'))].map(m=>m[0]);
const activeView=(wb,index)=>{
 if(/activeTab="\d+"/.test(wb))return wb.replace(/activeTab="\d+"/,`activeTab="${index}"`);
 if(/<workbookView\b/.test(wb))return wb.replace(/<workbookView\b/,`<workbookView activeTab="${index}"`);
 return wb.replace(/<sheets\b/,'<bookViews><workbookView activeTab="'+index+'"/></bookViews><sheets');
};
async function ungroupSheets(zip){
 for(const name of Object.keys(zip.files))if(/^xl\/worksheets\/[^/]+\.xml$/.test(name)){
  const original=await read(zip,name),next=original.replace(/\s+tabSelected="[01]"/g,'');
  if(next!==original)zip.file(name,next);
 }
}
const read=(z,p)=>{if(!z.file(p))throw new Error(`Invalid workbook part: ${p}`);return z.file(p).async('string');};
async function load(bytes){
 if(bytes.length>40*1024*1024)throw new Error('Workbook history exceeds 40 MB');
 const z=await JSZip.loadAsync(bytes);let total=0;
 for(const [name,file]of Object.entries(z.files)){
  if(name.includes('..')||name.startsWith('/')||/vbaProject/i.test(name))throw new Error('Unsupported workbook history relationship');
  total+=file._data?.uncompressedSize||0;
 }
 if(total>160*1024*1024)throw new Error('Workbook history expanded size exceeds limit');
 return z;
}
export async function costWorkbookDigest(bytes){
 const zip=await load(bytes),digest=createHash('sha256');
 for(const name of Object.keys(zip.files).sort())if(!zip.files[name].dir){digest.update(name);digest.update(await zip.files[name].async('nodebuffer'));}
 return digest.digest('hex');
}
export async function costWorkbookActiveSheet(bytes){
 const zip=await load(bytes),wb=await read(zip,'xl/workbook.xml');
 return Number(wb.match(/activeTab="(\d+)"/)?.[1]||0);
}
export async function selectCostWorkbookSheet(bytes,index){
 const zip=await load(bytes);let wb=await read(zip,'xl/workbook.xml');
 if(!Number.isInteger(index)||index<0||index>=nodes(wb,'sheet').length)throw new Error('Invalid historical sheet selection');
 if(Number(wb.match(/activeTab="(\d+)"/)?.[1]||0)===index)return bytes;
 wb=activeView(wb,index);zip.file('xl/workbook.xml',wb);await ungroupSheets(zip);
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
function mergeStyles(base,add){
 const offsets={};
 // Built-in number formats stay stable. Custom IDs are remapped independently.
 const ids=[...base.matchAll(/numFmtId="(\d+)"/g)].map(m=>+m[1]);let next=Math.max(163,...ids)+1;
 const map=new Map();for(const n of nodes(add,'numFmt')){const a=attrs(n);map.set(+a.numFmtId,next++);}
 let generated=add.replace(/numFmtId="(\d+)"/g,(m,id)=>map.has(+id)?`numFmtId="${map.get(+id)}"`:m);
 for(const [tag,child]of [['numFmts','numFmt'],['fonts','font'],['fills','fill'],['borders','border'],['cellStyleXfs','xf'],['cellXfs','xf'],['dxfs','dxf']]){
  const re=new RegExp(`<${tag}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/${tag}>)`);
  const old=base.match(re)?.[0],extra=generated.match(re)?.[0];
  const oldNodes=old?nodes(old,child):[],newNodes=extra?nodes(extra,child):[];offsets[tag]=oldNodes.length;
  let content=newNodes.join('');
  if(tag==='cellStyleXfs'||tag==='cellXfs')content=content.replace(/(fontId|fillId|borderId|xfId)="(\d+)"/g,(m,key,n)=>`${key}="${+n+(offsets[{fontId:'fonts',fillId:'fills',borderId:'borders',xfId:'cellStyleXfs'}[key]]||0)}"`);
  const replacement=`<${tag} count="${oldNodes.length+newNodes.length}">${oldNodes.join('')}${content}</${tag}>`;
  if(old)base=base.replace(old,()=>replacement);else if(newNodes.length)base=base.replace('</styleSheet>',()=>replacement+'</styleSheet>');
 }
 return {xml:base,offset:offsets.cellXfs,dxfOffset:offsets.dxfs};
}
export async function appendCostWorkbookHistory(previous,current,{label}={}){
 if(!previous)return Buffer.from(current);
 const base=await load(previous),add=await load(current);
 let wb=await read(base,'xl/workbook.xml'),rels=await read(base,'xl/_rels/workbook.xml.rels'),types=await read(base,'[Content_Types].xml');
 const awb=await read(add,'xl/workbook.xml'),ar=await read(add,'xl/_rels/workbook.xml.rels');
 const styles=mergeStyles(await read(base,'xl/styles.xml'),await read(add,'xl/styles.xml'));base.file('xl/styles.xml',styles.xml);
 const existing=nodes(wb,'sheet').map(attrs),incoming=nodes(awb,'sheet').map(attrs),names=new Set(existing.map(s=>s.name)),mapping=new Map();
 for(const s of incoming){let name=`${label||'신규'} ${s.name}`.replace(/[\\/?*\[\]:]/g,' ').slice(0,31),stem=name,n=1;while(names.has(name))name=stem.slice(0,26)+` (${n++})`;names.add(name);mapping.set(s.name,name);}
 const remapFormula=f=>{f=unesc(f);for(const[from,to]of mapping)f=f.split("'"+from.replace(/'/g,"''")+"'!").join("'"+to.replace(/'/g,"''")+"'!");return esc(f);};
 const relations=new Map(nodes(ar,'Relationship').map(s=>{const a=attrs(s);return[a.Id,a];}));
 let sheetId=Math.max(0,...existing.map(s=>+s.sheetId)),rid=1;
 const usedIds=new Set(nodes(rels,'Relationship').map(s=>attrs(s).Id));
 const additions=[];
 for(const s of incoming){
  const rel=relations.get(s['r:id']);if(!rel||!rel.Target.startsWith('worksheets/'))throw new Error('Unsupported generated worksheet');
  const source='xl/'+rel.Target;
  if(add.file(source.replace('worksheets/','worksheets/_rels/')+'.rels'))throw new Error('Generated sheet relationships require explicit migration');
  let body=await read(add,source);
  if(/t="s"/.test(body))throw new Error('Generated workbook must use inline strings');
  body=body.replace(/(<(?:c|row)\b[^>]*\bs=")(\d+)(")/g,(m,a,n,b)=>a+(+n+styles.offset)+b)
   .replace(/(<col\b[^>]*\bstyle=")(\d+)(")/g,(m,a,n,b)=>a+(+n+styles.offset)+b)
   .replace(/dxfId="(\d+)"/g,(m,n)=>`dxfId="${+n+styles.dxfOffset}"`);
  body=body.replace(/<f\b([^>]*)>([\s\S]*?)<\/f>/g,(m,a,f)=>{
   return `<f${a}>${remapFormula(f)}</f>`;
  });
  let part;do{part=`xl/worksheets/cost-history-${++sheetId}.xml`;}while(base.file(part));
  while(usedIds.has(`rIdCost${rid}`))rid++;const id=`rIdCost${rid++}`;usedIds.add(id);
  base.file(part,body);
  additions.push(`<sheet name="${esc(mapping.get(s.name))}" sheetId="${sheetId}" r:id="${id}"/>`);
  rels=rels.replace('</Relationships>',`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${part.slice(3)}"/></Relationships>`);
  types=types.replace('</Types>',`<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
 }
 wb=activeView(wb.replace('</sheets>',additions.join('')+'</sheets>'),existing.length+Math.min(2,incoming.length-1)).replace(/<calcPr\b[^>]*\/>/,'<calcPr calcId="0" fullCalcOnLoad="1" forceFullCalc="1"/>');
 const newNames=nodes(awb,'definedName').map(n=>n.replace(/localSheetId="(\d+)"/,(_,id)=>`localSheetId="${existing.length+Number(id)}"`).replace(/^(<definedName\b[^>]*>)([\s\S]*)(<\/definedName>)$/,(m,a,f,b)=>a+remapFormula(f)+b)).join('');
 if(newNames){if(wb.includes('</definedNames>'))wb=wb.replace('</definedNames>',()=>newNames+'</definedNames>');else wb=wb.replace('</sheets>',()=>'</sheets><definedNames>'+newNames+'</definedNames>');}
 // A stale calculation chain cannot describe newly appended formulas.
 base.remove('xl/calcChain.xml');rels=rels.replace(/<Relationship\b[^>]*Type="[^"]*\/calcChain"[^>]*\/>/g,'');types=types.replace(/<Override\b[^>]*PartName="\/xl\/calcChain.xml"[^>]*\/>/g,'');
 base.file('xl/workbook.xml',wb);base.file('xl/_rels/workbook.xml.rels',rels);base.file('[Content_Types].xml',types);
 await ungroupSheets(base);
 return base.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
