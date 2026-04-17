// lib/useWeekInput.js
// 차수 자동 포맷 훅 + 공통 WeekInput 컴포넌트
// 수정이력: 2026-03-30 — 오늘 날짜 기준 기본 차수 자동 계산 추가
// 수정이력: 2026-04-01 — prev/next 이동, WeekInput 공통 컴포넌트 추가
// 수정이력: 2026-04-17 — 연도 개념 추가 (2026-WW-SS 형식, 2025 구데이터 구분 표시)

import { useState } from 'react';

// 기본 연도 (새 입력의 기준 연도)
const DEFAULT_YEAR = 2026;

// ── 내부 파싱: "WW-SS" (구 2025) 또는 "YYYY-WW-SS" (신) 모두 처리
function parseWeekParts(val) {
  if (!val) return null;
  const parts = String(val).split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0]);
    const week = parseInt(parts[1]);
    const seq  = parseInt(parts[2]);
    if (year >= 2020 && year <= 2099 && week >= 1 && week <= 52 && seq >= 1 && seq <= 9)
      return { year, week, seq, isOld: false };
  } else if (parts.length === 2) {
    const week = parseInt(parts[0]);
    const seq  = parseInt(parts[1]);
    if (week >= 1 && week <= 52 && seq >= 1 && seq <= 9)
      return { year: 2025, week, seq, isOld: true }; // 구 데이터 → 2025
  }
  return null;
}

function buildWeekStr(year, week, seq, isOld = false) {
  const ww = String(week).padStart(2, '0');
  const ss = String(seq).padStart(2, '0');
  // 구 형식(2025) 데이터는 WW-SS 그대로, 신 형식은 YYYY-WW-SS
  if (isOld) return `${ww}-${ss}`;
  return `${year}-${ww}-${ss}`;
}

// ── 표시용 레이블: "WW-SS" → "25년 WW-SS" / "2026-WW-SS" → "WW-SS"
export function formatWeekDisplay(w) {
  if (!w) return '';
  const p = parseWeekParts(w);
  if (!p) return w;
  const wStr = `${String(p.week).padStart(2,'0')}-${String(p.seq).padStart(2,'0')}`;
  if (p.year === DEFAULT_YEAR) return wStr;             // 현재 연도: 연도 생략
  return `${String(p.year).slice(2)}년 ${wStr}`;       // 다른 연도: "25년 WW-SS"
}

// ── 오늘 날짜 기준 기본 차수 (2026-WW-01)
export function getCurrentWeek() {
  const now = new Date();
  const year = now.getFullYear();
  const start = new Date(year, 0, 1);
  const dayOfYear = Math.floor((now - start) / (24 * 60 * 60 * 1000)) + 1;
  const weekNum = Math.min(Math.ceil(dayOfYear / 7), 52);
  return `${year}-${String(weekNum).padStart(2, '0')}-01`;
}

// ── 입력 문자열 → 표준 형식 (신 YYYY-WW-SS)
function formatWeek(val) {
  if (!val) return '';
  // 이미 YYYY-WW-SS
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  // 구 WW-SS 형식: 그대로 유지 (기존 2025 데이터용)
  if (/^\d{2}-\d{2}$/.test(val)) return val;
  // 숫자만 입력: 앞 두자리=주, 뒤=차수
  const nums = val.replace(/[^0-9]/g, '');
  if (!nums) return '';
  if (nums.length >= 3) {
    const week = nums.slice(0, 2);
    const seq  = nums.slice(2, 4).padStart(2, '0').slice(0, 2);
    return `${DEFAULT_YEAR}-${week}-${seq}`;
  }
  return `${DEFAULT_YEAR}-${nums.padStart(2, '0')}-01`;
}

// ── 차수 이전/다음 계산 (1차수 = 4순환: 01~04)
const MAX_SEQ = 4;

function stepWeek(current, direction) {
  const p = parseWeekParts(current);
  if (!p) return current;
  let { year, week, seq, isOld } = p;
  if (direction === 'next') {
    seq++;
    if (seq > MAX_SEQ) { seq = 1; week++; }
    if (week > 52) { week = 1; year++; isOld = false; }
  } else {
    seq--;
    if (seq < 1) { seq = MAX_SEQ; week--; }
    if (week < 1) { week = 52; year--; }
    if (year < 2020) { week = 1; seq = 1; }
  }
  return buildWeekStr(year, week, seq, isOld);
}

// ── 주차(WW) 단위 이동 — 시퀀스 고정
function stepWeekBig(current, direction) {
  const p = parseWeekParts(current);
  if (!p) return current;
  let { year, week, seq, isOld } = p;
  week += direction === 'next' ? 1 : -1;
  if (week > 52) { week = 1; year++; isOld = false; }
  if (week < 1)  { week = 52; year--; }
  if (year < 2020) week = 1;
  return buildWeekStr(year, week, seq, isOld);
}

