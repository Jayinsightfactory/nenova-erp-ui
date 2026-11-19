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
  --pm-bg: #f8fafc; --pm-surface: #ffffff; --pm-surface-2: #f1f5f9; --pm-surface2: #f1f5f9;
  --pm-ink: #0f172a; --pm-muted: #475569; --pm-line: #e2e8f0;
  --pm-accent: #1d4ed8; --pm-accent-ink: #ffffff; --pm-accent-2: #1e40af; --pm-accent2: #1e40af; --pm-link: #1d4ed8;
  --pm-accent-hover: #1e40af; --pm-accent-down: #1e3a8a;
  --pm-ok: #15803d; --pm-ok-bg: #dcfce7; --pm-ok-ink: #14532d;
  --pm-idle: #b45309; --pm-idle-bg: #fef3c7; --pm-idle-ink: #78350f; --pm-est-bg: #fef3c7; --pm-est-ink: #78350f;
  --pm-err: #b91c1c; --pm-err-hover: #991b1b; --pm-err-down: #7f1d1d; --pm-err-bg: #fee2e2; --pm-err-ink: #7f1d1d;
  --pm-off-bg: #f1f5f9; --pm-off-ink: #475569; --pm-dis-bg: #f1f5f9; --pm-dis-ink: #94a3b8;
  --pm-radius: 6px; --pm-shadow: none; --pm-deco: none; --pm-floor: none; --pm-tex: none;
  --pm-font: "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", system-ui, -apple-system, sans-serif;
  color-scheme: light;
}
/* 버튼·칩 — 그림자 없이 1px 구조선. 고른 칩은 옅은 남색 바탕 + 남색 글자. */
${S} .pmk-btn.pmk-secondary, ${S} .pmk-btn.pmk-primary, ${S} .pmk-btn.pmk-danger { box-shadow: none; }
${S} .pmk-btn.pmk-primary { color: var(--pm-accent-ink); }
${S} .pmk-btn.pmk-secondary:hover:not(:disabled), ${S} .pmk-btn.pmk-primary:hover:not(:disabled), ${S} .pmk-btn.pmk-danger:hover:not(:disabled) { transform: none; }
${S} .pmk-chip, ${S} .pmk-person { background: var(--pm-surface); border-color: var(--pm-line); }
${S} .pmk-chip:hover, ${S} .pmk-person:hover { border-color: var(--pm-accent); }
${S} .pmk-chip.on { background: color-mix(in srgb, var(--pm-accent) 10%, var(--pm-surface)); color: var(--pm-accent); border-color: var(--pm-accent); font-weight: bold; }
${S} .pmk-skel-card, ${S} .pmk-empty { box-shadow: none; }
`;
