// components/pm/Character.js — /pm 캐릭터 v2 공용 렌더러(장면·직원상세·상점이 같은 props 하나로 씀).
//   데이터: public/pm-char/layers.json(블렌더 같은 리그·같은 카메라 렌더 → 모든 레이어가 256 캔버스에 정합).
//   <CharacterAvatar cfg state size name stage vibe emote dance personality /> = 레이어 합성 캐릭터
//   <DeskSet cfg ... scale /> = 자리(러그·책장·의자·캐릭터·책상·상판 소품·펫) — 책상 앵커 기준 좌표(lib/pmDeskSlots)
//   움직임은 합성된 캐릭터 통째로 CSS 변형 → 옷·소품이 항상 같이 움직인다(레이어 어긋남 없음). reduced-motion = 정지.
//   연출은 긍정·중립만, 급여·평가 무관.
import { useEffect, useMemo, useState } from 'react';

export const PERSONALITIES = [['calm', '차분'], ['lively', '활발'], ['playful', '장난꾸러기'], ['meticulous', '꼼꼼'], ['easygoing', '느긋'], ['shy', '수줍음']];
export const EMOTES = { joy: '😊', wow: '😮', heart: '💖', sweat: '💦', sparkle: '✨', think: '💭', fighting: '💪', star: '⭐', music: '🎵', idea: '💡', coffee: '☕', zzz: '💤', flower: '🌸', party: '🎉' };
export const EMOTE_LABEL = { joy: '기쁨', wow: '놀람', heart: '하트', sweat: '땀', sparkle: '반짝', think: '생각중', fighting: '화이팅', star: '별', music: '흥얼', idea: '아이디어', coffee: '커피', zzz: '꿀잠', flower: '꽃', party: '축하' };
export const DANCES = [['bounce', '통통'], ['spin', '빙글'], ['sway', '살랑'], ['jump', '점프'], ['wiggle', '꿈틀'], ['cheer', '만세']];
// 예전 책상 소품(desk.<소품>) → 상판 가운데 칸
const OLD_DESKTOP = { 'desk.vase': 'top.vase', 'desk.coffee': 'top.coffee', 'desk.plant': 'top.cactus', 'desk.calc': 'top.calc', 'desk.globe': 'top.globe', 'desk.box': 'top.box', 'desk.trophy': 'top.trophy' };

