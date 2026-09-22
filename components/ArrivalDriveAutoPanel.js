import { useCallback, useEffect, useState } from 'react';
import { ARRIVAL_DRIVE_COUNTRIES } from '../lib/arrivalDrivePolicy.js';

export default function ArrivalDriveAutoPanel() {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(null);
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
    <p>업무드라이브 등록 24시간 후 국가별 최신 세부차수만 반영합니다. 수정된 새 버전은 다시 24시간 대기합니다. 과거 시트 제외 · 같은 파일 중복 방지 · 수동 현재본/수동 수정값은 자동 교체하지 않습니다. 매입단가·주문·재고는 변경하지 않습니다.</p>
    {error && <div role="alert">{error}</div>}
    <div className="results">{!data.results.length ? <span>해당 연도·국가에 자동반영 가능한 원가 파일이 없습니다.</span> : data.results.map(r => <div key={r.id} className={r.reason || r.error ? 'review' : r.status === 'complete' ? 'complete' : ''}>
      <b>{r.year} {r.week} · {r.country}</b> · {r.filename} — {r.reason || (r.waiting ? `24시간 대기 · ${data.config.enabled ? '반영 예정' : '자동반영 꺼짐 · 대기 종료'} ${new Date(r.eligibleAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })} (한국시간)` : r.error || ({ complete: `반영 완료 ${r.rowCount}건 · 매칭 확인 ${r.unmatchedCount}건 · 이력 #${r.importKey}`, processing: '검증·등록 중', review: '확인 필요', error: '오류 · 5분 후 재시도' }[r.status] || '대기'))}
    </div>)}</div>
    <style jsx>{`.drive-auto{border:1px solid #b9cbdc;background:#f5f9fe;padding:12px;margin-bottom:12px;border-radius:5px;font-size:12px}.controls{display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:10px}label{display:flex;align-items:center;gap:4px}button{padding:5px 9px;border:1px solid #adc0d4;background:white;border-radius:4px;cursor:pointer}p{color:#51677d;margin:8px 0}.results>div{padding:7px;border-top:1px solid #dce4ee;overflow-wrap:anywhere}.review,[role=alert]{color:#a12f12;background:#fff1df}.complete{color:#17633c;background:#edf9f1}`}</style>
  </section>;
}
