// lib/useWeekInput.js
// 차수 자동 포맷 훅 + 공통 WeekInput 컴포넌트
// 수정이력: 2026-03-30 — 오늘 날짜 기준 기본 차수 자동 계산 추가
// 수정이력: 2026-04-01 — prev/next 이동, WeekInput 공통 컴포넌트 추가

import { useState } from 'react';

// 오늘 날짜 기준 주차 계산
export function getCurrentWeek() {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const dayOfYear = Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1;
  const weekNum = Math.ceil(dayOfYear / 7);
  const ww = String(Math.min(weekNum, 52)).padStart(2, '0');
  return `${ww}-01`;
}

// 문자열 포맷: "13" → "13-01", "132" → "13-02"
function formatWeek(val) {
  const nums = val.replace(/[^0-9]/g, '');
  if (!nums) return '';
  if (/^\d{1,2}-\d{2}$/.test(val)) return val;
  if (nums.length >= 3) {
    const week = nums.slice(0, 2);
    const seq  = nums.slice(2, 4).padStart(2, '0').slice(0, 2);
    return `${week}-${seq}`;
  }
  return `${nums.padStart(2, '0')}-01`;
}

// 차수 이전/다음 계산 (1차수 = 4순환: 01~04)
const MAX_SEQ = 4;
function stepWeek(current, direction) {
  if (!current || !current.includes('-')) return current;
  const [weekStr, seqStr] = current.split('-');
  let week = parseInt(weekStr) || 1;
  let seq  = parseInt(seqStr)  || 1;

  if (direction === 'next') {
    seq += 1;
    if (seq > MAX_SEQ) { seq = 1; week += 1; }
  } else {
    seq -= 1;
    if (seq < 1) { seq = MAX_SEQ; week -= 1; }
    if (week < 1) week = 1;
  }
  return `${String(week).padStart(2, '0')}-${String(seq).padStart(2, '0')}`;
}

// useWeekInput(initial)
export function useWeekInput(initial) {
  const defaultVal = (initial === undefined || initial === '') ? getCurrentWeek() : initial;
  const [raw, setRaw] = useState(defaultVal);
  const [formatted, setFormatted] = useState(defaultVal);

  const handleChange = (e) => {
    const val = e.target.value;
    setRaw(val);
    if (val.includes('-')) {
      const parts = val.split('-');
      const week = parts[0].replace(/\D/g, '').slice(0, 2);
      const seq  = (parts[1] || '').replace(/\D/g, '').slice(0, 2);
      setFormatted(seq ? `${week}-${seq.padStart(2, '0')}` : `${week}-`);
    } else {
      setFormatted(val);
    }
  };

  const handleBlur = () => {
    const result = formatWeek(raw);
    setRaw(result);
    setFormatted(result);
  };

  const prev = () => {
    const v = stepWeek(formatted, 'prev');
    setRaw(v); setFormatted(v);
  };

  const next = () => {
    const v = stepWeek(formatted, 'next');
    setRaw(v); setFormatted(v);
  };

  return {
    value: formatted,
    props: {
      value: raw,
      onChange: handleChange,
      onBlur: handleBlur,
      placeholder: getCurrentWeek(),
    },
    setValue: (val) => { setRaw(val); setFormatted(val); },
    prev,
    next,
  };
}

// ── 년도 훅
export function useYearInput(initial) {
  const defaultVal = initial || String(new Date().getFullYear());
  const [year, setYear] = useState(defaultVal);
  const prev = () => setYear(y => String(Number(y) - 1));
  const next = () => setYear(y => String(Number(y) + 1));
  return { value: year, setValue: setYear, prev, next };
}

// ── 공통 YearInput 컴포넌트
export function YearInput({ yearInput, style, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...style }}>
      {label && <span className="filter-label">{label}</span>}
      <button type="button" className="btn btn-sm"
        style={{ width: 22, height: 22, padding: 0, fontSize: 11, lineHeight: '20px' }}
        onClick={yearInput.prev} title="이전 년도">◀</button>
      <select className="filter-input" style={{ width: 70, textAlign: 'center', height: 22, fontSize: 11 }}
        value={yearInput.value} onChange={e => yearInput.setValue(e.target.value)}>
        {[...Array(5)].map((_, i) => {
          const y = new Date().getFullYear() - 2 + i;
          return <option key={y} value={y}>{y}</option>;
        })}
      </select>
      <button type="button" className="btn btn-sm"
        style={{ width: 22, height: 22, padding: 0, fontSize: 11, lineHeight: '20px' }}
        onClick={yearInput.next} title="다음 년도">▶</button>
    </span>
  );
}

// ── WeekSpinInput: 앞단위(주차 번호)만 위아래 스핀, 뒷단위(순환) 표시
// pivot.js 등에서 "14▲▼-04" 형태로 사용
export function WeekSpinInput({ weekInput, style, label }) {
  const parts = (weekInput.value || '').split('-');
  const week = parts[0] || '01';
  const seq  = parts[1] || '01';

  const spinUp = () => {
    const w = Math.max(1, (parseInt(week) || 1) + 1);
    weekInput.setValue(`${String(w).padStart(2, '0')}-${seq}`);
  };
  const spinDown = () => {
    const w = Math.max(1, (parseInt(week) || 1) - 1);
    weekInput.setValue(`${String(w).padStart(2, '0')}-${seq}`);
  };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...style }}>
      {label && <span className="filter-label">{label}</span>}
      {/* 앞단위: 위아래 스핀 */}
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <button type="button" className="btn btn-sm"
          style={{ width: 44, height: 18, padding: 0, fontSize: 10, lineHeight: '16px' }}
          onClick={spinUp}>▲</button>
        <input
          className="filter-input"
          style={{ width: 44, textAlign: 'center', height: 24, fontWeight: 700 }}
          value={week}
          readOnly
        />
        <button type="button" className="btn btn-sm"
          style={{ width: 44, height: 18, padding: 0, fontSize: 10, lineHeight: '16px' }}
          onClick={spinDown}>▼</button>
      </span>
      {/* 구분자 + 뒷단위 표시 */}
      <span style={{ fontSize: 13, color: 'var(--text3)', userSelect: 'none' }}>-</span>
      <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
        <span style={{ height: 18 }} />
        <span style={{
          width: 30, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 500, color: 'var(--text2)',
          border: '1px solid var(--border2)', borderRadius: 3, background: 'var(--bg)',
        }}>{seq}</span>
        <span style={{ height: 18 }} />
      </span>
    </span>
  );
}

// ── 공통 WeekInput 컴포넌트 (좌우 버튼 포함)
export function WeekInput({ weekInput, style, label }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...style }}>
      {label && <span className="filter-label">{label}</span>}
      <button
        type="button"
        className="btn btn-sm"
        style={{ width: 22, height: 22, padding: 0, fontSize: 11, lineHeight: '20px' }}
        onClick={weekInput.prev}
        title="이전 차수"
      >◀</button>
      <input
        className="filter-input"
        style={{ width: 60, textAlign: 'center' }}
        {...weekInput.props}
      />
      <button
        type="button"
        className="btn btn-sm"
        style={{ width: 22, height: 22, padding: 0, fontSize: 11, lineHeight: '20px' }}
        onClick={weekInput.next}
        title="다음 차수"
      >▶</button>
    </span>
  );
}
