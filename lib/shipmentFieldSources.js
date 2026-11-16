import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import XLSX from 'xlsx';
import JSZip from 'jszip';
import {parseAllocationWorkbook} from './shipmentImport.js';
import {palletSnapshot,addPalletSnapshots} from './shipmentPallet.js';
import {createUploadedFieldWorkbook} from './shipmentFieldUpload.js';

export function sourceFamily(row){return row.productFamily==='minicarnation'?'carnation':row.productFamily||row.sheetName;}
export const names={carnation:'카네이션',rose:'장미',hydrangea:'수국',alstroemeria:'알스트로',ruscus:'루스커스'};
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
function folder(year,week){
  if(!/^\d{4}$/.test(year)||!/^\d{2}-\d{2}$/.test(week))throw Error('연도와 차수를 확인하세요.');
  return path.join(process.env.FIELD_UPLOAD_DIR||path.join(process.cwd(),'data','shipment-field-uploads'),year,week);
}
export async function listSources(year,week){
  const dir=folder(year,week);
  let files;
  try{files=await fs.readdir(dir);}catch(e){if(e.code==='ENOENT')return [];throw e;}
  return Promise.all(files.filter(f=>/^[a-f0-9]{64}\.json$/.test(f)).map(async f=>JSON.parse(await fs.readFile(path.join(dir,f),'utf8'))));
}
async function atomicWrite(file,bytes){
  const temp=file+'.'+crypto.randomUUID()+'.tmp';
  try{await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600});await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true});}
}
export async function saveSource(year,week,filename,buffer){
  const match=filename.match(/(?:^|[^\d])(\d{2})[-－](\d{1,2})(?!\d)/);
  if(match&&match[1]+'-'+match[2].padStart(2,'0')!==week)throw Error('파일 차수와 화면에서 선택한 차수가 다릅니다.');
  const wb=XLSX.read(buffer),{rows}=parseAllocationWorkbook(XLSX,wb);
  if(!rows.length)throw Error('품목이 있는 물량표를 선택하세요.');
  const dir=folder(year,week);
  await fs.mkdir(dir,{recursive:true,mode:0o700});
  const id=hash(filename.normalize('NFC')),revision=hash(buffer);
  const item={id,revision,filename,families:[...new Set(rows.map(sourceFamily))],pallets:palletSnapshot(XLSX,wb,rows)};
  await atomicWrite(path.join(dir,revision+'.xlsx'),buffer);
  await atomicWrite(path.join(dir,id+'.json'),JSON.stringify(item));
  return item;
}
export function catalog(items){
  return items.flatMap(i=>i.families.map(family=>({id:i.id+':'+family,revision:i.revision,family,label:names[family]||family,filename:i.filename})));
}
function rowsFor(buffer,family){
  return parseAllocationWorkbook(XLSX,XLSX.read(buffer)).rows.filter(r=>sourceFamily(r)===family);
}
export async function selectedData(year,week,selection,includePrevious=true){
  if(!Array.isArray(selection)||!selection.length||selection.length>100)throw Error('다운로드할 품목을 체크하세요.');
  const items=await listSources(year,week),available=catalog(items),chosen=[];
  for(const request of selection){
    const item=available.find(i=>i.id===request.id&&i.revision===request.revision);
    if(!item||chosen.some(c=>c.id===item.id))throw Error('저장 목록을 새로 확인하고 품목을 선택하세요.');
    chosen.push(item);
  }
  const priorWeek=week.slice(0,3)+'01';
  const old=includePrevious&&week.endsWith('-02')?await listSources(year,priorWeek):[];
  const parts=[],snapshots=[];
  for(const item of chosen){
    const source=items.find(i=>i.id===item.id.split(':')[0]),family=item.family;
    if(source.pallets[family])snapshots.push({[family]:source.pallets[family]});
    const corresponding=source.filename.replace(/[-－]0?2(?!\d)/,'-01');
    const prior=old.find(o=>o.filename===corresponding&&o.families.includes(family));
    if(prior?.pallets[family])snapshots.push({[family]:prior.pallets[family]});
    parts.push({source,family,prior});
  }
  return {parts,pallets:addPalletSnapshots(...snapshots),priorWeek};
}
export async function rememberFieldPlan(plan,buffer){
  await fs.mkdir(folder(plan.orderYear,plan.week),{recursive:true,mode:0o700});
  await atomicWrite(path.join(folder(plan.orderYear,plan.week),hash(buffer)+'.plan'),JSON.stringify(plan));
}
async function storedPlan(dir,revision){
  try{return JSON.parse(await fs.readFile(path.join(dir,revision+'.plan'),'utf8'));}
  catch(e){if(e.code==='ENOENT')return null;throw e;}
}
export async function downloadSelection(year,week,selection,customers,memo,renderSaved,includePrevious=true){
  const {parts,pallets,priorWeek}=await selectedData(year,week,selection,includePrevious);
  const selectedFamilies=[...new Set(parts.map(p=>p.family))];
  const mode=week.endsWith('-02')?(includePrevious?' 1차합산':' 2차만'):'';
  const zip=new JSZip();
  for(const {source,family,prior} of parts){
    const buffer=await fs.readFile(path.join(folder(year,week),source.revision+'.xlsx'));
    let previousFile;
    if(prior){const bytes=await fs.readFile(path.join(folder(year,priorWeek),prior.revision+'.xlsx'));
      previousFile={buffer:bytes,rows:rowsFor(bytes,family),filename:prior.filename};}
    const saved=renderSaved&&await storedPlan(folder(year,week),source.revision);
    let output;
    if(saved){
      const products=saved.products.filter(p=>sourceFamily({productFamily:p.family})===family);
      const keys=new Set(products.map(p=>p.prodKey));
      if(!keys.size)throw Error('저장 분배의 품목 연결을 다시 검증하세요.');
      output=await renderSaved({...saved,includePrevious,products,expected:saved.expected.filter(r=>keys.has(r.prodKey)),selectedFamilies,pallets});
    }else output=await createUploadedFieldWorkbook(buffer,rowsFor(buffer,family),{year,week,filename:source.filename,customerDirectory:customers,previousFile,pallets,selectedFamilies,farmText:memo?.filename===source.filename?memo.text:''});
    const name=path.basename(source.filename,'.xlsx').replace(/[\\/:*?"<>|]/g,'_')+' '+(names[family]||family).replace(/[\\/:*?"<>|]/g,'_')+mode+' 현장물량표.xlsx';
    if(parts.length===1)return {name,output};
    zip.file(name,output);
  }
  return {name:week+mode+' 선택 현장물량표.zip',output:await zip.generateAsync({type:'nodebuffer'})};
}
