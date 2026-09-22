// lib/farmAlias.js — 농장명 별칭 사전(웹 전용 파일 data/farm-aliases.json). 전산 WarehouseMaster.FarmName은 건드리지 않고
// 정산·송금 매칭·클레임 집계에서만 표기 변형(Colibri / Colibri Flowers / COLIBRI FLOWERS S.A.S)을 한 농장으로 합친다.
//   파일 형식: { "<keyOf(별칭)>": { canonical: "Colibri", alias: "Colibri Flowers", by, at } }
import fs from 'fs';
import path from 'path';
import { normName } from './farmRemitImport';

const FILE = path.join(process.cwd(), 'data', 'farm-aliases.json');
// 사전 키: 대소문자·기호만 무시(normName은 FLOWERS/S.A.S까지 떼서 'Colibri'와 'Colibri Flowers'가 같은 키가 되어 별칭을 표현할 수 없다)
export const keyOf = (s) => String(s || '').toUpperCase().replace(/\(.*?\)/g, ' ').replace(/[^A-Z0-9가-힣 ]/g, ' ').replace(/\s+/g, ' ').trim();
// 회사 접미·범용어: 그룹 제안에서만 떼어낸다(별칭 저장은 사람이 확정)
const STOP = /\b(flowers?|flores|farms?|finca|greens?|group|grupo|s\.?a\.?s?\.?|sas|ltda\.?|cia\.?|ltd\.?|inc\.?|co\.?|bv|b\.v\.|import|export|international|intl|the)\b/gi;

export function readAliases() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }
export function writeAliases(map) { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(map, null, 2), 'utf8'); }

// 이름 → 대표 농장명(별칭 사전에 없으면 원래 이름). 대표명 자체가 다른 대표명의 별칭이면 한 단계 더 따라간다(순환 방지 3회).
export function makeCanon(map = readAliases()) {
  return (name) => {
    let cur = String(name || '').trim(); if (!cur) return cur;
    for (let i = 0; i < 3; i++) { const hit = map[keyOf(cur)]; if (!hit || !hit.canonical || keyOf(hit.canonical) === keyOf(cur)) break; cur = hit.canonical; }
    return cur;
  };
}

// 그룹 제안: 접미어를 뗀 핵심 토큰이 같은 이름끼리 묶고, 2개 이상인 그룹만 돌려준다(이미 사전에 있는 별칭은 제외).
export function suggestGroups(names = [], map = readAliases()) {
  const canon = makeCanon(map);
  const core = (n) => normName(n).replace(STOP, ' ').replace(/\s+/g, ' ').trim();
  const g = new Map();
  for (const n of new Set(names.filter(Boolean))) {
    if (map[keyOf(n)]) continue;
    const k = core(n) || normName(n); if (!k) continue;
    if (!g.has(k)) g.set(k, new Set()); g.get(k).add(canon(n));
  }
  return [...g.entries()].filter(([, s]) => s.size > 1).map(([key, s]) => { const list = [...s]; const canonical = list.slice().sort((a, b) => a.length - b.length || a.localeCompare(b))[0]; return { key, canonical, names: list }; })
    .sort((a, b) => b.names.length - a.names.length || a.key.localeCompare(b.key));
}

export function setAlias(map, alias, canonical, by = '') {
  const a = String(alias || '').trim(), c = String(canonical || '').trim();
  if (!a || !c || keyOf(a) === keyOf(c)) return map;
  map[keyOf(a)] = { alias: a, canonical: c, by, at: new Date().toISOString() };
  return map;
}
export function removeAlias(map, alias) { delete map[keyOf(alias)]; return map; }