let _layers = null; let _p = null;
export function usePmLayers() {
  const [l, setL] = useState(_layers);
  useEffect(() => {
    if (_layers) return undefined;
    let alive = true;
    _p = _p || fetch('/pm-char/layers.json').then((r) => r.json()).then((j) => { _layers = j; return j; });
    _p.then((j) => { if (alive) setL(j); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  return l;
}

// 저장 데이터(옛 형식 포함) → v2 정규형. 화면 전용 변환(저장값은 그대로).
export function normalizeAvatar(cfg) {
  const c = (cfg && cfg.view) || cfg || {};
  const items = { ...(c.items || {}) };
  if (items.desk && OLD_DESKTOP[items.desk]) { if (!items.deskM) items.deskM = OLD_DESKTOP[items.desk]; delete items.desk; }
  return { char: c.char || 'human', body: c.body || 'std', skin: Number.isInteger(c.skin) ? c.skin : 0, hair: c.hair || 'short', hairColor: Number.isInteger(c.hairColor) ? c.hairColor : 1, personality: c.personality || 'calm', items };
}

// 레이어 스택(아래→위). 테스트·검증에서도 같은 순서를 쓴다.
//   pose: 'stand'(정면 서기) | 'sit'(앉아 타이핑, 3/4 시점). sit 은 L.sit 의 같은 구조를 쓴다.
export function layerStack(cfg, Lall, pose = 'stand') {
  if (!Lall) return [];
  const a = normalizeAvatar(cfg);
  const P = pose === 'sit' && Lall.sit ? Lall.sit : null;
  const L = P ? { ...Lall, bodies: P.bodies, face: P.face, hairs: P.hairs, kinds: P.kinds } : Lall;
  const body = L.bodies[a.body] ? a.body : 'std';
  const it = (id) => (id && Lall.items[id] ? { id } : null);
  const pick = (meta, layer) => {
    if (!meta) return null;
    const m = P ? P.items[meta.id] && P.items[meta.id][layer] : Lall.items[meta.id].layers[layer];
    return m ? m[body] || m['*'] : null;
  };
  const out = [];
  const push = (z, src) => { if (src) out.push({ z, src }); };
  const kind = L.kinds[a.char] || {};
  const hair = L.hairs[a.hair] || {};
  push('kindBack', kind.back);
  push('hairBack', hair.back && hair.back[a.hairColor]);
  push('body', L.bodies[body][a.skin] || L.bodies[body][0]);
  const o = it(a.items.outfit);
  push('bottom', pick(o, 'bottom')); push('top', pick(o, 'top'));
  push('badge', pick(it(a.items.badge), 'badge'));
  push('face', L.face);
  push('hairFront', hair.front && hair.front[a.hairColor]);
  push('kindFront', kind.front);
  push('glasses', pick(it(a.items.glasses), 'glasses'));
  push('hat', pick(it(a.items.hat), 'hat'));
  push('hand', pick(it(a.items.hand), 'hand'));
  return out.filter((x) => typeof x.src === 'string');
}

function useReduced() {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const q = window.matchMedia('(prefers-reduced-motion: reduce)'); setR(q.matches);
    const on = () => setR(q.matches); q.addEventListener?.('change', on); return () => q.removeEventListener?.('change', on);
  }, []);
  return r;
}

const CSS = `
.pc2{position:relative;display:inline-block;flex:none;vertical-align:middle}
.pc2 .pc2-rig{position:absolute;inset:0;transform-origin:50% 92%}
.pc2 .pc2-rig img{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;user-select:none}
.pc2 .pc2-fx{position:absolute;inset:0;pointer-events:none}
.pc2 .pc2-emo{position:absolute;left:50%;top:-6%;transform:translate(-50%,-60%);background:var(--pm-surface);color:var(--pm-ink);border:1px solid var(--pm-line);border-radius:999px;padding:0 .3em;font-size:max(10px,.16em);line-height:1.5;box-shadow:var(--pm-shadow);white-space:nowrap;z-index:3}
.pc2 .pc2-halo{position:absolute;left:22%;right:22%;top:2%;height:9%;border-radius:50%;border:2px solid var(--pm-accent);opacity:.75}
.pc2 .pc2-aura{position:absolute;inset:6% 12% 2%;border-radius:50% 50% 40% 40%;background:radial-gradient(closest-side,var(--pm-accent2),transparent);opacity:.45}
.pc2 .pc2-spark{position:absolute;inset:0;background:radial-gradient(circle at 20% 30%,var(--pm-accent) 0 2%,transparent 3%),radial-gradient(circle at 82% 22%,var(--pm-accent2) 0 2%,transparent 3%),radial-gradient(circle at 75% 70%,var(--pm-accent) 0 1.5%,transparent 2.5%);opacity:.9}
.pc2 .pc2-pin{position:absolute;right:16%;bottom:8%;font-size:max(9px,.1em)}
.pc2-a-idle .pc2-rig{animation:pc2breathe 3.2s ease-in-out infinite}
.pc2-p-lively.pc2-a-idle .pc2-rig{animation:pc2hop 1.6s ease-in-out infinite}
.pc2-p-playful.pc2-a-idle .pc2-rig{animation:pc2tilt 2.2s ease-in-out infinite}
.pc2-p-meticulous.pc2-a-idle .pc2-rig{animation:pc2nod 2.6s ease-in-out infinite}
.pc2-p-easygoing.pc2-a-idle .pc2-rig{animation:pc2sway 4.5s ease-in-out infinite}
.pc2-p-shy.pc2-a-idle .pc2-rig{animation:pc2lean 3.6s ease-in-out infinite}
.pc2-a-work .pc2-rig{animation:pc2type .5s ease-in-out infinite}
.pc2-a-busy .pc2-rig{animation:pc2type .28s ease-in-out infinite}
.pc2-a-focus .pc2-rig{animation:pc2breathe 2.4s ease-in-out infinite}
.pc2-a-doze .pc2-rig{animation:pc2doze 4s ease-in-out infinite;filter:saturate(.85)}
.pc2-a-off .pc2-rig{filter:grayscale(.5);opacity:.85}
.pc2-d-bounce .pc2-rig{animation:pc2hop .45s ease-in-out 4}
.pc2-d-spin .pc2-rig{animation:pc2spin .9s ease-in-out 2}
.pc2-d-sway .pc2-rig{animation:pc2sway .8s ease-in-out 3}
.pc2-d-jump .pc2-rig{animation:pc2jump .6s cubic-bezier(.3,1.6,.5,1) 3}
.pc2-d-wiggle .pc2-rig{animation:pc2tilt .3s ease-in-out 6}
.pc2-d-cheer .pc2-rig{animation:pc2cheer .5s ease-in-out 4}
@keyframes pc2breathe{50%{transform:scale(1.015,1.03)}}
@keyframes pc2hop{50%{transform:translateY(-5%)}}
@keyframes pc2tilt{25%{transform:rotate(-5deg)}75%{transform:rotate(5deg)}}
@keyframes pc2nod{50%{transform:translateY(1.5%) rotate(1deg)}}
@keyframes pc2sway{25%{transform:translateX(-2%) rotate(-2deg)}75%{transform:translateX(2%) rotate(2deg)}}
@keyframes pc2lean{50%{transform:translateX(-2%) rotate(-3deg)}}
@keyframes pc2type{50%{transform:translateY(1%) scale(1.01,.99)}}
@keyframes pc2doze{50%{transform:translateY(1.5%) rotate(-2deg)}}
@keyframes pc2spin{to{transform:rotateY(360deg)}}
@keyframes pc2jump{0%,100%{transform:translateY(0) scale(1)}15%{transform:scale(1.06,.92)}50%{transform:translateY(-14%) scale(.97,1.04)}}
@keyframes pc2cheer{50%{transform:translateY(-6%) scale(1.04)}}
.pc2-desk{position:relative;flex:none}
.pc2-desk>*{position:absolute}
.pc2-desk>img{inset:0;width:100%;height:100%;pointer-events:none}
.pc2-pet{inset:0;overflow:hidden}
.pc2-pet img{position:absolute;left:0;top:0;width:200%;height:100%;animation:pc2pet 1.1s steps(2) infinite}
@keyframes pc2pet{to{transform:translateX(-50%)}}
@media (prefers-reduced-motion: reduce){.pc2 .pc2-rig,.pc2-pet img{animation:none!important}}
`;
let cssDone = false;
function useCss() {
  useEffect(() => {
    if (cssDone || typeof document === 'undefined') return;
    const s = document.createElement('style'); s.setAttribute('data-pm', 'character-v2'); s.textContent = CSS; document.head.appendChild(s); cssDone = true;
  }, []);
}

const STATE_ANIM = { idle: 'idle', working: 'work', off: 'off', error: 'idle', handoff: 'work' };

// stage = 성장 단계(1~5, lib/pmGrow) → 2+ 새싹 핀 · 3+ 반짝이 · 4+ 후광 · 5 전설 오라
//   pose='sit' + dir('left'|'right'): 앉은 3/4 포즈, right 는 좌우 반전. hideBelowHip: 엉덩이선 아래(하반신)를 잘라 책상 상판 뒤로 숨김.
export function CharacterAvatar({ cfg, state = 'idle', size = 40, stage = 1, vibe = '', emote = '', dance = '', className = '', onClick, title, pose = 'stand', dir = 'left', hideBelowHip = false }) {
  useCss();
  const L = usePmLayers();
  const reduced = useReduced();
  const a = normalizeAvatar(cfg);
  const stack = useMemo(() => layerStack(cfg, L, pose), [cfg, L, pose]);
  const hipPct = L && L.sit ? (L.sit.anchors.hip[1] / L.canvas) * 100 : 70;
  const rigStyle = { ...(pose === 'sit' && dir === 'right' ? { transform: 'scaleX(-1)' } : null), ...(hideBelowHip ? { clipPath: `inset(0 0 ${100 - hipPct + 1}% 0)` } : null) };
  const anim = dance && !reduced ? '' : vibe === 'doze' ? 'doze' : vibe === 'busy' ? 'busy' : vibe === 'focus' || vibe === 'blaze' ? 'focus' : STATE_ANIM[state] || 'idle';
  const cls = ['pc2', `pc2-p-${a.personality}`, anim && `pc2-a-${anim}`, dance && !reduced && `pc2-d-${dance}`, className].filter(Boolean).join(' ');
  return (
    <span className={cls} style={{ width: size, height: size, fontSize: size }} aria-hidden={!title} title={title} onClick={onClick}>
      {(stage >= 5 || vibe === 'blaze') && <i className="pc2-fx pc2-aura" />}
      <span className="pc2-rig" style={rigStyle}>{stack.map((x) => <img key={x.z} data-z={x.z} src={x.src} alt="" loading="lazy" decoding="async" draggable={false} />)}</span>
      {stage >= 4 && <i className="pc2-fx"><i className="pc2-halo" /></i>}
      {stage >= 3 && <i className="pc2-fx pc2-spark" />}
      {stage >= 2 && size >= 60 && <i className="pc2-pin">🌱</i>}
      {emote && EMOTES[emote] && size >= 32 && <span className="pc2-emo" title={EMOTE_LABEL[emote]}>{EMOTES[emote]}</span>}
    </span>
  );
}

// 자리 세트. scale 1 = 384px 캔버스(캐릭터 256 캔버스와 같은 px/m). 슬롯 좌표는 layers.json desk.slots(=lib/pmDeskSlots)
export function DeskSet({ cfg, scale = 1, state = 'idle', ...rest }) {
  useCss();
  const L = usePmLayers();
  if (!L) return <span className="pc2-desk" style={{ width: 384 * scale, height: 384 * scale }} />;
  const a = normalizeAvatar(cfg);
  const D = L.desk; const S = D.slots; const px = 384 * scale;
  const src = (id) => (id && D.items[id] ? D.items[id].src : null);
  const at = (slot) => S[slot].at;
  const seat = at('seat'); const feet = L.sit ? L.sit.anchors.hip : L.anchors.feet;
  const chSize = 256 * scale;
  const left = (D.anchor[0] + seat[0] - feet[0]) * scale; const top = (D.anchor[1] + seat[1] - feet[1]) * scale;
  const shift = (slot) => ({ left: S[slot].dx * scale, top: 0, width: px, height: px });
  const desk = a.items.desk && D.items[a.items.desk] ? a.items.desk : 'desk.wood';
  return (
    <span className="pc2-desk" style={{ width: px, height: px }}>
      {src(a.items.rug) && <img src={src(a.items.rug)} alt="" />}
      {src(a.items.shelf) && <img src={src(a.items.shelf)} alt="" />}
      {src(a.items.chair) && <img src={src(a.items.chair)} alt="" />}
      <span style={{ left, top, width: chSize, height: chSize }}><CharacterAvatar cfg={cfg} state={state} size={chSize} pose="sit" {...rest} /></span>
      <img src={src(desk)} alt="" />
      {['deskL', 'deskM', 'deskR'].map((s) => src(a.items[s]) && <img key={s} src={src(a.items[s])} alt="" style={{ ...shift(s), inset: 'auto' }} />)}
      {src(a.items.pet) && <span className="pc2-pet"><img src={src(a.items.pet)} alt="" /></span>}
    </span>
  );
}

// ── 장면 연결(feat/pm-bg-scene 의 seatAnchor) ──
// seat = { x, y, dir: 'left'|'right', scale, z } — x,y = 장면 화면 px 의 앉은 엉덩이 점, scale = 자리 세트 배율(1=384 캔버스), z = 장면 zIndex 기준
// 레이어: z(뒤 꾸밈: 의자·러그) < z+1(캐릭터 상반신 — 하반신은 hideBelowHip 로 숨김) < z+2(책상 스킨·상판 소품) < z+3(펫)
// 배경 그림 책상 위에 산 책상 스킨을 덮어 그린다(테마별 크기 = scale). 좌표 변환은 lib/pmDeskSlots.deskPlacement 와 같은 값.
export function seatToDesk(seat, L) {
  const D = L.desk; const sc = seat.scale || 1;
  const sAt = D.slots.seat.at; // 책상 앵커 → 엉덩이 상대 px
  return { ax: seat.x - sAt[0] * sc, ay: seat.y - sAt[1] * sc, sc };
}
export function SeatedCharacter({ cfg, seat, hideBelowHip = true, ...rest }) {
  useCss();
  const L = usePmLayers();
  if (!L || !L.sit || !seat) return null;
  const sc = seat.scale || 1; const hip = L.sit.anchors.hip; const size = 256 * sc;
  return (
    <span style={{ position: 'absolute', left: seat.x - hip[0] * sc, top: seat.y - hip[1] * sc, width: size, height: size, zIndex: (seat.z || 0) + 1 }}>
      <CharacterAvatar cfg={cfg} size={size} pose="sit" dir={seat.dir === 'right' ? 'right' : 'left'} hideBelowHip={hideBelowHip} {...rest} />
    </span>
  );
}
//   view='iso': 장면 배경과 같은 아이소메트릭 시점 스프라이트(public/pm-char/iso). anchor={x,y}=책상 상판 중심(장면 px, deskAnchor().desk),
//   anchorKind='floor' 면 책상 앞 바닥점 기준. scale=장면 배율(map.deskScale×장면폭/1600), dir='right'=반대 방향 책상(좌우 반전), z=깊이.
//   그리는 것: 책상 스킨(z+2) → 상판 소품 3칸(z+3) → 펫(z+4, 2프레임). 러그·의자·책장은 아이소 세트 없음(배경 그림 사용).
export function DeskDecorIso({ cfg, anchor, anchorKind = 'top', scale = 1, dir = 'left', z = 0, showDesk = true }) {
  useCss();
  const L = usePmLayers();
  if (!L || !L.iso || !anchor) return null;
  const a = normalizeAvatar(cfg); const I = L.iso; const A = I.anchors; const N = I.canvas;
  const flip = dir === 'right';
  const ax = flip ? N - A[anchorKind][0] : A[anchorKind][0];
  const left = anchor.x - ax * scale; const top = anchor.y - A[anchorKind][1] * scale; const size = N * scale;
  const tf = flip ? { transform: 'scaleX(-1)' } : null;
  const img = (id, zz, dx = 0, dy = 0, key = id) => (id && I.items[id] ? <img key={key} src={I.items[id].src} alt="" style={{ position: 'absolute', left: left + dx * scale, top: top + dy * scale, width: size, height: size, zIndex: z + zz, pointerEvents: 'none', ...tf }} /> : null);
  const pet = a.items.pet && I.items[a.items.pet];
  return (
    <>
      {showDesk && a.items.desk && img(a.items.desk, 2)}
      {['deskL', 'deskM', 'deskR'].map((sl) => img(a.items[sl], 3, (A[sl][0] - A.deskM[0]) * (flip ? -1 : 1), A[sl][1] - A.deskM[1], sl))}
      {pet && <span className="pc2-pet" style={{ position: 'absolute', left, top, width: size, height: size, inset: 'auto', zIndex: z + 4, ...tf }}><img src={pet.src} alt="" /></span>}
    </>
  );
}

export function DeskDecor({ cfg, seat, showDesk = true, view = 'front', ...iso }) {
  if (view === 'iso') return <DeskDecorIso cfg={cfg} showDesk={showDesk} dir={seat?.dir === 'right' ? 'right' : 'left'} z={seat?.z || 0} scale={seat?.scale || 1} {...iso} />;
  return <DeskDecorFront cfg={cfg} seat={seat} showDesk={showDesk} />;
}

function DeskDecorFront({ cfg, seat, showDesk = true }) {
  useCss();
  const L = usePmLayers();
  if (!L || !seat) return null;
  const a = normalizeAvatar(cfg); const D = L.desk; const { ax, ay, sc } = seatToDesk(seat, L);
  const size = 384 * sc; const left = ax - D.anchor[0] * sc; const top = ay - D.anchor[1] * sc; const z = seat.z || 0;
  const flip = seat.dir === 'right' ? { transform: 'scaleX(-1)' } : null;
  const img = (id, zz, dx = 0, key = id) => (id && D.items[id] ? <img key={key} src={D.items[id].src} alt="" style={{ position: 'absolute', left: left + dx * sc, top, width: size, height: size, zIndex: z + zz, pointerEvents: 'none', ...flip }} /> : null);
  const pet = a.items.pet && D.items[a.items.pet];
  return (
    <>
      {img(a.items.rug, 0)}{img(a.items.shelf, 0)}{img(a.items.chair, 0)}
      {showDesk && a.items.desk && img(a.items.desk, 2)}
      {['deskL', 'deskM', 'deskR'].map((sl) => img(a.items[sl], 2, D.slots[sl].dx * (seat.dir === 'right' ? -1 : 1), sl))}
      {pet && <span className="pc2-pet" style={{ position: 'absolute', left, top, width: size, height: size, inset: 'auto', zIndex: z + 3, ...flip }}><img src={pet.src} alt="" /></span>}
    </>
  );
}
