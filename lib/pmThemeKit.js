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

// 장면용 아바타: 꾸미기 저장 없는 직원은 이름 해시로 체형·피부·헤어·헤어색·의상을 정한다(같은 사람은 늘 같게).
//   테마 기본 세트 중 책상 스킨·러그·의자는 장면에서 쓰지 않는다(3/4 스프라이트 준비 전 — 상점·직원상세에서만 보임).
const HASH_BODIES = ['slim', 'std', 'round'];
const HASH_HAIRS = ['short', 'bob', 'long', 'bun'];
const BASIC_OUTFITS = ['outfit.hoodie', 'outfit.knit', 'outfit.suit', 'outfit.apron', 'outfit.vest', 'outfit.overall', 'outfit.aloha', 'outfit.puffer', 'outfit.smock'];
export function nameHash(s) { let h = 2166136261; for (const c of String(s || '')) { h ^= c.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; } return h; }
export function hashLook(name, themeOutfits = []) {
  const h = nameHash(name); const pick = (arr, sh) => arr[(h >>> sh) % arr.length];
  const pool = [...themeOutfits, ...BASIC_OUTFITS.filter((o) => !themeOutfits.includes(o))];
  // 테마 의상 우선(절반), 나머지는 다른 색·형태 의상으로 변형
  const outfit = themeOutfits.length && ((h >>> 20) & 1) ? themeOutfits[(h >>> 21) % themeOutfits.length] : pool[(h >>> 22) % pool.length];
  return { body: pick(HASH_BODIES, 0), skin: (h >>> 3) % 4, hair: pick(HASH_HAIRS, 6), hairColor: (h >>> 9) % 5, personality: pick(['calm', 'lively', 'playful', 'meticulous', 'easygoing', 'shy'], 12), items: { outfit } };
}
export function sceneAvatar(cfg, name, kit, themeOutfits) {
  const c = (cfg && cfg.view) || cfg || null;
  const k = { ...(kit || {}) }; delete k.desk; delete k.rug; delete k.chair;
  if (!c || (!c.hair && !c.body && !Object.keys(c.items || {}).length)) {
    const look = hashLook(name, Array.isArray(themeOutfits) ? themeOutfits : (kit?.outfit ? [kit.outfit] : []));
    return { ...look, items: { ...k, ...look.items } };
  }
  const own = { ...(c.items || {}) };
  for (const x of Object.keys(own)) if (!own[x]) delete own[x];
  const items = { ...k, ...own }; delete items.desk; delete items.rug; delete items.chair;
  return { ...c, items };
}
export function themeOutfits(manifest, themeId) {
  return ((manifest && manifest.items) || []).filter((it) => it.theme === themeId && it.category === 'outfit').map((it) => it.id);
}
