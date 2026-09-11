// pages/work/manuals.js
// 부서별 업무 매뉴얼 — 부서=폴더, 업무=아이콘. 홈 화면처럼 빈칸 없이 붙고 끌어서 순서를 바꾼다.
// 열람: 사장님(nenovaSS3) 전체 / 직원 본인 매뉴얼만 (API에서 거름). 저장소는 웹 전용 JSON(lib/workManuals.js).
import { useEffect, useMemo, useState } from 'react';

const TINTS = ['#2F6FEB', '#1E8E5A', '#C2410C', '#7C3AED', '#0E7490', '#B45309'];
const STATUS = {
  ai_draft: { label: 'AI 초안', cls: 'draft' },
  edited: { label: '수정 중', cls: 'edited' },
  confirmed: { label: '확인됨', cls: 'ok' },
};

async function api(body) {
  const r = await fetch('/api/work/manuals', body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : undefined);
  const j = await r.json();
  if (!j.success) throw new Error(j.error || '요청 실패');
  return j;
}

function ordered(items, order, keyOf) {
  if (!order?.length) return items;
  const rank = new Map(order.map((k, i) => [k, i]));
  return [...items].sort((a, b) => (rank.get(keyOf(a)) ?? 1e9) - (rank.get(keyOf(b)) ?? 1e9));
}

// 끌어서 놓기 격자 — 놓는 즉시 순서가 바뀌고 뒤 아이콘이 당겨져 구멍이 남지 않는다
function IconGrid({ items, keyOf, render, onReorder, onOpen }) {
  const [drag, setDrag] = useState(null);
  const move = (from, to) => {
    if (from === to || from == null) return;
    const next = [...items];
    const [it] = next.splice(from, 1);
    next.splice(to, 0, it);
    onReorder(next.map(keyOf));
  };
  return (
    <div className="grid">
      {items.map((it, i) => (
        <button
          key={keyOf(it)}
          type="button"
          className={`cell${drag === i ? ' dragging' : ''}`}
          draggable
          onDragStart={() => setDrag(i)}
          onDragEnter={() => { if (drag != null && drag !== i) { move(drag, i); setDrag(i); } }}
          onDragOver={(e) => e.preventDefault()}
          onDragEnd={() => setDrag(null)}
          onClick={() => onOpen(it)}
        >
          {render(it, i)}
        </button>
      ))}
    </div>
  );
}

