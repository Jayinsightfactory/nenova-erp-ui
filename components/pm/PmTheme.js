// components/pm/PmTheme.js
// /pm 테마 상태·선택기(썸네일 10종) · 캐릭터 아바타 · 상점+꾸미기 화면.
//   테마 토큰은 lib/pmThemes.js 한 곳. 캐릭터·아이템 목록·가격은 public/pm-themes/manifest.json(서버 가격 기준).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Badge, Button, SelectCard, Tabs, ToggleChip } from './ui';
import { CharacterAvatar, DANCES, DeskSet, EMOTES, EMOTE_LABEL, PERSONALITIES, normalizeAvatar, usePmLayers } from './Character';
import { useGrow } from './grow/Grow';
import { FxCast } from './SkillFx';
import { BASE_SKILLS, FX_RULES, castSpec, skillById, skillShopItems } from '../../lib/pmSkills';
import { mountShopItems } from '../../lib/pmMounts';
import { PM_DEFAULT_THEME, PM_THEMES, allThemesCss, readStoredTheme, storeTheme, themeById, themeThumb } from '../../lib/pmThemes';

export const PmThemeCtx = createContext({ manifest: null, theme: null, avatars: {}, save: null, shop: null, reloadShop: null });
export const usePmTheme = () => useContext(PmThemeCtx);

// 캐릭터 v2 슬롯(옷·소품은 캐릭터 레이어, 나머지는 자리 세트). deskL/M/R 는 상판 소품(category deskTop) 공용.
export const SLOTS = [['outfit', '옷'], ['hat', '모자'], ['glasses', '안경'], ['hand', '손 소품'], ['badge', '배지'], ['desk', '책상'], ['deskL', '상판 왼쪽'], ['deskM', '상판 가운데'], ['deskR', '상판 오른쪽'], ['chair', '의자'], ['rug', '러그'], ['shelf', '책장·큰 소품'], ['pet', '펫']];
const SLOT_CAT = { deskL: 'deskTop', deskM: 'deskTop', deskR: 'deskTop' };
const SLOT_UNLOCK = { rug: 2, shelf: 3 };
// 스킬·탈것 탭(lib/pmSkills·pmMounts, 가격·해금은 서버가 같은 데이터로 검증). 기본 9종 이펙트는 무료·자동(단계별)
export const FX_SLOTS = [['skillBasic', '스킬: 기본공격'], ['skillUlt', '스킬: 궁극기'], ['mount', '탈것']];
const FX_ITEMS = { skillBasic: () => skillShopItems().filter((x) => x.tier === 'basic'), skillUlt: () => skillShopItems().filter((x) => x.tier !== 'basic'), mount: () => mountShopItems() };
const ALL_FX = () => [...skillShopItems(), ...mountShopItems()];
const STATE_LABEL = { idle: '대기', working: '작업중', off: '꺼짐', error: '오류', handoff: '넘김' };

