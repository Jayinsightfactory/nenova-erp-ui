// lib/pmSkills.js — /pm 업무 "스킬 이펙트"(순수 데이터 + 순수 함수, import 없음). 설계: docs/pm-skills-mounts.md
//   직원→스테이션 연결선이 생길 때 게임 스킬처럼 시전 동작 + 발사체 + 피격 효과를 재생한다(연출 전용, 급여·평가 무관).
//   정의는 엔진 독립 JSON(2D BgScene·3D components/pm3d 공용). 색은 테마 토큰 이름만(var(--pm-*)), #hex 금지.
//   상점 id = 'skill.<id>', 장착 슬롯 = skillBasic(기본공격 대체) · skillUlt(스킬/궁극기).

export const FX_RARITY = Object.freeze({
  common: { label: '일반', price: 30, unlockStage: 1 },
  rare: { label: '희귀', price: 80, unlockStage: 2 },
  epic: { label: '영웅', price: 180, unlockStage: 3 },
  legend: { label: '전설', price: 400, unlockStage: 4 },
});
export const FX_TIER = Object.freeze({ basic: 1, skill: 2, ult: 3 }); // 우선순위(높을수록 상한 초과 시 살아남음)
export const FX_TRAILS = Object.freeze(['line', 'curve', 'bounce']);
// 쿨다운(화면 과밀 방지)
export const FX_RULES = Object.freeze({
  maxConcurrent: 4, // 동시에 화면에 떠 있는 시전 상한
  personGapMs: 8000, // 같은 사람 최소 간격(기본공격·스킬)
  ultGapMs: 3000, // 궁극기는 간격을 줄여서라도 보여준다
  comboMin: 20, // 같은 작업 연속 N분마다 스킬 1회
  durMs: { basic: 1400, skill: 2000, ult: 2800 },
});

// 정의 형식: { id, name, rarity, tier:'basic'|'skill'|'ult', stage?(기본 9종), cast(시전 동작 클립), shape(발사체), trail, count, hit, palette[토큰], emoji(2D 임시 아이콘) }
const S = (id, name, rarity, tier, cast, shape, trail, hit, palette, emoji, extra = {}) => Object.freeze({ id, name, rarity, tier, cast, shape, trail, count: 1, hit, palette: Object.freeze(palette), emoji, ...extra });

// 업무 단계별 기본 이펙트 9종(무료·기본공격) — 단계 색 토큰 'stage' = var(--pm-stage-N)
export const BASE_SKILLS = Object.freeze([
  S('order-plane', '종이비행기', 'common', 'basic', 'throw', 'paperPlane', 'curve', 'sparkle', ['stage', 'surface'], '✈️', { stage: 1 }),
  S('inbound-box', '상자 굴리기', 'common', 'basic', 'push', 'box', 'bounce', 'thud', ['stage', 'plate'], '📦', { stage: 2 }),
  S('dist-petal', '꽃잎 흩뿌리기', 'common', 'basic', 'scatter', 'petal', 'curve', 'petalBurst', ['stage', 'accent2'], '🌸', { stage: 3, count: 5 }),
  S('ship-truck', '미니 트럭', 'common', 'basic', 'push', 'truck', 'line', 'dust', ['stage', 'muted'], '🚚', { stage: 4 }),
  S('est-bolt', '계산기 번개', 'common', 'basic', 'point', 'bolt', 'line', 'flash', ['stage', 'accent'], '⚡', { stage: 5 }),
  S('deliver-letter', '편지 배달', 'common', 'basic', 'throw', 'envelope', 'curve', 'stamp', ['stage', 'surface'], '✉️', { stage: 6 }),
  S('pay-coin', '동전 튕기기', 'common', 'basic', 'flick', 'coin', 'bounce', 'coinRain', ['stage', 'accent'], '🪙', { stage: 7, count: 3 }),
  S('remit-globe', '지구 한 바퀴', 'common', 'basic', 'spin', 'globe', 'curve', 'ring', ['stage', 'link'], '🌏', { stage: 8 }),
  S('profit-chart', '상승 그래프', 'common', 'basic', 'raise', 'arrowUp', 'line', 'sparkle', ['stage', 'accent2'], '📈', { stage: 9 }),
]);

