// pages/work/drive.js
// 업무 드라이브 — 직원 PC에서 자동 업로드된 업무 파일을 "연도·차수 × 단계 × 사람"으로 본다.
// 상단: 범위(내/부서/전체) · 사람 칩 · 검색 · 보기(칸반/목록/최근) / 좌: 연도별 차수 타임라인 + 차수 없음 + (사장) PC별 업로드 현황
// 중: 선택 차수의 단계 요약띠 + 칸반 또는 표 / 우: 파일 상세(버전·내려받기·교정)
// 접근 범위는 서버(lib/workDrive)가 이미 걸러서 준다 — 화면은 받은 것만 보여준다.
import { useEffect, useMemo, useState } from 'react';

const fmtT = (t) => { try { return new Date(t).toLocaleString('ko-KR', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }); } catch { return ''; } };
const fmtD = (t) => { try { return new Date(t).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'short' }); } catch { return ''; } };
const ago = (t) => { const s = (Date.now() - new Date(t).getTime()) / 1000; if (!(s >= 0)) return ''; if (s < 90) return '방금'; if (s < 3600) return Math.round(s / 60) + '분 전'; if (s < 86400) return Math.round(s / 3600) + '시간 전'; return Math.round(s / 86400) + '일 전'; };
const fmtS = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + 'MB' : Math.max(1, Math.round(n / 1024)) + 'KB');
const cycleKey = (c) => { const m = String(c || '').match(/^(\d+)(?:-(\d+))?$/); return m ? parseInt(m[1], 10) * 10 + (parseInt(m[2] || '0', 10)) : -1; };
// 차수의 연도: ① 파일명에 적힌 연도(2025년·2024-46차·25년) ② 파일 수정시각 연도 — 단, 차수가 그 시점 주차보다 한참 크면(연말 차수를 1월에 손댄 파일) 전년
const weekOf = (d) => Math.ceil(((d - new Date(d.getFullYear(), 0, 1)) / 864e5 + 1) / 7);
const yearOf = (f) => {
  const m = String(f.filename || '').match(/(?:^|[^\d])(20(2\d))(?:년|-\d{2}차|\s*\d{2}차)/) || String(f.filename || '').match(/(?:^|[^\d])(2\d)년/);
  if (m) return m[1].length === 4 ? parseInt(m[1], 10) : 2000 + parseInt(m[1], 10);
  const d = new Date(f.mtime || f.uploadedAt); let y = d.getFullYear(); if (!(y > 2000)) { return new Date(f.uploadedAt).getFullYear(); }
  const major = parseInt(String(f.cycle || '').split('-')[0], 10);
  if (major > weekOf(d) + 2) y -= 1;
  return y;
};
const icon = (f) => (f.ext === 'pdf' ? '📄' : /xls|csv/.test(f.ext) ? '📊' : /doc|hwp|txt/.test(f.ext) ? '📝' : /png|jpg|jpeg/.test(f.ext) ? '🖼' : '📁');
const dayKey = (t) => String(t || '').slice(0, 10);
const NONE = '__none';

