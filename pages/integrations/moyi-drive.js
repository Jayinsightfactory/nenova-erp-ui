import { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout';

const TABS = ['파일', '버전', '권한', '다운로드 기록', '사용자 연결', '자동 업무'];
const FILE_VIEWS = [
  { id: 'all', label: '전체 파일' },
  { id: 'moyi', label: 'MOYI 앱에서 올림' },
  { id: 'naverworks', label: '네이버웍스에서 가져옴' },
  { id: 'needs-review', label: '정리 필요' },
  { id: 'ready', label: '확인 완료' },
];

export default function MoyiDriveAdminPage() {
  const [tab, setTab] = useState('파일');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [fileView, setFileView] = useState('all');
  useEffect(() => {
    fetch('/api/moyi/drive-admin').then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok && !body.connectionReason) throw new Error(body.error || 'Drive 화면을 불러오지 못했습니다.');
      setData(body);
    }).catch((e) => setError(e.message));
  }, []);
  const files = useMemo(() => (data?.files || []).filter((file) => {
    if (!file.name.toLowerCase().includes(query.toLowerCase())) return false;
    if (fileView === 'moyi') return file.source === 'MOYI 앱';
    if (fileView === 'naverworks') return file.source === '네이버웍스 Drive';
    if (fileView === 'needs-review') return !file.contentReady || file.sourceDeleted;
    if (fileView === 'ready') return file.contentReady && !file.sourceDeleted;
    return true;
  }), [data, query, fileView]);

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
    <div className="drive-workspace">
      {tab==='파일' && <nav className="drive-views" aria-label="파일 빠른 보기">
        <b>빠른 보기</b>
        {FILE_VIEWS.map((view) => <button key={view.id} className={fileView===view.id?'active':''} aria-current={fileView===view.id?'page':undefined} onClick={()=>setFileView(view.id)}>{view.label}</button>)}
        <div className="drive-help"><b>정리 원칙</b><span>폴더는 팀·업무 중심으로 적게 만들고, 연도·차수·거래처·문서 종류는 분류 정보로 찾습니다.</span></div>
      </nav>}
      <div className="card drive-content" style={{marginTop:4}}>
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
    </div>
    <div style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}>
      {tab==='자동 업무' && <><button className="btn" disabled>미리보기</button><button className="btn btn-danger" disabled>전산 변경 별도 승인</button></>}
      {(tab==='권한'||tab==='사용자 연결') && <button className="btn btn-primary" disabled title="MOYI Core 권한 저장 연결 대기">변경 저장</button>}
    </div>
    <style jsx>{`.drive-workspace{display:flex;gap:8px;align-items:flex-start}.drive-views{width:180px;flex:0 0 180px;border:1px solid #c7c7c7;background:#f7f7f7;padding:8px;display:flex;flex-direction:column;gap:3px}.drive-views>b{padding:4px 6px}.drive-views button{border:0;background:transparent;text-align:left;padding:7px 8px;cursor:pointer;color:#222}.drive-views button:hover,.drive-views button.active{background:#c5d9f1;border-left:3px solid #0066cc;padding-left:5px;font-weight:bold}.drive-help{margin-top:8px;padding:8px;background:#fff;border-top:1px solid #ddd;display:flex;flex-direction:column;gap:4px;line-height:1.45}.drive-help span{color:#555}.drive-content{flex:1;min-width:0}@media(max-width:767px){.filter-bar{align-items:stretch}.filter-bar :global(input),.filter-bar :global(select),.filter-bar :global(button){min-height:44px;width:100%}.tabs{overflow-x:auto}.tab-item{min-height:44px;white-space:nowrap}.card-body{padding:6px}.drive-workspace{display:block}.drive-views{width:auto;display:flex;flex-direction:row;overflow-x:auto;gap:4px;margin-top:4px}.drive-views>b,.drive-help{display:none}.drive-views button{min-height:44px;white-space:nowrap;border:1px solid #ddd}.drive-views button:hover,.drive-views button.active{border-left:1px solid #ddd;border-bottom:3px solid #0066cc;padding-left:8px}}`}</style>
  </Layout>;
}

function Empty({text}) { return <div className="empty-state" role="status">{text}</div>; }
function SyncPending({pending}) { return <div><div className="banner-warn"><b>네이버웍스 연결 대기:</b> {pending.naverworks}</div><Empty text={pending.automations}/></div>; }
