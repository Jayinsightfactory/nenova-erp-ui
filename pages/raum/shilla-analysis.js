import { useEffect, useMemo, useRef, useState } from 'react';
import Head from 'next/head';
import ShillaPeriodAnalysis from '../../components/ShillaPeriodAnalysis';
import { receiptGroups, validateScope } from '../../lib/shillaReconciliation';
import { shillaDefaultRange } from '../../lib/shillaCheck';
import ShillaCheckSummary from '../../components/ShillaCheckSummary';

const fmt = v => v == null ? '자료 없음' : Number(v).toLocaleString('ko-KR',{maximumFractionDigits:3});
function bridge(action,range={}) {
  return new Promise((resolve,reject)=>{
    const id=crypto.randomUUID();
    const cleanup=()=>{clearTimeout(timer);window.removeEventListener('message',receive);};
    const receive=event=>{
      if(event.source!==window||event.origin!==window.location.origin||event.data?.type!=='NENOVA_SHILLA_RESULT'||event.data.id!==id) return;
      cleanup();event.data.success?resolve(event.data):reject(new Error(event.data.error));
    };
    const timer=setTimeout(()=>{cleanup();reject(new Error(action==='ping'?'신라 연결 프로그램이 필요합니다. 아래 연결 안내를 확인하세요.':'신라 조회가 끝나지 않았습니다. 로그인과 연결 상태를 확인하세요.'));},action==='ping'?2000:600000);
    window.addEventListener('message',receive);
    window.postMessage({type:'NENOVA_SHILLA_REQUEST',id,action,...range},window.location.origin);
  });
}
function SourceCell({data}) {
  if(!data) return <td>자료 없음</td>;
  return <td><b>{fmt(data.qty)}</b><br/>매출단가 {data.prices.map(fmt).join(' / ')}{data.costPrices&&<><br/>매입단가 {data.costPrices.map(fmt).join(' / ')}</>}<br/>금액 <b>{fmt(data.amount)}</b>
    <details><summary>원본 {data.count}행</summary>{data.rows.map((r,i)=><p key={i}>{r.source} · {r.name}<br/>원본 [{r.originalUnit??r.unit}] {fmt(r.originalQty??r.qty)} × {fmt(r.originalPrice??r.price)} = {fmt(r.originalAmount??r.amount)}{r.costPrice!==undefined?<><br/>매입단가 {fmt(r.costPrice)}</>:null}{r.factor!==undefined?<><br/>비교 [{r.unit}] {fmt(r.qty)} × {fmt(r.price)} (수량 ×{r.factor})</>:null}{r.vatDivisor===1.1?<><br/>공급가액 환산: 단가 {fmt(r.price)} · 금액 {fmt(r.amount)} (÷1.1)</>:null}</p>)}</details>
  </td>;
}
export default function ShillaAnalysis({workspace=false}) {
  const [year,setYear]=useState('2026'),[file,setFile]=useState(null),[meta,setMeta]=useState(null),[periods,setPeriods]=useState([]);
  const [from,setFrom]=useState(''),[to,setTo]=useState(''),[busy,setBusy]=useState(''),[error,setError]=useState('');
  const [portal,setPortal]=useState(null),[mappings,setMappings]=useState({}),[gross,setGross]=useState(false),[result,setResult]=useState(null);
  const [onlyIssues,setOnlyIssues]=useState(true),[search,setSearch]=useState('');
  const alive=useRef(true);
  const running=useRef(false);
  useEffect(()=>{if(workspace)setYear(new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'}).slice(0,4));},[workspace]);
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
  useEffect(()=>{
    const back=e=>{if(result&&!busy){e.preventDefault();setResult(null);setPortal(null);}};
    window.addEventListener('nenova:menu-back-request',back);
    return()=>window.removeEventListener('nenova:menu-back-request',back);
  },[result,busy]);
  const groups=useMemo(()=>receiptGroups(portal?.rows || []),[portal]);
  const invalidate=()=>{setResult(null);setError('');};
  async function api(mode,payload) {
    const body=new FormData();if(file)body.append('file',file);body.append('sourceMode',workspace&&!file?'stored':'excel');body.append('year',year);body.append('mode',mode);
    if(payload) body.append('payload',JSON.stringify(payload));
    const response=await fetch('/api/raum/shilla-analysis',{method:'POST',body});
    const text=await response.text();let data;
    try {data=JSON.parse(text);} catch {throw new Error(response.status===413?'원본 파일 또는 입고자료가 너무 큽니다. 기간을 줄여주세요.':'분석 서버가 응답하지 않았습니다. 다시 시도하세요.');}
    if(!response.ok||!data.success) throw new Error(data.error||'분석에 실패했습니다.');
    return data;
  }
  async function prepare() {
    if(running.current)return;running.current=true;
    setBusy('엑셀과 DB 확인 중');invalidate();setMeta(null);setPortal(null);setMappings({});
    try { const data=await api('prepare');if(!alive.current)return;setMeta(data);setPeriods(data.periods.map(p=>p.period));
      const dates=data.periods.map(p=>p.date).filter(Boolean).sort();
      const first=dates[0]||`${year}-01-01`,last=dates.at(-1)||`${year}-12-31`;
      const monthEnd=new Date(Date.UTC(Number(last.slice(0,4)),Number(last.slice(5,7)),0)).toISOString().slice(0,10);
      const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'});
      setFrom(`${first.slice(0,7)}-01`);setTo(monthEnd>today&&today.slice(0,4)===year?today:monthEnd);
    } catch(e){if(alive.current)setError(e.message);} finally {running.current=false;if(alive.current)setBusy('');}
  }
  async function startWork() {
    if(running.current)return;running.current=true;
    invalidate();setPortal(null);setBusy('1/3 · 비교 기준과 저장된 품목 연결 확인 중');
    try {
      const prepared=await api('prepare');if(!alive.current)return;
      const scope=meta?{from,to,periods}:{...shillaDefaultRange(prepared.periods,year,new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Seoul'})),periods:prepared.periods.map(p=>p.period)};
      validateScope({year,...scope});setMeta(prepared);setPeriods(scope.periods);setFrom(scope.from);setTo(scope.to);
      setBusy('2/3 · 로그인된 신라 입고실적을 월별 순차 조회 중');
      await bridge('ping');const data=await bridge('receipts',{from:scope.from,to:scope.to});if(!alive.current)return;setPortal(data);
      setBusy('3/3 · 최신 전산 분배·판매요청·손익과 신라 입고 대조 중');
      const output=await api('compare',{...scope,receipts:data.rows,source:data.source,mappings,excelGross:gross});
      if(alive.current){setResult(output);setMappings(previous=>({...output.suggestedMappings,...previous}));}
    } catch(e){if(alive.current)setError(e.message);} finally {running.current=false;if(alive.current)setBusy('');}
  }
  async function analyze(reuse=false) {
    if(running.current)return;running.current=true;
    invalidate();setBusy(reuse?'세 자료 비교 중':'신라 브라우저 연결 확인 중');
    try {
      validateScope({year,from,to,periods});
      let data=portal;
      if(!reuse) {await bridge('ping');setBusy('신라 입고실적 조회 중 · 월별로 순차 조회합니다');data=await bridge('receipts',{from,to});if(!alive.current)return;setPortal(data);}
      if(!data) throw new Error('입고실적을 먼저 조회하세요.');
      setBusy('DB 최신값과 원본 엑셀·신라 입고 비교 중');
      const output=await api('compare',{from,to,periods,receipts:data.rows,source:data.source,mappings,excelGross:gross});
      if(alive.current){setResult(output);setMappings(previous=>({...output.suggestedMappings,...previous}));}
    } catch(e){if(alive.current)setError(e.message);} finally {running.current=false;if(alive.current)setBusy('');}
  }
  const updateMapping=(key,patch)=>{setMappings(previous=>({...previous,[key]:{factor:1,...previous[key],...patch}}));invalidate();};
  const visible=(result?.rows||[]).filter(r=>(!onlyIssues||r.status!=='일치')&&r.name.toLowerCase().includes(search.toLowerCase()));
  return <main className="shilla-analysis">
    <Head><title>{workspace?'신라 입고·견적·손익 확인':'신라호텔 입고 조회·분석'} | 네노바</title></Head>
    <a href="/raum/pnl">손익계산서로 돌아가기</a>
    <h1>{workspace?'신라 입고·견적·손익 확인':'신라호텔 입고 조회·분석'}</h1>
    <p>실제 전산 분배, 엑셀 손익, 신라 입고를 출고 차수·입고일·월 귀속으로 대조합니다. 금액은 매출 공급가액 기준입니다.</p>
    <fieldset disabled={!!busy}><legend>1. 비교할 원본</legend><div className="controls">
      <label>결산 연도 <input aria-label="결산 연도" type="number" min="2000" max="2099" value={year} onChange={e=>{setYear(e.target.value);setMappings({});setMeta(null);setPortal(null);invalidate();}}/></label>
      <label>손익계산서 원본 엑셀{workspace?' (선택)':''} <input type="file" accept=".xlsx,.xls" onChange={e=>{setFile(e.target.files?.[0]||null);setMappings({});setMeta(null);setPortal(null);invalidate();}}/></label>
      {workspace&&<button className="primary" onClick={startWork}>작업 시작</button>}
      <button disabled={!workspace&&!file} onClick={prepare}>{workspace?'기간·차수 먼저 선택':'원본·DB 확인'}</button>
      {workspace&&<p>같은 Chrome에서 신라 입고실적을 열어 주세요. 작업 시작 → 월별 입고 조회 → 자동 대조. 엑셀 미첨부 시 저장된 신라 손익자료를 기준으로 비교합니다.</p>}
    </div></fieldset>
    {meta&&<details open={!workspace||!result}><summary>조회 범위 · {from} ~ {to} · {periods.length}개 차수</summary><fieldset disabled={!!busy}><legend>2. 차수와 신라 입고기간</legend>
      <p>{meta.fileName} · DB {meta.dbCount}행 · 원본 {meta.periods.length}개 차수</p>
      <p>엑셀 차수와 신라 입고일은 서로 다른 기준입니다. 선택한 차수에 해당하는 입고기간을 확인하세요. 제목에서 읽은 날짜는 제안값입니다.</p>
      <div className="controls"><button onClick={()=>{setPeriods(meta.periods.map(p=>p.period));invalidate();}}>전체 차수</button><button onClick={()=>{setPeriods([]);invalidate();}}>선택 해제</button></div>
      <div className="periods">{meta.periods.map(p=><label key={p.period}><input type="checkbox" checked={periods.includes(p.period)} onChange={e=>{setPeriods(old=>e.target.checked?[...old,p.period]:old.filter(v=>v!==p.period));invalidate();}}/>{p.period}차{p.date?` (${p.date.slice(5)})`:''}</label>)}</div>
      <div className="controls"><label>입고 시작일 <input type="date" value={from} onChange={e=>{setFrom(e.target.value);setPortal(null);invalidate();}}/></label><label>입고 종료일 <input type="date" value={to} onChange={e=>{setTo(e.target.value);setPortal(null);invalidate();}}/></label>
      <label>엑셀·DB 매출단가 기준 <select value={gross?'gross':'net'} onChange={e=>{setGross(e.target.value==='gross');invalidate();}}><option value="net">공급가액 (부가세 별도)</option><option value="gross">부가세 포함 (÷1.1로 비교)</option></select></label>
      <button className="primary" disabled={!periods.length} onClick={()=>workspace?startWork():analyze(false)}>{workspace?'선택 범위로 작업 시작':'조회·분석'}</button></div>
      <p>신라에 로그인한 같은 Chrome에서 사용하세요. 입고실적 탭이 열려 있어야 합니다.</p>
    </fieldset></details>}
    <details className="connection"><summary>브라우저 연결 안내</summary><p>최초 한 번 전용 Chrome 확장 프로그램을 설치해야 합니다. 신라 입고실적 조회와 네노바웹 분석 화면만 연결하며 로그인 정보는 읽지 않습니다.</p><p><a href="/shilla-connector.zip" download>연결 프로그램 다운로드</a> → 압축 해제 → Chrome 확장 프로그램의 ‘압축해제된 확장 프로그램을 로드’에서 폴더 선택 → 이 화면 새로고침.</p><p>입고실적 조회만 수행합니다. 신라의 업체확인·저장 기능을 실행하지 않습니다.</p></details>
    {busy&&<p role="status" className="notice">{busy}</p>}{error&&<p role="alert" className="error">{error}</p>}
    {workspace&&result&&<ShillaCheckSummary result={result} from={from} to={to}/>}
    {portal&&<details open={!result || !!result.unmatched.length}><summary>3. 신라 자재와 손익 품목 연결 ({groups.length}개)</summary>
      <p>저장된 전산 품목 연결로 같은 품목의 표기를 함께 비교합니다. 안시리움의 단 표기는 사용자 확인에 따라 송이(신라 EA)와 1:1로 비교합니다. 포장 수량이 확인되지 않은 연결은 확인이 필요합니다. 수량 배수는 ‘신라 수량 × 배수 = 엑셀 단위 수량’입니다. 예: 1PK가 5송이면 배수 5. 단가는 같은 배수로 나누며 금액은 보존합니다. 연결은 현재 분석에만 적용됩니다.</p>
      <fieldset disabled={!!busy}><div className="wide"><table><thead><tr><th>신라 자재 / 규격 / 단위</th><th>엑셀·DB 품목</th><th>수량 배수</th><th>단위 확인</th></tr></thead><tbody>{groups.map(g=><tr key={g.key}><td>{g.code} · {g.name}<br/>{g.spec} [{g.unit}] · {g.rows.length}행</td><td><select aria-label={`${g.name} 연결 품목`} value={mappings[g.key]?.target||''} onChange={e=>updateMapping(g.key,{target:e.target.value,unitConfirmed:false})}><option value="">정확한 이름·단위만 자동 연결</option>{meta?.targets.map(t=><option key={t.key} value={t.key}>{t.aliases?.join(' / ')||t.name} [{t.unit||'단위 없음'}]{t.prodKey?` → ${t.prodName} (#${t.prodKey})`:''}</option>)}</select>{mappings[g.key]?.reason&&<p>{mappings[g.key].reason}</p>}</td><td><input aria-label={`${g.name} 수량 배수`} type="number" min="0.000001" max="10000" step="any" value={mappings[g.key]?.factor??1} onChange={e=>updateMapping(g.key,{factor:e.target.value,unitConfirmed:false})}/></td><td><label><input type="checkbox" checked={mappings[g.key]?.unitConfirmed===true} onChange={e=>updateMapping(g.key,{unitConfirmed:e.target.checked})}/>환산 확인</label></td></tr>)}</tbody></table></div>
      <button onClick={()=>analyze(true)}>연결 적용·다시 비교</button></fieldset>
    </details>}
    {result?.periodAnalysis&&<ShillaPeriodAnalysis data={result.periodAnalysis} baselineLabel={result.sourceMode==='stored'?'저장손익':'엑셀'}/>}
    {result&&result.sourceMode!=='stored'&&<section aria-label="세 자료 비교 결과">
      <h2>{result.complete?'저장 손익·엑셀·입고 합계 일치':'저장 손익·엑셀·입고 참고 검증'}</h2>
      <p>DB 조회 {new Date(result.readAt).toLocaleString('ko-KR')} · 신라 조회 {new Date(result.receiptReadAt).toLocaleString('ko-KR')} · {from} ~ {to}</p>
      <div className="cards">{[['저장 손익',result.totals.db,result.counts.db],['엑셀',result.totals.excel,result.counts.excel],['신라 입고',result.totals.srm,result.counts.srm]].map(([label,amount,count])=><div key={label}><span>{label} · {count}행</span><strong>{fmt(amount)}원</strong></div>)}</div>
      <p>품목 일치 {result.counts.matched} · 확인 필요 {result.counts.review} · 신라 미연결 {result.unmatched.length} · 차수별 DB/엑셀 차이 {result.periodDifferences.length}</p>
      {[...result.issues,...result.sourceWarnings].length>0&&<details open><summary>원본·중복 확인 사항</summary><ul>{[...result.issues,...result.sourceWarnings].map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
      {!!result.unmatched.length&&<p className="error">미연결: {result.unmatched.map(g=>`${g.name} [${g.unit}]`).join(', ')}. 위 품목 연결에서 확인하세요.</p>}
      <div className="controls"><label><input type="checkbox" checked={onlyIssues} onChange={e=>setOnlyIssues(e.target.checked)}/>차이·누락만</label><label>품목 검색 <input value={search} onChange={e=>setSearch(e.target.value)}/></label></div>
      <div className="wide"><table><thead><tr><th>품목 / 단위</th><th>저장된 손익계산서</th><th>원본 엑셀</th><th>신라 입고</th><th>DB − 엑셀</th><th>엑셀 − 신라</th></tr></thead><tbody>{visible.map(r=><tr key={r.key} className={r.status==='일치'?'':'difference'}><th>{r.aliases?.join(' / ')||r.name}<br/>[{r.unit||'단위 없음'}]{r.prodKey&&<><br/>전산 #{r.prodKey} · {r.prodName}</>}</th><SourceCell data={r.db}/><SourceCell data={r.excel}/><SourceCell data={r.srm}/>{[r.dbExcel,r.excelSrm].map((v,i)=><td key={i}><b>{v.status}</b><br/>수량 {fmt(v.qty)}<br/>금액 {fmt(v.amount)}<br/>{v.price===true?'단가 차이':v.price===null?'단가 미확인':'단가 일치'}{v.costPrice===true?<><br/>매입단가 차이</>:null}{v.bucketDifference?<><br/>단가별 수량 차이</>:null}</td>)}</tr>)}</tbody></table></div>
      {!visible.length&&<p>현재 필터에 해당하는 품목이 없습니다.</p>}
      {!!result.periodDifferences.length&&<details open><summary>차수별 DB·엑셀 차이 (차수 간 상쇄 제외)</summary><div className="wide"><table><thead><tr><th>차수</th><th>품목</th><th>DB</th><th>엑셀</th><th>차이</th></tr></thead><tbody>{result.periodDifferences.map((r,i)=><tr key={i}><td>{r.period}</td><th>{r.name} [{r.unit}]</th><SourceCell data={r.db}/><SourceCell data={r.excel}/><td>{r.status}<br/>수량 {fmt(r.qty)}<br/>금액 {fmt(r.amount)}</td></tr>)}</tbody></table></div></details>}
    </section>}
    <style jsx>{`
      .shilla-analysis{padding:20px;color:#172b3a;max-width:1800px;margin:auto;font-size:14px}h1{font-size:25px}h2{font-size:20px}p{line-height:1.6}fieldset{border:1px solid #cbd5e1;border-radius:8px;padding:16px;margin:18px 0}legend{font-weight:700}.controls,.periods{display:flex;gap:12px;flex-wrap:wrap;align-items:center}.periods{margin:16px 0}.periods label{padding:6px;border:1px solid #dde5eb;border-radius:4px}input,select,button{font:inherit;padding:8px;border:1px solid #aab9c5;border-radius:5px;max-width:100%}input[type=number]{width:110px}input[type=checkbox]{margin-right:6px}button{background:white;cursor:pointer}button:disabled{opacity:.55;cursor:wait}.primary{background:#0f766e;color:white;border-color:#0f766e;font-weight:700}:focus-visible{outline:3px solid #2563eb;outline-offset:3px}.wide{overflow-x:auto;margin:12px 0}table{width:auto;border-collapse:collapse;min-width:900px}th,td{width:220px;max-width:390px;overflow-wrap:anywhere;padding:12px;border:1px solid #dce4e9;text-align:left;vertical-align:top;line-height:1.6}thead{background:#edf3f6}td select{max-width:390px}.difference{background:#fff9eb}.error{background:#fff0f0;border-left:4px solid #be123c;padding:12px}.notice{background:#ecfdf5;padding:12px}.cards{display:flex;flex-wrap:wrap;gap:16px}.cards>div{padding:18px;border:1px solid #cbd5e1;border-radius:8px;flex:1;min-width:200px}.cards strong{display:block;font-size:23px;margin-top:8px}details{margin:14px 0}summary{cursor:pointer;font-weight:600}.connection{background:#f5f8fa;padding:14px}@media(max-width:700px){.shilla-analysis{padding:10px}h1{font-size:21px}}
    `}</style>
    <style jsx global>{`.shilla-analysis td details{font-size:12px}.shilla-analysis td details p{border-top:1px solid #dce4e9;white-space:normal}.shilla-analysis td summary{cursor:pointer}.shilla-analysis td{min-width:145px;padding:12px;border:1px solid #dce4e9;text-align:left;vertical-align:top;line-height:1.6}`}</style>
  </main>;
}
