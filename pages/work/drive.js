// pages/work/drive.js
// 업무 드라이브 — 직원 PC에서 자동 업로드된 업무 파일을 "연도·차수 × 단계 × 사람"으로 본다.
// 상단: 범위·사람·검색·보기 / 좌: 연도별 차수 / 우측 끝: 접을 수 있는 관리자 PC 현황
// 중: 선택 차수의 단계 요약띠 + 칸반 또는 표 / 우: 파일 상세(버전·내려받기·교정)
// 접근 범위는 서버(lib/workDrive)가 이미 걸러서 준다 — 화면은 받은 것만 보여준다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { fileSubcategory, filterCategories, subcategoryCounts } from '../../lib/workDriveCategories';
import { isKakaoInbound, securityEvent, securityRows, securityCounts } from '../../lib/workDriveSecurity';

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
// 차수 → 기준 수요일 (루트 CLAUDE.md 규칙 3: Week N 시작일 = 1/1 + (N-1)*7일, 그 날과 같거나 바로 앞의 수요일). 정오로 만들어 시간대 밀림 방지
const cycleWed = (year, cycle) => { const n = parseInt(String(cycle || '').split('-')[0], 10); if (!(year > 2000) || !(n > 0)) return null; const d = new Date(year, 0, (n - 1) * 7 + 1, 12); d.setDate(d.getDate() - ((d.getDay() - 3 + 7) % 7)); return d; };
const fmtMD = (d) => d ? `${d.getMonth() + 1}/${d.getDate()}` : '';

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
  const [subF, setSubF] = useState('');
  const [hostsOpen, setHostsOpen] = useState(true);
  const chooseStage = (value) => { setStageF(value); setSubF(''); };

  const load = async () => {
    try { const r = await fetch('/api/work/drive', { cache: 'no-store' }); const j = await r.json(); if (!j.success) throw new Error(j.error || '실패'); setData(j); setErr(''); }
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
  const clearF = () => { setDeptF(''); setExtF(''); setDirF(''); setPeriodF(''); setSensF(''); setVerF(''); chooseStage(''); };

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
  const categoryBase = view === 'recent' || q ? scoped : inCycle;
  const categoryRows = filterCategories(categoryBase, stageF, subF);
  const listRows = useMemo(() => {
    const base = filterCategories(view === 'recent' || q ? scoped : inCycle, stageF, subF);
    const [k, d] = sort; const val = (f) => (k === 'cycle' ? cycleKey(f.cycle) : k === 'size' ? f.size : k === 'stage' ? fileSubcategory(f) : String(f[k] || ''));
    return base.sort((a, b) => (val(a) > val(b) ? d : val(a) < val(b) ? -d : 0)).slice(0, view === 'recent' ? 200 : 2000);
  }, [scoped, inCycle, view, q, stageF, subF, sort]);

  const fix = async (id, patch) => { const r = await fetch('/api/work/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...patch }) }); const j = await r.json(); if (!j.success) { alert(j.error); return; } await load(); if (sel?.id === id) setSel(j.item); };
  const reclassAll = async () => { if (!confirm('규칙으로 전체 재분류할까요? 손으로 고친 파일은 그대로 둡니다.')) return; setBusy('재분류 중…'); const r = await fetch('/api/work/drive', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reclassifyAll' }) }); const j = await r.json(); setBusy(''); alert(j.success ? `검사 ${j.scanned}건 · 바뀜 ${j.changed}건` : j.error); await load(); };
  const openLog = async (id) => { const r = await fetch('/api/work/drive?log=' + encodeURIComponent(id)); const j = await r.json(); setLog(j.log || []); };
  // 보안 이력(유출 경로): 관리자만. 차단·알림 없이 기록만 본다.
  const [eg, setEg] = useState(null); const [egKind, setEgKind] = useState(''); const [egWho, setEgWho] = useState(''); const [egDays, setEgDays] = useState('30'); const [egQ, setEgQ] = useState('');
  const [tl, setTl] = useState(null);
  const [egScope, setEgScope] = useState('review');
  const [egError, setEgError] = useState('');
  const [egLoading, setEgLoading] = useState(false);
  const egRequest = useRef(0);
  const loadEg = async () => {
    const request = ++egRequest.current;
    setEgLoading(true); setEgError('');
    try {
      // Fetch the authorized period/person/search once; direction/type counts share this scope.
      const p = new URLSearchParams({ days: egDays, who: egWho, q: egQ });
      const r = await fetch('/api/work/drive-egress?' + p, { cache: 'no-store' }); const j = await r.json();
      if (!r.ok || !j.success || !Array.isArray(j.rows)) throw new Error(j.error || '보안이력을 불러오지 못했습니다.');
      if (request === egRequest.current) setEg(j.rows);
    } catch (e) { if (request === egRequest.current) { setEg(null); setEgError(e.message); } }
    finally { if (request === egRequest.current) setEgLoading(false); }
  };
  const egCounts = securityCounts(eg || []);
  const egVisible = securityRows(eg || [], egScope, egKind);
  const egTypes = egScope === 'reference' ? [['inbound', '카카오톡 수신'], ['download', '내려받기']]
    : egScope === 'review' ? [['copy', '외부 위치 복사'], ['print', '인쇄'], ['email', '이메일 첨부'], ['webupload', '웹 업로드'], ['kakao', '카카오톡 전송']]
    : [['inbound', '카카오톡 수신'], ['copy', '외부 위치 복사'], ['print', '인쇄'], ['email', '이메일 첨부'], ['webupload', '웹 업로드'], ['kakao', '카카오톡 전송'], ['download', '내려받기']];
  const openTl = async (id) => { const r = await fetch('/api/work/drive-egress?timeline=' + encodeURIComponent(id)); const j = await r.json(); setTl(j.timeline || []); };
  // 나간 파일의 내용 보기(시트 첫 행) — 관리자. 이력 행 id 기준.
  const [pv, setPv] = useState(null);
  const openPv = async (r) => { setPv({ row: r, loading: true }); const x = await fetch('/api/work/drive-egress?preview=' + encodeURIComponent(r.id)); const j = await x.json(); setPv({ row: r, ...j }); };
  // "어디로" 열: 유형별로 사람이 읽는 문장
  // "어디로" — 유형별로 사람이 읽는 문장. 카톡 '받은 파일'(destKind kakao-in / 옛 행은 경로로 판별)은 유출이 아니라 수신.
  const isInbound = isKakaoInbound;
  const DEST_KO = { usb: '이동식 저장장치(USB·외장)', network: '네트워크 공유 드라이브', onedrive: 'OneDrive 동기화 폴더', googledrive: 'Google Drive 동기화 폴더', dropbox: 'Dropbox 동기화 폴더', mybox: '네이버 MYBOX 동기화 폴더', icloud: 'iCloud 동기화 폴더' };
  const egWhere = (r) => {
    if (isInbound(r)) return { head: '카카오톡에서 받은 파일 (외부 → 이 PC)', lines: [r.dest] };
    if (r.kind === 'print') return { head: r.destKind === 'print-to-file' ? `파일로 출력 · ${r.dest || ''}` : `프린터 ${r.dest || '?'}`, lines: [r.detail, r.app && `인쇄한 프로그램 ${r.app}`].filter(Boolean) };
    if (r.kind === 'email') return { head: `이메일 → ${r.dest || '(받는 사람 미상)'}`, lines: [r.detail].filter(Boolean) };
    if (r.kind === 'copy') return { head: `${DEST_KO[r.destKind] || r.destKind || '복사'} → ${r.dest || ''}`, lines: [r.detail].filter(Boolean) };
    if (r.kind === 'kakao') return { head: `카톡방 "${r.dest || '?'}" 으로 전송`, lines: [r.detail].filter(Boolean) };
    if (r.kind === 'webupload') return { head: `웹사이트 ${r.dest || '?'} 에 업로드`, lines: [r.detail, r.app].filter(Boolean) };
    return { head: [r.destKind, r.dest || r.app].filter(Boolean).join(' · '), lines: [r.detail].filter(Boolean) };
  };
  useEffect(() => { if (view === 'security' && data?.isAdmin) loadEg(); }, [view, egWho, egDays]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setTl(null); if (sel && data?.isAdmin) openTl(sel.id); }, [sel?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (f) => { setSel(f); setLog(null); };
  const th = (k, label) => <th onClick={() => setSort(([pk, pd]) => [k, pk === k ? -pd : -1])} className={sort[0] === k ? 'on' : ''}>{label}{sort[0] === k ? (sort[1] < 0 ? ' ▼' : ' ▲') : ''}</th>;


  // ── 표시 요소 (참고 구조: Google Drive 툴바+종류 배지 / Linear 사이드바 섹션·밀도 / Notion 표면감) ──
  const kind = (f) => extKind(f);
  const KIND = { xls: ['XLS', '#1e7e4a', '#dcf3e6'], pdf: ['PDF', '#c2410c', '#ffe4d6'], doc: ['DOC', '#2f5fd0', '#dfe8ff'], img: ['IMG', '#7c3aed', '#ede4ff'], etc: ['FILE', '#6b7280', '#eceef2'] };
  const Badge = ({ f, sm }) => { const [t, c, bg] = KIND[kind(f)]; return <span className={'badge' + (sm ? ' sm' : '')} style={{ color: c, background: bg }}>{t}</span>; };
  const Avatar = ({ name }) => <span className="av">{String(name || '?').slice(0, 1)}</span>;
  const STAGE_C = ['#3b6cf6', '#16a34a', '#ea580c', '#7c3aed', '#dc2626', '#ca8a04', '#0891b2', '#9ca3af'];
  const Dot = ({ s }) => <i className="dot" style={{ background: STAGE_C[stages.indexOf(s)] || '#9ca3af' }} />;

  const Card = ({ f }) => (
    <div className={'card' + (sel?.id === f.id ? ' on' : '')} onClick={() => pick(f)} title={f.filename}>
      <div className="row"><Badge f={f} sm /><span className="fn">{f.filename}</span></div>
      <div className="meta"><span>{fileSubcategory(f)}</span><span>·</span><Avatar name={f.uploaderName} />{f.uploaderName || '?'}<span>·</span>{fmtT(f.uploadedAt)}{f.version > 1 && <span className="pill">v{f.version}</span>}{f.sensitive && <span className="pill lock">🔒 민감</span>}</div>
    </div>
  );
  const Row = ({ f, withCycle }) => (
    <tr className={sel?.id === f.id ? 'on' : ''} onClick={() => pick(f)}>
      <td className="fn" title={f.filename}><Badge f={f} sm /><span className="name">{f.filename}</span>{f.version > 1 && <span className="pill">v{f.version}</span>}{f.sensitive && <span className="pill lock">🔒</span>}</td>
      <td><span className="who"><Avatar name={f.uploaderName} />{f.uploaderName || '?'}</span></td>
      {withCycle && <td>{f.cycle ? <span className="pill cyc">{f.cycle}</span> : <span className="dim">—</span>}</td>}
      <td title={`${f.stage} › ${fileSubcategory(f)}`}><span className="stg"><Dot s={f.stage} />{fileSubcategory(f) || f.stage}</span></td>
      <td className="dim" title={fmtT(f.uploadedAt)}>{view === 'recent' ? ago(f.uploadedAt) : fmtT(f.uploadedAt)}</td>
      <td className="dim r">{fmtS(f.size)}</td>
    </tr>
  );
  const Table = ({ rows, withCycle }) => rows.length === 0 ? <div className="empty-state">조건에 맞는 파일이 없습니다</div> : (
    <div className="tbl-wrap"><table className="lst"><thead><tr>{th('filename', '파일')}{th('uploaderName', '올린 사람')}{withCycle && th('cycle', '차수')}{th('stage', '세부 분류')}{th('uploadedAt', '올린 시각')}{th('size', '크기')}</tr></thead>
      <tbody>{rows.map((f) => <Row key={f.id} f={f} withCycle={withCycle} />)}</tbody></table></div>
  );
  const Sel = ({ value, onChange, children }) => <select className={'sel' + (value ? ' on' : '')} value={value} onChange={(e) => onChange(e.target.value)}>{children}</select>;

  const curWed = cur && cur !== NONE ? cycleWed(parseInt(cur.split(':')[0], 10), cur.split(':')[1]) : null;
  const curLabel = cur === NONE ? '차수 없는 파일' : cur ? `${cur.split(':')[0]}년 ${cur.split(':')[1]}차` : '';
  const sc = stageCount(categoryBase);
  const visibleCounts = stageCount(categoryRows);
  const subCounts = subcategoryCounts(categoryBase, stageF);
  const categoryTabs = <div className="category-nav" aria-label="파일 분류">
    <div className="strip" role="group" aria-label="대분류">
      <button className={'stg-chip' + (!stageF ? ' on' : '')} aria-pressed={!stageF} onClick={() => chooseStage('')}>전체 <em>{categoryBase.length}</em></button>
      {stages.map((s) => <button key={s} className={'stg-chip' + (stageF === s ? ' on' : '') + (!sc[s] ? ' zero' : '')} aria-pressed={stageF === s} onClick={() => chooseStage(s)}><Dot s={s} />{s}<em>{sc[s]}</em></button>)}
    </div>
    {stageF ? <div className="subtabs" role="group" aria-label={`${stageF} 세부 분류`}>
      <strong>{stageF}</strong>
      <button className={!subF ? 'on' : ''} aria-pressed={!subF} onClick={() => setSubF('')}>전체 {sc[stageF]}</button>
      {Object.entries(subCounts).map(([label, n]) => <button key={label} className={subF === label ? 'on' : ''} aria-pressed={subF === label} onClick={() => setSubF(label)}>{label} <span>{n}</span></button>)}
      <small>파일명 기준 · 기존 분류 유지</small>
    </div> : <div className="category-hint">대분류를 누르면 세부 분류로 좁혀 볼 수 있습니다.</div>}
  </div>;
  const stale = (t) => Date.now() - new Date(t) > 3 * 86400e3;

  return (
    <div className="wd">
      {/* ── 툴바 ── */}
      <header className="top">
        <div className="title">
          <h1 data-desktop-chrome>업무 드라이브</h1>
          <span className="sub">{data ? <>{data.me}{data.dept ? ` · ${data.dept}` : ''} <b>{files.length.toLocaleString()}</b>개 파일</> : '불러오는 중…'}</span>
        </div>
        <label className="search"><span className="ico">⌕</span><input placeholder="파일명 · 이름 · 차수(38-2) 검색" value={q} onChange={(e) => setQ(e.target.value)} />{q && <button className="clr" onClick={() => setQ('')}>✕</button>}</label>
        <div className="seg">{[['kanban', '칸반'], ['list', '목록'], ['recent', '최근'], ...(data?.isAdmin ? [['security', '보안 이력']] : [])].map(([k, l]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{l}</button>)}</div>
        <div className="grow" />
        <button className="ghost" onClick={load} title="새로고침">↻</button>
        {data?.isAdmin && <button className="ghost" onClick={reclassAll} disabled={!!busy}>{busy || '일괄 재분류'}</button>}
      </header>

      {/* ── 범위 · 사람 · 필터 ── */}
      <div className="filters">
        <div className="seg soft">{[['mine', '내 파일'], ['dept', '내 부서'], ['all', '전체']].map(([k, l]) => <button key={k} className={scope === k && !who ? 'on' : ''} onClick={() => { setScope(k); setWho(''); }}>{l}</button>)}</div>
        {people.length > 1 && <div className="chips">{people.map((p) => <button key={p.name} className={who === p.name ? 'on' : ''} onClick={() => setWho(who === p.name ? '' : p.name)} title={`${p.dept || ''} · 마지막 ${fmtT(p.last)}`}><Avatar name={p.name} />{p.name}<em>{p.n}</em></button>)}</div>}
        <span className="sep" />
        <Sel value={deptF} onChange={setDeptF}><option value="">부서</option>{[...new Set(files.map((f) => f.dept).filter(Boolean))].map((d) => <option key={d}>{d}</option>)}</Sel>
        <Sel value={stageF} onChange={chooseStage}><option value="">대분류</option>{stages.map((s) => <option key={s}>{s}</option>)}</Sel>
        <Sel value={extF} onChange={setExtF}><option value="">종류</option><option value="xls">엑셀·CSV</option><option value="pdf">PDF</option><option value="doc">문서·PPT</option><option value="img">이미지</option><option value="etc">기타</option></Sel>
        <Sel value={dirF} onChange={setDirF}><option value="">폴더</option>{dirs.map(([d, n]) => <option key={d} value={d}>{d} ({n})</option>)}</Sel>
        <Sel value={periodF} onChange={setPeriodF}><option value="">기간</option><option value="1">오늘</option><option value="7">최근 7일</option><option value="30">최근 30일</option></Sel>
        <Sel value={sensF} onChange={setSensF}><option value="">민감</option><option value="sens">🔒 민감만</option><option value="plain">일반만</option></Sel>
        <Sel value={verF} onChange={setVerF}><option value="">버전</option><option value="multi">2개 이상</option></Sel>
        {anyF && <button className="link" onClick={clearF}>초기화</button>}
        <span className="cnt">{scoped.length.toLocaleString()}건</span>
      </div>
      {err && <p className="warn">{err}</p>}

      <div className="body">
        {/* ── 사이드바 ── */}
        <aside className="left" aria-label="연도별 차수">
          <section className="grow">
            <div className="sec">차수 <span>{allCk.length}</span></div>
            <div className="cyc">
              {years.length === 0 && <div className="dim pad">차수 파일 없음</div>}
              {years.map((y) => <div key={y.year}><div className="yr">{y.year}</div>{y.cycles.map((c, i) => <button key={c.ck} className={c.ck === cur ? 'on' : ''} onClick={() => { setCycle(c.ck); if (view === 'recent') setView('kanban'); }}><span>{c.c}차<small className="wd-date">{fmtMD(cycleWed(y.year, c.c))}</small>{y === years[0] && i === 0 && <em className="now">현재</em>}</span><span className="n">{c.n}</span></button>)}</div>)}
            </div>
            <button className={'nonebtn' + (cur === NONE ? ' on' : '')} onClick={() => { setCycle(NONE); if (view === 'recent') setView('list'); }}><span>차수 없음</span><span className="n">{noCycle.length}</span></button>
          </section>
        </aside>

        {/* ── 본문 ── */}
        <main className="main">
          {view !== 'security' && categoryTabs}
          {view === 'security' && data?.isAdmin ? <>
            <div className="h2">보안 이력 <span className="dim">파일 이동 방향과 작업 기록 · 유출 여부를 자동 확정하지 않습니다</span></div>
            <p className="security-note">카카오톡에서 받아 이 PC에 저장한 파일은 <b>수신 기록이며 유출이 아닙니다.</b> ‘수신·내부 기록’에서 별도로 확인할 수 있습니다. 원본 기록은 그대로 보관됩니다.</p>
            <div className="security-scope" role="group" aria-label="보안이력 구분">
              {[['review', '외부 전송·반출 확인'], ['reference', '수신·내부 기록'], ['all', '전체 활동']].map(([key, label]) => <button key={key} className={egScope === key ? 'on' : ''} aria-pressed={egScope === key} onClick={() => { setEgScope(key); setEgKind(''); }}>{label} <b>{eg && !egLoading ? egCounts[key] : '—'}</b></button>)}
            </div>
            <div className="strip">
              <button className={'stg-chip' + (egKind === '' ? ' on' : '')} onClick={() => setEgKind('')}>전체</button>
              {egTypes.map(([k, label]) => <button key={k} className={'stg-chip' + (egKind === k ? ' on' : '')} aria-pressed={egKind === k} onClick={() => setEgKind(k)}>{label} {eg && !egLoading ? securityRows(eg, egScope, k).length : '—'}</button>)}
              <select value={egWho} onChange={(e) => setEgWho(e.target.value)}><option value="">직원 전체</option>{[...new Set(files.map((f) => f.uploaderName).filter(Boolean))].sort().map((n) => <option key={n}>{n}</option>)}</select>
              <select value={egDays} onChange={(e) => setEgDays(e.target.value)}>{[['7', '7일'], ['30', '30일'], ['90', '90일'], ['365', '1년']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
              <input className="cy" style={{ width: 200 }} placeholder="파일명·목적지 검색" value={egQ} onChange={(e) => setEgQ(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && loadEg()} />
              <button className="ghost" onClick={loadEg}>↻</button>
            </div>
            {egError && <p className="warn" role="alert">{egError} 새로고침 버튼으로 다시 조회해 주세요.</p>}
            {egLoading && <div role="status">보안이력 불러오는 중…</div>}
            {eg && !egLoading && <p className="security-count">조회된 {egCounts.all}건 중 표시 {egVisible.length}건 · 카카오톡 수신 {egCounts.inbound}건은 반출 확인 대상에서 제외{eg.length >= 5000 ? ' · 최대 5,000건 조회: 기간/직원/검색으로 범위를 좁혀 주세요.' : ''}</p>}
            {eg && !egLoading && egVisible.length === 0 && <div className="empty-state">선택한 조건의 기록이 없습니다. 수신 기록은 ‘수신·내부 기록’에서 확인하세요.</div>}
            {eg && !egLoading && egVisible.length > 0 && <div className="tbl-wrap"><table className="lst eg"><thead><tr><th>시각</th><th>직원</th><th>유형·판단</th><th>파일</th><th>내용</th><th>이동 방향·목적지</th><th>원본 위치</th></tr></thead><tbody>
              {egVisible.map((r) => <tr key={r.id} className={isInbound(r) ? 'inbound' : r.fileSensitive ? 'sens' : ''}>
                <td className="dim" title={r.at}>{fmtT(r.at)}</td>
                <td><Avatar name={r.userName} />{r.userName || r.hostname}{r.dept && <span className="dim"> · {r.dept}</span>}</td>
                <td title={securityEvent(r).note}><span className="stg" style={{ color: securityEvent(r).color }}>{isInbound(r) ? '↓ ' : '○ '}{securityEvent(r).label}</span><small className="event-note">{isInbound(r) ? '유출 아님' : securityEvent(r).group === 'reference' ? '참고 기록' : '업무 목적 확인'}</small></td>
                <td title={r.filename}>{r.fileSensitive && '🔒 '}{r.filename}
                  {r.hasFile ? <> <a href={'/api/work/drive-egress?open=' + encodeURIComponent(r.id)} className="pill" style={{ marginLeft: 6 }}>열기</a><span className="dim"> {r.matchHow === 'sha' ? '내용 일치' : '이름 일치'}{r.fileStage ? ' · ' + r.fileStage : ''}</span></>
                    : <span className="pill" style={{ marginLeft: 6, color: '#9ca3af' }}>원본 없음</span>}</td>
                <td>{r.hasFile && r.previewKind ? <a onClick={() => openPv(r)} style={{ cursor: 'pointer' }}>{r.previewKind === 'sheet' ? '시트 보기' : '내용 보기'}</a> : r.hasFile ? <span className="dim">열기로 확인</span> : <span className="dim">—</span>}</td>
                <td className="where">{(() => { const w = egWhere(r); return <><div>{w.head}</div>{w.lines.map((l, i) => <div key={i} className="dim">{l}</div>)}</>; })()}</td>
                <td className="dim" title={r.path || ''}>{r.path ? r.path.replace(/^.*[\\/](?=[^\\/]+[\\/][^\\/]+$)/, '…\\') : (r.hostname || '')}</td>
              </tr>)}</tbody></table></div>}
            {pv && <div className="modal-bg" onClick={() => setPv(null)}><div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 960, width: '92vw', maxHeight: '85vh', overflow: 'auto' }}>
              <div className="h2">{pv.row.filename} <span className="dim">· {securityEvent(pv.row).label} · {securityEvent(pv.row).note} · {pv.row.userName} · {fmtT(pv.row.at)}</span>
                <a href={'/api/work/drive-egress?open=' + encodeURIComponent(pv.row.id)} className="pill" style={{ marginLeft: 8 }}>파일 열기</a><button className="ghost" style={{ float: 'right' }} onClick={() => setPv(null)}>닫기</button></div>
              {pv.loading ? <div className="dim">불러오는 중…</div> : !pv.success ? <div className="empty-state">{pv.error}</div>
                : pv.kind === 'sheet' ? <>{pv.sheetCount > pv.sheets.length && <div className="dim">시트 {pv.sheetCount}개 중 {pv.sheets.length}개 표시</div>}
                  {pv.sheets.map((s) => <section key={s.name} style={{ marginBottom: 12 }}><div className="day">{s.name}</div><div className="tbl-wrap"><table className="lst"><tbody>{s.rows.map((rw, i) => <tr key={i}>{rw.map((c, j) => <td key={j} className={i === 0 ? '' : 'dim'}>{c}</td>)}</tr>)}</tbody></table></div></section>)}</>
                : pv.kind === 'text' ? <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{pv.lines.join('\n')}</pre> : <div className="dim">{pv.note}</div>}
            </div></div>}
          </> : view === 'recent' ? <>
            <div className="h2">최근 올라온 파일 <span className="dim">{listRows.length}건 · 최신순</span></div>
            {listRows.length === 0 && <div className="empty-state">조건에 맞는 파일이 없습니다</div>}
            {Object.entries(listRows.reduce((m, f) => { (m[dayKey(f.uploadedAt)] ||= []).push(f); return m; }, {})).map(([d, rows]) => <section key={d} className="daysec"><div className="day">{d === today ? '오늘' : fmtD(d)} <em>{rows.length}</em></div><Table rows={rows} withCycle /></section>)}
          </> : !cur && !q ? <div className="empty-state">차수 파일이 없습니다. 왼쪽 ‘차수 없음’에서도 확인해 주세요.</div> : <>
            <div className="h2">{q ? <>&ldquo;{q}&rdquo; 검색 결과</> : curLabel}{!q && curWed && <span className="wed">기준 수요일 {curWed.getMonth() + 1}월 {curWed.getDate()}일</span>} <span className="dim">{categoryRows.length}개{stageF ? ` · ${stageF}${subF ? ' › ' + subF : ''}` : ''}</span></div>
            {showList ? <Table rows={listRows} withCycle={!!q || cur === NONE} /> : (
              <div className="kanban">
                {stages.filter((s) => !stageF || s === stageF).map((s) => <div className={'col' + (s === '미분류' ? ' un' : '') + (!visibleCounts[s] ? ' zero' : '')} key={s}><div className="ch"><Dot s={s} />{s}<em>{visibleCounts[s]}</em></div>{!visibleCounts[s] ? <div className="empty">조건에 맞는 파일 없음</div> : categoryRows.filter((f) => f.stage === s).map((f) => <Card key={f.id} f={f} />)}</div>)}
              </div>)}
          </>}
        </main>

        {/* ── 상세 서랍 ── */}
        {sel && <aside className="right">
          <div className="dh"><Badge f={sel} /><div className="dn">{sel.filename}</div><button className="x" onClick={() => setSel(null)} title="닫기">✕</button></div>
          <div className="dact">
            {sel.canDownload ? <a className="btn" href={'/api/work/drive?download=' + encodeURIComponent(sel.id)}>내려받기</a> : <span className="btn dis">내려받기 권한 없음</span>}
            {data?.isAdmin && <button className="ghost" onClick={() => openLog(sel.id)}>기록</button>}
          </div>
          <dl className="kv">
            <dt>올린 사람</dt><dd><Avatar name={sel.uploaderName} />{sel.uploaderName || '?'} {sel.dept && <span className="dim">· {sel.dept}</span>}</dd>
            <dt>PC · 폴더</dt><dd>{sel.hostname} <span className="dim">· {sel.sourceDir}</span></dd>
            <dt>차수</dt><dd>{sel.cycle ? `${sel.year}년 ${sel.cycle}차` : <span className="dim">없음</span>}</dd>
            <dt>세부 분류</dt><dd>{fileSubcategory(sel)} <span className="dim">· 파일명 기준</span></dd>
            <dt>단계</dt><dd><span className="stg"><Dot s={sel.stage} />{sel.stage}</span> <span className="dim">{sel.correctedBy && sel.correctedBy !== 'auto-reclassify' ? '· 사람이 교정' : `· 자동 ${Math.round((sel.confidence || 0) * 100)}%`}</span></dd>
            <dt>크기 · 버전</dt><dd>{fmtS(sel.size)} · v{sel.version}</dd>
            <dt>파일 수정</dt><dd>{sel.mtime ? fmtT(sel.mtime) : '—'}</dd>
            <dt>올린 시각</dt><dd>{fmtT(sel.uploadedAt)} <span className="dim">({ago(sel.uploadedAt)})</span></dd>
            {sel.sensitive && <><dt>보안</dt><dd className="lock">🔒 민감(금액·계약) — 경영지원·본인·사장만</dd></>}
          </dl>
          {(data?.isAdmin || sel.uploaderName === data?.me) && <div className="edit">
            <div className="sec">분류 교정</div>
            <div className="erow">
              <select value={sel.stage} onChange={(e) => fix(sel.id, { stage: e.target.value })}>{stages.map((s) => <option key={s}>{s}</option>)}</select>
              <input className="cy" placeholder="차수 38-2" defaultValue={sel.cycle} onBlur={(e) => e.target.value !== sel.cycle && fix(sel.id, { cycle: e.target.value })} />
              <button className="ghost danger" onClick={() => confirm('목록에서 숨길까요? (파일은 보관됩니다)') && fix(sel.id, { deleted: true })}>숨김</button>
            </div>
          </div>}
          {data?.isAdmin && tl && <div className="log"><div className="sec">파일 흐름 {tl.length}건</div>{tl.map((t, i) => <div key={i} className="dim"><span style={{ color: securityEvent(t).color }}>{securityEvent(t).label}{isInbound(t) ? ' · 유출 아님' : ''}</span> {fmtT(t.at)} · {t.userName} {t.detail && <span>· {t.detail}</span>}</div>)}</div>}
          {log && <div className="log"><div className="sec">내려받기 {log.length}건</div>{log.length === 0 && <div className="dim">없음</div>}{log.map((l, i) => <div key={i} className="dim">{fmtT(l.at)} · {l.byName || l.by}</div>)}</div>}
          <div className="vers"><div className="sec">같은 이름 버전</div>{files.filter((f) => f.filename === sel.filename && f.uploaderName === sel.uploaderName).sort((a, b) => b.version - a.version).map((f) => <div key={f.id} className={'ver' + (f.id === sel.id ? ' on' : '')} onClick={() => pick(f)}><span className="pill">v{f.version}</span>{fmtT(f.uploadedAt)}<span className="dim">· {fmtS(f.size)}</span></div>)}</div>
        </aside>}
        {data?.isAdmin && <aside className={'pc-panel' + (hostsOpen ? '' : ' collapsed')} aria-label="PC별 업로드 현황">
          <button className="pc-toggle" aria-expanded={hostsOpen} onClick={() => setHostsOpen(!hostsOpen)}>{hostsOpen ? 'PC별 업로드 ▸' : 'PC ◂'}</button>
          {hostsOpen && <><div className="pc-note">오늘 / 전체 파일 · 마지막 업로드</div><div className="hosts">{hosts.map((h) => <div key={h.name + '@' + h.host} className="host"><i className={'st' + (stale(h.last) ? ' off' : '')} /><div className="hn">{h.name}<small title={h.host}>{h.host}</small></div><div className="hv"><b>{h.today}</b>/{h.n}<small>{ago(h.last)}</small></div></div>)}</div></>}
        </aside>}
      </div>

      <style jsx>{`
.wd{--bg:#f6f7f9;--sf:#fff;--ln:#e6e8ec;--tx:#1a1d21;--mu:#6b7280;--ac:#3b6cf6;--acs:#eaf0ff;--r:10px;
            display:flex;flex-direction:column;height:calc(100vh - 60px);font-size:13px;color:var(--tx);background:var(--bg);
            font-family:Inter,"Pretendard","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.wd :global(.dim){color:var(--mu)}.wd :global(.r){text-align:right}.grow{flex:1 1 auto}.warn{color:#b45309;padding:6px 16px;margin:0}
button{font:inherit;color:inherit}
        /* 툴바 */
.top{display:flex;align-items:center;gap:12px;padding:10px 16px;background:var(--sf);border-bottom:1px solid var(--ln);flex-wrap:wrap}
.title h1{font-size:16px;font-weight:700;margin:0;letter-spacing:-.2px}.title .sub{font-size:12px;color:var(--mu)}.title .sub b{color:var(--tx);font-weight:600}
.search{display:flex;align-items:center;gap:6px;flex:1 1 260px;max-width:460px;padding:6px 10px;border:1px solid var(--ln);border-radius:var(--r);background:var(--bg)}
.search:focus-within{border-color:var(--ac);background:var(--sf);box-shadow:0 0 0 3px var(--acs)}.search .ico{color:var(--mu);font-size:15px}
.search input{flex:1;border:0;background:transparent;outline:0;font:inherit;min-width:0}.search .clr{border:0;background:transparent;color:var(--mu);cursor:pointer}
.seg{display:inline-flex;padding:3px;border-radius:var(--r);background:#eceef2;gap:2px}.seg button{border:0;background:transparent;padding:5px 11px;border-radius:7px;cursor:pointer;color:var(--mu);font-weight:500}
.seg button.on{background:var(--sf);color:var(--tx);box-shadow:0 1px 2px rgba(0,0,0,.08);font-weight:600}
.ghost{border:1px solid var(--ln);background:var(--sf);padding:6px 11px;border-radius:8px;cursor:pointer}.ghost:hover{border-color:#cfd3da;background:#fafbfc}.ghost:disabled{color:var(--mu)}.ghost.danger{color:#b91c1c}
.link{border:0;background:transparent;color:var(--ac);cursor:pointer;padding:4px 6px}
        /* 필터 행 */
.filters{display:flex;align-items:center;gap:8px;padding:8px 16px;background:var(--sf);border-bottom:1px solid var(--ln);flex-wrap:wrap}
.sep{width:1px;height:20px;background:var(--ln);margin:0 2px}
.chips{display:flex;gap:6px;flex-wrap:wrap}.chips button{display:inline-flex;align-items:center;gap:6px;padding:3px 10px 3px 4px;border:1px solid var(--ln);border-radius:20px;background:var(--sf);cursor:pointer}
.chips button:hover{border-color:#cfd3da}.chips button.on{border-color:var(--ac);background:var(--acs);color:#2450c8;font-weight:600}.chips em{font-style:normal;color:var(--mu);font-size:11px}
.wd :global(.av){display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:50%;background:#dfe3ea;color:#3c4452;font-size:11px;font-weight:700;flex:0 0 20px}
.wd :global(.sel){appearance:none;-webkit-appearance:none;padding:5px 24px 5px 10px;border:1px solid var(--ln);border-radius:8px;background:var(--sf) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%236b7280' fill='none' stroke-width='1.5'/%3E%3C/svg%3E") no-repeat right 9px center;font:inherit;max-width:180px;cursor:pointer}
.wd :global(.sel.on){border-color:var(--ac);background-color:var(--acs);color:#2450c8;font-weight:600}
.cnt{margin-left:auto;color:var(--mu);font-variant-numeric:tabular-nums}
        /* 레이아웃 */
.body{display:flex;flex:1 1 auto;min-height:0}
.left{flex:0 0 190px;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--ln);background:var(--sf);overflow:auto}
.pc-panel{flex:0 0 196px;min-width:0;overflow:auto;border-left:1px solid var(--ln);padding:10px 6px;background:#fafbfc}.pc-panel.collapsed{flex-basis:54px;padding:10px 3px}
.pc-toggle{width:100%;text-align:left;border:0;background:transparent;color:var(--mu);font:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:5px}.pc-note{font-size:10px;color:var(--mu);padding:4px 5px 8px}.hn small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wd :global(.category-nav){margin-bottom:12px}.wd :global(.category-nav .strip){display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px}.wd :global(.category-hint){font-size:11px;color:var(--mu)}
.wd :global(.category-nav .stg-chip){display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--ln);border-radius:20px;background:var(--sf);cursor:pointer;font:inherit}.wd :global(.category-nav .stg-chip.on){border-color:var(--ac);background:var(--acs);color:#2450c8;font-weight:600}.wd :global(.category-nav .stg-chip.zero){color:var(--mu)}.wd :global(.category-nav .stg-chip em){font-style:normal;font-weight:600}
.wd :global(.subtabs){display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px;background:var(--sf);border:1px solid var(--ln);border-radius:10px}.wd :global(.subtabs strong){font-size:12px;margin-right:4px}.wd :global(.subtabs button){border:1px solid var(--ln);border-radius:6px;padding:5px 9px;background:var(--sf);font:inherit;cursor:pointer}.wd :global(.subtabs button.on){border-color:var(--ac);background:var(--acs);color:#2450c8;font-weight:600}.wd :global(.subtabs small){font-size:10px;color:var(--mu)}
.left section{padding:10px 10px 6px}.left section.grow{flex:1 1 auto;display:flex;flex-direction:column;min-height:0}
.sec{font-size:11px;font-weight:600;letter-spacing:.4px;text-transform:uppercase;color:var(--mu);margin:0 4px 6px;display:flex;justify-content:space-between}
.hosts{display:flex;flex-direction:column;gap:2px}.host{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:8px}.host:hover{background:var(--bg)}
.st{width:8px;height:8px;border-radius:50%;background:#22c55e;flex:0 0 8px}.st.off{background:#f59e0b}
.hn{flex:1;min-width:0;line-height:1.15}.hn small,.hv small{display:block;color:var(--mu);font-size:10.5px}.hv{text-align:right;font-variant-numeric:tabular-nums;line-height:1.15}.hv b{font-weight:600}
.cyc{flex:1 1 auto;min-height:140px;overflow:auto;display:flex;flex-direction:column}.yr{font-size:11px;color:var(--mu);margin:8px 6px 3px}
.cyc button,.nonebtn{display:flex;justify-content:space-between;align-items:center;width:100%;padding:6px 8px 6px 10px;border:0;border-left:2px solid transparent;border-radius:0 8px 8px 0;background:transparent;cursor:pointer;text-align:left}
.cyc button:hover,.nonebtn:hover{background:var(--bg)}.cyc button.on,.nonebtn.on{background:var(--acs);border-left-color:var(--ac);color:#2450c8;font-weight:600}
.wd :global(.n){color:var(--mu);font-size:11.5px;font-variant-numeric:tabular-nums}.now{font-style:normal;margin-left:6px;font-size:10px;padding:1px 6px;border-radius:10px;background:var(--ac);color:#fff;font-weight:600;vertical-align:1px}
.nonebtn{margin-top:6px;border-top:1px dashed var(--ln);border-radius:0}
.main{flex:1 1 auto;min-width:0;overflow:auto;padding:14px 16px}
.h2{font-size:17px;font-weight:700;margin:0 0 10px;letter-spacing:-.2px}.wd :global(.h2 .dim){font-size:12.5px;font-weight:500;margin-left:6px}
.strip{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px}
.stg-chip{display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border:1px solid var(--ln);border-radius:20px;background:var(--sf);cursor:pointer}
.stg-chip.zero{color:var(--mu)}.stg-chip.on{border-color:var(--ac);background:var(--acs);color:#2450c8;font-weight:600}.stg-chip em{font-style:normal;font-weight:600;font-variant-numeric:tabular-nums}
.wd :global(.dot){display:inline-block;width:8px;height:8px;border-radius:50%;flex:0 0 8px}.wd :global(.stg){display:inline-flex;align-items:center;gap:6px}
        /* 칸반 */
.kanban{display:flex;gap:12px;align-items:flex-start;overflow-x:auto;padding-bottom:12px}
.col.zero{flex:0 0 150px;opacity:.7}.wd :global(.wd-date){margin-left:6px;color:var(--mu);font-weight:400;font-size:11px}.wed{margin-left:8px;font-size:12.5px;font-weight:500;color:#2450c8;background:var(--acs);padding:2px 8px;border-radius:10px;vertical-align:2px}
        .col{flex:0 0 250px;background:#eef0f3;border-radius:12px;padding:8px;max-height:calc(100vh - 250px);overflow:auto}.col.un{background:#f3f4f6;outline:1px dashed #d1d5db}
.ch{display:flex;align-items:center;gap:6px;font-weight:600;padding:4px 6px 8px;position:sticky;top:0;background:inherit;z-index:1}.ch em{font-style:normal;margin-left:auto;font-size:11.5px;color:var(--mu);background:var(--sf);padding:1px 7px;border-radius:10px}
.empty{color:#9ca3af;text-align:center;padding:14px;font-size:12px}
.wd :global(.card){background:var(--sf);border:1px solid transparent;border-radius:10px;padding:8px 10px;margin-bottom:6px;cursor:pointer;box-shadow:0 1px 2px rgba(16,24,40,.05);transition:box-shadow .12s,border-color .12s}
.wd :global(.card:hover){box-shadow:0 3px 10px rgba(16,24,40,.10)}.wd :global(.card.on){border-color:var(--ac);box-shadow:0 0 0 3px var(--acs)}
.wd :global(.card .row){display:flex;align-items:center;gap:7px;min-width:0}.wd :global(.fn){font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0}
.wd :global(.meta){display:flex;align-items:center;gap:5px;color:var(--mu);font-size:11.5px;margin-top:5px;flex-wrap:wrap}.wd :global(.meta .av){width:16px;height:16px;flex-basis:16px;font-size:9.5px}
.wd :global(.badge){display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:800;letter-spacing:.3px;border-radius:6px;padding:0 6px;height:24px;min-width:34px;flex:0 0 auto}.wd :global(.badge.sm){height:18px;font-size:9px;min-width:30px;border-radius:5px}
.wd :global(.pill){display:inline-block;font-size:10.5px;padding:1px 6px;border-radius:10px;background:#eceef2;color:#3c4452;margin-left:6px;font-weight:600}.wd :global(.pill.lock){background:#fff1e6;color:#b45309}.wd :global(.pill.cyc){margin:0;background:var(--acs);color:#2450c8}
        /* 표 */
.wd :global(.tbl-wrap){background:var(--sf);border:1px solid var(--ln);border-radius:12px;overflow:auto}
.wd :global(.lst){width:100%;min-width:680px;border-collapse:collapse;table-layout:fixed}
.wd :global(.lst th){text-align:left;padding:8px 12px;font-size:11.5px;font-weight:600;color:var(--mu);border-bottom:1px solid var(--ln);cursor:pointer;white-space:nowrap;position:sticky;top:0;background:var(--sf);user-select:none}.wd :global(.lst th.on){color:var(--ac)}
.wd :global(.lst td){padding:7px 12px;border-bottom:1px solid #f0f1f4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;vertical-align:middle}.wd :global(.lst tr:last-child td){border-bottom:0}
.wd :global(.lst tr){cursor:pointer}.wd :global(.lst tbody tr:hover td){background:#f8f9fb}.wd :global(.lst tr.on td){background:var(--acs)}
.wd :global(.lst th:nth-child(1)){width:auto}.wd :global(.lst th:nth-child(n+2)){width:104px}.wd :global(.lst th:last-child){width:76px}
.wd :global(.lst.eg th:nth-child(n+2)){width:auto}.wd :global(.lst.eg th:nth-child(1)){width:96px}.wd :global(.lst.eg th:nth-child(3)){width:96px}.wd :global(.lst.eg tr){cursor:default}.wd :global(.lst.eg tr.sens td){background:#fff7f0}
.security-note{margin:0 0 10px;padding:10px 12px;border:1px solid #bae6d3;border-radius:8px;background:#f0fdf7;color:#16624b;line-height:1.5}.security-scope{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px}.security-scope button{font:inherit;padding:8px 12px;border:1px solid var(--ln);border-radius:8px;background:#fff;cursor:pointer}.security-scope button.on{border-color:var(--ac);background:var(--acs);color:#2450c8;font-weight:600}.security-scope b{margin-left:6px}.security-count{font-size:12px;color:var(--mu);margin:8px 0}.wd :global(.lst.eg tr.inbound td){background:#f0fdf7}.event-note{display:block;font-size:10px;color:var(--mu);margin-top:3px}.wd :global(.lst.eg th:nth-child(3)){width:140px}
.wd :global(.lst td.fn){display:flex;align-items:center;gap:8px;font-weight:500}.wd :global(.lst .name){overflow:hidden;text-overflow:ellipsis}.wd :global(.who){display:inline-flex;align-items:center;gap:6px}
.daysec{margin-bottom:16px}.day{font-weight:600;margin:0 0 6px;color:var(--tx)}.day em{font-style:normal;color:var(--mu);margin-left:6px;font-weight:500}
.wd :global(.empty-state){color:var(--mu);text-align:center;padding:48px 20px;background:var(--sf);border:1px dashed var(--ln);border-radius:12px}
.pad{padding:6px 10px}
        /* 상세 서랍 */
.right{flex:0 0 340px;border-left:1px solid var(--ln);background:var(--sf);overflow:auto;padding:14px 16px;position:relative}
.dh{display:flex;align-items:flex-start;gap:10px}.dn{flex:1;font-weight:700;font-size:14px;line-height:1.3;word-break:break-all}
.x{border:0;background:transparent;color:var(--mu);cursor:pointer;font-size:14px;padding:2px 4px;border-radius:6px}.x:hover{background:var(--bg)}
.dact{display:flex;gap:8px;margin:12px 0 14px}
.btn{display:inline-block;background:var(--ac);color:#fff;padding:7px 14px;border-radius:8px;text-decoration:none;font-weight:600}.btn:hover{background:#2f5be0}.btn.dis{background:#eceef2;color:var(--mu);font-weight:500}
.kv{display:grid;grid-template-columns:76px 1fr;gap:7px 10px;margin:0;font-size:12.5px}.kv dt{color:var(--mu)}.kv dd{margin:0;display:flex;align-items:center;gap:6px;flex-wrap:wrap;word-break:break-all}.wd :global(.kv .av){width:18px;height:18px;flex-basis:18px;font-size:10px}
.lock{color:#b45309}
.edit{margin-top:16px;padding:10px;border-radius:10px;background:var(--bg)}.erow{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.erow select,.erow input{padding:5px 8px;border:1px solid var(--ln);border-radius:8px;background:var(--sf);font:inherit}.cy{width:96px}
.wd :global(td.where){white-space:normal;max-width:380px;line-height:1.35}
.modal-bg{position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:50;display:flex;align-items:center;justify-content:center}.modal{background:#fff;border-radius:12px;padding:16px 18px;box-shadow:0 20px 60px rgba(0,0,0,.25)}
.log,.vers{margin-top:16px;font-size:12px}.ver{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:8px;cursor:pointer}.wd :global(.ver .pill){margin:0}.ver:hover{background:var(--bg)}.ver.on{background:var(--acs)}
        @media (max-width:1500px){.right{position:fixed;right:0;top:60px;bottom:0;width:min(360px,92vw);box-shadow:-8px 0 24px rgba(16,24,40,.12);z-index:20}}
        @media (max-width:900px){.body{flex-direction:column}.left{flex:0 0 auto;border-right:0;border-bottom:1px solid var(--ln);max-height:24vh}.left section.grow{min-height:120px}.cyc{min-height:60px}.pc-panel,.pc-panel.collapsed{flex:0 0 auto;max-height:18vh;border-left:0;border-top:1px solid var(--ln)}.main{min-height:180px}.wd{height:auto;min-height:calc(100vh - 60px)}.body{min-height:0}.main{overflow:visible}.pc-panel .hosts{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr))}}
      `}</style>
    </div>
  );
}