// 구매형 24종(클레이 카와이 톤)
export const SHOP_SKILLS = Object.freeze([
  S('bubble', '비눗방울', 'common', 'basic', 'blow', 'bubble', 'curve', 'pop', ['link', 'surface'], '🫧', { count: 4 }),
  S('leaf', '나뭇잎 휘리릭', 'common', 'basic', 'scatter', 'leaf', 'curve', 'sparkle', ['ok', 'accent2'], '🍃', { count: 3 }),
  S('heart', '하트 뿅', 'common', 'basic', 'blow', 'heart', 'bounce', 'pop', ['accent', 'surface'], '💗'),
  S('star', '별똥별', 'common', 'basic', 'point', 'star', 'line', 'sparkle', ['accent2', 'surface'], '⭐'),
  S('clip', '클립 새총', 'common', 'basic', 'flick', 'clip', 'bounce', 'thud', ['muted', 'link'], '📎'),
  S('note', '포스트잇 날리기', 'common', 'basic', 'throw', 'sticky', 'curve', 'stamp', ['accent2', 'plate'], '🗒️'),
  S('candy', '사탕 폭죽', 'rare', 'basic', 'throw', 'candy', 'bounce', 'confetti', ['accent', 'accent2', 'link'], '🍬', { count: 3 }),
  S('music', '음표 퐁퐁', 'rare', 'basic', 'blow', 'note', 'curve', 'ring', ['link', 'accent'], '🎵', { count: 3 }),
  S('snow', '눈송이', 'rare', 'basic', 'scatter', 'snowflake', 'curve', 'sparkle', ['surface', 'link'], '❄️', { count: 4 }),
  S('fish', '붕어빵 투척', 'rare', 'basic', 'throw', 'fishBread', 'bounce', 'thud', ['accent2', 'plate'], '🐟'),
  S('rocket', '장난감 로켓', 'rare', 'skill', 'raise', 'rocket', 'curve', 'smoke', ['accent', 'muted'], '🚀'),
  S('rainbow', '무지개 다리', 'rare', 'skill', 'point', 'rainbow', 'curve', 'sparkle', ['stage', 'accent', 'accent2'], '🌈'),
  S('cat-paw', '고양이 발도장', 'rare', 'skill', 'stamp', 'paw', 'bounce', 'stamp', ['accent', 'plate'], '🐾', { count: 3 }),
  S('origami', '종이학 떼', 'epic', 'skill', 'scatter', 'crane', 'curve', 'sparkle', ['surface', 'link'], '🕊️', { count: 5 }),
  S('lantern', '등불 띄우기', 'epic', 'skill', 'raise', 'lantern', 'curve', 'glow', ['accent2', 'accent'], '🏮', { count: 3 }),
  S('dragon', '용 연', 'epic', 'skill', 'spin', 'kite', 'curve', 'ring', ['accent', 'stage'], '🐉'),
  S('meteor', '유성우', 'epic', 'ult', 'point', 'star', 'line', 'shockwave', ['accent2', 'link', 'surface'], '☄️', { count: 6 }),
  S('fireworks', '불꽃놀이', 'epic', 'ult', 'raise', 'spark', 'line', 'fireworks', ['accent', 'accent2', 'link'], '🎆', { count: 5 }),
  S('bloom', '만개 꽃비', 'epic', 'ult', 'scatter', 'petal', 'curve', 'petalBurst', ['accent', 'stage'], '🌺', { count: 8 }),
  S('whale', '하늘 고래', 'legend', 'ult', 'spin', 'whale', 'curve', 'splash', ['link', 'surface'], '🐋'),
  S('phoenix', '불사조', 'legend', 'ult', 'raise', 'phoenix', 'curve', 'fireworks', ['accent', 'accent2'], '🔥'),
  S('galaxy', '은하수 폭발', 'legend', 'ult', 'spin', 'orb', 'bounce', 'shockwave', ['link', 'accent2', 'ink'], '🌌', { count: 4 }),
  S('golden-flower', '황금 꽃 소환', 'legend', 'ult', 'raise', 'flower', 'curve', 'glow', ['accent2', 'stage'], '🌼', { count: 6 }),
  S('aurora', '오로라 커튼', 'legend', 'ult', 'point', 'ribbon', 'curve', 'glow', ['link', 'ok', 'accent'], '✨'),
]);

export const ALL_SKILLS = Object.freeze([...BASE_SKILLS, ...SHOP_SKILLS]);
const BY_ID = new Map(ALL_SKILLS.map((s) => [s.id, s]));
export const skillById = (id) => BY_ID.get(String(id || '').replace(/^skill\./, '')) || null;
export const baseSkillFor = (stage) => BASE_SKILLS.find((s) => s.stage === Number(stage)) || BASE_SKILLS[0];

// 상점 품목(lib/pmWallet catalog 형식). 기본 9종 = 무료(가격 0, 상점에 안 보여도 보유 인정)
export function skillShopItems() {
  return SHOP_SKILLS.map((s) => ({ id: `skill.${s.id}`, name: s.name, price: FX_RARITY[s.rarity].price, rarity: s.rarity, unlockStage: FX_RARITY[s.rarity].unlockStage, tier: s.tier, emoji: s.emoji }));
}

