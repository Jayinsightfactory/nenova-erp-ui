import JSZip from 'jszip';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escapeXml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));
const attribute = (tag, name) => tag.match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`))?.[1];
const columnName = index => { let result=''; for(let number=index+1;number;number=Math.floor((number-1)/26)) result=String.fromCharCode(65+(number-1)%26)+result; return result; };
const roleForKind=kind=>['dayTotal','sum01','sum02','total'].includes(kind)?'sum'
  :['remaining01','remaining02','remaining'].includes(kind)?'balance':kind==='change'?'change':['initial01','initial02'].includes(kind)?'baseline':null;
const roleColors={sum:'E7F0FF',balance:'E6F4EA',change:'FFF2CC',baseline:'FFF2CC',subtotal:'C9DDF3'};

function workbookRoleStyles(xml) {
  const xfs=xml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/);
  const fills=xml.match(/<fills\b[^>]*>([\s\S]*?)<\/fills>/);
  if(!xfs || !fills) throw new Error('저장된 발주 양식의 기본 셀 서식을 확인할 수 없습니다.');
  const bases=xfs[1].match(/<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g)||[];
  const originalFills=fills[1].match(/<fill\b[^>]*?(?:\/>|>[\s\S]*?<\/fill>)/g)||[];
  const appendedXfs=[],appendedFills=[],fillIds=new Map(),cache=new Map();
  const styleId=(base,role)=>{
    if(!role) return base;
    const key=`${base}|${role}`;
    if(cache.has(key)) return cache.get(key);
    const source=bases[Number(base)];
    if(!source) throw new Error('저장된 발주 양식의 셀 서식 번호를 확인할 수 없습니다.');
    if(!fillIds.has(role)) {
      fillIds.set(role,originalFills.length+appendedFills.length);
      appendedFills.push(`<fill><patternFill patternType="solid"><fgColor rgb="FF${roleColors[role]}"/><bgColor indexed="64"/></patternFill></fill>`);
    }
    const clone=source.replace(/^<xf\b[^>]*>/,opening=>{
      const clean=opening.replace(/\s+(?:fillId|applyFill)=["'][^"']*["']/g,'');
      return clean.replace(/\/?>$/,` fillId="${fillIds.get(role)}" applyFill="1"${clean.endsWith('/>')?'/>' :'>'}`);
    });
    const id=String(bases.length+appendedXfs.length);appendedXfs.push(clone);cache.set(key,id);return id;
  };
  const append=(section,entries,count)=>section.replace(/^<\w+\b[^>]*>/,opening=>
    opening.replace(/\s+count=["'][^"']*["']/g,'').replace(/>$/,` count="${count}">`))
    .replace(/<\/(\w+)>$/,`${entries.join('')}</$1>`);
  return {styleId,serialize:()=>xml.replace(xfs[0],()=>append(xfs[0],appendedXfs,bases.length+appendedXfs.length))
    .replace(fills[0],()=>append(fills[0],appendedFills,originalFills.length+appendedFills.length))};
}

/** Copies only formatting assets; every worksheet value comes from the full web snapshot. */
export async function buildWeekdayStyledWebWorkbook(templateBytes, {title='주광 발주내역',sheetName='주광 발주내역',columns=[],rows=[]}={}) {
  if(!Array.isArray(columns)||!Array.isArray(rows)||!columns.length||!rows.length) throw new Error('다운로드할 전체 품목과 수량을 확인하세요.');
  if(columns.length>16381||rows.length>100000) throw new Error('엑셀의 품목·열 범위를 초과했습니다.');
  const keys=new Set();
  for(const column of columns) { if(!column.key||keys.has(column.key)) throw new Error('다운로드 열이 중복되었습니다.'); keys.add(column.key); }
  const source=await JSZip.loadAsync(templateBytes);
  const workbook=await source.file('xl/workbook.xml')?.async('string');
  const relationships=await source.file('xl/_rels/workbook.xml.rels')?.async('string');
  const sheet=[...(workbook||'').matchAll(/<sheet\b[^>]*\/>/g)].find(match=>attribute(match[0],'name')==='주광 카장수알 38-39차 발주 수량');
  const relation=[...(relationships||'').matchAll(/<Relationship\b[^>]*\/>/g)].find(match=>attribute(match[0],'Id')===attribute(sheet?.[0]||'','r:id'));
  const target=attribute(relation?.[0]||'','Target');
  if(!target) throw new Error('저장된 발주 양식의 디자인을 확인할 수 없습니다.');
  const path=target.startsWith('/')?target.slice(1):`xl/${target}`;
  const original=await source.file(path)?.async('string');
  const styles=source.file('xl/styles.xml');
  if(!original||!styles) throw new Error('저장된 발주 양식의 셀 서식이 없습니다.');
  const roleStyles=workbookRoleStyles(await styles.async('string'));
  const rowTemplate=number=>original.match(new RegExp(`<row\\b[^>]*\\br=["']${number}["'][^>]*>[\\s\\S]*?<\\/row>`))?.[0]||'';
  const style=(number,column)=>attribute(rowTemplate(number).match(new RegExp(`<c\\b[^>]*\\br=["']${column}${number}["'][^>]*>`))?.[0]||'','s')||'0';
  const height=number=>attribute(rowTemplate(number).split('>')[0],'ht');
  const cell=(address,value,styleId)=>{
    if(value==null || value===0) return `<c r="${address}" s="${styleId}"/>`;
    if(typeof value==='number') { if(!Number.isFinite(value)) throw new Error('다운로드 수량에 잘못된 숫자가 있습니다.'); return `<c r="${address}" s="${styleId}"><v>${value}</v></c>`; }
    return `<c r="${address}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  };
  const groupedHeaders=columns.some(column=>column.groupKey && column.groupLabel);
  // Presentation columns never change the model's quantity keys or unit buckets.
  const presentation=groupedHeaders?[{name:true,key:'first-name'},...columns.flatMap((column,index)=>[
    ...(index>0 && ['initial01','initial02'].includes(column.kind)?[{name:true,key:`name-${column.key}`}]:[]),
    {...column,sourceIndex:index}])]:null;
  const sourceColumn=index=>groupedHeaders?(index===0?0:presentation[index-1]?.name?1:Math.min(presentation[index-1].sourceIndex+3,15)):Math.min(index,15);
  const generated=[]; const merges=[]; let rowNumber=0;
  const textLines=(value,capacity)=>String(value??'').split(/\r?\n/).reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].reduce((length,char)=>length+(char.charCodeAt(0)>255?2:1),0)/capacity)),0);
  const addRow=(values,templateNumber)=>{
    rowNumber++;
    const baseHeight=Number(height(templateNumber))||21;
    const rowHeight=templateNumber===3 ? Math.max(baseHeight,21*textLines(values[1],28))
      : templateNumber===2 ? Math.max(baseHeight,21*Math.max(...values.slice(3).map(value=>textLines(value,12)))) : baseHeight;
    generated.push(`<row r="${rowNumber}" ht="${rowHeight}" customHeight="1">${values.map((value,index)=>{
      const originalIndex=sourceColumn(index);
      const base=style(templateNumber,templateNumber===2&&originalIndex>=3?'D':columnName(originalIndex));
      const kind=groupedHeaders?presentation[index-1]?.kind:columns[index-3]?.kind;
      const role=templateNumber===27?'subtotal':(templateNumber===2||templateNumber===3)?roleForKind(kind):null;
      return cell(`${columnName(index)}${rowNumber}`,value,roleStyles.styleId(base,role));
    }).join('')}</row>`);
    return rowNumber;
  };
  const count=groupedHeaders?presentation.length+1:columns.length+3;
  if(count>16384) throw new Error('엑셀의 품목·열 범위를 초과했습니다.');
  addRow([title,...Array(count-1).fill(null)],1); merges.push(`A1:${columnName(count-1)}1`);
  const groups=new Map();
  for(const row of rows) {
    if(!row.name) throw new Error('품목 이름이 없는 행은 다운로드할 수 없습니다.');
    const category=String(row.category||'기타');
    if(!groups.has(category)) groups.set(category,[]); groups.get(category).push(row);
  }
  for(const [category,items] of groups) {
    const headerColumns=groupedHeaders?presentation:columns;
    const start=addRow([category,...(groupedHeaders?[]:['품목','단위']),...headerColumns.map((column,index)=>column.name?'품목':groupedHeaders && column.groupKey ? headerColumns[index-1]?.groupKey===column.groupKey?null:column.groupLabel : column.label)],2);
    if(groupedHeaders) {
      const lower=addRow([null,...presentation.map(column=>column.groupKey?column.label:null)],2);
      for(let index=0;index<presentation.length;) {
        const column=presentation[index],first=columnName(index+1);
        if(!column.groupKey) {merges.push(`${first}${start}:${first}${lower}`);index++;continue;}
        let end=index;
        while(end+1<presentation.length && presentation[end+1].groupKey===column.groupKey) end++;
        if(end>index) merges.push(`${first}${start}:${columnName(end+1)}${start}`);
        index=end+1;
      }
    }
    const units=new Map();
    for(const item of items) {
      const values=columns.map(column=>item.values?.[column.key]??null);
      addRow(groupedHeaders?[null,...presentation.map(column=>column.name?item.name:values[column.sourceIndex])]:[null,item.name,item.unit||'',...values],3);
      const unit=String(item.unit||'');
      if(!units.has(unit)) units.set(unit,columns.map(()=>({total:0,known:true})));
      values.forEach((value,index)=>{ const state=units.get(unit)[index]; if(typeof value==='number'&&Number.isFinite(value)) state.total+=value; else state.known=false; });
    }
    for(const [unit,totals] of units) {
      const values=totals.map(state=>state.known?Math.round(state.total*1000)/1000:null);
      addRow(groupedHeaders?[null,...presentation.map(column=>column.name?'합계':values[column.sourceIndex])]:[null,'합계',unit,...values],27);
    }
    merges.push(`A${start}:A${rowNumber}`);
    addRow(Array(count).fill(null),28);
  }
  const originalColumns=[...original.matchAll(/<col\b[^>]*\/>/g)];
  const width=index=>attribute(originalColumns.find(match=>Number(attribute(match[0],'min'))<=index+1&&Number(attribute(match[0],'max'))>=index+1)?.[0]||'','width')||'14.625';
  const cols=Array.from({length:count},(_,index)=>`<col min="${index+1}" max="${index+1}" width="${width(sourceColumn(index))}" customWidth="1"/>`).join('');
  const pageMargins=original.match(/<pageMargins\b[^>]*\/>/)?.[0]||'';
  const pageSetup=original.match(/<pageSetup\b[^>]*\/>/)?.[0]?.replace(/\s+r:id=["'][^"']*["']/g,'')||'';
  const result=new JSZip();
  result.file('xl/styles.xml',roleStyles.serialize());
  const theme=source.file('xl/theme/theme1.xml'); if(theme) result.file('xl/theme/theme1.xml',await theme.async('uint8array'));
  const headerEnd=groupedHeaders?3:2;
  result.file('xl/worksheets/sheet1.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN}"><dimension ref="A1:${columnName(count-1)}${rowNumber}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="${groupedHeaders?2:3}" ySplit="${headerEnd}" topLeftCell="${groupedHeaders?'C':'D'}${headerEnd+1}" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${generated.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>${pageMargins}${pageSetup}</worksheet>`);
  const safeName=String(sheetName).replace(/[\\/?*\[\]:]/g,' ').slice(0,31)||'주광 발주내역';
  const quotedName=`'${safeName.replace(/'/g,"''")}'`;
  result.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${escapeXml(safeName)}" sheetId="1" r:id="rId1"/></sheets><definedNames><definedName name="_xlnm.Print_Titles" localSheetId="0">${escapeXml(quotedName)}!$1:$${headerEnd}</definedName><definedName name="_xlnm.Print_Area" localSheetId="0">${escapeXml(quotedName)}!$A$1:$${columnName(count-1)}$${rowNumber}</definedName></definedNames><calcPr calcMode="auto"/></workbook>`);
  result.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>${theme?`<Relationship Id="rId3" Type="${REL}/theme" Target="theme/theme1.xml"/>`:''}</Relationships>`);
  result.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  result.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${theme?'<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>':''}</Types>`);
  return result.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
