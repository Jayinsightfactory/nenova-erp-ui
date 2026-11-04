// lib/pmAvatars.js
// /pm 직원별 캐릭터 꾸미기 — data/runtime/pm-avatars.json (웹 전용 파일, git 미추적, MSSQL 무관).
//   { avatars: { [직원이름]: { char, items: { hat, glasses, outfit, desk, pet, badge }, by, at } } }
//   값은 manifest 의 id 형태만 허용(영문·숫자·.-), 사람 수 200명 상한.
//   theme: /pm 화면 테마(A~J, lib/pmThemes) — 직원별로 서버에 둬서 PC 를 바꿔도 유지. body.themeOnly=true 면 테마만 바꾼다.
import fs from 'fs';
import path from 'path';

export const PM_AVATAR_MAX = 200;
export const PM_AVATAR_SLOTS = Object.freeze(['hat', 'glasses', 'outfit', 'desk', 'pet', 'badge', 'hand', 'deskL', 'deskM', 'deskR', 'rug', 'chair', 'shelf']);
// 캐릭터 v2: 슬롯별 허용 id 접두어(옷/소품/자리). desk 는 책상(테이블) — 예전 책상 소품 desk.<소품> 은 화면에서 deskM 으로 옮겨 보인다.
export const PM_SLOT_PREFIX = Object.freeze({ deskL: 'top', deskM: 'top', deskR: 'top' });
// 베이스 바디 선택값(체형·피부·헤어·헤어색·성격) — public/pm-char/layers.json 과 같은 값
export const PM_BASE = Object.freeze({ body: ['slim', 'std', 'round'], skin: [0, 1, 2, 3], hair: ['short', 'bob', 'long', 'bun'], hairColor: [0, 1, 2, 3, 4], personality: ['calm', 'lively', 'playful', 'meticulous', 'easygoing', 'shy'] });
export const pmAvatarsPath = () => path.join(process.cwd(), 'data', 'runtime', 'pm-avatars.json');
const ID = /^[a-z0-9.-]{1,40}$/;
const THEME = /^[A-Z]$/;

export function readAvatars(file = pmAvatarsPath()) {
  try { const d = JSON.parse(fs.readFileSync(file, 'utf8')); return d && typeof d.avatars === 'object' && d.avatars ? d.avatars : {}; } catch { return {}; }
}

export function cleanAvatar(body) {
  const char = String(body?.char || '').trim();
  if (char && !ID.test(char)) return null;
  const items = {};
  for (const s of PM_AVATAR_SLOTS) {
    const v = String(body?.items?.[s] || '').trim();
    if (!v) continue;
    if (!ID.test(v) || !v.startsWith(`${PM_SLOT_PREFIX[s] || s}.`)) return null;
    items[s] = v;
  }
  const base = {};
  for (const [k, allowed] of Object.entries(PM_BASE)) {
    const raw = body?.[k];
    if (raw == null || raw === '') continue;
    const v = typeof allowed[0] === 'number' ? Number(raw) : String(raw);
    if (!allowed.includes(v)) return null;
    base[k] = v;
  }
  return { char: char || '', ...base, items };
}

export function saveAvatar(name, body, by, { file = pmAvatarsPath(), now = new Date() } = {}) {
  const n = String(name || '').trim().slice(0, 40);
  if (!n) return { ok: false, status: 400, error: 'name 필요' };
  const all = readAvatars(file);
  const theme = body?.theme == null || body.theme === '' ? '' : String(body.theme);
  if (theme && !THEME.test(theme)) return { ok: false, status: 400, error: '잘못된 테마 값' };
  const a = body?.themeOnly ? (() => { const { by: _b, at: _a, theme: _t, ...keep } = all[n] || {}; return { char: '', ...keep, items: { ...(all[n]?.items || {}) } }; })() : cleanAvatar(body);
  if (!a) return { ok: false, status: 400, error: '잘못된 꾸미기 값' };
  const keepTheme = body?.themeOnly ? theme : (all[n]?.theme || '');
  if (keepTheme) a.theme = keepTheme;
  if (!a.char && !Object.keys(a.items).length && !a.theme) delete all[n];
  else {
    if (!all[n] && Object.keys(all).length >= PM_AVATAR_MAX) return { ok: false, status: 409, error: '저장 상한 초과' };
    all[n] = { ...a, by: String(by || '').slice(0, 40), at: now.toISOString() };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ avatars: all }, null, 1));
  fs.renameSync(tmp, file);
  return { ok: true, avatar: all[n] || null };
}
