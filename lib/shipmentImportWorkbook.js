// Preserve the package, drawings and print geometry. Only verified quantity
// cells, formula caches, and the standard custom-property provenance change.
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { IMPORT_FILE_PROPERTY, IMPORT_FILE_SCHEMA, requireDownloadKind, importModeError } from './shipmentImportMode.js';

const xml=value=>String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const near=(a,b)=>Math.abs(Number(a)-Number(b))<0.0000001;
export function allocationExportRows(preview,kind='FINAL') {
  requireDownloadKind(kind);
  if(preview.distributionMode!=='ADD')return preview.rows;
  return preview.rows.map(row=>kind==='ADDITIONAL' ? {...row,farmSource:row.farmAddedSource} : row);
}
export function allocationWorkbookPlan(preview,workbook,kind='FINAL') {
  requireDownloadKind(kind);
  if(preview.distributionMode!=='ADD')return null;
  const patches=[];
  for(const row of preview.rows) {
    const refs=[...new Set(row.cells||[])].map(cell=>String(cell).match(/^(.*)!R(\d+)C(\d+)$/)).filter(Boolean);
    if(!refs.length)continue;
    const factor=Number(row.sourceQuantityFactor);
    const target=kind==='FINAL' ? Number(row.uploadQty) : Number(row.inputQty);
    if(!(factor>0)||!Number.isFinite(target))throw importModeError('다운로드 수량의 원본 단위를 확인할 수 없습니다. 다시 검증하세요.');
    const rawTotal=refs.reduce((sum,m)=>sum+Number(workbook.Sheets[m[1]]?.[XLSX.utils.encode_cell({r:Number(m[2])-1,c:Number(m[3])-1})]?.v||0),0);
    if(!Number.isFinite(rawTotal)||!near(rawTotal,row.excelQty))throw importModeError('같은 업체·품목의 원본 셀 합계가 검증값과 다릅니다.');
    // Baseline is added once, even when several source columns resolve to one pair.
    const adjustment=target/factor-rawTotal;
    if(adjustment>0.0000001) {
      const first=refs[0];patches.push({sheetName:first[1],ref:XLSX.utils.encode_cell({r:Number(first[2])-1,c:Number(first[3])-1}),adjustment});
    } else if(adjustment< -0.0000001) {
      let remaining=-adjustment;
      for(const cell of refs) {
        const sheetName=cell[1],ref=XLSX.utils.encode_cell({r:Number(cell[2])-1,c:Number(cell[3])-1});
        const subtract=Math.min(Number(workbook.Sheets[sheetName]?.[ref]?.v||0),remaining);
        if(subtract>0){patches.push({sheetName,ref,adjustment:-subtract});remaining-=subtract;}
        if(remaining<0.0000001)break;
      }
      if(remaining>0.0000001)throw importModeError('선출고 제외량을 원본 셀에 반영할 수 없습니다.');
    }
  }
  return {metadata:{schema:IMPORT_FILE_SCHEMA,kind,year:String(preview.orderYear),week:preview.week},patches};
}
function partPath(base,target) {
  const parts=target.startsWith('/')?[]:base.split('/').slice(0,-1);
  for(const p of target.split('/')){if(p==='..')parts.pop();else if(p && p!=='.')parts.push(p);}
  return parts.join('/');
}
async function sheetPaths(zip) {
  const book=await zip.file('xl/workbook.xml').async('string'),rels=await zip.file('xl/_rels/workbook.xml.rels').async('string');
  return new Map((book.match(/<sheet\b[^>]*>/g)||[]).map(tag=>{
    const name=tag.match(/\bname="([^"]+)"/)?.[1]?.replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&lt;/g,'<').replace(/&gt;/g,'>');
    const id=tag.match(/\br:id="([^"]+)"/)?.[1],rel=(rels.match(/<Relationship\b[^>]*>/g)||[]).find(t=>t.includes(`Id="${id}"`));
    return [name,partPath('xl/workbook.xml',rel?.match(/\bTarget="([^"]+)"/)?.[1]||'')];
  }));
}
function numberStyle(open,style) {
  if(style==null)return open;
  return /\bs="\d+"/.test(open)?open.replace(/\bs="\d+"/,`s="${style}"`):open.replace(/\s*\/?>$/,` s="${style}">`);
}
function writeQuantity(source,ref,value,formula,style) {
  const re=new RegExp(`<c\\b(?=[^>]*\\br="${ref}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`);
  const old=source.match(re)?.[0];
  const body=(open)=>`${numberStyle(open.replace(/\s+t="[^"]*"/,'').replace(/\s*\/>$/,'>'),style)}${formula?`<f>${xml(formula)}</f>`:''}<v>${value}</v></c>`;
  if(old)return source.replace(re,body(old.match(/^<c\b[^>]*>/)[0]));
  const r=Number(ref.match(/\d+/)[0]),rowRe=new RegExp(`(<row\\b(?=[^>]*\\br="${r}")[^>]*>)([\\s\\S]*?)(<\\/row>)`);
  if(!rowRe.test(source))throw importModeError('원본 행 밖에는 합산 수량을 추가할 수 없습니다.');
  return source.replace(rowRe,(_,start,cells,end)=>{
    const tags=cells.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)||[];
    tags.push(body(`<c r="${ref}">`));tags.sort((a,b)=>XLSX.utils.decode_cell(a.match(/\br="([^"]+)"/)[1]).c-XLSX.utils.decode_cell(b.match(/\br="([^"]+)"/)[1]).c);
    return start+tags.join('')+end;
  });
}
// Deliberately limited to the arithmetic/SUM emitted by our volume exporter.
// Unsupported Excel functions lose their stale cached value and recalculate in Excel.
export function formulaCacheValue(sheet,ref,visiting=new Set(),budget={remaining:100000}) {
  if(--budget.remaining<0)return null;
  const cell=sheet[ref];if(!cell?.f)return typeof cell?.v==='number'?cell.v:0;
  if(visiting.has(ref))return null;
  const next=new Set(visiting).add(ref),expression=String(cell.f).replace(/^=/,'').replace(/\$/g,'').replace(/\s/g,'').toUpperCase();
  const tokens=expression.match(/SUM|[A-Z]+\d+|(?:\d*\.)?\d+(?:E[+-]?\d+)?|[()+\-*/,\:]/g)||[];
  if(tokens.join('')!==expression)return null;
  let at=0;
  const take=expected=>{if(tokens[at++]!==expected)throw new Error('Unsupported formula');};
  const factor=()=>{
    const t=tokens[at++];
    if(t==='+'||t==='-')return(t==='-'?-1:1)*factor();
    if(t==='('){const v=expr();take(')');return v;}
    if(t==='SUM') {
      take('(');let sum=0;
      do {
        if(tokens[at]===',')at++;
        if(/^[A-Z]+\d+$/.test(tokens[at]||'') && tokens[at+1]===':') {
          const begin=tokens[at];at+=2;const end=tokens[at++];
          const range=XLSX.utils.decode_range(`${begin}:${end}`);
          if((range.e.r-range.s.r+1)*(range.e.c-range.s.c+1)>100000)throw new Error('Formula range too large');
          for(let r=range.s.r;r<=range.e.r;r++)for(let c=range.s.c;c<=range.e.c;c++){const value=formulaCacheValue(sheet,XLSX.utils.encode_cell({r,c}),next,budget);if(value==null)throw new Error('Unsupported dependency');sum+=value;}
        } else sum+=expr();
      }while(tokens[at]===',');take(')');return sum;
    }
    if(/^[A-Z]+\d+$/.test(t||'')){const v=formulaCacheValue(sheet,t,next,budget);if(v==null)throw new Error('Unsupported dependency');return v;}
    if(t!=null && Number.isFinite(Number(t)))return Number(t);
    throw new Error('Unsupported formula');
  };
  const term=()=>{let v=factor();while(['*','/'].includes(tokens[at])){const op=tokens[at++],right=factor();v=op==='*'?v*right:v/right;}return v;};
  const expr=()=>{let v=term();while(['+','-'].includes(tokens[at])){const op=tokens[at++],right=term();v=op==='+'?v+right:v-right;}return v;};
  try{const value=expr();return at===tokens.length && Number.isFinite(value)?value:null;}catch{return null;}
}
async function writeMetadata(zip,metadata) {
  const file='docProps/custom.xml';let source=zip.file(file)?await zip.file(file).async('string'):'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"></Properties>';
  source=source.replace(/<property\b[^>]*>[\s\S]*?<\/property>/g,tag=>tag.includes(`name="${IMPORT_FILE_PROPERTY}"`)?'':tag);
  if(!source.includes('xmlns:vt='))source=source.replace('<Properties','<Properties xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"');
  const pid=Math.max(1,...[...source.matchAll(/\bpid="(\d+)"/g)].map(m=>Number(m[1])))+1;
  source=source.replace('</Properties>',`<property fmtid="{D5CDD505-2E9C-101B-9397-08002B2CF9AE}" pid="${pid}" name="${IMPORT_FILE_PROPERTY}"><vt:lpwstr>${xml(JSON.stringify(metadata))}</vt:lpwstr></property></Properties>`);
  zip.file(file,source);
  let types=await zip.file('[Content_Types].xml').async('string');
  if(!types.includes('PartName="/docProps/custom.xml"'))zip.file('[Content_Types].xml',types.replace('</Types>','<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/></Types>'));
  let rels=await zip.file('_rels/.rels').async('string');
  if(!rels.includes('/custom-properties')){let id='rIdImportProvenance';while(rels.includes(`Id="${id}"`))id+='x';rels=rels.replace('</Relationships>',`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/custom-properties" Target="docProps/custom.xml"/></Relationships>`);zip.file('_rels/.rels',rels);}
}
export async function exportAllocationWorkbook(buffer,allocation) {
  if(!allocation)return buffer;
  const zip=await JSZip.loadAsync(buffer),workbook=XLSX.read(buffer,{type:'buffer',cellFormula:true}),paths=await sheetPaths(zip);
  let styles=await zip.file('xl/styles.xml').async('string');
  const oldXf=styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/),xfs=oldXf?.[1]?.match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)||[];
  const originalXfCount=xfs.length,decimalStyles=new Map();let decimalFormat;
  const fractionStyle=(source,ref,value)=>{
    if(value==null || near(value,Math.round(value)))return null;
    if(!oldXf)throw importModeError('소수 수량을 표시할 원본 스타일을 확인할 수 없습니다.');
    const old=Number(source.match(new RegExp(`<c\\b(?=[^>]*\\br="${ref}")[^>]*`))?.[0]?.match(/\bs="(\d+)"/)?.[1]||0);
    if(decimalStyles.has(old))return decimalStyles.get(old);
    if(decimalFormat==null) {
      decimalFormat=Math.max(163,...[...styles.matchAll(/numFmtId="(\d+)"/g)].map(m=>Number(m[1])))+1;
      const fmt=`<numFmt numFmtId="${decimalFormat}" formatCode="0.########"/>`;
      if(/<numFmts\b/.test(styles))styles=styles.replace(/<numFmts\b([^>]*?)(?:\/>|>([\s\S]*?)<\/numFmts>)/,(_,attrs,items)=>`<numFmts${attrs.replace(/\bcount="\d+"/,`count="${(items?.match(/<numFmt\b/g)||[]).length+1}"`)}>${items||''}${fmt}</numFmts>`);
      else styles=styles.replace(/(<styleSheet\b[^>]*>)/,`$1<numFmts count="1">${fmt}</numFmts>`);
    }
    let xf=xfs[old]||xfs[0];xf=xf.replace(/\bnumFmtId="\d+"/,`numFmtId="${decimalFormat}"`);
    xf=/\bapplyNumberFormat=/.test(xf)?xf.replace(/\bapplyNumberFormat="[^"]*"/,'applyNumberFormat="1"'):xf.replace('<xf','<xf applyNumberFormat="1"');
    const id=xfs.length;xfs.push(xf);decimalStyles.set(old,id);return id;
  };
  const sources=new Map();
  for(const patch of allocation.patches) {
    const path=paths.get(patch.sheetName);if(!path||!zip.file(path))throw importModeError('원본 시트를 찾을 수 없습니다.');
    const sheet=workbook.Sheets[patch.sheetName],cell=sheet[patch.ref]||{t:'n',v:0};
    const value=Number(cell.v||0)+Number(patch.adjustment);
    if(!Number.isFinite(value)||value<0)throw importModeError('원본 셀의 합산 다운로드 수량이 유효하지 않습니다.');
    const formula=cell.f?`(${cell.f})${patch.adjustment<0?'':'+'}${patch.adjustment}`:null;
    let source=sources.get(path)??await zip.file(path).async('string');
    source=writeQuantity(source,patch.ref,value,formula,fractionStyle(source,patch.ref,value));sources.set(path,source);sheet[patch.ref]={...cell,t:'n',v:value,...(formula?{f:formula}:{})};
  }
  const cacheBudget={remaining:500000};
  for(const [name,path]of paths) {
    let source=sources.get(path)??await zip.file(path).async('string');const sheet=workbook.Sheets[name];
    source=source.replace(/<c\b[^>]*>[\s\S]*?<\/c>/g,tag=>{
      if(!/<f\b/.test(tag))return tag;
      const ref=tag.match(/\br="([^"]+)"/)?.[1],value=formulaCacheValue(sheet,ref,new Set(),cacheBudget);
      if(value!=null && near(value,sheet[ref]?.v))return tag;
      const clean=tag.replace(/<v\b[^>]*>[\s\S]*?<\/v>/g,'');
      if(value==null)return clean;
      const styled=clean.replace(/^<c\b[^>]*>/,open=>numberStyle(open,fractionStyle(source,ref,value)));
      return styled.replace('</c>',`<v>${value}</v></c>`);
    });zip.file(path,source);
  }
  let book=await zip.file('xl/workbook.xml').async('string');
  const calc=book.match(/<calcPr\b[^>]*\/?\s*>/)?.[0];
  const nextCalc=(calc||'<calcPr/>').replace(/\s+(?:calcMode|fullCalcOnLoad|forceFullCalc)="[^"]*"/g,'').replace(/\/?\s*>$/,' calcMode="auto" fullCalcOnLoad="1" forceFullCalc="1"/>');
  book=calc?book.replace(calc,nextCalc):book.replace('</workbook>',nextCalc+'</workbook>');zip.file('xl/workbook.xml',book);
  await writeMetadata(zip,allocation.metadata);
  if(xfs.length!==originalXfCount){styles=styles.replace(/<cellXfs\b[^>]*>[\s\S]*?<\/cellXfs>/,`<cellXfs count="${xfs.length}">${xfs.join('')}</cellXfs>`);zip.file('xl/styles.xml',styles);}
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
