// components/pm/StaffRequests.js
// /pm "직원 요청" 게시판 서랍 — 오류·요청을 쓰면 PM(사장님 PC nenova-pm/pm-staff.js)이 분류·답변·수정(PR)한다.
//   API: /api/pm/staff-requests (GET 목록·POST 작성), /api/pm/staff-requests/[id] (PATCH, 작성자·관리자), /shot?id= (스크린샷)
//   색은 var(--pm-*) 토큰만, 버튼은 components/pm/ui.js 키트만.
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, IconButton, ToggleChip } from './ui';
import { STAFF_REQ_CATEGORIES, STAFF_REQ_STATUSES, categoryLabel, statusLabel } from '../../lib/pmStaffReqLabels';

const TONE = { received: 'plain', triaged: 'plain', working: 'live', pr: 'live', deployed: 'ok', answered: 'ok', 'needs-human': 'warn', rejected: 'warn' };
const kst = (iso) => { const t = Date.parse(iso || ''); if (!Number.isFinite(t)) return ''; const d = new Date(t + 9 * 3600e3); return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

// 이미지 → 최대 1280px JPEG data URL(700KB 이하가 되도록 품질 낮춤)
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, 1280 / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      for (const q of [0.8, 0.6, 0.45, 0.3]) { const u = c.toDataURL('image/jpeg', q); if (u.length * 0.75 < 680 * 1024) return resolve(u); }
      reject(new Error('이미지가 너무 큽니다'));
    };
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다'));
    img.src = URL.createObjectURL(file);
  });
}

