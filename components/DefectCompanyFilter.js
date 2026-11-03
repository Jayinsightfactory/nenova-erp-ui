import { useMemo, useRef, useState } from 'react';
import { defectCompanyChoices, defectInputSource } from '../lib/defectCompanyFilter.js';

export function DefectInputSource({ row }) {
  const source = defectInputSource(row);
  return <small title={source.detail} style={{ display: 'block', color: source.label === '자동수집' ? '#1d4ed8' : '#475569', fontSize: 12, marginTop: 3 }}>입력: {source.label}</small>;
}

export default function DefectCompanyFilter({ rows, value, onChange, disabled = false }) {
  const [query, setQuery] = useState('');
  const searchRef = useRef(null);
  const choices = useMemo(() => defectCompanyChoices(rows, query), [rows, query]);
  const selected = defectCompanyChoices(rows).find(item => item.key === value);
  const clear = () => { setQuery(''); onChange(''); searchRef.current?.focus(); };
  return <section aria-label="업체별 보기" style={{ padding: 10, marginTop: 8, border: '1px solid #bfcee2', borderRadius: 5, background: '#f8fafc' }}>
    <label>업체 검색 <input ref={searchRef} className="input" aria-label="목록 업체 검색" placeholder="업체명을 입력하고 아래 업체 버튼을 누르세요" value={query} disabled={disabled} style={{ width: 'min(360px, 100%)' }} onChange={e => setQuery(e.target.value)} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); clear(); }
      if (e.key === 'Enter' && choices.length === 1) { e.preventDefault(); onChange(choices[0].key); }
      if (e.key === 'ArrowDown') { e.preventDefault(); e.currentTarget.closest('section').querySelector('[data-company-button]')?.focus(); }
    }} /></label>
    <button type="button" className="btn" disabled={disabled} onClick={clear} aria-pressed={!value} style={{ marginLeft: 6 }}>전체 업체 ({rows.length}건)</button>
    <div role="group" aria-label="업체 선택" style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginTop: 7 }} onKeyDown={e => {
      if (e.key === 'Escape') { e.preventDefault(); clear(); return; }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
      const buttons = [...e.currentTarget.querySelectorAll('button:not(:disabled)')];
      const index = buttons.indexOf(e.target);
      if (index < 0) return;
      e.preventDefault(); buttons[(index + (['ArrowRight', 'ArrowDown'].includes(e.key) ? 1 : -1) + buttons.length) % buttons.length]?.focus();
    }}>
      {choices.map(item => <button key={item.key} data-company-button type="button" className={`btn ${value === item.key ? 'btn-primary' : ''}`} disabled={disabled} aria-pressed={value === item.key} title={item.custKey > 0 ? `거래처 #${item.custKey}` : '미매칭 업체명 기준'} onClick={() => onChange(item.key)}>{item.name} ({item.count}건)</button>)}
      {!choices.length && <span>검색 결과가 없습니다. 업체명을 다시 입력하세요.</span>}
    </div>
    <div role="status" style={{ marginTop: 7, color: '#475569', fontSize: 12 }}>{value ? `${selected?.name || '선택한 업체'}만 표시 · ${selected?.count || 0}건. 전체선택·문제 해결 창도 이 업체만 대상으로 합니다.` : '전체 업체 표시. 업체 버튼을 누르면 해당 업체 자료만 보입니다.'} 입력 출처는 각 업체명 아래에 표시됩니다.</div>
  </section>;
}
