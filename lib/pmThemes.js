// lib/pmThemes.js
// /pm 디자인 테마 — 유일한 정의 장소. Gemini 시안 10종(C:\Users\USER\nenova-pm\theme-mockups)에서 색을 실측해 토큰으로 옮겼다.
//   테마 = 디자인 토큰 한 세트(--pm-*) + 배경 장식(CSS 그라데이션 + 시안을 흐리게 줄인 텍스처 public/pm/themes/X-bg.jpg).
//   pages/pm.js · components/pm/* 는 색을 직접 쓰지 않고 var(--pm-*) 만 쓴다(__tests__/pmNoHexColor.test.js 가 검사).
//   hex 색은 이 파일에만 둔다.
export const PM_DEFAULT_THEME = 'B';
export const PM_THEME_KEY = 'pm.theme';
export const PM_DEPTS = ['경영지원', '영업지원', '영업부', '수입부'];

const ROUND = '"Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif';

// 공통(테마 무관) 의미 색 — 상태·단계·차트. 테마가 덮어쓸 수 있음.
export const PM_BASE_TOKENS = {
  ok: '#2f9e62', okBg: '#c9f2d9', okInk: '#0b3d1f',
  idle: '#e0a92e', idleBg: '#ffeab0', idleInk: '#4a3200',
  err: '#d9443a', errBg: '#ffd2cc', errInk: '#5c0d05',
  offBg: '#dde1e8', offInk: '#2a2f3a',
  estBg: '#ffeab0', estInk: '#4a3200',
  dept1: '#c9925a', dept2: '#5b8def', dept3: '#b56cc7', dept4: '#3fa56b',
  bubble: '#ffffff', bubbleInk: '#1b1f2a',
  skin: '#f2c9a0', hair: '#3b2a20', robot: '#b8c4d6', deskWood: '#a8724a', deskTop: '#c48e60', monitor: '#2b2f3a', screen: '#1c2a3a', screenOn: '#3fbf7f',
};

export const STAGE_COLOR = { 1: '#4f8cff', 2: '#20b2a6', 3: '#3fbf7f', 4: '#94c43a', 5: '#e8b322', 6: '#f0803c', 7: '#ef6a86', 8: '#a77bff', 9: '#7c8597' };
export const SHIRTS = ['#4f8cff', '#ff8a4f', '#3fbf7f', '#c26bff', '#ffcc3f', '#ff5f8f', '#3fc8d8', '#9a7b4f'];
export const CHART_COLORS = ['#2f6fe0', '#1f9d55', '#c26b00', '#8e44ad', '#d6336c', '#0b8a8a', '#6b7a1f', '#9a5b2e', '#5a6276'];