// 색: 토큰 이름 → CSS 변수. 'stage' 는 그 시전의 업무 단계 색
export function fxColor(tok, stage) {
  if (tok === 'stage') return Number(stage) >= 1 && Number(stage) <= 9 ? `var(--pm-stage-${Number(stage)})` : 'var(--pm-link)';
  return /^[a-z][a-z0-9]*$/.test(String(tok)) ? `var(--pm-${tok})` : 'var(--pm-link)';
}

// 장착된 이펙트 고르기: 기본공격=skillBasic(없으면 단계 기본), 스킬/궁극기=skillUlt(없으면 단계 기본을 강화 재생)
export function pickSkill(tier, stage, items) {
  const it = items || {};
  if (tier === 'basic') return skillById(it.skillBasic) || baseSkillFor(stage);
  return skillById(it.skillUlt) || skillById(it.skillBasic) || baseSkillFor(stage);
}

// 트리거 판정(순수). input = { lines:[{name, stage, kind}], dances:{name:'cheer'|'jump'|'spin'} } (kind==='current' 만 본다)
//   state = { cur:{name:{stage, since, combos}}, last:{name:ms}, active:[{name, tier, until}] }
//   반환 { casts:[{name, stage, tier, reason}], state }
//   기본공격 = 작업 시작·단계 전환 / 스킬 = 같은 단계 연속 comboMin 분마다 / 궁극기 = 오늘 목표(jump)·요청 배포(spin)·성장 승급(cheer)
export function nextCasts(state, input, nowMs, rules = FX_RULES) {
  const st = { cur: { ...(state?.cur || {}) }, last: { ...(state?.last || {}) }, active: (state?.active || []).filter((a) => a.until > nowMs) };
  const first = !state; // 첫 호출은 기준만 잡고 발사하지 않음(화면 열자마자 폭발 방지)
  const want = [];
  const seen = new Set();
  for (const l of Array.isArray(input?.lines) ? input.lines : []) {
    if (!l || l.kind !== 'current' || !l.name || seen.has(l.name)) continue;
    seen.add(l.name);
    const c = st.cur[l.name];
    if (!c || c.stage !== l.stage) {
      st.cur[l.name] = { stage: l.stage, since: nowMs, combos: 0 };
      if (!first) want.push({ name: l.name, stage: l.stage, tier: 'basic', reason: c ? 'switch' : 'start' });
    } else {
      const n = Math.floor((nowMs - c.since) / (rules.comboMin * 60000));
      if (n > c.combos) { st.cur[l.name] = { ...c, combos: n }; if (!first) want.push({ name: l.name, stage: l.stage, tier: 'skill', reason: `combo${n * rules.comboMin}` }); }
    }
  }
  for (const n of Object.keys(st.cur)) if (!seen.has(n)) delete st.cur[n]; // 작업 끝나면 연속 끊김
  if (!first) {
    for (const [name, d] of Object.entries(input?.dances || {})) {
      const reason = { jump: 'goal', spin: 'deployed', cheer: 'stageUp' }[d];
      if (reason) want.push({ name, stage: st.cur[name]?.stage || 0, tier: 'ult', reason });
    }
  }
  // 우선순위 높은 것부터 쿨다운·상한 적용
  want.sort((a, b) => FX_TIER[b.tier] - FX_TIER[a.tier]);
  const casts = [];
  for (const w of want) {
    const gap = w.tier === 'ult' ? rules.ultGapMs : rules.personGapMs;
    if (st.last[w.name] != null && nowMs - st.last[w.name] < gap) continue;
    if (casts.some((c) => c.name === w.name)) continue;
    if (st.active.length >= rules.maxConcurrent) {
      const low = st.active.reduce((m, a, i) => (m < 0 || FX_TIER[a.tier] < FX_TIER[st.active[m].tier] ? i : m), -1);
      if (low < 0 || FX_TIER[st.active[low].tier] >= FX_TIER[w.tier]) continue;
      st.active.splice(low, 1); // 더 낮은 등급 시전을 밀어낸다
    }
    st.last[w.name] = nowMs;
    st.active.push({ name: w.name, tier: w.tier, until: nowMs + rules.durMs[w.tier] });
    casts.push(w);
  }
  return { casts, state: st };
}

// 엔진 독립 재생 정의(2D·3D 공용 JSON). from/to = 장면 좌표, path = 2D 곡선(d) 있으면 curve 궤적에 사용
export function castSpec(skill, cast, reduced = false) {
  return {
    id: skill.id, tier: cast.tier, reason: cast.reason, name: cast.name, stage: cast.stage,
    clip: `cast.${skill.cast}`, projectile: skill.shape, trail: skill.trail,
    count: reduced ? 0 : Math.min(8, skill.count * (cast.tier === 'ult' ? 2 : 1)),
    hit: reduced ? 'highlight' : skill.hit,
    colors: skill.palette.map((t) => fxColor(t, cast.stage)),
    durMs: FX_RULES.durMs[cast.tier], emoji: skill.emoji, reduced: !!reduced,
  };
}