function Composer({ onDone, initial, id }) {
  const [category, setCategory] = useState(initial?.category || 'error');
  const [title, setTitle] = useState(initial?.title || '');
  const [body, setBody] = useState(initial?.body || '');
  const [shot, setShot] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pageUrl = typeof window !== 'undefined' ? (document.referrer && new URL(document.referrer).origin === window.location.origin ? document.referrer : window.location.href) : '';
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      const r = await fetch(id ? `/api/pm/staff-requests/${id}` : '/api/pm/staff-requests', {
        method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { category, title, body } : { category, title, body, pageUrl, shot: shot || undefined }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
      onDone(j.request);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="srq-form">
      <div className="srq-cats" role="group" aria-label="분류">
        {STAFF_REQ_CATEGORIES.map(([k, l]) => <ToggleChip key={k} on={category === k} onClick={() => setCategory(k)}>{l}</ToggleChip>)}
      </div>
      <input className="srq-in" placeholder="제목 (예: 견적서 인쇄 버튼이 안 눌려요)" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="제목" />
      <textarea className="srq-in" rows={5} maxLength={4000} placeholder="무슨 일이 있었는지, 어떻게 되길 원하는지 적어 주세요" value={body} onChange={(e) => setBody(e.target.value)} aria-label="내용" />
      {!id && <div className="srq-row">
        <label className="srq-file">스크린샷(선택) <input type="file" accept="image/*" onChange={async (e) => { const f = e.target.files?.[0]; if (!f) return setShot(''); try { setShot(await shrinkImage(f)); } catch (x) { setErr(x.message); } }} /></label>
        {shot && <img className="srq-thumb" src={shot} alt="첨부 미리보기" />}
      </div>}
      {!id && pageUrl && <p className="srq-muted">관련 화면 자동 첨부: {pageUrl.replace(/^https?:\/\/[^/]+/, '')}</p>}
      {err && <p className="srq-err">{err}</p>}
      <div className="srq-row">
        <Button variant="primary" loading={busy} disabled={!title.trim()} onClick={submit}>{id ? '수정 저장' : '올리기'}</Button>
        <Button variant="ghost" onClick={() => onDone(null)}>취소</Button>
      </div>
    </div>
  );
}

function Post({ r, isAdmin, onChange }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [comment, setComment] = useState('');
  const patch = async (p) => {
    const x = await fetch(`/api/pm/staff-requests/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) });
    const j = await x.json().catch(() => ({}));
    if (j.success) onChange(j.request);
  };
  return (
    <li className={`srq-post st-${r.status}`}>
      <div className="srq-head">
        <Badge tone={TONE[r.status] || 'plain'}>{statusLabel(r.status)}</Badge>
        <span className="srq-cat">{categoryLabel(r.category)}</span>
        <Button variant="ghost" size="sm" className="srq-title" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{r.title}</Button>
        <span className="srq-muted">{r.byName || r.by} · {kst(r.at)}</span>
      </div>
      {r.answer && <div className="srq-answer"><b>PM 답변</b> {r.answer}</div>}
      {open && (editing ? <Composer id={r.id} initial={r} onDone={(n) => { setEditing(false); if (n) onChange(n); }} /> : (
        <div className="srq-detail">
          {r.body && <p className="srq-body">{r.body}</p>}
          {r.pageUrl && <p className="srq-muted">관련 화면: <a href={r.pageUrl}>{r.pageUrl}</a></p>}
          {r.shot && <a href={`/api/pm/staff-requests/shot?id=${r.id}`} target="_blank" rel="noreferrer"><img className="srq-shot" src={`/api/pm/staff-requests/shot?id=${r.id}`} alt="첨부 스크린샷" /></a>}
          {r.pr && <p className="srq-muted">수정안: <a href={r.pr} target="_blank" rel="noreferrer">{r.pr.replace(/^https:\/\/github\.com\//, '')}</a></p>}
          {r.dupOf && <p className="srq-muted">같은 내용 묶음: #{r.dupOf}</p>}
          <ol className="srq-log" aria-label="진행 로그">
            {(r.log || []).map((l, i) => <li key={i}><span className="srq-muted">{kst(l.at)} {l.by === 'pm' ? 'PM' : l.by === 'system' ? '' : l.by}</span> {l.text}</li>)}
          </ol>
          {r.canEdit && <div className="srq-row">
            <input className="srq-in" placeholder="덧붙일 말(추가 설명·확인 결과)" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="댓글" />
            <Button size="sm" disabled={!comment.trim()} onClick={async () => { await patch({ comment }); setComment(''); }}>남기기</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>수정</Button>
            {isAdmin && <select className="srq-in srq-sel" aria-label="상태 변경(관리자)" value={r.status} onChange={(e) => patch({ status: e.target.value })}>
              {STAFF_REQ_STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>}
          </div>}
        </div>
      ))}
    </li>
  );
}

export function StaffRequestsButton({ onClick }) {
  return <Button size="sm" variant="primary" onClick={onClick}>직원 요청</Button>;
}

export default function StaffRequests({ open, onClose }) {
  const [list, setList] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [writing, setWriting] = useState(false);
  const [filter, setFilter] = useState('all');
  const [err, setErr] = useState('');
  const load = useCallback(() => fetch('/api/pm/staff-requests', { cache: 'no-store' }).then((r) => r.json()).then((j) => {
    if (!j.success) throw new Error(j.error || '불러오기 실패');
    setList(j.requests); setIsAdmin(!!j.isAdmin); setErr('');
  }).catch((e) => setErr(e.message)), []);
  useEffect(() => { if (!open) return undefined; load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [open, load]);
  useEffect(() => { if (!open) return undefined; const k = (e) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [open, onClose]);
  if (!open) return null;
  const upd = (n) => setList((l) => { const a = (l || []).filter((x) => x.id !== n.id); return [n, ...a].sort((x, y) => (y.at > x.at ? 1 : -1)); });
  const shown = (list || []).filter((r) => filter === 'all' || (filter === 'open' ? !['deployed', 'answered', 'rejected'].includes(r.status) : r.status === filter));
  return (
    <div className="srq-back" onClick={onClose}>
      <aside className="srq" role="dialog" aria-modal="true" aria-label="직원 요청 게시판" onClick={(e) => e.stopPropagation()}>
        <div className="srq-top">
          <h2>직원 요청</h2>
          <span className="srq-muted">오류·요청을 남기면 PM 이 확인해 답하거나 고칩니다. 돈·재고·주문 관련은 사람이 확인합니다.</span>
          <IconButton label="닫기" onClick={onClose} />
        </div>
        <div className="srq-row">
          {!writing && <Button variant="primary" onClick={() => setWriting(true)}>+ 글쓰기</Button>}
          <ToggleChip on={filter === 'all'} onClick={() => setFilter('all')}>전체</ToggleChip>
          <ToggleChip on={filter === 'open'} onClick={() => setFilter('open')}>진행 중</ToggleChip>
          <ToggleChip on={filter === 'needs-human'} onClick={() => setFilter('needs-human')}>사람 확인 필요</ToggleChip>
        </div>
        {writing && <Composer onDone={(n) => { setWriting(false); if (n) upd(n); }} />}
        {err && <p className="srq-err">{err}</p>}
        {!list ? <p className="srq-muted">불러오는 중…</p> : !shown.length ? <p className="srq-muted">아직 올라온 글이 없습니다. 오른쪽 위 + 글쓰기로 남겨 주세요.</p> : (
          <ul className="srq-list">{shown.map((r) => <Post key={r.id} r={r} isAdmin={isAdmin} onChange={upd} />)}</ul>
        )}
      </aside>
      <style jsx global>{`
        .pm .srq-back { position: fixed; inset: 0; z-index: 60; background: color-mix(in srgb, var(--pm-ink) 35%, transparent); display: flex; justify-content: flex-end; }
        .pm .srq { width: min(560px, 100%); height: 100%; overflow-y: auto; background: var(--pm-surface); color: var(--pm-ink); border-left: 3px solid var(--pm-line); padding: 14px 16px 24px; box-sizing: border-box; }
        .pm .srq-top { display: flex; align-items: flex-start; gap: 8px; } .pm .srq-top h2 { margin: 0; font-size: 18px; white-space: nowrap; } .pm .srq-top .srq-muted { flex: 1; }
        .pm .srq-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
        .pm .srq-muted { color: var(--pm-muted); font-size: 12px; }
        .pm .srq-err { color: var(--pm-err); font-size: 13px; }
        .pm .srq-form { background: var(--pm-surface2); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); padding: 10px; margin: 8px 0; }
        .pm .srq-in { width: 100%; box-sizing: border-box; margin: 4px 0; padding: 7px 9px; font: inherit; font-size: 13px; color: var(--pm-ink); background: var(--pm-surface); border: 1px solid var(--pm-line); border-radius: var(--pm-radius); }
        .pm .srq-row .srq-in { flex: 1; min-width: 140px; width: auto; } .pm .srq-sel { flex: 0 0 auto !important; min-width: 0 !important; }
        .pm .srq-file { font-size: 12px; color: var(--pm-muted); } .pm .srq-thumb { max-height: 60px; border-radius: var(--pm-radius); border: 1px solid var(--pm-line); }
        .pm .srq-list { list-style: none; padding: 0; margin: 8px 0; }
        .pm .srq-post { border: 1px solid var(--pm-line); border-radius: var(--pm-radius); background: var(--pm-surface2); padding: 8px 10px; margin-bottom: 8px; }
        .pm .srq-post.st-needs-human { border-color: var(--pm-err); }
        .pm .srq-head { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
        .pm .srq-cat { font-size: 11px; color: var(--pm-muted); border: 1px solid var(--pm-line); border-radius: 999px; padding: 0 6px; }
        .pm .srq-title { font-weight: bold; text-align: left; padding: 0 4px; }
        .pm .srq-answer { margin-top: 6px; font-size: 13px; background: var(--pm-surface); border-left: 3px solid var(--pm-accent); padding: 6px 8px; white-space: pre-wrap; }
        .pm .srq-body { white-space: pre-wrap; font-size: 13px; margin: 6px 0; }
        .pm .srq-shot { max-width: 100%; max-height: 240px; border: 1px solid var(--pm-line); border-radius: var(--pm-radius); }
        .pm .srq-log { margin: 6px 0; padding-left: 18px; font-size: 12px; } .pm .srq-log li { margin: 2px 0; }
        .pm .srq a { color: var(--pm-link); word-break: break-all; }
        @media (max-width: 640px) { .pm .srq { border-left: 0; } }
      `}</style>
    </div>
  );
}