export function usePmThemeState(who = '') {
  const [manifest, setManifest] = useState(null);
  const [themeId, setThemeId] = useState(PM_DEFAULT_THEME);
  const [avatars, setAvatars] = useState({});
  const [shop, setShop] = useState(null); // { balances, team, themes } — 서버 계산(lib/pmWallet)
  const reloadShop = useCallback(() => fetch('/api/pm/shop', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j.success) setShop(j); }).catch(() => {}), []);
  useEffect(() => { reloadShop(); }, [reloadShop]);
  useEffect(() => { setThemeId(readStoredTheme(who)); }, [who]);
  useEffect(() => {
    let alive = true;
    fetch('/pm-themes/manifest.json').then((r) => r.json()).then((m) => { if (alive) setManifest(m); }).catch(() => {});
    fetch('/api/pm/avatars', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (alive && j.success) setAvatars(j.avatars || {}); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  // 서버(직원별 꾸미기 저장소 data/runtime/pm-avatars.json)에 저장된 테마가 있으면 우선 — PC 를 바꿔도 유지
  const serverTheme = who ? avatars[who]?.theme : '';
  useEffect(() => { if (serverTheme && PM_THEMES.some((x) => x.id === serverTheme)) { setThemeId(serverTheme); storeTheme(serverTheme, who); } }, [serverTheme, who]);
  const pick = useCallback((id) => {
    setThemeId(id); storeTheme(id, who);
    if (who) {
      fetch('/api/pm/avatars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: who, themeOnly: true, theme: id }) })
        .then((r) => r.json()).then((j) => { if (j.success) setAvatars((a) => { const n = { ...a }; if (j.avatar) n[who] = j.avatar; return n; }); }).catch(() => {});
    }
  }, [who]);
  const save = useCallback(async (name, cfg) => {
    const r = await fetch('/api/pm/avatars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...cfg }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
    setAvatars((a) => { const n = { ...a }; if (j.avatar) n[name] = j.avatar; else delete n[name]; return n; });
  }, []);
  const theme = themeById(themeId);
  const css = useMemo(() => allThemesCss(), []);
  const ctx = useMemo(() => ({ manifest, theme, avatars, save, shop, reloadShop }), [manifest, theme, avatars, save, shop, reloadShop]);
  return { themeId: theme.id, pick, css, ctx };
}

// 상단 테마 선택: 시안 축소본 썸네일 10개. 접힌 상태에선 지금 테마 이름만.
export function ThemePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const cur = themeById(value);
  return (
    <div className="tpick">
      <Button size="sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{cur.emoji} 테마 · {cur.name} {open ? '▴' : '▾'}</Button>
      {open && (
        <div className="tgrid" role="listbox" aria-label="화면 테마 선택">
          {PM_THEMES.map((t) => (
            <SelectCard key={t.id} className="tthumb" on={t.id === value} pressed={t.id === value} title={t.desc}
              onClick={() => { onChange(t.id); setOpen(false); }}>
              <img src={themeThumb(t.id)} alt="" loading="lazy" decoding="async" />
              <span><b>{t.id}</b> {t.name}</span>
            </SelectCard>
          ))}
        </div>
      )}
    </div>
  );
}

// 아바타 = 캐릭터 v2 레이어 합성(components/pm/Character). 예전 호출(cfg·state·size) 그대로 호환.
//   name 을 주면 성장 단계(후광 등)·작업 분위기(집중·바쁨…)를 /api/pm/grow 에서 붙인다.
export function Avatar({ cfg, state = 'idle', size = 40, className = '', name = '', ...rest }) {
  const { view } = useGrow() || {};
  if (!cfg) return null;
  const me = name && view ? view.people?.find((p) => p.name === name) : null;
  const vibe = name && view?.vibes?.[name] ? view.vibes[name] : null;
  return <CharacterAvatar cfg={cfg} state={state} size={size} className={`pav ${className}`} stage={me?.stage || 1} vibe={vibe?.vibe || ''} emote={vibe?.emote || ''} {...rest} />;
}

// 자유이용권 남은 일수 배지
export function PassBadge({ pass }) {
  if (!pass || !pass.active) return null;
  return <Badge tone="plain" className="passb" title={`${pass.start} 부터 ${pass.days}일 · ${pass.end} 까지`}>🎟️ 자유이용권 D-{pass.daysLeft}</Badge>;
}

const RARITY = { basic: '기본', common: '일반', rare: '희귀', legendary: '전설' };

export function useWallet(name) {
  const [w, setW] = useState(null);
  const load = useCallback(() => (!name ? Promise.resolve() : fetch('/api/pm/shop?name=' + encodeURIComponent(name), { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j.success) setW(j.wallet); }).catch(() => {})), [name]);
  useEffect(() => { setW(null); load(); }, [load]);
  return [w, load];
}

// 책상 위 작은 잔액 배지
export function TokenBadge({ name }) {
  const { shop } = usePmTheme();
  const b = shop?.balances?.[name];
  if (b == null) return null;
  return <Badge tone="plain" className="tokb" title={`${name} 토큰 잔액 ${b}(업무시간 적립)`}>🪙 {b}</Badge>;
}

export function WalletPanel({ name, wallet }) {
  const [own] = useWallet(wallet ? '' : name);
  const w = wallet || own;
  if (!w) return <p className="muted">지갑 불러오는 중…</p>;
  return (
    <div className="wal">
      <div className="sum"><div><b>{w.balance}</b><span>잔액</span></div><div><b>{w.earned}</b><span>누적 적립</span></div><div><b>{w.spent}</b><span>사용</span></div></div>
      <p className="muted">적립 규칙(서버 계산): 업무 특정 1시간 = {w.rule.workPerH}토큰 · 활동만 1시간 = {w.rule.activePerH}토큰 · 하루 최대 {w.rule.dailyCap}토큰. 꾸미기 전용이며 급여·평가와 무관합니다.</p>
      <h3>적립 내역</h3>
      {w.history.length ? <ul className="walh">{w.history.slice(0, 30).map((h) => (
        <li key={h.day}><b>{h.day}{h.today ? ' (오늘)' : ''}</b> +{h.points}토큰 <span className="muted">{h.reasons.map((r) => `${r.label} ${r.minutes}분`).join(' · ')}</span></li>
      ))}</ul> : <p className="muted">아직 적립 없음</p>}
      <h3>구매 내역</h3>
      {w.purchases.length ? <ul className="walh">{w.purchases.map((p, i) => <li key={i}>{p.at.slice(0, 16).replace('T', ' ')} · {p.id} · −{p.price}토큰 <span className="muted">{p.by ? `(${p.by} 대리)` : ''}</span></li>)}</ul> : <p className="muted">구매 없음</p>}
    </div>
  );
}

// 몸·헤어·성격 고르기(무료)
const HAIR_NAMES = ['흑갈', '갈색', '카라멜', '금발', '라벤더'];
function BasePicker({ cfg, setCfg }) {
  const set = (k, v) => setCfg((c) => ({ ...c, [k]: v }));
  const row = (label, k, opts) => (
    <div className="czst" role="group" aria-label={label}><b>{label}</b>{opts.map(([v, l]) => <ToggleChip key={String(v)} on={cfg[k] === v} onClick={() => set(k, v)}>{l}</ToggleChip>)}</div>
  );
  return (
    <div className="basep">
      {row('체형', 'body', [['slim', '날씬'], ['std', '보통'], ['round', '통통']])}
      {row('피부', 'skin', [0, 1, 2, 3].map((i) => [i, `톤 ${i + 1}`]))}
      {row('헤어', 'hair', [['short', '짧은'], ['bob', '단발'], ['long', '긴'], ['bun', '똥머리']])}
      {row('헤어색', 'hairColor', HAIR_NAMES.map((l, i) => [i, l]))}
      {row('성격(대기 동작)', 'personality', PERSONALITIES)}
    </div>
  );
}

// 상점 + 꾸미기(시안 page-shop-avatar): 왼쪽 미리보기 무대·슬롯 탭 / 가운데 아이템 그리드 / 오른쪽 상세·구매·장착 저장. 위 지갑.
//   canEdit=false 면 보기만(본인 또는 관리자 대리만 구매·저장 — 서버 API 도 같은 규칙).
export function ShopPanel({ name, canEdit = true, editNote = '', isAdmin = false, myStaff = null, onBack }) {
  const { manifest, avatars, save, reloadShop } = usePmTheme();
  const [wallet, reloadWallet] = useWallet(name);
  const saved = avatars[name];
  const base = (sv) => { const n = normalizeAvatar(sv ? { ...sv, view: null } : null); return { char: n.char, body: n.body, skin: n.skin, hair: n.hair, hairColor: n.hairColor, personality: n.personality, items: n.items }; };
  const [cfg, setCfg] = useState(() => base(saved));
  const [dance, setDance] = useState('');
  const [emote, setEmote] = useState('');
  const { view: growV } = useGrow() || {};
  const myStage = growV?.people?.find((p) => p.name === name)?.stage || 1;
  const pass = saved?.pass || null;
  usePmLayers();
  const [st, setSt] = useState('working');
  const [slot, setSlot] = useState('char');
  const [focus, setFocus] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState(false);
  const [fxPlay, setFxPlay] = useState(0);
  useEffect(() => { setCfg(base(saved)); }, [name, saved]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!dance) return undefined; const t = setTimeout(() => setDance(''), 2600); return () => clearTimeout(t); }, [dance]);
  useEffect(() => { setMsg(''); setFocus(null); }, [name]);
  if (!manifest) return <p className="muted">상점 불러오는 중…</p>;
  const ownedSet = new Set(wallet?.owned || []);
  const freeOn = !!pass?.active;
  const isOwned = (key, price) => !price || ownedSet.has(key);
  const usable = (key, price) => freeOn || isOwned(key, price);
  const list = slot === 'char'
    ? manifest.characters.map((c) => ({ key: `char.${c.id}`, id: c.id, name: c.name, price: c.price, rarity: c.rarity, src: c.src, on: cfg.char === c.id }))
    : slot === 'base' ? []
    : FX_ITEMS[slot] ? FX_ITEMS[slot]().map((x) => ({ key: x.id, id: x.id, name: x.name, price: x.price, rarity: x.rarity, emoji: x.emoji, need: x.unlockStage, theme: x.theme, on: cfg.items[slot] === x.id }))
    : manifest.items.filter((x) => !x.hidden && x.category === (SLOT_CAT[slot] || slot)).map((x) => ({ key: x.id, id: x.id, name: x.name, price: x.price, rarity: x.rarity, src: x.icon || x.src, theme: x.theme, on: cfg.items[slot] === x.id }));
  const slotShut = SLOT_UNLOCK[slot] && myStage < SLOT_UNLOCK[slot] && !freeOn;
  const choose = (x) => {
    setFocus(x); setFxPlay((n) => n + 1);
    if (slotShut || (x.need > myStage && !freeOn)) return;
    if (slot === 'char') setCfg((c) => ({ ...c, char: x.id }));
    else setCfg((c) => ({ ...c, items: { ...c.items, [slot]: c.items[slot] === x.id ? undefined : x.id } }));
  };
  const chosen = [
    ...manifest.characters.filter((c) => c.id === cfg.char).map((c) => ({ key: `char.${c.id}`, name: c.name, price: c.price })),
    ...manifest.items.filter((x) => Object.values(cfg.items).includes(x.id)).map((x) => ({ key: x.id, name: x.name, price: x.price })),
    ...ALL_FX().filter((x) => Object.values(cfg.items).includes(x.id)).map((x) => ({ key: x.id, name: x.name, price: x.price })),
  ];
  const needBuy = chosen.filter((x) => !usable(x.key, x.price));
  const notBought = chosen.filter((x) => !isOwned(x.key, x.price));
  const doBuy = async (x) => {
    setBusy(true); setMsg('');
    try {
      const r = await fetch('/api/pm/shop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, id: x.key }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
      setMsg(`${x.name} 구매 완료 — 잔액 ${j.wallet.balance}토큰`); reloadWallet(); reloadShop?.();
    } catch (e) { setMsg(`구매 실패: ${e.message || e}`); } finally { setBusy(false); }
  };
  const doSave = async (next) => {
    setBusy(true); setMsg('');
    try { await save(name, next); setMsg(next.char ? '장착 저장됨 — 모든 화면에 반영' : '기본 모습으로 되돌림'); } catch (e) { setMsg(`저장 실패: ${e.message || e}`); } finally { setBusy(false); }
  };
  const f = focus && list.find((x) => x.key === focus.key) ? focus : list.find((x) => x.on) || list[0] || null;
  const fOwned = f ? isOwned(f.key, f.price) : false;
  const proxy = isAdmin && myStaff !== name;
  return (
    <div className="shop">
      <div className="shead">
        {onBack && <Button size="sm" variant="ghost" onClick={onBack}>← 직원 상세</Button>}
        <h2>🏪 토큰 상점 &amp; 캐릭터 꾸미기 <small>{name}{proxy ? ' · 관리자 대리' : ''}</small></h2>
        <div className="wpill" title="토큰 잔액(업무시간 적립)">{wallet ? <><b>{wallet.balance}</b> 🪙</> : '…'}</div>
      </div>
      <div className="sgrid">
        <section className="sstage">
          <div className="stagebox pc2stage"><DeskSet cfg={cfg} scale={0.74} state={st} stage={myStage} dance={dance} emote={emote} /></div>
          <PassBadge pass={pass} />
          {pass && pass.expired && <p className="czmsg" role="note">자유이용권이 끝났어요. 산 적 없는 품목은 기본 복장으로 돌아갔어요(꾸미기 기록은 보관) — 구매하면 계속 사용할 수 있어요.</p>}
          <div className="czst" role="group" aria-label="춤 미리보기">
            {DANCES.map(([k, l]) => <ToggleChip key={k} on={dance === k} onClick={() => setDance(k)}>💃 {l}</ToggleChip>)}
          </div>
          <div className="czst" role="group" aria-label="이모트">
            {Object.keys(EMOTES).map((k) => <ToggleChip key={k} on={emote === k} onClick={() => setEmote(emote === k ? '' : k)} title={EMOTE_LABEL[k]}>{EMOTES[k]}</ToggleChip>)}
          </div>
          <div className="czst" role="group" aria-label="미리보기 상태">
            {manifest.states.map((s) => <ToggleChip key={s} on={st === s} onClick={() => setSt(s)}>{STATE_LABEL[s] || s}</ToggleChip>)}
          </div>
          <Tabs className="slots" label="꾸미기 슬롯" value={slot} onChange={(k) => { setSlot(k); setFocus(null); }} items={[['base', '몸·헤어·성격'], ['char', '캐릭터'], ...SLOTS, ...FX_SLOTS]} />
        </section>
        <section className="sitems" aria-label="아이템 목록">
          {slot === 'base' && <BasePicker cfg={cfg} setCfg={setCfg} />}
          {slotShut && <p className="czmsg" role="note">🌱 성장 {SLOT_UNLOCK[slot]}단계에서 열리는 자리예요(지금 {myStage}단계).</p>}
          {list.map((x) => {
            const own = isOwned(x.key, x.price);
            const poor = !own && wallet && wallet.balance < x.price;
            return (
              <SelectCard key={x.key} className={`sitem ${own ? 'own' : 'lock'} ${poor ? 'poor' : ''}`} on={x.on} pressed={x.on} onClick={() => choose(x)} title={`${x.name} · ${RARITY[x.rarity] || ''}`}>
                {x.emoji ? <span className="fxi" aria-hidden>{x.emoji}</span> : <img src={x.src} alt="" loading="lazy" />}
                {x.on && <span className="eq" aria-label="착용 중">✓</span>}
                <span className="iname">{x.name}</span>
                <small className={`czr r-${x.rarity || 'basic'}`}>{x.need > myStage && !freeOn ? `🌱 ${x.need}단계 · ` : ''}{!x.price ? '무료' : own ? '보유중' : freeOn ? `🎟️ 이용권 · ${x.price}🪙` : `${poor ? '🔒 ' : ''}${x.price} 🪙`}</small>
              </SelectCard>
            );
          })}
          {!list.length && <p className="muted">이 슬롯 아이템 없음</p>}
        </section>
        <section className="sside">
          {f && (
            <div className="sdetail">
              {f.emoji ? <FxPreview f={f} slot={slot} play={fxPlay} reduced={reducedMotion()} /> : <div className="dimg"><img src={f.src} alt="" /></div>}
              {f.emoji && <Button size="sm" onClick={() => setFxPlay((n) => n + 1)}>▶ 이펙트 재생</Button>}
              <b>{f.name}</b>
              <small className={`czr r-${f.rarity || 'basic'}`}>{RARITY[f.rarity] || '기본'} · {!f.price ? '무료' : fOwned ? '보유중' : `${f.price}토큰`}</small>
            </div>
          )}
          {!canEdit && <p className="czmsg" role="note">{editNote || '편집 권한 없음'}</p>}
          {canEdit && (freeOn ? notBought : needBuy).map((x) => (
            <Button key={x.key} variant="primary" className="big buy" disabled={busy || !wallet || wallet.balance < x.price} onClick={() => doBuy(x)}>
              {x.name} 구매하기 · {x.price}🪙{wallet && wallet.balance < x.price ? ' (부족)' : ''}
            </Button>
          ))}
          <Button variant="primary" className="big equip" loading={busy} disabled={!canEdit || needBuy.length > 0} title={needBuy.length ? '잠긴 품목을 먼저 사야 저장됩니다' : ''}
            onClick={() => doSave({ char: cfg.char, body: cfg.body, skin: cfg.skin, hair: cfg.hair, hairColor: cfg.hairColor, personality: cfg.personality, items: Object.fromEntries(Object.entries(cfg.items).filter(([, v]) => v)) })}>{busy ? '저장 중…' : '장착 저장'}</Button>
          <div className="srow">
            <Button size="sm" disabled={!canEdit || busy} onClick={() => setCfg((c) => ({ ...c, char: 'human', items: {} }))}>모두 벗기</Button>
            <Button size="sm" disabled={!canEdit || busy} onClick={() => doSave({ char: '', items: {} })}>기본 모습</Button>
          </div>
          {msg && <p className="czmsg" role="status">{msg}</p>}
        </section>
      </div>
      <div className="shist">
        <Button size="sm" variant="ghost" aria-expanded={hist} onClick={() => setHist((h) => !h)}>{hist ? '지갑 내역 접기' : '지갑 내역(적립·구매) 보기'}</Button>
        {hist && <WalletPanel name={name} wallet={wallet} />}
      </div>
    </div>
  );
}

const reducedMotion = () => { try { return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };
// 상점 미리보기: 스킬 = 같은 FxCast 로 캐릭터→스테이션 발사 재생, 탈것 = 아이콘 크게
function FxPreview({ f, slot, play, reduced }) {
  if (slot === 'mount') return <div className="dimg fxprev"><span className="fxi big" aria-hidden>{f.emoji}</span></div>;
  const sk = skillById(f.id) || BASE_SKILLS[0];
  const spec = castSpec(sk, { name: 'preview', stage: 3, tier: sk.tier === 'basic' ? 'basic' : 'ult', reason: 'preview' }, reduced);
  return (
    <div className="dimg fxprev">
      <svg viewBox="0 0 220 120" role="img" aria-label={`${f.name} 이펙트 미리보기 · 쿨다운 ${FX_RULES.personGapMs / 1000}초`}>
        <circle cx="200" cy="60" r="12" className="fx-st" />
        <FxCast key={play} uid={`pv${play}`} spec={spec} a={[20, 90]} b={[200, 60]} d="M20,90 Q110,0 200,60" />
      </svg>
    </div>
  );
}
