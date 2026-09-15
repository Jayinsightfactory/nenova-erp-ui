import { useEffect, useMemo, useRef, useState } from 'react';
import { MAX_PNL_SPECIAL_NOTE_LENGTH } from '../../lib/raumPnlSpecialNotePolicy';

const border = '1px solid #cbd5e1';
const btn = { height: 30, padding: '0 11px', border, borderRadius: 5, background: '#fff', cursor: 'pointer', fontWeight: 700 };
const primary = { ...btn, color: '#fff', background: '#0f766e', borderColor: '#0f766e' };

function displayDate(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('ko-KR');
}

async function requestNote(url, options) {
  let response;
  try { response = await fetch(url, options); }
  catch { throw new Error('서버 연결 문제로 특이사항 처리 결과를 확인할 수 없습니다. 자동으로 다시 시도하지 않았습니다.'); }
  const result = await response.json().catch(() => null);
  if (!response.ok || result?.success !== true) {
    throw new Error(result?.error || `특이사항 요청이 실패했습니다(HTTP ${response.status}).`);
  }
  return result;
}

export default function PnlSpecialNotesDialog({ open, partnerCode, partnerLabel, initialYear, yearOptions = [], onClose }) {
  const years = useMemo(() => [...new Set([String(initialYear || ''), ...yearOptions.map(String)].filter(year => /^\d{4}$/.test(year)))].sort((a, b) => b.localeCompare(a)), [initialYear, yearOptions]);
  const [year, setYear] = useState(String(initialYear || new Date().getFullYear()));
  const [note, setNote] = useState({ text: '', revision: null, updatedAt: null, updatedBy: '' });
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const requestRef = useRef(0);

  useEffect(() => {
    if (open) setYear(String(initialYear || new Date().getFullYear()));
  }, [open, initialYear, partnerCode]);

  useEffect(() => {
    if (!open || !/^\d{4}$/.test(year)) return undefined;
    const request = ++requestRef.current;
    setLoading(true); setError(''); setMessage('');
    requestNote(`/api/raum/pnl-notes?partner=${encodeURIComponent(partnerCode)}&year=${encodeURIComponent(year)}`)
      .then(result => {
        if (request !== requestRef.current) return;
        const next = result.note || { text: '', revision: null, updatedAt: null, updatedBy: '' };
        setNote(next); setDraft(String(next.text || ''));
      })
      .catch(cause => { if (request === requestRef.current) setError(cause.message || '특이사항을 불러오지 못했습니다.'); })
      .finally(() => { if (request === requestRef.current) setLoading(false); });
    return () => { requestRef.current += 1; };
  }, [open, partnerCode, year]);

  if (!open) return null;
  const dirty = draft !== String(note.text || '');
  const close = () => {
    if ((dirty || saving) && typeof window !== 'undefined' && !window.confirm(saving ? '저장이 진행 중입니다. 창을 닫을까요?' : '저장하지 않은 특이사항이 있습니다. 닫을까요?')) return;
    onClose?.();
  };
  const save = async () => {
    if (saving || loading || !dirty || draft.length > MAX_PNL_SPECIAL_NOTE_LENGTH) return;
    setSaving(true); setError(''); setMessage('');
    try {
      const result = await requestNote('/api/raum/pnl-notes', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partner: partnerCode, orderYear: year, text: draft, expectedRevision: note.revision }),
      });
      setNote(result.note); setDraft(String(result.note?.text || ''));
      setMessage(result.changed ? '특이사항을 저장했습니다.' : '변경된 내용이 없습니다.');
    } catch (cause) {
      setError(cause.message || '특이사항 저장에 실패했습니다.');
    } finally { setSaving(false); }
  };

  return <div role="dialog" aria-modal="true" aria-label={`${partnerLabel} 특이사항`} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(15,23,42,.35)', display: 'grid', placeItems: 'center', padding: 16 }}>
    <section style={{ width: 'min(760px, calc(100vw - 32px))', maxHeight: 'calc(100vh - 32px)', overflow: 'auto', background: '#fff', borderRadius: 8, boxShadow: '0 18px 50px rgba(15,23,42,.25)', padding: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <div style={{ minWidth: 0 }}><b style={{ fontSize: 17 }}>{partnerLabel} 특이사항</b><div style={{ marginTop: 2, color: '#64748b', fontSize: 12 }}>결산 참고 내용을 연도별로 자유롭게 기록합니다.</div></div>
        <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 12 }}>연도
          <select aria-label="특이사항 연도" value={year} disabled={loading || saving || dirty} onChange={event => setYear(event.target.value)} style={{ height: 29, border, borderRadius: 4, padding: '0 5px' }}>
            {(years.length ? years : [year]).map(value => <option key={value} value={value}>{value}년</option>)}
          </select>
        </label>
        <button type="button" style={btn} disabled={saving} onClick={close}>닫기</button>
      </div>
      {error ? <div role="alert" style={{ marginBottom: 7, padding: '7px 9px', border: '1px solid #fecaca', borderRadius: 5, background: '#fef2f2', color: '#b91c1c', whiteSpace: 'pre-wrap' }}>{error}</div> : null}
      {message ? <div role="status" style={{ marginBottom: 7, padding: '7px 9px', border: '1px solid #bbf7d0', borderRadius: 5, background: '#f0fdf4', color: '#166534' }}>{message}</div> : null}
      <textarea aria-label={`${partnerLabel} ${year}년 특이사항 입력`} value={draft} maxLength={MAX_PNL_SPECIAL_NOTE_LENGTH} disabled={loading || saving} onChange={event => { setDraft(event.target.value); setMessage(''); }} placeholder="차수별 매입단가, 원본 자료, 정산 확인사항 등 기억해야 할 내용을 입력하세요." style={{ width: '100%', minHeight: 330, resize: 'vertical', boxSizing: 'border-box', border, borderRadius: 6, padding: 10, font: 'inherit', lineHeight: 1.55, background: loading ? '#f8fafc' : '#fff' }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, minHeight: 30 }}>
        <span style={{ color: draft.length > MAX_PNL_SPECIAL_NOTE_LENGTH ? '#b91c1c' : '#64748b', fontSize: 12 }}>{draft.length.toLocaleString()} / {MAX_PNL_SPECIAL_NOTE_LENGTH.toLocaleString()}자</span>
        {note.updatedAt ? <span style={{ color: '#64748b', fontSize: 12 }}>마지막 저장: {displayDate(note.updatedAt)} · {note.updatedBy || '사용자'}</span> : <span style={{ color: '#64748b', fontSize: 12 }}>아직 저장된 특이사항이 없습니다.</span>}
        <button type="button" style={{ ...primary, marginLeft: 'auto', opacity: dirty && !loading && !saving ? 1 : .55 }} disabled={!dirty || loading || saving} onClick={save}>{saving ? '저장 중…' : '특이사항 저장'}</button>
      </div>
    </section>
  </div>;
}
