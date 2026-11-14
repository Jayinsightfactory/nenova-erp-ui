// lib/pmLookClear.js
// "맑은 업무" 분위기 — 2026-11-15 사장님이 시안 A/B/C 중 B 로 확정(docs/UI_STANDARD.md 5절).
//   흰 바탕 · 얇은 선 · 남색 강조 · 그림자 없음 · 모서리 8px. 숫자와 표가 또렷하게 보이는 것이 목표.
//   쓰는 법: 화면 최상위 <div className="pm …" data-theme=… data-look="clear"> + 테마 CSS **뒤에** 이 CSS 를 한 번 넣는다.
//   /pm 테마(lib/pmThemes.js)의 토큰 값만 덮어쓴다. 부품(components/pm/ui.js)과 화면 CSS 는 그대로 var(--pm-*) 를 읽는다.
//   /pm 사무실(pages/pm.js)에는 아직 쓰지 않는다 — 그 화면은 가이드 영상과 함께 바꿔야 한다.
export const LOOK_CLEAR = 'clear';

const S = '.pm.pm[data-look="clear"]';

export const lookClearCss = `
${S} {
  --pm-bg: #f3f5f8; --pm-surface: #ffffff; --pm-surface-2: #f1f4f9; --pm-surface2: #f1f4f9;
  --pm-ink: #1b2433; --pm-muted: #5b6678; --pm-line: #d9dee8;
  --pm-accent: #2456c8; --pm-accent-ink: #ffffff; --pm-accent-2: #2456c8; --pm-accent2: #2456c8; --pm-link: #2456c8;
  --pm-accent-hover: #1e49ab; --pm-accent-down: #183b8a;
  --pm-ok: #1f8a4c; --pm-ok-bg: #e3f4ea; --pm-ok-ink: #14532d;
  --pm-idle: #b7791f; --pm-idle-bg: #fdf0c8; --pm-idle-ink: #5c4300; --pm-est-bg: #fdf0c8; --pm-est-ink: #5c4300;
  --pm-err: #c8362c; --pm-err-hover: #ad2d24; --pm-err-down: #8f241d; --pm-err-bg: #fde3e0; --pm-err-ink: #7a1c14;
  --pm-off-bg: #eceff4; --pm-off-ink: #3a4558; --pm-dis-bg: #eceff4; --pm-dis-ink: #8b94a3;
  --pm-radius: 8px; --pm-shadow: none; --pm-deco: none; --pm-floor: none; --pm-tex: none;
  --pm-font: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, sans-serif;
  color-scheme: light;
}
/* 버튼·칩 — 그림자 없이 얇은 선. 고른 칩은 옅은 남색 바탕 + 남색 글자(색만이 아니라 굵기로도 구분). */
${S} .pmk-btn.pmk-secondary, ${S} .pmk-btn.pmk-primary, ${S} .pmk-btn.pmk-danger { box-shadow: none; }
${S} .pmk-btn.pmk-primary { color: var(--pm-accent-ink); }
${S} .pmk-btn.pmk-secondary:hover:not(:disabled), ${S} .pmk-btn.pmk-primary:hover:not(:disabled), ${S} .pmk-btn.pmk-danger:hover:not(:disabled) { transform: none; }
${S} .pmk-chip, ${S} .pmk-person { background: var(--pm-surface); border-color: var(--pm-line); }
${S} .pmk-chip:hover, ${S} .pmk-person:hover { border-color: var(--pm-accent); }
${S} .pmk-chip.on { background: color-mix(in srgb, var(--pm-accent) 10%, var(--pm-surface)); color: var(--pm-accent); border-color: var(--pm-accent); font-weight: bold; }
${S} .pmk-skel-card, ${S} .pmk-empty { box-shadow: none; }
`;
