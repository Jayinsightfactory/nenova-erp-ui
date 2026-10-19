import {useEffect,useState} from 'react';
import {apiGet} from '../../lib/useApi';
import {historyValue} from '../../lib/productInputHistory';

export default function ProductInputHistory({product}) {
  const [rows,setRows]=useState([]),[next,setNext]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  async function load(cursor){setBusy(true);setError('');try{const data=await apiGet('/api/master/product-history',{prodKey:product?.ProdKey,before:cursor});setRows(old=>cursor?[...old,...data.rows]:data.rows);setNext(data.nextCursor);}catch(e){setError(e.message);}finally{setBusy(false);}}
  useEffect(()=>{load();},[product?.ProdKey]);
  return <section aria-label="품목 입력 히스토리" style={{padding:12,border:'1px solid #b8cadc',margin:'8px 0'}}>
    <h3>품목 입력 히스토리 · {product?.ProdName||'전체 품목'}</h3>
    <p>기록 기능 적용 이후 웹에서 저장한 내역입니다. 전산 프로그램에서 수정한 과거 내역은 소급 생성하지 않습니다.</p>
    <button type="button" disabled={busy} onClick={()=>load()}>이력 새로고침</button>
    {error&&<p role="alert">{error}</p>}{busy&&<p role="status">이력을 불러오는 중입니다.</p>}
    {!busy&&!error&&!rows.length&&<p>저장된 입력 이력이 없습니다.</p>}
    {rows.map(row=><article key={row.id} style={{borderTop:'1px solid #dae3ed',padding:'10px 0'}}><strong>{new Date(row.at).toLocaleString('ko-KR')} · {row.actor} · {row.kind}</strong>
      {row.changes.map(c=><div key={c.prodKey}><b>{c.prodName} (#{c.prodKey})</b><ul>{c.fields.map(f=><li key={f.key}>{f.label}: {historyValue(f.key,f.before)} → {historyValue(f.key,f.after)}</li>)}</ul>{!c.fields.length&&<span>값 변경 없음</span>}</div>)}
    </article>)}
    {next&&<button type="button" disabled={busy} onClick={()=>load(next)}>이전 이력 더 보기</button>}
  </section>;
}
