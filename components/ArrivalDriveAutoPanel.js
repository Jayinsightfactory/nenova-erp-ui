import { useCallback, useEffect, useState } from 'react';
import { ARRIVAL_DRIVE_COUNTRIES } from '../lib/arrivalDrivePolicy.js';

export default function ArrivalDriveAutoPanel() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
  const [runningId, setRunningId] = useState('');
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/arrival-cost/drive-auto', { credentials: 'same-origin' });
      if (res.status === 403) return;
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '자동반영 상태 조회 실패');
      setData(json); setDraft(previous => previous || json.config); setError('');
    } catch (e) { setError(e.message); }
  }, []);
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer); }, [load]);
  async function save() {
    setBusy(true); setError('');
    try {
      const res = await fetch('/api/arrival-cost/drive-auto', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(draft) });
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '설정 저장 실패');
      setData(json); setDraft(json.config);
    } catch (e) { setError(e.message); } finally { setBusy(false); }
  }
  async function runNow(row) {
    if (!window.confirm(`${row.year}년 ${row.week}차 · ${row.country}\n${row.filename}\n\n이 파일의 해당 차수만 지금 검증·반영할까요?\n24시간 대기만 이번 한 번 건너뛰며, 수동 수정값 보호와 중복 검사는 유지합니다.`)) return;
    setBusy(true); setRunningId(row.id); setError('');
    try {
      const selection = Object.fromEntries(['id', 'sha', 'year', 'week', 'country'].map(k => [k, row[k]]));
      const res = await fetch('/api/arrival-cost/drive-auto', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'run-now', confirm: true, selection }) });
      if (!res.headers.get('content-type')?.includes('application/json')) throw new Error('서버 응답을 확인하지 못했습니다. 재등록하지 말고 상태 새로고침으로 결과를 확인하세요');
      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.error || '즉시 처리 요청 실패');
      setData(json);
    } catch (e) { setError(`${e.message} · 응답 오류만으로 저장 실패를 단정하지 말고 아래 파일 상태를 확인하세요.`); }
    finally { setBusy(false); setRunningId(''); }
  }
  if (!data) return error ? <div role="alert">업무드라이브 자동반영: {error}</div> : null;
  return <section className="drive-auto">
    <strong>업무드라이브 → 도착원가 자동반영 · {data.config.enabled ? '켜짐 (파일 등록 24시간 후)' : '꺼짐'}</strong>
    <div className="controls">
      <label><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />자동반영</label>
      <label>연도 <input aria-label="자동반영 연도" value={draft.year} onChange={e => setDraft({ ...draft, year: e.target.value })} size={5} /></label>
      {ARRIVAL_DRIVE_COUNTRIES.map(country => <label key={country}><input type="checkbox" checked={draft.countries.includes(country)} onChange={e => setDraft({ ...draft, countries: e.target.checked ? [...draft.countries, country] : draft.countries.filter(c => c !== country) })} />{country}</label>)}
      <button type="button" disabled={busy} onClick={save}>{busy ? '저장 중…' : '자동반영 설정 저장'}</button>
      <button type="button" onClick={load}>상태 새로고침</button>
    </div>
    <p>업무드라이브 등록 24시간 후 국가별 최신 세부차수만 반영합니다. 파일명 또는 시트의 연도를 검증하며, 연도가 없거나 서로 다르면 보류합니다. 수정된 새 버전은 다시 24시간 대기합니다. 과거 시트 제외 · 같은 파일 중복 방지 · 수동 현재본/수동 수정값은 자동 교체하지 않습니다. 매입단가·주문·재고는 변경하지 않습니다.</p>
    {error && <div role="alert">{error}</div>}
    {runningId && <div role="status">선택 파일 검증·등록 중입니다. 완료 또는 보류 결과를 아래에 표시합니다.</div>}
    <div className="results">{!data.results.length ? <span>해당 연도·국가에 자동반영 가능한 원가 파일이 없습니다.</span> : data.results.map(r => <div key={r.id} className={r.reason || r.error ? 'review' : r.status === 'complete' ? 'complete' : ''}>
      <b>{r.year} {r.week} · {r.country}</b> · {r.filename} — {r.reason || r.error || (r.status === 'processing' ? '검증·등록 중' : r.waiting ? `24시간 대기 · ${data.config.enabled ? '반영 예정' : '자동반영 꺼짐 · 대기 종료'} ${new Date(r.eligibleAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국시간)` : ({ complete: `반영 완료 ${r.rowCount}건 · 매칭 확인 ${r.unmatchedCount}건 · 이력 #${r.importKey}`, review: '확인 필요', error: '오류 · 5분 후 재시도' }[r.status] || '대기'))}
      {r.status !== 'complete' && <button type="button" style={{ marginLeft: 10 }} disabled={busy || !data.config.enabled || !!r.reason || r.status === 'processing'} onClick={() => runNow(r)} aria-label={`${r.country} ${r.week} 지금 검증·처리`}>{runningId === r.id ? '검증·등록 중…' : '지금 검증·처리'}</button>}
    </div>)}</div>
    <style jsx>{`.drive-auto{font-family:'Pretendard Variable','Pretendard',-apple-system,BlinkMacSystemFont,'Malgun Gothic','맑은 고딕','Segoe UI',sans-serif;font-variant-numeric:tabular-nums;border:1px solid #cbd5e1;background:#ffffff;padding:14px 18px;margin-bottom:12px;border-radius:10px;font-size:13.5px;color:#0f172a}.drive-auto strong{font-size:14.5px;color:#0f172a}.controls{display:flex;gap:10px 14px;flex-wrap:wrap;align-items:center;margin-top:10px}label{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;color:#334155}input:not([type=checkbox]){font-family:inherit;height:34px;padding:0 10px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;color:#0f172a;font-size:13.5px}input[type=checkbox]{width:16px;height:16px;accent-color:#0f172a;margin:0}button{font-family:inherit;height:34px;padding:0 12px;border:1px solid #cbd5e1;background:#ffffff;color:#0f172a;border-radius:6px;font-size:13px;font-weight:600;white-space:nowrap;cursor:pointer}button:hover:not(:disabled){background:#f8fafc;border-color:#94a3b8}button:disabled{background:#f1f5f9;border-color:#cbd5e1;color:#94a3b8;cursor:not-allowed}p{color:#475569;font-size:13px;line-height:1.5;margin:8px 0}.results>div{padding:8px 10px;border-top:1px solid #e2e8f0;overflow-wrap:anywhere;font-size:13px}.review,[role=alert]{color:#92400e;background:#fffbeb;border-radius:6px;padding:8px 10px}.complete{color:#065f46;background:#ecfdf5;border-radius:6px}`}</style>
  </section>;
}
