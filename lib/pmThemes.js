// lib/pmThemes.js
// /pm 디자인 테마 — public/pm-themes/manifest.json 한 곳의 색 토큰·에셋 경로로 CSS 를 만든다.
//   기본 테마(office)는 CSS 를 하나도 만들지 않는다 = 기존 화면 그대로(회귀 0).
//   모든 규칙은 .pm[data-theme="id"] 안에만 걸리고, 에셋 url 은 그 테마를 고를 때만 브라우저가 받는다(지연 로딩).
export const PM_DEFAULT_THEME = 'office';
export const PM_THEME_KEY = 'pm.theme';
export const PM_DEPTS = ['경영지원', '영업지원', '영업부', '수입부'];

const safe = (v) => String(v || '').replace(/[^#a-zA-Z0-9(),.\s%-]/g, '');
const url = (v) => `url("${String(v || '').replace(/["\\\n]/g, '')}")`;

export function themeCss(t) {
  if (!t || t.default || !/^[a-z0-9-]+$/.test(t.id || '')) return '';
  const s = `.pm[data-theme="${t.id}"]`;
  const ink = safe(t.ink); const surface = safe(t.surface); const muted = safe(t.muted); const line = safe(t.line);
  const rules = [
    `${s} { background: ${safe(t.bg)} ${url(t.background)} repeat; color: ${ink}; }`,
    `${s} .floor { background: transparent !important; border-color: ${line}; }`,
    `${s} .hallwrap { background: ${surface} !important; border-color: ${line} !important; box-shadow: none !important; }`,
    `${s} .table { background: rgba(0,0,0,.06); }`,
    `${s} .room { border-color: ${line}; box-shadow: inset 0 0 0 2px ${line}, 0 8px 0 rgba(0,0,0,.18), 0 10px 14px rgba(0,0,0,.2) !important; }`,
    `${s} .lab, ${s} .mgr { background: ${surface} !important; }`,
    `${s} .plate { background: ${safe(t.plate)}; color: ${safe(t.plateInk)}; border-color: ${line}; }`,
    `${s} .seat { background: ${surface}; border-color: ${line}; box-shadow: 0 4px 0 rgba(0,0,0,.15); }`,
    `${s} .seat.d-off { background: ${surface}; opacity: .82; }`,
    `${s} .seat.d-working { border-color: #2f9e62; } ${s} .seat.d-error { border-color: #c0392b; }`,
    `${s} .nm, ${s} .hall-t, ${s} .hlist li, ${s} .hlist .muted, ${s} h3 { color: ${ink}; }`,
    `${s} .muted, ${s} .hall-t small { color: ${muted}; }`,
    `${s} .panel, ${s} .tstrip, ${s} .spanel, ${s} .cell, ${s} .task, ${s} .msg, ${s} .lchip { background-color: ${surface}; color: ${ink}; border-color: ${line}; }`,
    `${s} .cell .ch, ${s} .cell .cl, ${s} .cell .cd, ${s} .cell .cd2 { color: ${ink}; }`,
    `${s} .cell { border-color: var(--sc, ${line}); box-shadow: 0 4px 0 rgba(0,0,0,.15); }`,
    `${s} .badge, ${s} .pchips span, ${s} .mt { background: ${line}; color: ${ink}; }`,
    // 버튼은 components/pm/ui.js 키트 토큰만 바꾼다(모양은 키트가 고정).
    `${s} { --pmk-chip-bg: ${line}; --pmk-chip-ink: ${ink}; --pmk-on-bg: ${safe(t.plate)}; --pmk-on-ink: ${safe(t.plateInk)}; --pmk-ink: ${ink}; --pmk-tab-ink: ${muted}; --pmk-tab-on: ${safe(t.accent)}; --pmk-focus: ${safe(t.accent)}; --pmk-link: ${safe(t.light ? t.accent : t.ink)}; }`,
    `${s} .wn, ${s} .spx { color: ${ink}; }`,
    `${s} .badge.live { background: #1f8f4f; color: #fff; } ${s} .badge.warn { background: #b8452f; color: #fff; }`,
    `${s} .cell[data-stage] { background-repeat: no-repeat; background-size: 16px 16px; background-position: right 3px top 3px; }`,
  ];
  (t.stageIcons || []).forEach((src, i) => rules.push(`${s} .cell[data-stage="${i + 1}"] { background-image: ${url(src)}; }`));
  for (const d of PM_DEPTS) {
    const f = t.depts?.[d]?.floor;
    if (f) rules.push(`${s} .room.dept[data-dept="${d}"] { background: ${url(f)} repeat !important; }`);
  }
  return rules.join('\n');
}

export function readStoredTheme() {
  try { return window.localStorage.getItem(PM_THEME_KEY) || PM_DEFAULT_THEME; } catch { return PM_DEFAULT_THEME; }
}
export function storeTheme(id) {
  try { window.localStorage.setItem(PM_THEME_KEY, id); } catch { /* 저장 불가(사생활 모드)면 이번 화면만 */ }
}
