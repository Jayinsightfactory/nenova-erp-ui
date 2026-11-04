// components/pm/PmTheme.js
// /pm 테마 상태·선택기(썸네일 10종) · 캐릭터 아바타 · 상점+꾸미기 화면.
//   테마 토큰은 lib/pmThemes.js 한 곳. 캐릭터·아이템 목록·가격은 public/pm-themes/manifest.json(서버 가격 기준).
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Badge, Button, SelectCard, Tabs, ToggleChip } from './ui';
import { PM_DEFAULT_THEME, PM_THEMES, allThemesCss, readStoredTheme, storeTheme, themeById, themeThumb } from '../../lib/pmThemes';

export const PmThemeCtx = createContext({ manifest: null, theme: null, avatars: {}, save: null, shop: null, reloadShop: null });
export const usePmTheme = () => useContext(PmThemeCtx);

export const SLOTS = [['hat', '모자'], ['glasses', '안경'], ['outfit', '옷'], ['desk', '책상 소품'], ['pet', '펫'], ['badge', '배지']];
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

// 아바타 = 캐릭터 그림 + 장착 아이템 겹치기. 상태 애니메이션은 클래스(pmc-상태)로.
export function Avatar({ cfg, state = 'idle', size = 40, className = '' }) {
  const { manifest } = usePmTheme();
  if (!manifest || !cfg) return null;
  const ch = manifest.characters.find((c) => c.id === cfg.char) || manifest.characters[0];
  const items = SLOTS.map(([s]) => cfg.items?.[s]).filter(Boolean).map((id) => manifest.items.find((x) => x.id === id)).filter(Boolean);
  const under = items.filter((x) => x.category === 'pet' || x.category === 'desk');
  const over = items.filter((x) => !(x.category === 'pet' || x.category === 'desk'));
  return (
    <span className={`pav pmc-${state} ${className}`} style={{ width: size, height: size }} aria-hidden>
      {under.map((x) => <img key={x.id} className={`it it-${x.category}`} src={x.src} alt="" loading="lazy" decoding="async" />)}
      <span className="pbody">
        <img className="ch" src={ch.src} alt="" loading="lazy" decoding="async" />
        {over.map((x) => <img key={x.id} className={`it it-${x.category}`} src={x.src} alt="" loading="lazy" decoding="async" />)}
      </span>
    </span>
  );
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

// 상점 + 꾸미기(시안 page-shop-avatar): 왼쪽 미리보기 무대·슬롯 탭 / 가운데 아이템 그리드 / 오른쪽 상세·구매·장착 저장. 위 지갑.
//   canEdit=false 면 보기만(본인 또는 관리자 대리만 구매·저장 — 서버 API 도 같은 규칙).
export function ShopPanel({ name, canEdit = true, editNote = '', isAdmin = false, myStaff = null, onBack }) {
  const { manifest, avatars, save, reloadShop } = usePmTheme();
  const [wallet, reloadWallet] = useWallet(name);
  const saved = avatars[name];
  const [cfg, setCfg] = useState(() => ({ char: saved?.char || 'human', items: { ...(saved?.items || {}) } }));
  const [st, setSt] = useState('working');
  const [slot, setSlot] = useState('char');
  const [focus, setFocus] = useState(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [hist, setHist] = useState(false);
  useEffect(() => { setCfg({ char: saved?.char || 'human', items: { ...(saved?.items || {}) } }); }, [name, saved]);
  useEffect(() => { setMsg(''); setFocus(null); }, [name]);
  if (!manifest) return <p className="muted">상점 불러오는 중…</p>;
  const ownedSet = new Set(wallet?.owned || []);
  const isOwned = (key, price) => !price || ownedSet.has(key);
  const list = slot === 'char'
    ? manifest.characters.map((c) => ({ key: `char.${c.id}`, id: c.id, name: c.name, price: c.price, rarity: c.rarity, src: c.src, on: cfg.char === c.id }))
    : manifest.items.filter((x) => x.category === slot).map((x) => ({ key: x.id, id: x.id, name: x.name, price: x.price, rarity: x.rarity, src: x.src, on: cfg.items[slot] === x.id }));
  const choose = (x) => {
    setFocus(x);
    if (slot === 'char') setCfg((c) => ({ ...c, char: x.id }));
    else setCfg((c) => ({ ...c, items: { ...c.items, [slot]: c.items[slot] === x.id ? undefined : x.id } }));
  };
  const chosen = [
    ...manifest.characters.filter((c) => c.id === cfg.char).map((c) => ({ key: `char.${c.id}`, name: c.name, price: c.price })),
    ...manifest.items.filter((x) => Object.values(cfg.items).includes(x.id)).map((x) => ({ key: x.id, name: x.name, price: x.price })),
  ];
  const needBuy = chosen.filter((x) => !isOwned(x.key, x.price));
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
          <div className="stagebox"><Avatar cfg={cfg} state={st} size={150} /><i className="pedestal" aria-hidden /></div>
          <div className="czst" role="group" aria-label="미리보기 상태">
            {manifest.states.map((s) => <ToggleChip key={s} on={st === s} onClick={() => setSt(s)}>{STATE_LABEL[s] || s}</ToggleChip>)}
          </div>
          <Tabs className="slots" label="꾸미기 슬롯" value={slot} onChange={(k) => { setSlot(k); setFocus(null); }} items={[['char', '캐릭터'], ...SLOTS]} />
        </section>
        <section className="sitems" aria-label="아이템 목록">
          {list.map((x) => {
            const own = isOwned(x.key, x.price);
            const poor = !own && wallet && wallet.balance < x.price;
            return (
              <SelectCard key={x.key} className={`sitem ${own ? 'own' : 'lock'} ${poor ? 'poor' : ''}`} on={x.on} pressed={x.on} onClick={() => choose(x)} title={`${x.name} · ${RARITY[x.rarity] || ''}`}>
                <img src={x.src} alt="" loading="lazy" />
                {x.on && <span className="eq" aria-label="착용 중">✓</span>}
                <span className="iname">{x.name}</span>
                <small className={`czr r-${x.rarity || 'basic'}`}>{!x.price ? '무료' : own ? '보유중' : `${poor ? '🔒 ' : ''}${x.price} 🪙`}</small>
              </SelectCard>
            );
          })}
          {!list.length && <p className="muted">이 슬롯 아이템 없음</p>}
        </section>
        <section className="sside">
          {f && (
            <div className="sdetail">
              <div className="dimg"><img src={f.src} alt="" /></div>
              <b>{f.name}</b>
              <small className={`czr r-${f.rarity || 'basic'}`}>{RARITY[f.rarity] || '기본'} · {!f.price ? '무료' : fOwned ? '보유중' : `${f.price}토큰`}</small>
            </div>
          )}
          {!canEdit && <p className="czmsg" role="note">{editNote || '편집 권한 없음'}</p>}
          {canEdit && needBuy.map((x) => (
            <Button key={x.key} variant="primary" className="big buy" disabled={busy || !wallet || wallet.balance < x.price} onClick={() => doBuy(x)}>
              {x.name} 구매하기 · {x.price}🪙{wallet && wallet.balance < x.price ? ' (부족)' : ''}
            </Button>
          ))}
          <Button variant="primary" className="big equip" loading={busy} disabled={!canEdit || needBuy.length > 0} title={needBuy.length ? '잠긴 품목을 먼저 사야 저장됩니다' : ''}
            onClick={() => doSave({ char: cfg.char, items: Object.fromEntries(Object.entries(cfg.items).filter(([, v]) => v)) })}>{busy ? '저장 중…' : '장착 저장'}</Button>
          <div className="srow">
            <Button size="sm" disabled={!canEdit || busy} onClick={() => setCfg({ char: 'human', items: {} })}>모두 벗기</Button>
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
