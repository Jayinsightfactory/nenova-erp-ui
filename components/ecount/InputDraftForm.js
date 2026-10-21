import { useCallback, useEffect, useState } from 'react';

// ECOUNT 입력 화면 7종 웹 전용 초안 폼. API: /api/ecount/input-drafts (ecount_work.InputDraft* 만 사용).
// 사용법: <InputDraftForm program="E040205" /> — program 은 E040203/E040205/E040253/E040301/E040501/E040503/E040507.
// ECOUNT 원본 저장(F8/F7)은 미승인이라 비활성이다. data-ecount-action-id 는 button-matches.json 의 기존 matchId 만 쓴다.
export const SOURCE_SAVE_MATCH_ID = Object.freeze({
  E040203: 'E040203-A18', E040205: 'E040205-A23', E040253: 'E040253-A23', E040301: 'E040301-A20',
  E040501: 'E040501-A15', E040503: 'E040503-A13', E040507: 'E040507-A16',
});
export const SOURCE_SAVE_TOOLTIP = '원본 저장 미승인';
const API = '/api/ecount/input-drafts';
const STATUS_LABEL = { draft: '초안', reviewed: '검토됨', cancelled: '취소됨' };
const box = { border: '1px solid #cbd5e1', borderRadius: 6, padding: 12, marginBottom: 12, background: '#fff' };
const input = { width: '100%', padding: '4px 6px', border: '1px solid #cbd5e1', borderRadius: 4, boxSizing: 'border-box' };

