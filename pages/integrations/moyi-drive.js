import { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';

const TABS = ['파일', '버전', '권한', '다운로드 기록', '사용자 연결', '자동 업무'];

export default function MoyiDriveAdminPage() {
  const [tab, setTab] = useState('파일');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    fetch('/api/moyi/drive-admin').then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok && !body.connectionReason) throw new Error(body.error || 'Drive 화면을 불러오지 못했습니다.');
      setData(body);
    }).catch((e) => setError(e.message));
  }, []);
  const files = useMemo(() => (data?.files || []).filter((f) => f.name.toLowerCase().includes(query.toLowerCase())), [data, query]);

  if (error) return <Layout title="MOYI Drive 관리"><div className="banner-err" role="alert">{error}</div></Layout>;
  if (!data) return <Layout title="MOYI Drive 관리"><div className="empty-state">Drive 화면을 불러오는 중입니다.</div></Layout>;

  return <Layout title="MOYI Drive 관리">
    <div className={data.connectionReady?'banner-ok':'banner-warn'} role="status"><b>{data.connectionReady?'실제 원장 연결:':'연결 대기:'}</b> {data.connectionReason} {!data.connectionReady && '실제 파일·권한·계정은 변경되지 않습니다.'}</div>
    <div className="filter-bar" aria-label="Drive 도구">
      <label className="filter-label" htmlFor="company">회사</label>
      <select id="company" className="filter-select" value={data.company.id || ''} disabled><option value={data.company.id || ''}>{data.company.name}</option></select>
      <input className="filter-input" style={{minWidth:240}} value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="파일 이름 검색" aria-label="파일 이름 검색" />
      <button className="btn btn-primary" disabled title="MOYI 파일 업로드 연결 대기">파일 올리기</button>
      <button className="btn" disabled title="MOYI 분류 저장 연결 대기">분류 확인</button>
    </div>
    <div className="tabs" role="tablist" aria-label="Drive 관리 항목">{TABS.map((name)=><button key={name} role="tab" aria-selected={tab===name} className={`tab-item ${tab===name?'active':''}`} onClick={()=>setTab(name)}>{name}</button>)}</div>
    <div className="card" style={{marginTop:4}}>
      <div className="card-header"><span className="card-title">{tab}</span><span className={`badge ${data.connectionReady?'badge-green':'badge-amber'}`} style={{marginLeft:'auto'}}>{data.connectionReady?'실제 원장 조회':'연결 대기'}</span></div>
      <div className="card-body">
        {tab==='파일' && (files.length ? <div className="table-wrap"><table className="tbl"><thead><tr><th>이름</th><th>들어온 곳</th><th>상태</th><th>내용</th></tr></thead><tbody>{files.map(f=><tr key={f.id}><td>{f.name}</td><td>{f.source}</td><td><span className={`badge ${f.sourceDeleted?'badge-red':f.contentReady?'badge-green':'badge-amber'}`}>{f.state}</span></td><td>{f.contentReady?'원본 등록됨':'백업 내용 대기'}</td></tr>)}</tbody></table></div> : <Empty text={data.connectionReady?'이 폴더에 표시할 실제 파일이 없습니다.':data.connectionReason}/>) }
        {tab==='버전' && <Empty text={data.pending.versions}/>}
        {tab==='권한' && <Empty text={data.pending.permissions}/>}
        {tab==='다운로드 기록' && <Empty text={data.pending.downloads}/>}
        {tab==='사용자 연결' && <Empty text={data.pending.identities}/>}
        {tab==='자동 업무' && <SyncPending pending={data.pending}/>}
      </div>
    </div>
    <div style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}>
      {tab==='자동 업무' && <><button className="btn" disabled>미리보기</button><button className="btn btn-danger" disabled>전산 변경 별도 승인</button></>}
      {(tab==='권한'||tab==='사용자 연결') && <button className="btn btn-primary" disabled title="MOYI Core 권한 저장 연결 대기">변경 저장</button>}
    </div>
    <style jsx>{`@media(max-width:767px){.filter-bar{align-items:stretch}.filter-bar :global(input),.filter-bar :global(select),.filter-bar :global(button){min-height:44px;width:100%}.tabs{overflow-x:auto}.tab-item{min-height:44px;white-space:nowrap}.card-body{padding:6px}}`}</style>
  </Layout>;
}

function Empty({text}) { return <div className="empty-state" role="status">{text}</div>; }
function SyncPending({pending}) { return <div><div className="banner-warn"><b>네이버웍스 연결 대기:</b> {pending.naverworks}</div><Empty text={pending.automations}/></div>; }
