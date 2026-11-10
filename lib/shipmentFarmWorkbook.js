// Patch the ZIP package directly: never round-trip source sheets through an Excel writer.
import JSZip from 'jszip';
import XLSX from 'xlsx';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { FARM_SHEET } from './shipmentFarmText.js';

const xml=value=>String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
const hash=buffer=>createHash('sha256').update(buffer).digest('hex');
function fail(message) {throw Object.assign(new Error(message),{statusCode:409,code:'FARM_EXPORT_INVALID'});}
function cellXml(ref,value,style='') {
  return typeof value==='number' ? `<c r="${ref}"${style}><v>${value}</v></c>` : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
}
function wrappedLines(value,width) {
  const lines=[];let line='',used=0;
  for(const char of value) {
    const size=char.charCodeAt(0)>255 ? 14.7 : 8;
    if(used+size>width && line) {lines.push(line);line='';used=0;}
    line+=char;used+=size;
  }
  if(line)lines.push(line);return lines;
}
function headerNoteBlocks(sheet,range,lines,old) {
  const cells={...sheet};
  for(const block of old?.blocks || []) {
    if(String(sheet[block.cell]?.v || '')!==block.text) fail('인쇄 농장메모가 직접 수정됐습니다. 농장분배_검증 시트 또는 카톡 입력에서 수정한 뒤 다시 검증하세요.');
    delete cells[block.cell];
  }
  const blocks=[];let at=0;
  for(let r=0;r<=Math.min(11,range.e.r) && at<lines.length;r++) {
    const values=[];let last=-1;
    for(let c=0;c<=range.e.c;c++) {const v=String(cells[XLSX.utils.encode_cell({r,c})]?.v ?? '').trim();values.push(v);if(v)last=c;}
    if(values.includes('주문') && values.includes('입고'))break;
    const start=last<0 ? 0 : last+3; // protect overflow from the last existing heading
    if(start>range.e.c)continue;
    const height=sheet['!rows']?.[r]?.hpt ?? 15;
    const capacity=Math.floor((height-4)/14);
    if(capacity<1)continue;
    const width=Array.from({length:range.e.c-start+1},(_,i)=>sheet['!cols']?.[start+i]?.wpx ?? 64).reduce((a,b)=>a+b,0);
    const count=Math.max(1,Math.floor(width/450)), cols=Math.floor((range.e.c-start+1)/count);
    for(let part=0;part<count && at<lines.length;part++) {
      const c=start+part*cols,end=part===count-1?range.e.c:c+cols-1;
      const region={s:{r,c},e:{r,c:end}};
      if((sheet['!merges'] || []).some(m=>!(m.e.r<r || m.s.r>r || m.e.c<c || m.s.c>end) && !(old?.blocks || []).some(b=>b.ref===XLSX.utils.encode_range(m))))continue;
      let text=[],used=0;
      const pixels=Array.from({length:end-c+1},(_,i)=>sheet['!cols']?.[c+i]?.wpx ?? 64).reduce((a,b)=>a+b,0)-16;
      while(at<lines.length) {
        const wrapped=wrappedLines(lines[at],pixels);
        if(used+wrapped.length>capacity)break;
        text.push(...wrapped);used+=wrapped.length;at++;
      }
      if(text.length)blocks.push({cell:XLSX.utils.encode_cell({r,c}),ref:XLSX.utils.encode_range(region),text:text.join('\n')});
    }
  }
  return at===lines.length ? blocks : null;
}
export async function planFarmWorkbook(buffer,rows) {
  const entries=rows.filter(r=>r.farmSource).map(r=>({...r.farmSource,sheetName:r.sheetName,rowKey:r.key}));
  const zip=await JSZip.loadAsync(buffer);
  const workbook=XLSX.read(buffer,{type:'buffer',cellStyles:true});
  let previous=[];
  try { previous=JSON.parse(workbook.Sheets[FARM_SHEET]?.B1?.v || '[]'); } catch { fail('농장분배 위치 기록이 손상됐습니다. 원본 파일로 다시 검증하세요.'); }
  const patches=[],errors=[];
  const printableHeights={1:792,5:1008,8:1190.55,9:841.89}; // points: Letter, Legal, A3, A4
  for(const name of [...new Set([...entries.map(e=>e.sheetName),...previous.map(p=>p.sheetName)])]) {
    const sheet=workbook.Sheets[name],index=workbook.SheetNames.indexOf(name);
    if(!sheet || index<0) {errors.push(`${name}: 원본 시트를 찾을 수 없습니다.`);continue;}
    // Resolve actual package relationship instead of assuming sheetN.xml order.
    const wbXml=await zip.file('xl/workbook.xml').async('string');
    const rels=await zip.file('xl/_rels/workbook.xml.rels').async('string');
    const tag=(wbXml.match(/<sheet\b[^>]*\/?\s*>/g)||[])[index];
    const rid=tag?.match(/\br:id="([^"]+)"/)?.[1];
    const rel=(rels.match(/<Relationship\b[^>]*\/?\s*>/g)||[]).find(t=>t.includes(`Id="${rid}"`));
    const target=rel?.match(/\bTarget="([^"]+)"/)?.[1];
    const path=target?.startsWith('/') ? target.slice(1) : `xl/${target || ''}`;
    if(!zip.file(path)) {errors.push(`${name}: 시트 관계를 찾을 수 없습니다.`);continue;}
    const source=await zip.file(path).async('string');
    const setup=source.match(/<pageSetup\b[^>]*>/)?.[0] || '';
    const margins=source.match(/<pageMargins\b[^>]*>/)?.[0] || '';
    const attr=(tag,key,fallback)=>Number(tag.match(new RegExp(`\\b${key}="([^"]+)"`))?.[1] ?? fallback);
    const paper=attr(setup,'paperSize',9), scale=attr(setup,'scale',100)/100;
    const landscape=/orientation="landscape"/.test(setup);
    const height=landscape ? ({1:612,5:612,8:841.89,9:595.28}[paper]) : printableHeights[paper];
    const old=previous.find(p=>p.sheetName===name);
    const originalRef=old?.originalRef || sheet['!ref'] || 'A1';
    const range=XLSX.utils.decode_range(originalRef);
    if(!entries.some(e=>e.sheetName===name) && old) {
      headerNoteBlocks(sheet,range,[],old); // detect edits before removing our own generated notes
      patches.push({path,sheetName:name,originalRef,clear:true,previous:old});continue;
    }
    let usedHeight=0;
    const defaultHeight=attr(source.match(/<sheetFormatPr\b[^>]*>/)?.[0] || '', 'defaultRowHeight',15);
    for(let r=0;r<=range.e.r;r++) usedHeight += sheet['!rows']?.[r]?.hpt ?? defaultHeight;
    const availableHeight=height ? (height-72*(attr(margins,'top',.75)+attr(margins,'bottom',.75)))/scale : usedHeight;
    const noteRows=[['농장분배 · 이번 검증 결과 (원본 수기 메모보다 우선)']];
    let lastCustomer='';
    for(const entry of entries.filter(e=>e.sheetName===name)) {
      if(lastCustomer!==entry.customer) {noteRows.push([`-${entry.customer}`]);lastCustomer=entry.customer;}
      noteRows.push([`${entry.product} ${entry.quantity}${entry.unit} (${entry.farms.map(f=>`${f.name} ${f.quantity}${f.unit || ''}`).join(', ')})`]);
    }
    const blocks=headerNoteBlocks(sheet,range,noteRows.map(r=>r[0]),old);
    if(blocks) {
      patches.push({path,sheetName:name,originalRef,blocks,previous:old || null});continue;
    }
    // Existing explicit print areas are hard boundaries. Never silently expand them.
    const printName=(workbook.Workbook?.Names || []).find(n=>n.Name==='_xlnm.Print_Area' && n.Sheet===index);
    let withinArea=true;
    if(printName) {
      const a=String(printName.Ref).match(/\$?([A-Z]+)\$?(\d+)\s*$/);
      withinArea=!!a && Number(a[2])>=range.e.r+2+noteRows.length;
    }
    if(!withinArea || usedHeight+(noteRows.length+1)*defaultHeight>availableHeight*.96) {
      errors.push(`${name}: 원본 인쇄 배율을 유지할 수 있는 빈 공간이 부족합니다. 농장분배 내용을 줄이거나 원본 엑셀의 빈 공간을 확보한 뒤 다시 검증하세요.`);continue;
    }
    patches.push({path,sheetName:name,start:range.e.r+3,lines:noteRows.map(r=>r[0]),lastColumn:range.e.c,originalRef,previous:old || null});
  }
  return {entries,patches,errors};
}
export function signFarmExport(buffer,plan,userId,secret=process.env.JWT_SECRET) {
  if(!secret) fail('다운로드 검증 서명이 설정되지 않았습니다.');
  const payload=Buffer.from(JSON.stringify({hash:hash(buffer),plan,userId,issued:Date.now()})).toString('base64url');
  return `${payload}.${createHmac('sha256',secret).update(`farm-export-v1:${payload}`).digest('hex')}`;
}
export function verifyFarmExport(buffer,token,userId,secret=process.env.JWT_SECRET) {
  const [payload,sig,extra]=String(token || '').split('.');
  if(!secret || !payload || !/^[a-f0-9]{64}$/.test(sig || '') || extra) fail('다운로드 전에 다시 검증하세요.');
  const expected=createHmac('sha256',secret).update(`farm-export-v1:${payload}`).digest('hex');
  if(!timingSafeEqual(Buffer.from(sig),Buffer.from(expected))) fail('다운로드 검증 정보가 변경됐습니다.');
  let data;try{data=JSON.parse(Buffer.from(payload,'base64url').toString());}catch{fail('잘못된 다운로드 정보입니다.');}
  if(data.userId!==userId || data.hash!==hash(buffer) || Date.now()<data.issued || Date.now()-data.issued>30*60*1000) fail('파일·계정이 바뀌었거나 검증 시간이 만료됐습니다.');
  if(data.plan.errors?.length) fail(data.plan.errors.join('\n'));
  return data.plan;
}
export async function exportFarmWorkbook(buffer,plan) {
  const zip=await JSZip.loadAsync(buffer);
  let styles=await zip.file('xl/styles.xml').async('string');
  const xfs=styles.match(/<cellXfs\b[^>]*count="(\d+)"[^>]*>/);
  const noteXf='<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="left" vertical="top" wrapText="1"/></xf>';
  const existingXfs=styles.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1]?.match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g) || [];
  const existingNoteStyle=existingXfs.indexOf(noteXf);
  const noteStyle=existingNoteStyle>=0 ? existingNoteStyle : Number(xfs?.[1] || 0);
  if(plan.patches.some(p=>p.blocks)) {
    if(!xfs)fail('원본 셀 스타일을 찾을 수 없습니다.');
    if(existingNoteStyle<0) {
      styles=styles.replace(xfs[0],xfs[0].replace(`count="${noteStyle}"`,`count="${noteStyle+1}"`)).replace('</cellXfs>',`${noteXf}</cellXfs>`);
      zip.file('xl/styles.xml',styles);
    }
  }
  for(const patch of plan.patches) {
    let source=await zip.file(patch.path).async('string');
    for(const block of patch.previous?.blocks || []) {
      const escaped=block.cell;
      source=source.replace(new RegExp(`<c\\b(?=[^>]*\\br="${escaped}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`),block.original || '');
      source=source.replace(`<mergeCell ref="${block.ref}"/>`,'');
    }
    source=source.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/,section=>{
      const refs=section.match(/<mergeCell\b[^>]*\/>/g)||[];
      return refs.length ? `<mergeCells count="${refs.length}">${refs.join('')}</mergeCells>` : '';
    });
    if(patch.previous?.start) {
      for(let r=patch.previous.start;r<patch.previous.start+patch.previous.count;r++) {
        const pattern=new RegExp(`<row\\b(?=[^>]*\\br="${r}")[^>]*>[\\s\\S]*?<\\/row>`);
        const existing=source.match(pattern)?.[0];
        // Never delete a user-edited note row containing additional cells.
        if(existing && (existing.match(/<c\b/g)||[]).length>1) fail(`${patch.sheetName}: 농장메모 행에 추가 입력이 있습니다. 원본에서 빈 공간을 확보하세요.`);
        source=source.replace(pattern,'');
      }
    }
    if(patch.clear) {
      source=source.replace(/<dimension ref="([^"]+)"\s*\/>/,`<dimension ref="${xml(patch.originalRef)}"/>`);
      zip.file(patch.path,source);continue;
    }
    if(patch.blocks) {
      for(const block of patch.blocks) {
        const original=source.match(new RegExp(`<c\\b(?=[^>]*\\br="${block.cell}")[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)`))?.[0] || '';
        block.original=original;
        // Explicit 11pt runs avoid inheriting huge heading fonts; row/column geometry is untouched.
        const cell=`<c r="${block.cell}" s="${noteStyle}" t="inlineStr"><is><r><rPr><sz val="11"/></rPr><t xml:space="preserve">${xml(block.text)}</t></r></is></c>`;
        if(original)source=source.replace(original,cell);
        else {
          const row=XLSX.utils.decode_cell(block.cell).r+1;
          const emptyRowPattern=new RegExp(`<row\\b(?=[^>]*\\br="${row}")[^>]*?\\/>`);
          if(emptyRowPattern.test(source)) {
            source=source.replace(emptyRowPattern,tag=>tag.replace(/\/>$/,`>${cell}</row>`));
          }
          const rowPattern=new RegExp(`(<row\\b(?=[^>]*\\br="${row}")[^>]*>)([\\s\\S]*?)(<\\/row>)`);
          if(!source.includes(cell))source=source.replace(rowPattern,(_,open,content,close)=>{
            const elements=content.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g)||[];
            elements.push(cell);elements.sort((a,b)=>XLSX.utils.decode_cell(a.match(/\br="([^"]+)"/)[1]).c-XLSX.utils.decode_cell(b.match(/\br="([^"]+)"/)[1]).c);
            return open+elements.join('')+close;
          });
          if(!source.includes(cell))fail('원본 빈셀 행을 찾을 수 없습니다.');
        }
        if(block.ref.split(':')[0]!==block.ref.split(':')[1]) {
          if(source.includes('</mergeCells>'))source=source.replace('</mergeCells>',`<mergeCell ref="${block.ref}"/></mergeCells>`);
          else {
            const merge=`<mergeCells count="1"><mergeCell ref="${block.ref}"/></mergeCells>`;
            const tail=source.indexOf('</sheetData>')+'</sheetData>'.length;
            const rest=source.slice(tail);
            const before=rest.search(/<(?:phoneticPr|conditionalFormatting|dataValidations|hyperlinks|printOptions|pageMargins|pageSetup|headerFooter|rowBreaks|colBreaks|drawing|legacyDrawing|extLst)\b/);
            const position=before<0 ? source.lastIndexOf('</worksheet>') : tail+before;
            source=source.slice(0,position)+merge+source.slice(position);
          }
        }
      }
      source=source.replace(/<mergeCells\b[^>]*>[\s\S]*?<\/mergeCells>/,s=>s.replace(/count="\d+"/,`count="${(s.match(/<mergeCell\b/g)||[]).length}"`));
      zip.file(patch.path,source);continue;
    }
    const addition=patch.lines.map((text,i)=>`<row r="${patch.start+i}">${cellXml(`A${patch.start+i}`,text)}</row>`).join('');
    source=source.replace('</sheetData>',`${addition}</sheetData>`);
    source=source.replace(/<dimension ref="([^"]+)"\s*\/>/,()=>`<dimension ref="A1:${XLSX.utils.encode_cell({r:patch.start+patch.lines.length-2,c:patch.lastColumn})}"/>`);
    zip.file(patch.path,source);
  }
  // Structured sheet is also the round-trip source; source quantities stay numeric and untouched.
  const positions=plan.patches.filter(p=>!p.clear).map(p=>({sheetName:p.sheetName,originalRef:p.originalRef,...(p.blocks?{blocks:p.blocks}:{start:p.start,count:p.lines.length})}));
  const table=[['NENOVA_FARM_V1',JSON.stringify(positions)],['업체','품목','총수량','단위','농장','농장수량','품종']];
  for(const sourceEntry of plan.entries) {
    const entry=sourceEntry.roundTrip || sourceEntry;
    for(const farm of entry.farms) table.push([entry.customer,entry.product,entry.quantity,entry.unit,farm.name,farm.quantity,entry.family]);
  }
  let wb=await zip.file('xl/workbook.xml').async('string');
  let rels=await zip.file('xl/_rels/workbook.xml.rels').async('string');
  let types=await zip.file('[Content_Types].xml').async('string');
  const existing=(wb.match(/<sheet\b[^>]*\/?\s*>/g)||[]).find(t=>t.includes(`name="${FARM_SHEET}"`));
  let path;
  if(existing) {
    const rid=existing.match(/\br:id="([^"]+)"/)[1];
    const rel=(rels.match(/<Relationship\b[^>]*\/?\s*>/g)||[]).find(t=>t.includes(`Id="${rid}"`));
    const target=rel.match(/\bTarget="([^"]+)"/)[1];
    path=target.startsWith('/') ? target.slice(1) : `xl/${target}`;
  } else {
    const id=Math.max(0,...(wb.match(/sheetId="\d+"/g)||[]).map(s=>Number(s.match(/\d+/)[0])))+1;
    let rid='rIdFarmImport';while(rels.includes(`Id="${rid}"`))rid+='x';
    path=`xl/worksheets/nenovaFarmImport${id}.xml`;
    wb=wb.replace('</sheets>',`<sheet name="${FARM_SHEET}" sheetId="${id}" r:id="${rid}"/></sheets>`);
    rels=rels.replace('</Relationships>',`<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/nenovaFarmImport${id}.xml"/></Relationships>`);
    types=types.replace('</Types>',`<Override PartName="/${path}" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`);
    zip.file('xl/workbook.xml',wb);zip.file('xl/_rels/workbook.xml.rels',rels);zip.file('[Content_Types].xml',types);
  }
  const data=table.map((row,r)=>`<row r="${r+1}">${row.map((v,c)=>cellXml(XLSX.utils.encode_cell({r,c}),v)).join('')}</row>`).join('');
  zip.file(path,`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="A1:G${table.length}"/><sheetData>${data}</sheetData></worksheet>`);
  return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
}