// t: 토큰. dark=어두운 테마. floor=방 바닥, hall=복도 길, deco=페이지 배경 위 장식 레이어.
export const PM_THEMES = [
  { id: 'A', name: '아늑한 원목', emoji: '🪵', dark: false, desc: '따뜻한 나무 바닥 · 남색 헤더',
    t: { bg: '#8a5a36', surface: '#fbf3e4', surface2: '#f1e2c8', ink: '#3a2616', muted: '#7a5a3e', accent: '#c2703a', accentInk: '#ffffff', accent2: '#5f8a4a', line: '#c9a57c', header: '#2b3350', headerInk: '#f4ecdf', hall: '#a9c58c', hallInk: '#24361a', room: '#d9b98f', plate: '#2b3350', plateInk: '#f4ecdf', link: '#a4521f', radius: '10px', shadow: '0 4px 0 rgba(74,46,22,.35)', font: ROUND },
    floor: 'repeating-linear-gradient(90deg, #c9a272 0 22px, #bf9566 22px 44px)', deco: 'repeating-linear-gradient(90deg, rgba(0,0,0,.06) 0 3px, transparent 3px 60px)' },
  { id: 'B', name: '파스텔 클레이', emoji: '🌸', dark: false, desc: '말랑한 3D 클레이 · 민트·핑크',
    t: { bg: '#e6f4f1', surface: '#ffffff', surface2: '#f2f8fa', ink: '#33475a', muted: '#7a8b9b', accent: '#4cc3a8', accentInk: '#ffffff', accent2: '#f4a9c0', line: '#cfe4ea', header: '#ffffff', headerInk: '#33475a', hall: '#c9efe3', hallInk: '#1f5a4c', room: '#f7fbfc', plate: '#ffffff', plateInk: '#33475a', link: '#2b8f79', radius: '18px', shadow: '0 6px 16px rgba(80,130,150,.18)', font: ROUND },
    floor: 'linear-gradient(180deg, #fbfdfe, #eef6f8)', deco: 'radial-gradient(circle at 15% 10%, rgba(244,169,192,.25), transparent 40%), radial-gradient(circle at 85% 90%, rgba(76,195,168,.22), transparent 45%)' },
  { id: 'C', name: '야간 네온', emoji: '🌃', dark: true, desc: '어두운 사무실 · 네온 연결선',
    t: { bg: '#0f1326', surface: '#1b2142', surface2: '#232a52', ink: '#eef1ff', muted: '#a2acdb', accent: '#8b7dff', accentInk: '#ffffff', accent2: '#ff6fb5', line: '#39447f', header: '#141a36', headerInk: '#eef1ff', hall: '#262d5c', hallInk: '#d7dcff', room: '#1a2040', plate: '#2a1f55', plateInk: '#9df0ff', link: '#5ee0ff', radius: '12px', shadow: '0 0 0 1px rgba(94,224,255,.25), 0 8px 18px rgba(0,0,0,.45)', font: ROUND,
      offBg: '#2c3360', offInk: '#d7dcff', bubble: '#232a52', bubbleInk: '#eef1ff', deskWood: '#3a3560', deskTop: '#4a4380', screen: '#123048' },
    floor: 'repeating-conic-gradient(#1c2244 0 25%, #191f3e 0 50%) 0 0 / 28px 28px', deco: 'radial-gradient(circle at 20% 0%, rgba(139,125,255,.25), transparent 40%), radial-gradient(circle at 90% 70%, rgba(255,111,181,.18), transparent 45%)' },
  { id: 'D', name: '한옥', emoji: '🏯', dark: false, desc: '한지·목재 · 단청 빨강',
    t: { bg: '#e9dcc2', surface: '#fbf5e8', surface2: '#f2e7d0', ink: '#3b2a1c', muted: '#7a6248', accent: '#b23a2e', accentInk: '#fff8ec', accent2: '#2f6f6a', line: '#a98458', header: '#fbf5e8', headerInk: '#3b2a1c', hall: '#d6c29b', hallInk: '#3b2a1c', room: '#c79d6a', plate: '#3b2a1c', plateInk: '#fbf0dc', link: '#8f2c22', radius: '6px', shadow: '0 3px 0 rgba(59,42,28,.35)', font: '"Nanum Myeongjo", "Batang", serif' },
    floor: 'repeating-linear-gradient(0deg, #c79d6a 0 18px, #bb915f 18px 20px), linear-gradient(90deg, rgba(0,0,0,.05) 50%, transparent 0) 0 0 / 80px 100%', deco: 'repeating-linear-gradient(0deg, rgba(120,80,40,.08) 0 2px, transparent 2px 90px), repeating-linear-gradient(90deg, rgba(120,80,40,.08) 0 2px, transparent 2px 90px)' },
  { id: 'E', name: '꽃 온실', emoji: '🌿', dark: false, desc: '유리 온실 · 덩굴과 꽃',
    t: { bg: '#e3ecd9', surface: '#fafcf4', surface2: '#eef4e2', ink: '#22351f', muted: '#5b6e52', accent: '#4f8a3c', accentInk: '#ffffff', accent2: '#e88aa8', line: '#b5cb9f', header: '#dbe8cf', headerInk: '#22351f', hall: '#b9d39a', hallInk: '#22351f', room: '#efe6d2', plate: '#4f8a3c', plateInk: '#ffffff', link: '#3a6f2b', radius: '16px', shadow: '0 4px 10px rgba(50,90,40,.18)', font: ROUND },
    floor: 'linear-gradient(180deg, #f4ecda, #ebe0c7)', deco: 'radial-gradient(circle at 0% 0%, rgba(79,138,60,.25), transparent 35%), radial-gradient(circle at 100% 100%, rgba(232,138,168,.22), transparent 40%)' },
  { id: 'F', name: '8비트 오락실', emoji: '👾', dark: true, desc: '픽셀 · 각진 칸 · 빨강 테두리',
    t: { bg: '#0c1230', surface: '#161f4a', surface2: '#1e2a5e', ink: '#ffffff', muted: '#b3bdff', accent: '#2f6bff', accentInk: '#ffffff', accent2: '#ff3b5c', line: '#d6304a', header: '#0c1230', headerInk: '#ffffff', hall: '#7fb35a', hallInk: '#0c1230', room: '#9a6438', plate: '#2f6bff', plateInk: '#ffffff', link: '#ffd23f', radius: '0px', shadow: '4px 4px 0 #000000', font: '"Galmuri11", "DungGeunMo", ui-monospace, monospace',
      offBg: '#2a356e', offInk: '#e6eaff', bubble: '#ffffff', bubbleInk: '#0c1230' },
    floor: 'repeating-linear-gradient(90deg, #9a6438 0 16px, #8c5830 16px 32px)', deco: 'repeating-linear-gradient(0deg, rgba(255,255,255,.04) 0 2px, transparent 2px 4px)' },
  { id: 'G', name: '수채화 마을', emoji: '🎨', dark: false, desc: '동화풍 수채 · 빨간 지붕',
    t: { bg: '#f3ead3', surface: '#fffaf0', surface2: '#f7efdc', ink: '#4a3a2a', muted: '#8a7656', accent: '#c4453a', accentInk: '#fffaf0', accent2: '#6f9a4a', line: '#d8c39a', header: '#fffaf0', headerInk: '#4a3a2a', hall: '#e7d6ae', hallInk: '#4a3a2a', room: '#e9f0d6', plate: '#fffaf0', plateInk: '#4a3a2a', link: '#a3352c', radius: '14px', shadow: '0 2px 0 rgba(74,58,42,.25)', font: '"Gaegu", "Nanum Pen Script", ' + ROUND },
    floor: 'radial-gradient(circle at 30% 30%, #eef3d9, #dfe8c2)', deco: 'radial-gradient(ellipse at 10% 20%, rgba(111,154,74,.2), transparent 40%), radial-gradient(ellipse at 90% 10%, rgba(196,69,58,.12), transparent 40%)' },
  { id: 'H', name: '우주정거장', emoji: '🚀', dark: true, desc: '원형 정거장 · 주황 링',
    t: { bg: '#0a1030', surface: '#162047', surface2: '#1d2a5a', ink: '#e8eeff', muted: '#94a4d0', accent: '#ff8a2a', accentInk: '#1a1206', accent2: '#3fd0ff', line: '#2f3e74', header: '#0f173d', headerInk: '#e8eeff', hall: '#3a4878', hallInk: '#e8eeff', room: '#c7ccd8', plate: '#ff8a2a', plateInk: '#1a1206', link: '#7fdcff', radius: '14px', shadow: '0 0 0 1px rgba(63,208,255,.22), 0 8px 18px rgba(0,0,0,.5)', font: ROUND,
      offBg: '#2a3668', offInk: '#e8eeff', bubble: '#1d2a5a', bubbleInk: '#e8eeff' },
    floor: 'radial-gradient(circle at 50% 50%, #d3d8e4, #aeb5c6)', deco: 'radial-gradient(1px 1px at 20% 30%, #ffffff, transparent), radial-gradient(1px 1px at 70% 60%, #ffffff, transparent), radial-gradient(1.5px 1.5px at 40% 80%, #ffffff, transparent), radial-gradient(circle at 0% 100%, rgba(63,120,255,.3), transparent 45%)' },
  { id: 'I', name: '해변 리조트', emoji: '🏖️', dark: false, desc: '모래·나무 데크 · 청록 바다',
    t: { bg: '#f1dfb8', surface: '#fffaf0', surface2: '#fbefd6', ink: '#3a2a1a', muted: '#8a6e4a', accent: '#f08a3c', accentInk: '#ffffff', accent2: '#22b3c4', line: '#e1c493', header: '#2aa7b5', headerInk: '#ffffff', hall: '#c99a5e', hallInk: '#3a2a1a', room: '#f6e6c4', plate: '#22b3c4', plateInk: '#ffffff', link: '#c4621c', radius: '16px', shadow: '0 5px 12px rgba(120,80,30,.2)', font: ROUND },
    floor: 'repeating-linear-gradient(90deg, #d6aa6e 0 20px, #c99a5e 20px 22px)', deco: 'linear-gradient(110deg, rgba(34,179,196,.35) 0 18%, transparent 30%)' },
  { id: 'J', name: '겨울 눈마을', emoji: '❄️', dark: false, desc: '눈 덮인 통나무집 · 버건디',
    t: { bg: '#e9eff6', surface: '#fffaf3', surface2: '#f6efe6', ink: '#2a1f1a', muted: '#6a5a52', accent: '#8a1f2a', accentInk: '#fffaf3', accent2: '#e6a23c', line: '#d6cabd', header: '#1f2a44', headerInk: '#fffaf3', hall: '#dfe7f0', hallInk: '#2a1f1a', room: '#8a5a3c', plate: '#8a1f2a', plateInk: '#fffaf3', link: '#8a1f2a', radius: '10px', shadow: '0 4px 10px rgba(40,50,70,.18)', font: ROUND },
    floor: 'repeating-linear-gradient(90deg, #a06c48 0 18px, #946240 18px 36px)', deco: 'radial-gradient(2px 2px at 10% 20%, #ffffff, transparent), radial-gradient(2px 2px at 60% 40%, #ffffff, transparent), radial-gradient(2px 2px at 85% 75%, #ffffff, transparent), linear-gradient(180deg, #dfe8f2, #f4f7fb)' },
];

