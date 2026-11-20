import * as XLSX from 'xlsx';

const historyLimit = 5;
const prefix = 'nenova.country-download.v1.';
export const countryDownloadEvent = 'nenova-country-download-done';

export async function downloadHistoryKey(user, context, filename) {
  if (!user || !context || !filename) return '';
  const scope = JSON.stringify([user,context.country,String(context.year),context.week,filename]);
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(scope));
  return prefix + [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2,'0')).join('');
}

export function orderWorkbookRows(workbook, unit = '') {
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet || !sheet['!ref']) throw Error('비교할 발주서 시트가 없습니다.');
  const range = XLSX.utils.decode_range(sheet['!ref']);
  if (range.e.r > 10000 || range.e.c > 256) throw Error('비교할 발주서 범위가 너무 큽니다.');
  const table = XLSX.utils.sheet_to_json(sheet,{header:1,raw:true,defval:null,blankrows:true});
  const headings = table[2] || [];
  const unitColumn = headings.indexOf('단위');
  const totalColumn = headings.findIndex(value => /^(합계|Total\b)/i.test(String(value || '')));
  if (totalColumn < 0 && !/^(Pedido inicial|Tallos|Bunches)$/i.test(String(headings[1] || ''))) {
    throw Error('비교할 발주서 양식을 확인하세요.');
  }
  const quantities = new Map();
  for (const row of table.slice(3)) {
    const name = String(row[0] ?? '').trim();
    if (/^(TOTAL|합계)(?:\s|$)/i.test(name)) break;
    const quantity = row[totalColumn < 0 ? 1 : totalColumn];
    if (!name || !Number.isFinite(quantity)) continue;
    const rowUnit = unitColumn >= 0 ? String(row[unitColumn] || '') : unit;
    if (unitColumn >= 0 && !rowUnit) continue;
    const key = JSON.stringify([name,rowUnit]);
    const total = (quantities.get(key)?.quantity || 0) + quantity;
    quantities.set(key,{name,unit:rowUnit,quantity:total});
  }
  return [...quantities.values()];
}

export function compareOrderDownload(previous,current) {
  const id = row => JSON.stringify([row.name,row.unit]);
  const before = new Map(previous.map(row => [id(row),row]));
  const after = new Map(current.map(row => [id(row),row]));
  return [...new Set([...before.keys(),...after.keys()])].flatMap(key => {
    const old = before.get(key), next = after.get(key);
    if (old && next && old.quantity === next.quantity) return [];
    return [{...(next || old),before:old?.quantity ?? null,after:next?.quantity ?? null}];
  });
}

export function readOrderDownloads(storage,key) {
  if (!key) return [];
  const records = JSON.parse(storage.getItem(key) || '[]');
  if (!Array.isArray(records)) throw Error('저장된 비교 이력을 읽지 못했습니다.');
  return records;
}

export async function appendOrderDownload(storage,key,record,locks) {
  if (!key) return [];
  const append = () => {
    const records = [record,...readOrderDownloads(storage,key)].slice(0,historyLimit);
    storage.setItem(key,JSON.stringify(records));
    return records;
  };
  return locks ? locks.request(key,append) : append();
}

export async function saveOrderFile({bytes,filename,document,desktop,openPicker}) {
  if (!desktop && openPicker) {
    const handle = await openPicker({suggestedName:filename,types:[{description:'Excel 통합 문서',accept:{
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':['.xlsx'],
    }}]});
    const writer = await handle.createWritable();
    try { await writer.write(bytes); await writer.close(); }
    catch (error) { await writer.abort().catch(()=>{}); throw error; }
    return 'completed';
  }
  const view = document.defaultView;
  const url = view.URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  let result, removeListener = ()=>{};
  if (desktop) result = new Promise(resolve => {
    const callback = event => {
      if (event.detail?.url !== url) return;
      removeListener();
      resolve(event.detail.status);
    };
    const timeout = view.setTimeout(()=>{ removeListener(); resolve('unverified'); },120000);
    removeListener = () => { view.clearTimeout(timeout); view.removeEventListener(countryDownloadEvent,callback); };
    view.addEventListener(countryDownloadEvent,callback);
  });
  try { document.body.appendChild(anchor); anchor.click(); }
  catch (error) { removeListener(); throw error; }
  finally { anchor.remove(); view.setTimeout(()=>view.URL.revokeObjectURL(url),1000); }
  return result || 'requested';
}