async function call(method, url, body) {
  const res = await fetch(url, { method, credentials: 'same-origin', headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await res.json(); } catch { json = null; }
  return { status: res.status, json: json || { success: false, error: 'BAD_RESPONSE' } };
}
// 빈 칸은 null(수정 시 칸 비우기), 체크박스는 불리언.
const cell = (def, value) => (def.valueType === 'boolean' ? (value === true || value === 'true') : (value === undefined || value === null ? '' : String(value)));
const toPayload = (defs, values, forPatch) => {
  const out = {};
  for (const d of defs) {
    const v = values[d.key];
    if (d.valueType === 'boolean') { if (v === true) out[d.key] = true; else if (forPatch) out[d.key] = null; continue; }
    if (v === undefined || v === null || String(v).trim() === '') { if (forPatch) out[d.key] = null; continue; }
    out[d.key] = String(v);
  }
  return out;
};
const lineToPayload = (defs, row) => {
  const out = {};
  for (const d of defs) { const v = row[d.key]; if (v !== undefined && v !== null && String(v).trim() !== '') out[d.key] = String(v); }
  return out;
};

export default function InputDraftForm({ program, sourceSaveButton = true }) {
  const [schema, setSchema] = useState(null);
  const [head, setHead] = useState({});
  const [lines, setLines] = useState([{}]);
  const [saved, setSaved] = useState(null); // { draftId, revision, status }
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null); // { kind: 'ok'|'error', text }
  const [errors, setErrors] = useState([]);

  const fail = useCallback((r) => {
    const j = r.json || {};
    if (r.status === 503 && j.code === 'MIGRATION_PENDING') setMessage({ kind: 'error', text: `저장소가 아직 설치되지 않았습니다(마이그레이션 대기): ${j.migration}` });
    else if (r.status === 409) setMessage({ kind: 'error', text: `다른 곳에서 먼저 수정되었습니다(리비전 충돌). 다시 불러온 뒤 수정하세요. [${j.error}]` });
    else setMessage({ kind: 'error', text: `처리하지 못했습니다. [${j.error || r.status}]` });
    setErrors(Array.isArray(j.details) ? j.details.map((e) => e.message).filter(Boolean) : (j.details && j.details.message ? [j.details.message] : []));
  }, []);

  useEffect(() => {
    let alive = true;
    setSchema(null); setSaved(null); setHead({}); setLines([{}]); setMessage(null); setErrors([]);
    call('GET', `${API}?view=schema&program=${encodeURIComponent(program)}`).then((r) => {
      if (!alive) return;
      if (r.json.success) setSchema(r.json.schema); else fail(r);
    });
    return () => { alive = false; };
  }, [program, fail]);

  if (!schema) return <div style={box}>{message ? message.text : '입력 화면을 불러오는 중…'}</div>;
  const lineDefs = schema.lines.fields;
  const locked = busy || (saved && saved.status === 'cancelled');

  async function run(fn) {
    setBusy(true); setMessage(null); setErrors([]);
    try { await fn(); } finally { setBusy(false); }
  }
  const done = (r, text) => {
    setSaved({ draftId: r.json.draftId, revision: r.json.revision, status: r.json.status });
    setMessage({ kind: 'ok', text: `${text} (draftId ${r.json.draftId}, 리비전 ${r.json.revision}, 상태 ${STATUS_LABEL[r.json.status] || r.json.status}) — 웹 전용 초안이며 ECOUNT 원본에는 저장되지 않았습니다.` });
  };
  const create = () => run(async () => {
    const r = await call('POST', API, { program, header: toPayload(schema.head, head, false), lines: lines.map((l) => lineToPayload(lineDefs, l)) });
    if (r.json.success) done(r, '초안을 저장했습니다'); else fail(r);
  });
  const correct = () => run(async () => {
    const r = await call('PATCH', API, { draftId: saved.draftId, expectedRevision: saved.revision, header: toPayload(schema.head, head, true), lines: lines.map((l) => lineToPayload(lineDefs, l)), reason: reason || undefined });
    if (r.json.success) done(r, '초안을 수정했습니다'); else fail(r);
  });
  const review = () => run(async () => {
    const r = await call('POST', API, { action: 'review', draftId: saved.draftId, expectedRevision: saved.revision });
    if (r.json.success) done(r, '초안을 검토 처리했습니다'); else fail(r);
  });
  const cancel = () => run(async () => {
    if (!reason.trim()) { setMessage({ kind: 'error', text: '취소 사유는 필수입니다.' }); return; }
    const r = await call('POST', API, { action: 'cancel', draftId: saved.draftId, expectedRevision: saved.revision, reason });
    if (r.json.success) done(r, '초안을 취소했습니다'); else fail(r);
  });

  return (
    <section style={box} data-input-draft-program={program}>
      <h3 style={{ margin: '0 0 8px' }}>{schema.title} ({program}) — 웹 전용 초안</h3>
      <p style={{ margin: '0 0 8px', color: '#475569', fontSize: 13 }}>{schema.sourceSave.note}. 빈 칸과 0 은 다르게 저장됩니다.</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: 8 }}>
        {schema.head.map((d) => (
          <label key={d.key} style={{ fontSize: 13 }}>
            {d.label || '(라벨 미관측)'}{d.draftRequired ? ' *' : ''}
            {d.valueType === 'boolean'
              ? <input type="checkbox" checked={cell(d, head[d.key]) === true} disabled={locked} onChange={(e) => setHead({ ...head, [d.key]: e.target.checked })} style={{ marginLeft: 6 }} />
              : <input type={d.valueType === 'date' ? 'date' : 'text'} style={input} value={cell(d, head[d.key])} maxLength={d.maxLength || 60} disabled={locked} onChange={(e) => setHead({ ...head, [d.key]: e.target.value })} />}
          </label>
        ))}
      </div>
      <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse', fontSize: 13 }}>
        <thead><tr><th>#</th>{lineDefs.map((d) => <th key={d.key} style={{ textAlign: 'left' }}>{d.label}{d.draftRequired ? ' *' : ''}</th>)}<th /></tr></thead>
        <tbody>
          {lines.map((row, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              {lineDefs.map((d) => <td key={d.key}><input style={input} value={cell(d, row[d.key])} disabled={locked} onChange={(e) => setLines(lines.map((l, j) => (j === i ? { ...l, [d.key]: e.target.value } : l)))} /></td>)}
              <td><button type="button" disabled={locked || lines.length === 1} onClick={() => setLines(lines.filter((_, j) => j !== i))}>행 삭제</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={locked || lines.length >= schema.lines.maxLines} onClick={() => setLines([...lines, {}])}>행 추가</button>
      <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" disabled={locked || !!saved} onClick={create}>초안 저장</button>
        <button type="button" disabled={locked || !saved} onClick={correct}>수정 저장</button>
        <button type="button" disabled={locked || !saved || saved.status === 'reviewed'} onClick={review}>검토 완료</button>
        <input style={{ ...input, width: 240 }} placeholder="수정·취소 사유" maxLength={200} value={reason} disabled={locked} onChange={(e) => setReason(e.target.value)} />
        <button type="button" disabled={locked || !saved} onClick={cancel}>초안 취소</button>
        {sourceSaveButton && <button type="button" disabled title={SOURCE_SAVE_TOOLTIP} aria-disabled="true" data-ecount-action-id={SOURCE_SAVE_MATCH_ID[program]}>원본 저장(F8)</button>}
      </div>
      {message && <p role="status" style={{ color: message.kind === 'ok' ? '#166534' : '#b91c1c' }}>{message.text}</p>}
      {errors.length > 0 && <ul style={{ color: '#b91c1c' }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
    </section>
  );
}