function ManualSheet({ manual, canEdit, onClose, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [steps, setSteps] = useState(manual.steps || []);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const st = STATUS[manual.status] || STATUS.ai_draft;

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const setStep = (i, k, v) => setSteps((s) => s.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const save = async (confirm) => {
    setBusy(true); setErr('');
    try {
      const j = await api({ action: 'save', id: manual.id, steps, confirm });
      onSaved(j.manual); setEditing(false);
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="scrim" onClick={onClose}>
      <aside className="sheet" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`${manual.title} 매뉴얼`}>
        <header className="sheet-head">
          <div>
            <div className="eyebrow">{manual.dept} · {manual.owner}</div>
            <h2>{manual.title}</h2>
            {manual.summary && <p className="summary">{manual.summary}</p>}
          </div>
          <button type="button" className="x" onClick={onClose} aria-label="닫기">×</button>
        </header>

        <div className="facts">
          <span className={`badge ${st.cls}`}>{st.label}</span>
          {manual.frequency && <span>주기 · {manual.frequency}</span>}
          {manual.tools?.length > 0 && <span>도구 · {manual.tools.join(', ')}</span>}
        </div>
        {manual.status !== 'confirmed' && (
          <p className="hint">AI가 업무 기록을 보고 쓴 초안입니다. 틀린 단계를 고치고 “확인 완료”를 눌러야 공식 절차가 됩니다.</p>
        )}

        <ol className="steps">
          {steps.map((s, i) => (
            <li key={i}>
              <span className="no">{i + 1}</span>
              {editing ? (
                <div className="edit">
                  <input value={s.title} onChange={(e) => setStep(i, 'title', e.target.value)} placeholder="단계 제목" />
                  <textarea rows={2} value={s.detail} onChange={(e) => setStep(i, 'detail', e.target.value)} placeholder="무엇을, 어느 화면에서, 어떻게" />
                  <div className="row">
                    <input value={s.app || ''} onChange={(e) => setStep(i, 'app', e.target.value)} placeholder="프로그램·화면" />
                    <input value={s.check || ''} onChange={(e) => setStep(i, 'check', e.target.value)} placeholder="확인할 점" />
                    <button type="button" className="ghost danger" onClick={() => setSteps((x) => x.filter((_, j) => j !== i))}>삭제</button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="step-title">{s.title}{s.app && <span className="app">{s.app}</span>}</div>
                  {s.detail && <p>{s.detail}</p>}
                  {s.check && <p className="check">확인 · {s.check}</p>}
                </div>
              )}
            </li>
          ))}
        </ol>
        {editing && (
          <button type="button" className="ghost add" onClick={() => setSteps((x) => [...x, { title: '', detail: '', app: '', check: '' }])}>+ 단계 추가</button>
        )}

        {manual.evidence && (
          <p className="evidence">근거 · {manual.evidence.period}{manual.evidence.eventCount ? ` · 기록 ${manual.evidence.eventCount.toLocaleString()}건` : ''}</p>
        )}
        {err && <p className="err">{err}</p>}

        {canEdit && (
          <footer className="sheet-foot">
            {editing ? (
              <>
                <button type="button" className="ghost" disabled={busy} onClick={() => { setSteps(manual.steps || []); setEditing(false); }}>취소</button>
                <button type="button" className="primary" disabled={busy} onClick={() => save(false)}>저장</button>
              </>
            ) : (
              <>
                <button type="button" className="ghost" onClick={() => setEditing(true)}>고치기</button>
                {manual.status !== 'confirmed' && <button type="button" className="primary" disabled={busy} onClick={() => save(true)}>확인 완료</button>}
              </>
            )}
          </footer>
        )}
      </aside>
    </div>
  );
}

export default function WorkManualsPage() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [deptId, setDeptId] = useState(null);
  const [open, setOpen] = useState(null);
  const [layout, setLayout] = useState({});

  useEffect(() => {
    api().then((j) => { setData(j); setLayout(j.layout || {}); }).catch((e) => setErr(e.message));
  }, []);

  const byDept = useMemo(() => {
    const m = {};
    for (const d of data?.departments || []) m[d.id] = (data.manuals || []).filter((x) => d.members.includes(x.owner));
    return m;
  }, [data]);

  const persist = (key, order) => {
    setLayout((l) => ({ ...l, [key]: order }));
    api({ action: 'layout', key, order }).catch(() => {});
  };

  if (err) return <div className="wm"><p className="err">{err}</p><style jsx>{css}</style></div>;
  if (!data) return <div className="wm"><p className="muted">불러오는 중…</p><style jsx>{css}</style></div>;

  const depts = ordered(data.departments, layout.home, (d) => d.id);
  const dept = data.departments.find((d) => d.id === deptId);
  const tasks = dept ? ordered(byDept[dept.id] || [], layout[dept.id], (m) => m.id) : [];
  const canEdit = (m) => data.isAdmin || m.owner === data.me;

  return (
    <div className="wm">
      <div className="top">
        {dept ? (
          <nav className="crumb">
            <button type="button" onClick={() => setDeptId(null)}>업무 매뉴얼</button>
            <span>›</span><b>{dept.name}</b>
          </nav>
        ) : <h1>업무 매뉴얼</h1>}
        <p className="muted">
          {data.isAdmin ? '전 부서 매뉴얼을 볼 수 있습니다.' : '내 매뉴얼만 보입니다.'} 아이콘은 끌어서 순서를 바꿀 수 있습니다.
        </p>
      </div>

      {!dept && (
        <IconGrid
          items={depts}
          keyOf={(d) => d.id}
          onReorder={(o) => persist('home', o)}
          onOpen={(d) => setDeptId(d.id)}
          render={(d) => {
            const list = byDept[d.id] || [];
            return (
              <>
                <span className="folder">
                  {Array.from({ length: 4 }).map((_, k) => (
                    <i key={k} style={{ background: list[k] ? TINTS[k % TINTS.length] : 'transparent' }} />
                  ))}
                </span>
                <span className="name">{d.name}</span>
                <span className="sub">{d.members.length}명 · 업무 {list.length}</span>
              </>
            );
          }}
        />
      )}

      {dept && (
        <>
          <div className="members">{dept.members.map((n) => <span key={n}>{n}</span>)}</div>
          {tasks.length === 0 ? (
            <p className="empty">아직 만들어진 매뉴얼이 없습니다. 업무 기록이 쌓이면 AI 초안이 여기에 생깁니다.</p>
          ) : (
            <IconGrid
              items={tasks}
              keyOf={(m) => m.id}
              onReorder={(o) => persist(dept.id, o)}
              onOpen={setOpen}
              render={(m, i) => {
                const st = STATUS[m.status] || STATUS.ai_draft;
                return (
                  <>
                    <span className="app-icon" style={{ background: TINTS[i % TINTS.length] }}>{m.title.slice(0, 2)}</span>
                    <span className="name">{m.title}</span>
                    <span className={`dot ${st.cls}`}>{m.owner} · {st.label}</span>
                  </>
                );
              }}
            />
          )}
        </>
      )}

      {open && (
        <ManualSheet
          manual={open}
          canEdit={canEdit(open)}
          onClose={() => setOpen(null)}
          onSaved={(m) => {
            setData((d) => ({ ...d, manuals: d.manuals.map((x) => (x.id === m.id ? m : x)) }));
            setOpen(m);
          }}
        />
      )}
      <style jsx>{css}</style>
    </div>
  );
}

const css = `
.wm{--ink:#1d1d1f;--ink2:#6e6e73;--line:#e5e5ea;--card:#fff;--ground:#f5f5f7;--blue:#0071e3;
  max-width:980px;margin:0 auto;padding:28px 24px 64px;color:var(--ink);
  font-family:-apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.top{margin-bottom:22px}
h1{font-size:26px;font-weight:700;letter-spacing:-.02em;margin:0 0 4px}
.muted{color:var(--ink2);font-size:13px;margin:0}
.crumb{display:flex;align-items:center;gap:8px;font-size:22px;margin-bottom:4px}
.crumb button{border:0;background:none;padding:0;font:inherit;color:var(--blue);cursor:pointer}
.crumb span{color:var(--ink2)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));grid-auto-flow:row dense;
  background:var(--card);border:1px solid var(--line);border-radius:18px;overflow:hidden}
.cell{all:unset;box-sizing:border-box;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  aspect-ratio:1;padding:12px 8px;cursor:pointer;text-align:center;
  box-shadow:inset -1px -1px 0 var(--line);transition:background .15s ease,transform .15s ease}
.cell:hover{background:var(--ground)}
.cell:active{transform:scale(.96)}
.cell:focus-visible{outline:2px solid var(--blue);outline-offset:-2px}
.cell.dragging{opacity:.35}
.folder{width:56px;height:56px;border-radius:14px;background:#e8e8ed;display:grid;grid-template-columns:1fr 1fr;gap:4px;padding:8px;box-sizing:border-box}
.folder i{border-radius:4px;border:1px dashed #c7c7cc}
.app-icon{width:56px;height:56px;border-radius:14px;color:#fff;font-weight:700;font-size:17px;display:flex;align-items:center;justify-content:center;
  box-shadow:0 1px 2px rgba(0,0,0,.12)}
.name{font-size:13px;font-weight:600;line-height:1.25}
.sub,.dot{font-size:11px;color:var(--ink2)}
.dot.draft::before,.dot.edited::before,.dot.ok::before{content:"";display:inline-block;width:6px;height:6px;border-radius:50%;margin-right:4px;vertical-align:1px}
.dot.draft::before{background:#ff9f0a}.dot.edited::before{background:#0a84ff}.dot.ok::before{background:#30d158}
.members{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 14px}
.members span{font-size:12px;padding:4px 10px;border-radius:999px;background:var(--card);border:1px solid var(--line)}
.empty{background:var(--card);border:1px dashed var(--line);border-radius:18px;padding:40px;text-align:center;color:var(--ink2);font-size:13px}
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.28);display:flex;justify-content:flex-end;z-index:1000;animation:fade .2s ease}
.sheet{width:min(560px,100%);height:100%;overflow:auto;background:var(--card);padding:26px 28px;box-sizing:border-box;
  box-shadow:-12px 0 40px rgba(0,0,0,.12);animation:slide .28s cubic-bezier(.32,.72,0,1)}
@keyframes fade{from{opacity:0}}
@keyframes slide{from{transform:translateX(40px);opacity:0}}
@media (prefers-reduced-motion:reduce){.scrim,.sheet{animation:none}.cell{transition:none}}
.sheet-head{display:flex;justify-content:space-between;gap:12px}
.eyebrow{font-size:12px;color:var(--ink2);margin-bottom:2px}
h2{font-size:22px;margin:0 0 6px;letter-spacing:-.01em}
.summary{color:var(--ink2);font-size:14px;margin:0}
.x{border:0;background:var(--ground);width:32px;height:32px;border-radius:50%;font-size:20px;line-height:1;cursor:pointer;color:var(--ink2);flex:none}
.facts{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;font-size:12px;color:var(--ink2);margin:16px 0 8px}
.badge{font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px}
.badge.draft{background:#fff4e0;color:#b25e00}.badge.edited{background:#e5f0ff;color:#0060d0}.badge.ok{background:#e3f8ea;color:#1a7f3c}
.hint{font-size:12.5px;background:#fff8ea;color:#8a5300;border-radius:10px;padding:10px 12px;margin:8px 0 4px}
.steps{list-style:none;padding:0;margin:18px 0 8px}
.steps li{display:flex;gap:12px;padding:12px 0;border-top:1px solid var(--line)}
.no{flex:none;width:24px;height:24px;border-radius:50%;background:var(--ground);font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center}
.step-title{font-weight:600;font-size:14px}
.app{margin-left:8px;font-size:11px;font-weight:500;color:var(--ink2);background:var(--ground);padding:2px 7px;border-radius:6px}
.steps p{margin:4px 0 0;font-size:13px;line-height:1.55;color:#3a3a3c}
.steps .check{color:#1a7f3c;font-size:12px}
.edit{flex:1;display:flex;flex-direction:column;gap:6px}
.edit input,.edit textarea{font:inherit;font-size:13px;border:1px solid var(--line);border-radius:8px;padding:7px 9px;width:100%;box-sizing:border-box}
.edit .row{display:flex;gap:6px}
.evidence{font-size:11.5px;color:var(--ink2);margin:14px 0 0}
.err{color:#d70015;font-size:13px}
.sheet-foot{position:sticky;bottom:-26px;background:var(--card);display:flex;justify-content:flex-end;gap:8px;padding:16px 0 4px;margin-top:16px;border-top:1px solid var(--line)}
.primary,.ghost{font:inherit;font-size:13px;font-weight:600;border-radius:999px;padding:8px 16px;cursor:pointer}
.primary{background:var(--blue);color:#fff;border:0}
.ghost{background:none;border:1px solid var(--line);color:var(--ink)}
.ghost.danger{color:#d70015;flex:none}
.ghost.add{margin-top:4px}
button:disabled{opacity:.5;cursor:default}
`;
