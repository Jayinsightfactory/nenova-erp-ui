import JSZip from 'jszip';

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const escapeXml = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[character]));
const attribute = (tag, name) => tag.match(new RegExp(`(?:^|\\s)${name}=["']([^"']*)["']`))?.[1];
const columnName = index => { let result=''; for(let number=index+1;number;number=Math.floor((number-1)/26)) result=String.fromCharCode(65+(number-1)%26)+result; return result; };

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
  const rowTemplate=number=>original.match(new RegExp(`<row\\b[^>]*\\br=["']${number}["'][^>]*>[\\s\\S]*?<\\/row>`))?.[0]||'';
  const style=(number,column)=>attribute(rowTemplate(number).match(new RegExp(`<c\\b[^>]*\\br=["']${column}${number}["'][^>]*>`))?.[0]||'','s')||'0';
  const height=number=>attribute(rowTemplate(number).split('>')[0],'ht');
  const cell=(address,value,styleId)=>{
    if(value==null) return `<c r="${address}" s="${styleId}"/>`;
    if(typeof value==='number') { if(!Number.isFinite(value)) throw new Error('다운로드 수량에 잘못된 숫자가 있습니다.'); return `<c r="${address}" s="${styleId}"><v>${value}</v></c>`; }
    return `<c r="${address}" s="${styleId}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
  };
  const generated=[]; const merges=[]; let rowNumber=0;
  const textLines=(value,capacity)=>String(value??'').split(/\r?\n/).reduce((sum,line)=>sum+Math.max(1,Math.ceil([...line].reduce((length,char)=>length+(char.charCodeAt(0)>255?2:1),0)/capacity)),0);
  const addRow=(values,templateNumber)=>{
    rowNumber++;
    const baseHeight=Number(height(templateNumber))||21;
    const rowHeight=templateNumber===3 ? Math.max(baseHeight,21*textLines(values[1],28))
      : templateNumber===2 ? Math.max(baseHeight,21*Math.max(...values.slice(3).map(value=>textLines(value,12)))) : baseHeight;
    generated.push(`<row r="${rowNumber}" ht="${rowHeight}" customHeight="1">${values.map((value,index)=>cell(`${columnName(index)}${rowNumber}`,value,style(templateNumber,templateNumber===2&&index>=3?'D':columnName(Math.min(index,15))))).join('')}</row>`);
    return rowNumber;
  };
  const count=columns.length+3;
  addRow([title,...Array(count-1).fill(null)],1); merges.push(`A1:${columnName(count-1)}1`);
  const groups=new Map();
  for(const row of rows) {
    if(!row.name) throw new Error('품목 이름이 없는 행은 다운로드할 수 없습니다.');
    const category=String(row.category||'기타');
    if(!groups.has(category)) groups.set(category,[]); groups.get(category).push(row);
  }
  for(const [category,items] of groups) {
    const start=addRow([category,'품목','단위',...columns.map(column=>column.label)],2);
    const units=new Map();
    for(const item of items) {
      const values=columns.map(column=>item.values?.[column.key]??null);
      addRow([null,item.name,item.unit||'',...values],3);
      const unit=String(item.unit||'');
      if(!units.has(unit)) units.set(unit,columns.map(()=>({total:0,known:true})));
      values.forEach((value,index)=>{ const state=units.get(unit)[index]; if(typeof value==='number'&&Number.isFinite(value)) state.total+=value; else state.known=false; });
    }
    for(const [unit,totals] of units) addRow([null,'합계',unit,...totals.map(state=>state.known?Math.round(state.total*1000)/1000:null)],27);
    merges.push(`A${start}:A${rowNumber}`);
    addRow(Array(count).fill(null),28);
  }
  const originalColumns=[...original.matchAll(/<col\b[^>]*\/>/g)];
  const width=index=>attribute(originalColumns.find(match=>Number(attribute(match[0],'min'))<=index+1&&Number(attribute(match[0],'max'))>=index+1)?.[0]||'','width')||'14.625';
  const cols=Array.from({length:count},(_,index)=>`<col min="${index+1}" max="${index+1}" width="${width(Math.min(index,15))}" customWidth="1"/>`).join('');
  const pageMargins=original.match(/<pageMargins\b[^>]*\/>/)?.[0]||'';
  const pageSetup=original.match(/<pageSetup\b[^>]*\/>/)?.[0]?.replace(/\s+r:id=["'][^"']*["']/g,'')||'';
  const result=new JSZip();
  result.file('xl/styles.xml',await styles.async('uint8array'));
  const theme=source.file('xl/theme/theme1.xml'); if(theme) result.file('xl/theme/theme1.xml',await theme.async('uint8array'));
  result.file('xl/worksheets/sheet1.xml',`<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="${MAIN}"><dimension ref="A1:${columnName(count-1)}${rowNumber}"/><sheetViews><sheetView workbookViewId="0"><pane xSplit="3" ySplit="2" topLeftCell="D3" activePane="bottomRight" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/><cols>${cols}</cols><sheetData>${generated.join('')}</sheetData><mergeCells count="${merges.length}">${merges.map(ref=>`<mergeCell ref="${ref}"/>`).join('')}</mergeCells>${pageMargins}${pageSetup}</worksheet>`);
  const safeName=String(sheetName).replace(/[\\/?*\[\]:]/g,' ').slice(0,31)||'주광 발주내역';
  result.file('xl/workbook.xml',`<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="${MAIN}" xmlns:r="${REL}"><sheets><sheet name="${escapeXml(safeName)}" sheetId="1" r:id="rId1"/></sheets><calcPr calcMode="auto"/></workbook>`);
  result.file('xl/_rels/workbook.xml.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/styles" Target="styles.xml"/>${theme?`<Relationship Id="rId3" Type="${REL}/theme" Target="theme/theme1.xml"/>`:''}</Relationships>`);
  result.file('_rels/.rels',`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  result.file('[Content_Types].xml',`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${theme?'<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>':''}</Types>`);
  return result.generateAsync({type:'uint8array',compression:'DEFLATE'});
}