// ── useWeekInput(initial)
export function useWeekInput(initial) {
  const defaultVal = (initial === undefined || initial === '') ? getCurrentWeek() : initial;
  const [raw, setRaw] = useState(defaultVal);
  const [formatted, setFormatted] = useState(defaultVal);

  const handleChange = (e) => {
    const val = e.target.value;
    setRaw(val);
    if (val.includes('-')) {
      const parts = val.split('-');
      if (parts.length === 3) {
        // YYYY-WW-SS 입력 중
        const year = parts[0].replace(/\D/g,'').slice(0,4);
        const week = parts[1].replace(/\D/g,'').slice(0,2);
        const seq  = (parts[2]||'').replace(/\D/g,'').slice(0,2);
        setFormatted(seq ? `${year}-${week}-${seq.padStart(2,'0')}` : `${year}-${week}-`);
      } else {
        const week = parts[0].replace(/\D/g,'').slice(0,2);
        const seq  = (parts[1]||'').replace(/\D/g,'').slice(0,2);
        setFormatted(seq ? `${week}-${seq.padStart(2,'0')}` : `${week}-`);
      }
    } else {
      setFormatted(val);
    }
  };

  const handleBlur = () => {
    const result = formatWeek(raw);
    setRaw(result);
    setFormatted(result);
  };

  const prev     = () => { const v = stepWeek(formatted, 'prev');    setRaw(v); setFormatted(v); };
  const next     = () => { const v = stepWeek(formatted, 'next');    setRaw(v); setFormatted(v); };
  const prevWeek = () => { const v = stepWeekBig(formatted, 'prev'); setRaw(v); setFormatted(v); };
  const nextWeek = () => { const v = stepWeekBig(formatted, 'next'); setRaw(v); setFormatted(v); };

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
    prevWeek,
    nextWeek,
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

// ── WeekSpinInput: 앞단위(주차)와 뒷단위(차수) 모두 위아래 스핀
export function WeekSpinInput({ weekInput, style, label }) {
  const p = parseWeekParts(weekInput.value);
  const week = p ? String(p.week).padStart(2,'0') : '01';
  const seq  = p ? String(p.seq).padStart(2,'0')  : '01';
  const year = p ? p.year : DEFAULT_YEAR;
  const isOld = p ? p.isOld : false;

  const spinWeekUp   = () => { const w = Math.max(1, p ? p.week+1 : 1); weekInput.setValue(buildWeekStr(w > 52 ? year+1 : year, w > 52 ? 1 : w, p?.seq||1, isOld && w <= 52)); };
  const spinWeekDown = () => { const w = Math.max(1, p ? p.week-1 : 1); weekInput.setValue(buildWeekStr(year, w, p?.seq||1, isOld)); };

  const spinSeqUp = () => {
    const s = (p ? p.seq : 1) % MAX_SEQ + 1;
    weekInput.setValue(buildWeekStr(year, p?.week||1, s, isOld));
  };
  const spinSeqDown = () => {
    let s = (p ? p.seq : 1) - 1;
    if (s < 1) s = MAX_SEQ;
    weekInput.setValue(buildWeekStr(year, p?.week||1, s, isOld));
  };

  const btnStyle = { width: 30, height: 18, padding: 0, fontSize: 10, lineHeight: '16px' };
  const colStyle = { display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 1 };

  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, ...style }}>
      {label && <span className="filter-label">{label}</span>}
      {/* 년도 표시 (현재 연도가 아닌 경우만) */}
      {year !== DEFAULT_YEAR && (
        <span style={{ fontSize: 10, color: '#e65100', fontWeight: 700, marginRight: 2 }}>
          {String(year).slice(2)}년
        </span>
      )}
      {/* 앞단위(주차): ▲▼ */}
      <span style={colStyle}>
        <button type="button" className="btn btn-sm" style={btnStyle} onClick={spinWeekUp}>▲</button>
        <input className="filter-input"
          style={{ width: 36, textAlign: 'center', height: 24, fontWeight: 700 }}
          value={week} readOnly />
        <button type="button" className="btn btn-sm" style={btnStyle} onClick={spinWeekDown}>▼</button>
      </span>
      <span style={{ fontSize: 13, color: 'var(--text3)', userSelect: 'none' }}>-</span>
      {/* 뒷단위(차수): ▲▼ */}
      <span style={colStyle}>
        <button type="button" className="btn btn-sm" style={btnStyle} onClick={spinSeqUp}>▲</button>
        <span style={{
          width: 30, height: 24, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 500, color: 'var(--text2)',
          border: '1px solid var(--border2)', borderRadius: 3, background: 'var(--bg)',
        }}>{seq}</span>
        <button type="button" className="btn btn-sm" style={btnStyle} onClick={spinSeqDown}>▼</button>
      </span>
    </span>
  );
}

// ── 공통 WeekInput 컴포넌트 (좌우 버튼 포함)
export function WeekInput({ weekInput, style, label }) {
  const p = parseWeekParts(weekInput.value);
  const showYearBadge = p && p.year !== DEFAULT_YEAR;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, ...style }}>
      {label && <span className="filter-label">{label}</span>}
      {showYearBadge && (
        <span style={{ fontSize: 10, color: '#e65100', fontWeight: 700, padding: '1px 4px', background: '#fff3e0', borderRadius: 3 }}>
          {String(p.year).slice(2)}년
        </span>
      )}
      <button
        type="button"
        className="btn btn-sm"
        style={{ width: 22, height: 22, padding: 0, fontSize: 11, lineHeight: '20px' }}
        onClick={weekInput.prev}
        title="이전 차수"
      >◀</button>
      <input
        className="filter-input"
        style={{ width: 110, textAlign: 'center' }}
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
