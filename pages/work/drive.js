// pages/work/drive.js
// 업무 드라이브 — 직원 PC에서 자동 업로드된 업무 파일을 "차수 × 단계 × 부서"로 본다.
// 좌: 차수 타임라인(현재 차수 위) / 중: 선택 차수의 단계 칸반 / 좌하: 수신함(차수 없는 파일) / 우: 파일 상세(버전·내려받기)
// 접근 범위는 서버(lib/workDrive)가 이미 걸러서 준다 — 화면은 받은 것만 보여준다.
import { useEffect, useMemo, useState } from 'react';

const fmtT = (t) => { try { return new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return ''; } };
const fmtS = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
const cycleKey = (c) => { const m = String(c || '').match(/^(\d+)(?:-(\d+))?$/); return m ? parseInt(m[1], 10) * 10 + (parseInt(m[2] || '0', 10)) : -1; };

export default function WorkDrivePage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [cycle, setCycle] = useState(null);
  const [scope, setScope] = useState('dept'); // mine | dept | all
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(null);
  const [log, setLog] = useState(null);

  const load = async () => {
    try { const r = await fetch('/api/work/drive'); const j = await r.json(); if (!j.success) throw new Error(j.error || '실패'); setData(j); setErr(''); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);

  const files = data?.files || [];
  const scoped = useMemo(() => files.filter((f) => scope === 'all' ? true : scope === 'mine' ? f.uploaderName === data?.me : (f.dept === data?.dept || f.uploaderName === data?.me))
    .filter((f) => !q || f.filename.toLowerCase().includes(q.toLowerCase()) || (f.uploaderName || '').includes(q)), [files, scope, q, data]);
  const cycles = useMemo(() => [...new Set(scoped.map((f) => f.cycle).filter(Boolean))].sort((a, b) => cycleKey(b) - cycleKey(a)), [scoped]);
  const cur = cycle && cycles.includes(cycle) ? cycle : cycles[0] || null;
  const inbox = scoped.filter((f) => !f.cycle);
  const inCycle = scoped.filter((f) => f.cycle === cur);
  const stages = (data?.stages || []).filter((s) => s !== '미분류');
  const byStage = (s) => inCycle.filter((f) => f.stage === s);
  const unstaged = inCycle.filter((f) => f.stage === '미분류');

  const fix = async (id, patch) => { const r = await fetch('/api/work/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }); const j = await r.json(); if (!j.success) { alert(j.error); return; } await load(); if (sel?.id === id) setSel(j.item); };
  const openLog = async (id) => { const r = await fetch('/api/work/drive?log=' + encodeURIComponent(id)); const j = await r.json(); setLog(j.log || []); };

  const Card = ({ f }) => (
    <div className={'card' + (sel?.id === f.id ? ' on' : '') + (f.sensitive ? ' sens' : '')} onClick={() => { setSel(f); setLog(null); }} title={f.filename}>
      <div className="fn">{f.ext === 'pdf' ? '📄' : /xls|csv/.test(f.ext) ? '📊' : '📁'} {f.filename}</div>
      <div className="meta">{f.uploaderName || '?'}{f.dept ? ` · ${f.dept}` : ''} · {fmtT(f.uploadedAt)}{f.version > 1 ? ` · v${f.version}` : ''}{f.sensitive ? ' · 🔒' : ''}</div>
    </div>
  );

  return (
    <div className="wd">
      <div className="bar">
        <b>업무 드라이브</b>
        <span className="dim">{data ? `${data.me}${data.dept ? ' · ' + data.dept : ''} · 파일 ${files.length}` : '불러오는 중…'}</span>
        <div className="seg">{[['mine', '내 파일'], ['dept', '부서 파일'], ['all', '볼 수 있는 전체']].map(([k, l]) => <button key={k} className={scope === k ? 'on' : ''} onClick={() => setScope(k)}>{l}</button>)}</div>
        <input placeholder="파일명·이름 검색" value={q} onChange={(e) => setQ(e.target.value)} />
        <button onClick={load}>새로고침</button>
      </div>
      {err && <p className="warn">{err}</p>}
      <div className="body">
        <aside className="left">
          <div className="h">차수</div>
          <div className="cyc">{cycles.length === 0 ? <div className="dim">차수 파일 없음</div> : cycles.map((c, i) => <button key={c} className={c === cur ? 'on' : ''} onClick={() => setCycle(c)}>{c}{i === 0 ? ' ▶' : ''} <em>{scoped.filter((f) => f.cycle === c).length}</em></button>)}</div>
          <div className="h">수신함 <em>{inbox.length}</em> <span className="dim">차수를 못 읽은 파일</span></div>
          <div className="inbox">{inbox.slice(0, 40).map((f) => <Card key={f.id} f={f} />)}{inbox.length > 40 && <div className="dim">… 외 {inbox.length - 40}</div>}</div>
        </aside>
        <main className="main">
          {!cur ? <p className="dim">차수가 있는 파일이 아직 없습니다. 직원 PC에서 업무 파일이 저장되면 자동으로 여기에 쌓입니다.</p> : <>
            <div className="h2">{cur}차 <span className="dim">파일 {inCycle.length}</span></div>
            <div className="kanban">
              {stages.map((s) => <div className="col" key={s}><div className="ch">{s} <em>{byStage(s).length}</em></div>{byStage(s).length === 0 ? <div className="empty">—</div> : byStage(s).map((f) => <Card key={f.id} f={f} />)}</div>)}
              {unstaged.length > 0 && <div className="col"><div className="ch">미분류 <em>{unstaged.length}</em></div>{unstaged.map((f) => <Card key={f.id} f={f} />)}</div>}
            </div>
          </>}
        </main>
        <aside className="right">
          {!sel ? <div className="dim">파일을 누르면 상세가 보입니다.</div> : <>
            <div className="h">{sel.filename}</div>
            <table className="kv"><tbody>
              <tr><td>올린 사람</td><td>{sel.uploaderName || '?'} {sel.dept && <span className="dim">({sel.dept})</span>}</td></tr>
              <tr><td>PC · 폴더</td><td>{sel.hostname} · {sel.sourceDir}</td></tr>
              <tr><td>차수 / 단계</td><td>{sel.cycle || '—'} / {sel.stage}</td></tr>
              <tr><td>크기 · 버전</td><td>{fmtS(sel.size)} · v{sel.version}</td></tr>
              <tr><td>올린 시각</td><td>{fmtT(sel.uploadedAt)}</td></tr>
              <tr><td>분류 확신</td><td>{Math.round((sel.confidence || 0) * 100)}%{sel.sensitive && <span className="lock"> · 🔒 민감(금액·계약)</span>}</td></tr>
            </tbody></table>
            <div className="acts">
              {sel.canDownload ? <a className="btn" href={'/api/work/drive?download=' + encodeURIComponent(sel.id)}>내려받기</a> : <span className="dim">내려받기 권한 없음</span>}
              {(data?.isAdmin || sel.uploaderName === data?.me) && <>
                <select value={sel.stage} onChange={(e) => fix(sel.id, { stage: e.target.value })}>{(data?.stages || []).map((s) => <option key={s}>{s}</option>)}</select>
                <input className="cy" placeholder="차수 예 38-2" defaultValue={sel.cycle} onBlur={(e) => e.target.value !== sel.cycle && fix(sel.id, { cycle: e.target.value })} />
                <button onClick={() => confirm('목록에서 숨길까요? (파일은 보관됩니다)') && fix(sel.id, { deleted: true })}>숨김</button>
              </>}
              {data?.isAdmin && <button onClick={() => openLog(sel.id)}>내려받기 기록</button>}
            </div>
            {log && <div className="log"><b>내려받기 {log.length}건</b>{log.map((l, i) => <div key={i} className="dim">{fmtT(l.at)} {l.byName || l.by}</div>)}</div>}
            <div className="vers"><b>같은 이름 버전</b>{files.filter((f) => f.filename === sel.filename && f.uploaderName === sel.uploaderName).sort((a, b) => b.version - a.version).map((f) => <div key={f.id} className={f.id === sel.id ? 'on' : ''} onClick={() => setSel(f)}>v{f.version} · {fmtT(f.uploadedAt)} · {fmtS(f.size)}</div>)}</div>
          </>}
        </aside>
      </div>
      <style jsx>{`
        .wd{display:flex;flex-direction:column;height:calc(100vh - 60px);font-size:13px;color:#222}
        .bar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #e3e3e3;background:#fff;flex-wrap:wrap}
        .bar input{padding:5px 8px;border:1px solid #ccc;border-radius:6px;min-width:200px}.bar button{padding:5px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer}
        .seg{display:flex;border:1px solid #ccc;border-radius:6px;overflow:hidden}.seg button{border:0;border-right:1px solid #ccc;border-radius:0}.seg button:last-child{border-right:0}.seg button.on{background:#2f6feb;color:#fff}
        .dim{color:#777}.warn{color:#b45309;padding:6px 12px}.lock{color:#b45309}
        .body{display:flex;flex:1 1 auto;min-height:0}
        .left{flex:0 0 260px;border-right:1px solid #e3e3e3;overflow:auto;padding:8px;background:#fafafa}
        .main{flex:1 1 auto;overflow:auto;padding:10px 12px}
        .right{flex:0 0 340px;border-left:1px solid #e3e3e3;overflow:auto;padding:10px;background:#fafafa}
        .h{font-weight:700;margin:6px 0 6px}.h em{font-style:normal;color:#2f6feb;margin-left:4px}.h2{font-size:16px;font-weight:700;margin:0 0 10px}
        .cyc{display:flex;flex-direction:column;gap:3px;margin-bottom:12px}.cyc button{text-align:left;padding:5px 8px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer}.cyc button.on{border-color:#2f6feb;background:#e8f0fe;font-weight:700}.cyc em{float:right;font-style:normal;color:#777}
        .kanban{display:flex;gap:10px;align-items:flex-start;overflow-x:auto;padding-bottom:10px}
        .col{flex:0 0 230px;background:#f3f4f6;border-radius:8px;padding:6px}.ch{font-weight:700;margin:2px 4px 6px}.ch em{font-style:normal;color:#2f6feb;margin-left:4px}.empty{color:#bbb;text-align:center;padding:8px}
        .card{background:#fff;border:1px solid #e3e3e3;border-radius:7px;padding:6px 8px;margin-bottom:6px;cursor:pointer}.card:hover{border-color:#2f6feb}.card.on{border-color:#2f6feb;box-shadow:0 0 0 2px #e8f0fe}.card.sens{border-left:3px solid #b45309}
        .fn{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{color:#777;font-size:11.5px;margin-top:2px}
        .kv{width:100%;border-collapse:collapse;margin:6px 0}.kv td{padding:3px 4px;vertical-align:top;border-bottom:1px solid #eee}.kv td:first-child{color:#777;width:88px;white-space:nowrap}
        .acts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0}.btn{background:#2f6feb;color:#fff;padding:5px 12px;border-radius:6px;text-decoration:none}.acts select,.acts input,.acts button{padding:4px 6px;border:1px solid #ccc;border-radius:6px;background:#fff}.cy{width:90px}
        .log,.vers{margin-top:10px;font-size:12px}.vers div{padding:3px 4px;cursor:pointer;border-radius:4px}.vers div.on{background:#e8f0fe}.vers div:hover{background:#eef}
      `}</style>
    </div>
  );
}
