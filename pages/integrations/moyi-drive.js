import { useEffect, useMemo, useState } from 'react';

const TABS = ['파일', '버전', '권한', '다운로드 기록', '사용자 연결', '자동 업무'];
const badge = (state) => state === '완료' ? 'badge-green' : state.includes('차단') || state === '실패' ? 'badge-red' : state.includes('기다림') || state.includes('멈춤') ? 'badge-amber' : 'badge-blue';

export default function MoyiDriveAdminPage() {
  const [tab, setTab] = useState('파일');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    fetch('/api/moyi/drive-admin').then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Drive 화면을 불러오지 못했습니다.');
      setData(body);
    }).catch((e) => setError(e.message));
  }, []);
  const files = useMemo(() => (data?.files || []).filter((f) => f.name.toLowerCase().includes(query.toLowerCase())), [data, query]);

  if (error) return <div className="banner-err" role="alert">{error}</div>;
  if (!data) return <div className="empty-state">Drive 화면을 불러오는 중입니다.</div>;

  return <>
    <div className="banner-warn" role="status"><b>연결 대기:</b> {data.connectionReason} 실제 파일·권한·계정은 변경되지 않습니다.</div>
    <div className="filter-bar" aria-label="Drive 도구">
      <label className="filter-label" htmlFor="company">회사</label>
      <select id="company" className="filter-select" value={data.company.id} disabled><option value={data.company.id}>{data.company.name}</option></select>
      <input className="filter-input" style={{minWidth:240}} value={query} onChange={(e)=>setQuery(e.target.value)} placeholder="파일 이름 검색" aria-label="파일 이름 검색" />
      <button className="btn btn-primary" disabled title="MOYI 파일 업로드 연결 대기">파일 올리기</button>
      <button className="btn" disabled title="MOYI 분류 저장 연결 대기">분류 확인</button>
    </div>
    <div className="tabs" role="tablist" aria-label="Drive 관리 항목">{TABS.map((name)=><button key={name} role="tab" aria-selected={tab===name} className={`tab-item ${tab===name?'active':''}`} onClick={()=>setTab(name)}>{name}</button>)}</div>
    <div className="card" style={{marginTop:4}}>
      <div className="card-header"><span className="card-title">{tab}</span><span className="badge badge-amber" style={{marginLeft:'auto'}}>실제 연결 전 미리보기</span></div>
      <div className="card-body">
        {tab==='파일' && <div className="table-wrap"><table className="tbl"><thead><tr><th>이름</th><th>종류</th><th>담당</th><th>수정일</th><th>상태</th><th>미리보기</th></tr></thead><tbody>{files.map(f=><tr key={f.id}><td>{f.name}</td><td>{f.type}</td><td>{f.owner}</td><td>{f.changedAt}</td><td><span className="badge badge-amber">{f.state}</span></td><td>{f.type==='Excel'?'표 미리보기':f.type==='PDF'?'페이지 미리보기':'지원 여부 확인 후 표시'}</td></tr>)}</tbody></table></div>}
        {tab==='버전' && <Timeline rows={data.versions}/>} 
        {tab==='권한' && <PermissionGrid rows={data.permissions}/>} 
        {tab==='다운로드 기록' && <SimpleTable headers={['시간','직원','파일','결과']} rows={data.downloads.map(x=>[x.at,x.user,x.file,x.result])}/>} 
        {tab==='사용자 연결' && <SimpleTable headers={['Nenova 로그인 ID','MOYI 사용자','부서 확인','상태']} rows={data.identities.map(x=>[x.nenovaUserId,x.moyiUser,x.department,x.state])}/>} 
        {tab==='자동 업무' && <SimpleTable headers={['업무','회사','담당자','상태']} rows={data.automations.map(x=>[x.name,x.company,x.owner,x.state])}/>} 
      </div>
    </div>
    <div style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}>
      {tab==='자동 업무' && <><button className="btn" disabled>미리보기</button><button className="btn btn-danger" disabled>전산 변경 별도 승인</button></>}
      {(tab==='권한'||tab==='사용자 연결') && <button className="btn btn-primary" disabled title="MOYI Core 권한 저장 연결 대기">변경 저장</button>}
    </div>
    <style jsx>{`@media(max-width:767px){.filter-bar{align-items:stretch}.filter-bar :global(input),.filter-bar :global(select),.filter-bar :global(button){min-height:44px;width:100%}.tabs{overflow-x:auto}.tab-item{min-height:44px;white-space:nowrap}.card-body{padding:6px}}`}</style>
  </>;
}

function Timeline({rows}) { return <div>{rows.map(x=><div key={x.id} style={{borderLeft:'3px solid var(--blue)',padding:'6px 10px',marginBottom:6}}><b>{x.label}</b><div style={{fontSize:11,color:'var(--text3)'}}>{x.at} · {x.by} · 이전 버전 보기 · 복원은 연결 후 가능</div></div>)}</div>; }
function PermissionGrid({rows}) { const cols=['view','preview','download','upload','edit','remove','share']; const labels=['보기','미리보기','다운로드','업로드','수정','삭제','공유']; return <div className="table-wrap"><table className="tbl"><thead><tr><th>대상</th>{labels.map(x=><th key={x}>{x}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.subject}><td>{r.subject}</td>{cols.map(c=><td key={c} style={{textAlign:'center'}}>{r[c]?'허용':'차단'}</td>)}</tr>)}</tbody></table></div>; }
function SimpleTable({headers,rows}) { return <div className="table-wrap"><table className="tbl"><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}>{j===r.length-1?<span className={`badge ${badge(String(v))}`}>{v}</span>:v}</td>)}</tr>)}</tbody></table></div>; }