export default function WorkDrivePage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [cycle, setCycle] = useState(null);     // 'YYYY:38-2' | NONE
  const [scope, setScope] = useState('dept');   // mine | dept | all
  const [who, setWho] = useState('');           // 올린 사람 필터
  const [q, setQ] = useState('');
  const [view, setView] = useState('kanban');   // kanban | list | recent
  const [stageF, setStageF] = useState('');     // 단계 필터
  const [deptF, setDeptF] = useState('');       // 부서
  const [extF, setExtF] = useState('');         // 종류: xls | pdf | doc | img | etc
  const [dirF, setDirF] = useState('');         // 폴더: Desktop | Documents | Downloads
  const [periodF, setPeriodF] = useState('');   // 올린 기간: 1 | 7 | 30 (일)
  const [sensF, setSensF] = useState('');       // '' | 'sens' | 'plain'
  const [verF, setVerF] = useState('');         // '' | 'multi'(버전 2개 이상)
  const [sort, setSort] = useState(['uploadedAt', -1]);
  const [sel, setSel] = useState(null);
  const [log, setLog] = useState(null);
  const [busy, setBusy] = useState('');

  const load = async () => {
    try { const r = await fetch('/api/work/drive'); const j = await r.json(); if (!j.success) throw new Error(j.error || '실패'); setData(j); setErr(''); }
    catch (e) { setErr(e.message); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => { if (data?.isAdmin) setScope('all'); }, [data?.isAdmin]);

  const files = useMemo(() => (data?.files || []).map((f) => ({ ...f, year: yearOf(f), ck: f.cycle ? `${yearOf(f)}:${f.cycle}` : NONE })), [data]);
  const extKind = (f) => (/xls|csv/.test(f.ext) ? 'xls' : f.ext === 'pdf' ? 'pdf' : /doc|hwp|txt|ppt/.test(f.ext) ? 'doc' : /png|jpg|jpeg/.test(f.ext) ? 'img' : 'etc');
  const verCount = useMemo(() => { const m = {}; for (const f of files) { const k = f.uploaderName + '|' + f.filename; m[k] = (m[k] || 0) + 1; } return m; }, [files]);
  const since = periodF ? Date.now() - Number(periodF) * 86400e3 : 0;
  const scoped = useMemo(() => files
    .filter((f) => who ? f.uploaderName === who : scope === 'all' ? true : scope === 'mine' ? f.uploaderName === data?.me : (f.dept === data?.dept || f.uploaderName === data?.me))
    .filter((f) => !deptF || f.dept === deptF)
    .filter((f) => !extF || extKind(f) === extF)
    .filter((f) => !dirF || f.sourceDir === dirF)
    .filter((f) => !since || new Date(f.uploadedAt).getTime() >= since)
    .filter((f) => !sensF || (sensF === 'sens' ? f.sensitive : !f.sensitive))
    .filter((f) => !verF || verCount[f.uploaderName + '|' + f.filename] > 1)
    .filter((f) => !q || f.filename.toLowerCase().includes(q.toLowerCase()) || (f.uploaderName || '').includes(q) || (f.cycle || '') === q), [files, scope, who, q, data, deptF, extF, dirF, since, sensF, verF, verCount]);
  const dirs = useMemo(() => { const m = {}; for (const f of files) if (f.sourceDir) m[f.sourceDir] = (m[f.sourceDir] || 0) + 1; return Object.entries(m).filter(([, n]) => n >= 5).sort((a, b) => b[1] - a[1]).slice(0, 30); }, [files]); // 5건 이상 폴더만, 많은 순 30개
  const anyF = !!(deptF || extF || dirF || periodF || sensF || verF || stageF);
  const clearF = () => { setDeptF(''); setExtF(''); setDirF(''); setPeriodF(''); setSensF(''); setVerF(''); setStageF(''); };

  // 사람 칩(범위 안에서) · 연도별 차수 · PC별 업로드 현황(사장)
  const people = useMemo(() => { const m = new Map(); for (const f of files.filter((f) => scope === 'all' ? true : scope === 'mine' ? f.uploaderName === data?.me : (f.dept === data?.dept || f.uploaderName === data?.me))) if (f.uploaderName) { const p = m.get(f.uploaderName) || { name: f.uploaderName, dept: f.dept, n: 0, last: '' }; p.n++; if (f.uploadedAt > p.last) p.last = f.uploadedAt; m.set(f.uploaderName, p); } return [...m.values()].sort((a, b) => b.n - a.n); }, [files, scope, data]);
  const years = useMemo(() => {
    const m = new Map();
    for (const f of scoped) if (f.cycle) { const y = m.get(f.year) || new Map(); y.set(f.cycle, (y.get(f.cycle) || 0) + 1); m.set(f.year, y); }
    return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([y, cs]) => ({ year: y, cycles: [...cs.entries()].sort((a, b) => cycleKey(b[0]) - cycleKey(a[0])).map(([c, n]) => ({ c, n, ck: `${y}:${c}` })) }));
  }, [scoped]);
  const allCk = years.flatMap((y) => y.cycles.map((c) => c.ck));
  const cur = cycle === NONE ? NONE : (cycle && allCk.includes(cycle) ? cycle : allCk[0] || null);
  const noCycle = scoped.filter((f) => f.ck === NONE);
  const inCycle = cur === NONE ? noCycle : scoped.filter((f) => f.ck === cur);
  const stages = data?.stages || [];
  const stageCount = (list) => Object.fromEntries(stages.map((s) => [s, list.filter((f) => f.stage === s).length]));
  const today = dayKey(new Date().toISOString());
  const hosts = useMemo(() => { const m = new Map(); for (const f of files) { const k = `${f.uploaderName || '?'}@${f.hostname || '?'}`; const h = m.get(k) || { name: f.uploaderName || '?', host: f.hostname || '?', n: 0, today: 0, last: '' }; h.n++; if (dayKey(f.uploadedAt) === today) h.today++; if (f.uploadedAt > h.last) h.last = f.uploadedAt; m.set(k, h); } return [...m.values()].sort((a, b) => (b.last > a.last ? 1 : -1)); }, [files, today]);

  // 표 데이터: 검색 중이거나 차수 없음이거나 목록 보기 → 표, 최근 보기 → 최근 200건
  const showList = view === 'list' || cur === NONE || !!q;
  const listRows = useMemo(() => {
    const base = view === 'recent' ? [...scoped] : (q ? scoped : inCycle).filter((f) => !stageF || f.stage === stageF);
    const [k, d] = sort; const val = (f) => (k === 'cycle' ? cycleKey(f.cycle) : k === 'size' ? f.size : String(f[k] || ''));
    return base.sort((a, b) => (val(a) > val(b) ? d : val(a) < val(b) ? -d : 0)).slice(0, view === 'recent' ? 200 : 2000);
  }, [scoped, inCycle, view, q, stageF, sort]);

  const fix = async (id, patch) => { const r = await fetch('/api/work/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }); const j = await r.json(); if (!j.success) { alert(j.error); return; } await load(); if (sel?.id === id) setSel(j.item); };
  const reclassAll = async () => { if (!confirm('규칙으로 전체 재분류할까요? 손으로 고친 파일은 그대로 둡니다.')) return; setBusy('재분류 중…'); const r = await fetch('/api/work/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reclassifyAll' }) }); const j = await r.json(); setBusy(''); alert(j.success ? `검사 ${j.scanned}건 · 바뀜 ${j.changed}건` : j.error); await load(); };
  const openLog = async (id) => { const r = await fetch('/api/work/drive?log=' + encodeURIComponent(id)); const j = await r.json(); setLog(j.log || []); };
  const pick = (f) => { setSel(f); setLog(null); };
  const th = (k, label) => <th onClick={() => setSort(([pk, pd]) => [k, pk === k ? -pd : -1])} className={sort[0] === k ? 'on' : ''}>{label}{sort[0] === k ? (sort[1] < 0 ? ' ▼' : ' ▲') : ''}</th>;

  const Card = ({ f }) => (
    <div className={'card' + (sel?.id === f.id ? ' on' : '') + (f.sensitive ? ' sens' : '')} onClick={() => pick(f)} title={f.filename}>
      <div className="fn">{icon(f)} {f.filename}</div>
      <div className="meta">{f.uploaderName || '?'} · {fmtT(f.uploadedAt)}{f.version > 1 ? ` · v${f.version}` : ''}{f.sensitive ? ' · 🔒' : ''}</div>
    </div>
  );
  const Row = ({ f, withCycle }) => (
    <tr className={(sel?.id === f.id ? 'on' : '') + (f.sensitive ? ' sens' : '')} onClick={() => pick(f)}>
      <td className="fn" title={f.filename}>{icon(f)} {f.filename}{f.version > 1 && <span className="v">v{f.version}</span>}{f.sensitive && ' 🔒'}</td>
      <td>{f.uploaderName || '?'}</td>
      {withCycle && <td>{f.cycle || '—'}</td>}
      <td><span className={'tag s' + stages.indexOf(f.stage)}>{f.stage}</span></td>
      <td className="dim" title={fmtT(f.uploadedAt)}>{view === 'recent' ? ago(f.uploadedAt) : fmtT(f.uploadedAt)}</td>
      <td className="dim r">{fmtS(f.size)}</td>
    </tr>
  );
  const Table = ({ rows, withCycle }) => rows.length === 0 ? <p className="dim">파일 없음</p> : (
    <table className="lst"><thead><tr>{th('filename', '파일')}{th('uploaderName', '올린 사람')}{withCycle && th('cycle', '차수')}{th('stage', '단계')}{th('uploadedAt', '올린 시각')}{th('size', '크기')}</tr></thead>
      <tbody>{rows.map((f) => <Row key={f.id} f={f} withCycle={withCycle} />)}</tbody></table>
  );

  const curLabel = cur === NONE ? '차수 없는 파일' : cur ? `${cur.split(':')[0]}년 ${cur.split(':')[1]}차` : '';
  const sc = stageCount(inCycle);

  return (
    <div className="wd">
      <div className="bar">
        <b>업무 드라이브</b>
        <span className="dim">{data ? `${data.me}${data.dept ? ' · ' + data.dept : ''} · 파일 ${files.length}` : '불러오는 중…'}</span>
        <div className="seg">{[['mine', '내 파일'], ['dept', '부서'], ['all', '볼 수 있는 전체']].map(([k, l]) => <button key={k} className={scope === k ? 'on' : ''} onClick={() => { setScope(k); setWho(''); }}>{l}</button>)}</div>
        <input placeholder="파일명 · 이름 · 차수(38-2)" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">{[['kanban', '칸반'], ['list', '목록'], ['recent', '최근 올라온']].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
        <button onClick={load}>새로고침</button>
        {data?.isAdmin && <button onClick={reclassAll} disabled={!!busy}>{busy || '일괄 재분류'}</button>}
      </div>
      {people.length > 1 && <div className="chips"><span className="dim">사람</span><button className={!who ? 'on' : ''} onClick={() => setWho('')}>전체</button>{people.map((p) => <button key={p.name} className={who === p.name ? 'on' : ''} onClick={() => setWho(who === p.name ? '' : p.name)} title={`${p.dept || ''} · 마지막 ${fmtT(p.last)}`}>{p.name} <em>{p.n}</em></button>)}</div>}
      <div className="filters">
        <span className="dim">필터</span>
        <select value={deptF} onChange={(e) => setDeptF(e.target.value)}><option value="">부서 전체</option>{[...new Set(files.map((f) => f.dept).filter(Boolean))].map((d) => <option key={d}>{d}</option>)}</select>
        <select value={stageF} onChange={(e) => setStageF(e.target.value)}><option value="">단계 전체</option>{stages.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={extF} onChange={(e) => setExtF(e.target.value)}><option value="">종류 전체</option><option value="xls">엑셀·CSV</option><option value="pdf">PDF</option><option value="doc">문서·PPT</option><option value="img">이미지</option><option value="etc">기타</option></select>
        <select value={dirF} onChange={(e) => setDirF(e.target.value)}><option value="">폴더 전체</option>{dirs.map(([d, n]) => <option key={d} value={d}>{d} ({n})</option>)}</select>
        <select value={periodF} onChange={(e) => setPeriodF(e.target.value)}><option value="">올린 기간 전체</option><option value="1">오늘(24시간)</option><option value="7">최근 7일</option><option value="30">최근 30일</option></select>
        <select value={sensF} onChange={(e) => setSensF(e.target.value)}><option value="">민감 여부 전체</option><option value="sens">🔒 민감만</option><option value="plain">일반만</option></select>
        <select value={verF} onChange={(e) => setVerF(e.target.value)}><option value="">버전 전체</option><option value="multi">버전 2개 이상</option></select>
        {anyF && <button onClick={clearF}>필터 지우기</button>}
        <span className="dim">{scoped.length}건</span>
      </div>
      {err && <p className="warn">{err}</p>}
      <div className="body">
        <aside className="left">
          {data?.isAdmin && <>
            <div className="h">PC별 업로드 <span className="dim">오늘/전체 · 마지막</span></div>
            <table className="hosts"><tbody>{hosts.map((h) => <tr key={h.name + h.host} className={Date.now() - new Date(h.last) > 3 * 86400e3 ? 'stale' : ''}><td>{h.name}<div className="dim">{h.host}</div></td><td className="r">{h.today}/{h.n}</td><td className="dim r">{ago(h.last)}</td></tr>)}</tbody></table>
          </>}
          <div className="h">차수 <span className="dim">{allCk.length}개</span></div>
          <div className="cyc">
            {years.length === 0 && <div className="dim">차수 파일 없음</div>}
            {years.map((y) => <div key={y.year}><div className="yr">{y.year}년</div>{y.cycles.map((c, i) => <button key={c.ck} className={c.ck === cur ? 'on' : ''} onClick={() => { setCycle(c.ck); if (view === 'recent') setView('kanban'); }}>{c.c}차{y === years[0] && i === 0 ? ' ▶' : ''} <em>{c.n}</em></button>)}</div>)}
          </div>
          <button className={'nonebtn' + (cur === NONE ? ' on' : '')} onClick={() => { setCycle(NONE); if (view === 'recent') setView('list'); }}>차수 없음 <em>{noCycle.length}</em></button>
        </aside>
        <main className="main">
          {view === 'recent' ? <>
            <div className="h2">최근 올라온 파일 <span className="dim">{listRows.length}건 · 범위 안 최신순</span></div>
            {Object.entries(listRows.reduce((m, f) => { (m[dayKey(f.uploadedAt)] ||= []).push(f); return m; }, {})).map(([d, rows]) => <div key={d}><div className="day">{d === today ? '오늘' : fmtD(d)} <em>{rows.length}</em></div><Table rows={rows} withCycle /></div>)}
          </> : !cur ? <p className="dim">파일이 아직 없습니다. 직원 PC에서 업무 파일이 저장되면 자동으로 여기에 쌓입니다.</p> : <>
            <div className="h2">{q ? `"${q}" 검색 결과` : curLabel} <span className="dim">파일 {(q ? scoped : inCycle).length}</span></div>
            {!q && <div className="strip">{stages.map((s) => (sc[s] > 0 || s !== '미분류') && <button key={s} className={'tag s' + stages.indexOf(s) + (stageF === s ? ' on' : '')} onClick={() => setStageF(stageF === s ? '' : s)}>{s} <em>{sc[s]}</em></button>)}</div>}
            {showList ? <Table rows={listRows} withCycle={!!q || cur === NONE} /> : (
              <div className="kanban">
                {stages.filter((s) => s !== '미분류' && (!stageF || s === stageF)).map((s) => <div className="col" key={s}><div className="ch">{s} <em>{sc[s]}</em></div>{sc[s] === 0 ? <div className="empty">—</div> : inCycle.filter((f) => f.stage === s).map((f) => <Card key={f.id} f={f} />)}</div>)}
                {sc['미분류'] > 0 && (!stageF || stageF === '미분류') && <div className="col un"><div className="ch">미분류 <em>{sc['미분류']}</em></div>{inCycle.filter((f) => f.stage === '미분류').map((f) => <Card key={f.id} f={f} />)}</div>}
              </div>)}
          </>}
        </main>
        {sel && <aside className="right">
            <button className="x" onClick={() => setSel(null)} title="닫기">✕</button>
            <div className="h">{icon(sel)} {sel.filename}</div>
            <table className="kv"><tbody>
              <tr><td>올린 사람</td><td>{sel.uploaderName || '?'} {sel.dept && <span className="dim">({sel.dept})</span>}</td></tr>
              <tr><td>PC · 폴더</td><td>{sel.hostname} · {sel.sourceDir}</td></tr>
              <tr><td>차수 / 단계</td><td>{sel.cycle ? `${sel.year}년 ${sel.cycle}차` : '—'} / {sel.stage}</td></tr>
              <tr><td>크기 · 버전</td><td>{fmtS(sel.size)} · v{sel.version}</td></tr>
              <tr><td>파일 수정</td><td>{sel.mtime ? fmtT(sel.mtime) : '—'}</td></tr>
              <tr><td>올린 시각</td><td>{fmtT(sel.uploadedAt)} <span className="dim">({ago(sel.uploadedAt)})</span></td></tr>
              <tr><td>분류</td><td>{sel.correctedBy && sel.correctedBy !== 'auto-reclassify' ? '사람이 교정' : `자동 ${Math.round((sel.confidence || 0) * 100)}%`}{sel.sensitive && <span className="lock"> · 🔒 민감</span>}</td></tr>
            </tbody></table>
            <div className="acts">
              {sel.canDownload ? <a className="btn" href={'/api/work/drive?download=' + encodeURIComponent(sel.id)}>내려받기</a> : <span className="dim">내려받기 권한 없음</span>}
              {data?.isAdmin && <button onClick={() => openLog(sel.id)}>기록</button>}
            </div>
            {(data?.isAdmin || sel.uploaderName === data?.me) && <div className="acts edit">
              <span className="dim">교정</span>
              <select value={sel.stage} onChange={(e) => fix(sel.id, { stage: e.target.value })}>{stages.map((s) => <option key={s}>{s}</option>)}</select>
              <input className="cy" placeholder="차수 38-2" defaultValue={sel.cycle} onBlur={(e) => e.target.value !== sel.cycle && fix(sel.id, { cycle: e.target.value })} />
              <button onClick={() => confirm('목록에서 숨길까요? (파일은 보관됩니다)') && fix(sel.id, { deleted: true })}>숨김</button>
            </div>}
            {log && <div className="log"><b>내려받기 {log.length}건</b>{log.length === 0 && <div className="dim">없음</div>}{log.map((l, i) => <div key={i} className="dim">{fmtT(l.at)} {l.byName || l.by}</div>)}</div>}
            <div className="vers"><b>같은 이름 버전</b>{files.filter((f) => f.filename === sel.filename && f.uploaderName === sel.uploaderName).sort((a, b) => b.version - a.version).map((f) => <div key={f.id} className={f.id === sel.id ? 'on' : ''} onClick={() => pick(f)}>v{f.version} · {fmtT(f.uploadedAt)} · {fmtS(f.size)}</div>)}</div>
            <div className="dim legend">🔒 = 금액·계약 파일(경영지원·본인·사장만) · v2 = 같은 이름의 새 버전</div>
        </aside>}
      </div>
      <style jsx>{`
        .wd{display:flex;flex-direction:column;height:calc(100vh - 60px);font-size:13px;color:#222}
        .bar{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid #e3e3e3;background:#fff;flex-wrap:wrap}
        .bar input{padding:5px 8px;border:1px solid #ccc;border-radius:6px;min-width:200px}.bar button{padding:5px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer}.bar button:disabled{color:#999}
        .seg{display:flex;border:1px solid #ccc;border-radius:6px;overflow:hidden}.seg button{border:0;border-right:1px solid #ccc;border-radius:0}.seg button:last-child{border-right:0}.seg button.on{background:#2f6feb;color:#fff}
        .chips{display:flex;gap:6px;align-items:center;padding:6px 12px;border-bottom:1px solid #eee;background:#fff;flex-wrap:wrap}.chips button{padding:3px 9px;border:1px solid #ddd;border-radius:14px;background:#fff;cursor:pointer}.chips button.on{border-color:#2f6feb;background:#e8f0fe;font-weight:700}.chips em{font-style:normal;color:#777;font-size:11px}
        .filters{display:flex;gap:6px;align-items:center;padding:6px 12px;border-bottom:1px solid #eee;background:#fcfcfc;flex-wrap:wrap}.filters select,.filters button{max-width:200px;padding:3px 6px;border:1px solid #ddd;border-radius:6px;background:#fff;font-size:12px}
        .dim{color:#777}.warn{color:#b45309;padding:6px 12px}.lock{color:#b45309}.r{text-align:right}
        .body{display:flex;flex:1 1 auto;min-height:0}
        .left{flex:0 0 220px;border-right:1px solid #e3e3e3;overflow:auto;padding:8px;background:#fafafa;display:flex;flex-direction:column;min-height:0}
        .main{flex:1 1 auto;overflow:auto;padding:10px 12px;min-width:0}
        .right{flex:0 0 330px;border-left:1px solid #e3e3e3;overflow:auto;padding:10px;background:#fafafa;position:relative}.x{position:absolute;right:8px;top:8px;border:0;background:transparent;cursor:pointer;font-size:14px;color:#777}.legend{margin-top:14px;font-size:11.5px}
        .h{font-weight:700;margin:6px 0 6px;word-break:break-all}.h em{font-style:normal;color:#2f6feb;margin-left:4px}.h2{font-size:16px;font-weight:700;margin:0 0 8px}
        .yr{font-size:11px;color:#999;margin:8px 4px 3px;letter-spacing:.5px}
        .cyc{flex:1 1 auto;min-height:120px;overflow:auto;display:flex;flex-direction:column;gap:3px;margin-bottom:6px}.cyc button{text-align:left;width:100%;padding:5px 8px;border:1px solid #ddd;border-radius:6px;background:#fff;cursor:pointer;margin-bottom:3px}.cyc button.on{border-color:#2f6feb;background:#e8f0fe;font-weight:700}.cyc em{float:right;font-style:normal;color:#777}.nonebtn{text-align:left;padding:5px 8px;border:1px dashed #bbb;border-radius:6px;background:#fff;cursor:pointer}.nonebtn.on{border-color:#2f6feb;background:#e8f0fe;font-weight:700}.nonebtn em{float:right;font-style:normal;color:#777}
        .hosts{width:100%;border-collapse:collapse;font-size:12px}.hosts td{padding:3px 4px;border-bottom:1px solid #eee;vertical-align:top}.hosts tr.stale td{color:#b45309}.hosts .dim{font-size:10.5px}
        .strip{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 10px}.strip button{cursor:pointer;border:1px solid transparent}.strip button.on{outline:2px solid #2f6feb}
        .tag{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;background:#eee}.tag em{font-style:normal;font-weight:700;margin-left:3px}
        .tag.s0{background:#e0ecff}.tag.s1{background:#dff5e3}.tag.s2{background:#ffe9cc}.tag.s3{background:#e9e2ff}.tag.s4{background:#fde2e2}.tag.s5{background:#fff3c4}.tag.s6{background:#e2f2f5}.tag.s7{background:#eee;color:#777}
        .kanban{display:flex;gap:10px;align-items:flex-start;overflow-x:auto;padding-bottom:10px}
        .col{flex:0 0 230px;background:#f3f4f6;border-radius:8px;padding:6px;max-height:calc(100vh - 230px);overflow:auto}.col.un{background:#f8f8f8;border:1px dashed #ccc}.ch{font-weight:700;margin:2px 4px 6px;position:sticky;top:0;background:inherit}.ch em{font-style:normal;color:#2f6feb;margin-left:4px}.empty{color:#bbb;text-align:center;padding:8px}
        .card{background:#fff;border:1px solid #e3e3e3;border-radius:7px;padding:6px 8px;margin-bottom:6px;cursor:pointer}.card:hover{border-color:#2f6feb}.card.on{border-color:#2f6feb;box-shadow:0 0 0 2px #e8f0fe}.card.sens{border-left:3px solid #b45309}
        .fn{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.meta{color:#777;font-size:11.5px;margin-top:2px}
        .lst{width:100%;min-width:640px;border-collapse:collapse;background:#fff;table-layout:fixed}.lst th{text-align:left;padding:6px 8px;border-bottom:2px solid #ddd;cursor:pointer;white-space:nowrap;font-size:12px;color:#555;position:sticky;top:0;background:#fff}.lst th.on{color:#2f6feb}
        .lst td{padding:5px 8px;border-bottom:1px solid #eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lst tr{cursor:pointer}.lst tr:hover td{background:#f5f8ff}.lst tr.on td{background:#e8f0fe}.lst tr.sens td.fn{border-left:3px solid #b45309}
        .lst th:nth-child(1){width:auto}.lst th:nth-child(n+2){width:96px}.lst .v{margin-left:4px;font-size:11px;color:#2f6feb}
        .day{font-weight:700;margin:12px 0 4px}.day em{font-style:normal;color:#2f6feb}
        .kv{width:100%;border-collapse:collapse;margin:6px 0}.kv td{padding:3px 4px;vertical-align:top;border-bottom:1px solid #eee;word-break:break-all}.kv td:first-child{color:#777;width:80px;white-space:nowrap}
        .acts{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin:8px 0}.acts.edit{padding:8px;background:#f3f4f6;border-radius:8px}.btn{background:#2f6feb;color:#fff;padding:5px 12px;border-radius:6px;text-decoration:none}.acts select,.acts input,.acts button{padding:4px 6px;border:1px solid #ccc;border-radius:6px;background:#fff}.cy{width:90px}
        .log,.vers{margin-top:10px;font-size:12px}.vers div{padding:3px 4px;cursor:pointer;border-radius:4px}.vers div.on{background:#e8f0fe}.vers div:hover{background:#eef}
        @media (max-width:1200px){.right{position:fixed;right:0;top:60px;bottom:0;width:min(360px,92vw);box-shadow:-4px 0 16px rgba(0,0,0,.12);z-index:20}}
        @media (max-width:900px){.body{flex-direction:column}.left{flex:0 0 auto;border:0;border-bottom:1px solid #e3e3e3;max-height:38vh}}
      `}</style>
    </div>
  );
}