export const themeById = (id) => PM_THEMES.find((x) => x.id === id) || PM_THEMES.find((x) => x.id === PM_DEFAULT_THEME);
export const themeThumb = (id) => `/pm/themes/${id}-thumb.jpg`;
export const themeTexture = (id) => `/pm/themes/${id}-bg.jpg`;

const kebab = (k) => k.replace(/[A-Z0-9]+/g, (m) => `-${m.toLowerCase()}`);
const safe = (v) => String(v ?? '').replace(/[;{}<>]/g, '');

// 테마 하나의 CSS 변수 선언(.pm[data-theme] 범위). 버튼 키트 --pmk-* 도 여기서 토큰에 묶는다.
export function themeCss(theme) {
  const th = theme || themeById(PM_DEFAULT_THEME);
  if (!/^[A-Z]$/.test(th.id)) return '';
  const tok = { ...PM_BASE_TOKENS, ...th.t };
  const vars = Object.entries(tok).map(([k, v]) => `--pm-${kebab(k)}: ${safe(v)};`);
  Object.entries(STAGE_COLOR).forEach(([n, c]) => vars.push(`--pm-stage-${n}: ${c};`));
  vars.push(`--pm-floor: ${safe(th.floor)};`, `--pm-deco: ${safe(th.deco)};`, `--pm-tex: url("${themeTexture(th.id)}");`);
  vars.push(
    '--pmk-primary: var(--pm-accent); --pmk-primary-hover: var(--pm-accent); --pmk-primary-ink: var(--pm-accent-ink);',
    '--pmk-danger: var(--pm-err); --pmk-danger-hover: var(--pm-err);',
    '--pmk-sec-bg: var(--pm-surface); --pmk-sec-hover: var(--pm-surface2); --pmk-sec-ink: var(--pm-ink); --pmk-sec-border: var(--pm-line);',
    '--pmk-chip-bg: var(--pm-surface2); --pmk-chip-ink: var(--pm-ink); --pmk-on-bg: var(--pm-accent); --pmk-on-ink: var(--pm-accent-ink);',
    '--pmk-ink: var(--pm-ink); --pmk-link: var(--pm-link); --pmk-tab-ink: var(--pm-muted); --pmk-tab-on: var(--pm-accent); --pmk-focus: var(--pm-accent2);',
    '--pmk-radius: var(--pm-radius);',
  );
  return `.pm[data-theme="${th.id}"] { ${vars.join(' ')} color-scheme: ${th.dark ? 'dark' : 'light'}; }`;
}

export const allThemesCss = () => PM_THEMES.map(themeCss).join('\n');

// 직원별 저장: 로그인 직원(myStaff) 이름을 키에 붙여 같은 PC 를 나눠 써도 각자 테마. 사생활 모드면 이번 화면만.
const keyOf = (who) => `${PM_THEME_KEY}.${who || 'guest'}`;
export function readStoredTheme(who) {
  try { const v = window.localStorage.getItem(keyOf(who)); return PM_THEMES.some((x) => x.id === v) ? v : PM_DEFAULT_THEME; } catch { return PM_DEFAULT_THEME; }
}
export function storeTheme(id, who) {
  try { window.localStorage.setItem(keyOf(who), id); } catch { /* 저장 불가면 이번 화면만 */ }
}
