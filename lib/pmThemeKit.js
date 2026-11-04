// lib/pmThemeKit.js — 테마 "무료 미리보기 기본 세트": 테마를 고르면 그 테마 의상·책상 스킨·의자·러그·상판 소품을 장면 캐릭터에 자동으로 입힌다.
//   본인이 장착한 품목(같은 슬롯)은 항상 우선. 저장·구매·토큰과 무관(화면 표시 전용).
const SLOT_OF = { outfit: 'outfit', desk: 'desk', chair: 'chair', rug: 'rug', deskTop: 'deskM' };

export function themeKit(manifest, themeId) {
  const out = {};
  for (const it of (manifest && manifest.items) || []) {
    if (it.theme !== themeId) continue;
    const slot = SLOT_OF[it.category];
    if (slot && !out[slot] && (it.category !== 'desk' || String(it.id).startsWith('desk.'))) out[slot] = it.id;
  }
  return out;
}

export function withThemeKit(cfg, kit) {
  const c = (cfg && cfg.view) || cfg || {};
  const own = { ...(c.items || {}) };
  for (const k of Object.keys(own)) if (!own[k]) delete own[k];
  return { ...c, items: { ...(kit || {}), ...own } };
}
