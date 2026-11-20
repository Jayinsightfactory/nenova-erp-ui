import { useEffect, useMemo, useState } from 'react';
import { readPedidosWorkbook } from '../../lib/importPedidos';
import { appendOrderDownload, compareOrderDownload, downloadHistoryKey, orderWorkbookRows, readOrderDownloads } from '../../lib/countryOrderDownloadHistory';

const displayValue = value => value == null ? '—' : value.toLocaleString('ko-KR',{maximumFractionDigits:8});
const displayTime = at => new Date(at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'});

export default function CountryDownloadComparison({userId, context, output, revision, currentEta}) {
  const [records,setRecords] = useState([]);
  const [selected,setSelected] = useState('');
  const [error,setError] = useState('');
  const [importOpen,setImportOpen] = useState(false);
  const [importing,setImporting] = useState(false);
  const [chosen,setChosen] = useState(null);
  const [verifiedYear,setVerifiedYear] = useState(false);
  const current = useMemo(()=>{
    try { return orderWorkbookRows(output.workbook,output.unit); } catch { return []; }
  },[output]);
  useEffect(()=>{
    let ignore = false;
    async function load() {
      try {
        const key=await downloadHistoryKey(userId,context,output.filename);
        const next=readOrderDownloads(localStorage,key);
        if (!ignore) setRecords(next);
      } catch (failure) { if (!ignore) setError(failure.message); }
    }
    void load();
    return ()=>{ignore=true;};
  },[userId,context.country,context.year,context.week,output.filename,revision]);
  const baseline=records.find(record=>record.id===selected) || records[0];
  const differences=baseline ? compareOrderDownload(baseline.rows,current) : [];

  async function importFile() {
    if (!chosen || importing) return;
    setError('');setImporting(true);
    try {
      if (chosen.size>20*1024*1024) throw Error('20MB 이하 발주서 파일을 선택하세요.');
      if (chosen.name.replace(/ \(\d+\)(?=\.xlsx$)/i,'')!==output.filename) throw Error('현재 미리보기와 같은 파일명인 발주서를 선택하세요.');
      const workbook=readPedidosWorkbook(await chosen.arrayBuffer());
      const title=String(workbook.Sheets[workbook.SheetNames[0]]?.A1?.v || '');
      if (!title.includes(`Semana ${context.week}차`)) throw Error('파일의 세부차수가 현재 선택과 다릅니다.');
      const embeddedYear=workbook.Custprops?.NenovaOrderYear ?? title.split('Semana ')[0].match(/\b(20\d{2})\b/)?.[1];
      const embeddedCountry=workbook.Custprops?.NenovaOrderCountry;
      if (embeddedCountry && embeddedCountry!==context.country) throw Error('파일의 국가가 현재 선택과 다릅니다.');
      if (embeddedYear && String(embeddedYear)!==String(context.year)) throw Error('파일의 발주 연도가 현재 선택과 다릅니다.');
      if (!embeddedYear && !verifiedYear) throw Error('파일에 발주 연도가 없습니다. 원본 연도를 직접 확인하고 체크하세요.');
      const etaParts=title.match(/ETA\s*\(\s*(\d{4})[-,\/](\d{1,2})[-,\/](\d{1,2})/);
      const eta=etaParts ? [etaParts[1],etaParts[2].padStart(2,'0'),etaParts[3].padStart(2,'0')].join('-') : '';
      const record={id:crypto.randomUUID(),at:new Date().toISOString(),eta,rows:orderWorkbookRows(workbook,output.unit),source:'imported'};
      const key=await downloadHistoryKey(userId,context,output.filename);
      setRecords(await appendOrderDownload(localStorage,key,record,navigator.locks));
      setSelected(record.id);setChosen(null);setVerifiedYear(false);setImportOpen(false);
    } catch (failure) { setError(failure.message); }
    finally {setImporting(false);}
  }

  return <section className="pedidos-download-comparison" aria-label="이전 다운로드와 비교">
    <h5>이전 다운로드와 비교</h5>
    <p>같은 국가·연도·세부차수·파일의 품목·단위별 합계와 ETA를 비교합니다. 이 기기의 현재 계정에 비교 이력 5건을 보관합니다.</p>
    {!userId ? <p>계정을 확인하면 비교 이력이 표시됩니다.</p> : baseline ? <>
      <label>비교할 이전본<select value={baseline.id} onChange={event=>setSelected(event.target.value)}>
        {records.map(record=><option key={record.id} value={record.id}>{displayTime(record.at)} · {record.source==='imported'?'파일 불러옴':'저장 완료'}</option>)}
      </select></label>
      <p>이전 ETA <strong>{baseline.eta || '미기재'}</strong> · 현재 기본 ETA <strong>{currentEta || '입력 필요'}</strong></p>
      {differences.length ? <div className="pedidos-preview">
        <table aria-label="이전과 현재 수량 차이"><thead><tr><th scope="col">품목</th><th scope="col">단위</th><th scope="col">이전</th><th scope="col">현재</th><th scope="col">차이</th></tr></thead>
          <tbody>{differences.map(row=><tr key={JSON.stringify([row.name,row.unit])}><th scope="row">{row.name}</th><td>{row.unit}</td>
            <td>{displayValue(row.before)}</td><td>{displayValue(row.after)}</td><td>{row.before==null?'신규':row.after==null?'제외':displayValue(row.after-row.before)}</td></tr>)}</tbody>
        </table>
      </div> : <p>품목·단위별 합계가 이전본과 같습니다.</p>}
    </> : <p>이 범위에 보관된 다운로드가 없습니다.</p>}
    <button type="button" disabled={!userId} className="pedidos-secondary" aria-expanded={importOpen} onClick={()=>setImportOpen(value=>!value)}>기존 발주서 불러오기</button>
    {importOpen && <div className="pedidos-fields">
      <label>이전 XLSX 파일<input type="file" accept=".xlsx" onChange={event=>{setChosen(event.target.files[0]);setVerifiedYear(false);}} /></label>
      <label><input type="checkbox" checked={verifiedYear} onChange={event=>setVerifiedYear(event.target.checked)}/>이전 파일이 {context.year}년 발주서인지 확인했습니다</label>
      <button type="button" disabled={!chosen || importing} onClick={importFile}>이전본으로 비교</button>
    </div>}
    {error && <p role="alert" className="pedidos-error">{error}</p>}
  </section>;
}
