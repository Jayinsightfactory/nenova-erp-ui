import { useEffect, useMemo, useState } from 'react';
import Head from 'next/head';

const inputStyle = {
  border: '1px solid #9db4d0', borderRadius: 5, padding: '8px 10px',
  minHeight: 38, fontSize: 14, color: '#17324f', background: '#fff',
};
const buttonStyle = {
  border: '1px solid #155da8', borderRadius: 5, padding: '9px 15px',
  minHeight: 38, fontSize: 14, fontWeight: 700, cursor: 'pointer',
};

export default function VolumeBoard() {
  const [year, setYear] = useState(String(new Date().getFullYear()));
  const [weeks, setWeeks] = useState([]);
  const [weekStart, setWeekStart] = useState('');
  const [weekEnd, setWeekEnd] = useState('');
  const [weeksBusy, setWeeksBusy] = useState(false);
  const [items, setItems] = useState([]);
  const [selected, setSelected] = useState(new Set());
  const [combineSubweeks, setCombineSubweeks] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    let active = true;
    setWeeksBusy(true);
    setItems([]);
    setSelected(new Set());
    setError('');
    setMessage('');
    if (!/^\d{4}$/.test(year) || Number(year) < 2020 || Number(year) > 2099) {
      setWeeks([]);
      setWeekStart('');
      setWeekEnd('');
      setError('연도는 2020~2099년 사이로 입력하세요.');
      setWeeksBusy(false);
      return () => { active = false; };
    }
    fetch(`/api/stats/pivot-weeks?${new URLSearchParams({ orderYear: year })}`)
      .then(async response => {
        const payload = await response.json();
        if (!response.ok || !payload.success) throw new Error(payload.error || '차수 목록을 불러오지 못했습니다.');
        if (!active) return;
        const nextWeeks = Array.isArray(payload.weeks) ? payload.weeks : [];
        const nextStart = nextWeeks.includes(weekStart) ? weekStart : (nextWeeks[0] || '');
        const nextEnd = nextWeeks.includes(weekEnd) ? weekEnd : nextStart;
        setWeeks(nextWeeks);
        setWeekStart(nextStart);
        setWeekEnd(nextEnd);
        if (!nextWeeks.length) setMessage(`${year}년에 선택할 수 있는 차수가 없습니다.`);
      })
      .catch(err => { if (active) { setWeeks([]); setWeekStart(''); setWeekEnd(''); setError(err.message); } })
      .finally(() => { if (active) setWeeksBusy(false); });
    return () => { active = false; };
  // Year changes reload the actual order/inbound/shipment/stock week list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const baseParams = useMemo(() => ({ orderYear: year, weekStart, weekEnd: weekEnd || weekStart }), [year, weekStart, weekEnd]);
  const startIndex = weeks.indexOf(weekStart);
  const endIndex = weeks.indexOf(weekEnd || weekStart);
  const invalidRange = startIndex >= 0 && endIndex >= 0 && startIndex < endIndex;

  const selectStartWeek = (week) => {
    const nextStartIndex = weeks.indexOf(week);
    setWeekStart(week);
    if (weeks.indexOf(weekEnd) < nextStartIndex) setWeekEnd(week);
  };

  const handleRoundKeyDown = (event) => {
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(key)) return;
    const options = Array.from(event.currentTarget.parentElement.querySelectorAll('button[data-week-option]:not(:disabled)'));
    const currentIndex = options.indexOf(event.currentTarget);
    if (currentIndex < 0 || !options.length) return;
    const nextIndex = key === 'Home' ? 0 : key === 'End' ? options.length - 1 :
      Math.max(0, Math.min(options.length - 1, currentIndex + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1)));
    event.preventDefault();
    if (nextIndex !== currentIndex) {
      options[nextIndex].focus();
      options[nextIndex].click();
    }
  };

  const loadSpecies = async (event) => {
    event?.preventDefault();
    setError('');
    setMessage('');
    setItems([]);
    setSelected(new Set());
    if (!weekStart || !weekEnd) { setError('다운로드할 차수를 선택하세요.'); return; }
    if (invalidRange) { setError('끝 차수는 시작 차수와 같거나 이후 차수로 선택하세요.'); return; }
    setBusy('품종 목록 불러오는 중…');
    try {
      const params = new URLSearchParams({ ...baseParams, list: '1' });
      const response = await fetch(`/api/stats/pivot-volume-excel?${params}`);
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || '품종 목록을 불러오지 못했습니다.');
      if (!payload.items?.length) { setMessage('선택한 차수에 다운로드할 물량 품종이 없습니다.'); return; }
      setItems(payload.items);
      setSelected(new Set(payload.items.map(item => item.key)));
      setMessage(`품종 ${payload.items.length}개를 불러왔습니다. 다운로드할 항목을 선택하세요.`);
    } catch (err) { setError(`품종 목록 조회 실패: ${err.message || err}`); }
    finally { setBusy(''); }
  };

  const toggleSpecies = (key) => setSelected(previous => {
    const next = new Set(previous);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  const downloadSelected = async () => {
    const chosen = items.filter(item => selected.has(item.key));
    if (!chosen.length) { setError('다운로드할 품종을 선택하세요.'); return; }
    setError('');
    setMessage('');
    try {
      for (let index = 0; index < chosen.length; index += 1) {
        const item = chosen[index];
        setBusy(`${index + 1}/${chosen.length} 다운로드 중: ${item.species}`);
        const params = new URLSearchParams({
          ...baseParams,
          species: item.key,
          ...(combineSubweeks ? { combineSubweeks: '1' } : {}),
        });
        const response = await fetch(`/api/stats/pivot-volume-excel?${params}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload.error || `${item.species}: 다운로드 실패 (${response.status})`);
        }
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        const filename = response.headers.get('content-disposition')?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
        anchor.href = objectUrl;
        anchor.download = filename ? decodeURIComponent(filename) : item.fileName || `${item.species}.xlsx`;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
        if (index < chosen.length - 1) await new Promise(resolve => window.setTimeout(resolve, 450));
      }
      setMessage(`완료 — ${chosen.length}개 물량표를 다운로드했습니다.`);
    } catch (err) { setError(`개별 다운로드 실패: ${err.message || err}`); }
    finally { setBusy(''); }
  };

  return (
    <>
      <Head><title>물량표</title></Head>
      <main style={{ minHeight: 'calc(100vh - 48px)', background: '#f2f5f9', padding: '28px 20px' }}>
        <section style={{ width: 'min(1120px, 100%)', margin: '0 auto', background: '#fff', border: '1px solid #cbd8e8', borderRadius: 10, boxShadow: '0 8px 26px rgba(22,50,82,.12)', overflow: 'hidden' }}>
          <header style={{ padding: '18px 22px', background: '#174b89', color: '#fff' }}>
            <h1 style={{ margin: 0, fontSize: 20 }}>차수별 품종 물량표</h1>
            <p style={{ margin: '6px 0 0', fontSize: 13, opacity: .9 }}>연도와 차수를 선택하고 다운로드할 품종을 고르세요.</p>
          </header>
          <form onSubmit={loadSpecies} style={{ padding: 20 }}>
            <div className="round-selection-grid">
              <label className="year-picker" style={{ display: 'grid', gap: 5, fontSize: 13, fontWeight: 700, color: '#284564' }}>
                연도
                <input aria-label="연도" type="number" min="2020" max="2099" step="1" value={year} onChange={event => setYear(event.target.value)} style={inputStyle} />
              </label>
              {[
                { label: '시작 차수', value: weekStart, onSelect: selectStartWeek },
                { label: '끝 차수', value: weekEnd, onSelect: setWeekEnd },
              ].map(group => (
                <fieldset key={group.label} className="week-picker">
                  <legend>{group.label}</legend>
                  <div role="radiogroup" aria-label={`${group.label} 선택`} className="week-choice-list">
                    {weeks.map((week, index) => {
                      const active = group.value === week;
                      const disabled = weeksBusy || !!busy || (group.label === '끝 차수' && startIndex >= 0 && index < startIndex);
                      return (
                        <button
                          key={week}
                          type="button"
                          role="radio"
                          aria-checked={active}
                          aria-label={`${group.label} ${week}`}
                          data-week-option="true"
                          tabIndex={active ? 0 : -1}
                          className="week-choice-button"
                          disabled={disabled}
                          onClick={() => group.onSelect(week)}
                          onKeyDown={handleRoundKeyDown}
                        >
                          {week}
                        </button>
                      );
                    })}
                    {!weeks.length && <span className="week-choice-empty">{weeksBusy ? '차수 불러오는 중…' : '선택할 차수가 없습니다.'}</span>}
                  </div>
                </fieldset>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
              <button type="submit" style={{ ...buttonStyle, color: '#fff', background: '#1764b0' }} disabled={weeksBusy || !!busy || !weeks.length}>
                {weeksBusy ? '차수 불러오는 중…' : '품종 목록 불러오기'}
              </button>
              <span style={{ fontSize: 12, color: '#61758d' }}>{weeks.length ? `${year}년 실제 입력 차수 ${weeks.length}개` : ''}</span>
            </div>
            {invalidRange && <p role="alert" style={{ color: '#b42318', margin: '10px 0 0', fontSize: 13 }}>끝 차수는 시작 차수와 같거나 이후 차수로 선택하세요.</p>}
            <label style={{ display: 'block', marginTop: 16, padding: 12, background: '#eef5ff', borderRadius: 6, lineHeight: 1.6, fontSize: 13 }}>
              <input type="checkbox" checked={combineSubweeks} onChange={event => setCombineSubweeks(event.target.checked)} />{' '}
              같은 본차수 세부차수 합산 — 셀에 합계와 차수별 수량 표시
              <div style={{ color: '#58708c', marginLeft: 23 }}>예: 30(10,20) · 업체별 합산</div>
            </label>
            {items.length > 0 && (
              <section aria-label="다운로드 품종 선택" style={{ marginTop: 18, border: '1px solid #d5e0ec', borderRadius: 7, overflow: 'hidden' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '10px 12px', background: '#f5f8fc', borderBottom: '1px solid #d5e0ec' }}>
                  <b style={{ fontSize: 14 }}>다운로드 품종 ({selected.size}/{items.length})</b>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set(items.map(item => item.key)))}>전체 선택</button>
                    <button type="button" className="btn btn-sm" onClick={() => setSelected(new Set())}>전체 해제</button>
                  </div>
                </div>
                <div style={{ maxHeight: 'min(48vh, 480px)', overflowY: 'auto', padding: '4px 12px' }}>
                  {items.map(item => (
                    <label key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 9, minHeight: 36, cursor: 'pointer', borderBottom: '1px solid #edf1f6', fontSize: 14 }}>
                      <input type="checkbox" checked={selected.has(item.key)} onChange={() => toggleSpecies(item.key)} />
                      <span>{item.species}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 12 }}>
                  <button type="button" style={{ ...buttonStyle, color: '#fff', background: '#13824a', borderColor: '#13824a' }} onClick={downloadSelected} disabled={!selected.size || !!busy}>
                    {busy && busy.includes('다운로드 중') ? busy : `선택 ${selected.size}개 다운로드`}
                  </button>
                </div>
              </section>
            )}
            {busy && !busy.includes('다운로드 중') && <p role="status" style={{ color: '#1764b0', margin: '12px 0 0', fontSize: 13 }}>{busy}</p>}
            {message && <p role="status" style={{ color: '#17603a', margin: '12px 0 0', fontSize: 13 }}>{message}</p>}
            {error && <p role="alert" style={{ color: '#b42318', background: '#fff1f0', border: '1px solid #ffd0cb', borderRadius: 5, padding: 10, margin: '12px 0 0', fontSize: 13 }}>{error}</p>}
          </form>
        </section>
      </main>
      <style jsx>{`
        .round-selection-grid { display: grid; grid-template-columns: 130px minmax(0, 1fr) minmax(0, 1fr); gap: 12px; align-items: start; }
        .week-picker { min-width: 0; margin: 0; padding: 8px 10px 10px; border: 1px solid #cbd8e8; border-radius: 7px; }
        .week-picker legend { padding: 0 5px; color: #284564; font-size: 13px; font-weight: 700; }
        .week-choice-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(62px, 1fr)); gap: 6px; }
        .week-choice-button { min-height: 36px; padding: 5px 7px; border: 1px solid #9db4d0; border-radius: 5px; background: #f8fafc; color: #284564; font-size: 13px; font-weight: 700; cursor: pointer; }
        .week-choice-button[aria-checked="true"] { border-color: #0e4f96; background: #1764b0; color: #fff; box-shadow: inset 0 0 0 1px #0e4f96, 0 0 0 2px #dcecff; }
        .week-choice-button:focus-visible { outline: 3px solid #e5a900; outline-offset: 2px; z-index: 1; }
        .week-choice-button:disabled { opacity: .45; cursor: not-allowed; }
        .week-choice-empty { grid-column: 1 / -1; padding: 5px 2px; color: #61758d; font-size: 13px; }
        @media (max-width: 800px) { .round-selection-grid { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); } .year-picker { grid-column: 1 / -1; max-width: 170px; } }
        @media (max-width: 560px) { .round-selection-grid { grid-template-columns: minmax(0, 1fr); } .year-picker { grid-column: auto; } }
      `}</style>
    </>
  );
}
