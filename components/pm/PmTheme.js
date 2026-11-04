// components/pm/PmTheme.js
// /pm 테마 선택기 · 캐릭터 아바타 · 꾸미기 패널. 에셋/목록은 public/pm-themes/manifest.json.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Badge, Button, SelectCard, ToggleChip } from './ui';
import { PM_DEFAULT_THEME, readStoredTheme, storeTheme, themeCss } from '../../lib/pmThemes';

export const PmThemeCtx = createContext({ manifest: null, theme: null, avatars: {}, save: null, shop: null, reloadShop: null });
export const usePmTheme = () => useContext(PmThemeCtx);

const SLOTS = [['hat', '모자'], ['glasses', '안경'], ['outfit', '옷'], ['desk', '책상 소품'], ['pet', '펫'], ['badge', '배지']];

export function usePmThemeState() {
  const [manifest, setManifest] = useState(null);
  const [themeId, setThemeId] = useState(PM_DEFAULT_THEME);
  const [avatars, setAvatars] = useState({});
  const [shop, setShop] = useState(null); // { balances, team, themes } — 서버 계산(lib/pmWallet)
  const reloadShop = useCallback(() => fetch('/api/pm/shop', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j.success) setShop(j); }).catch(() => {}), []);
  useEffect(() => { reloadShop(); }, [reloadShop]);
  useEffect(() => {
    setThemeId(readStoredTheme());
    let alive = true;
    fetch('/pm-themes/manifest.json').then((r) => r.json()).then((m) => { if (alive) setManifest(m); }).catch(() => {});
    fetch('/api/pm/avatars', { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (alive && j.success) setAvatars(j.avatars || {}); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  const pick = useCallback((id) => { setThemeId(id); storeTheme(id); }, []);
  const save = useCallback(async (name, cfg) => {
    const r = await fetch('/api/pm/avatars', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, ...cfg }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.success) throw new Error(j.error || `HTTP ${r.status}`);
    setAvatars((a) => { const n = { ...a }; if (j.avatar) n[name] = j.avatar; else delete n[name]; return n; });
  }, []);
  // 팀 해금 안 된 테마는 고를 수 없다(저장돼 있어도 기본으로). 해금 정보가 아직 없으면 기본.
  const unlocked = (id) => id === PM_DEFAULT_THEME || !!shop?.themes?.find((t) => t.id === id && t.unlocked);
  const theme = (unlocked(themeId) && manifest?.themes?.find((t) => t.id === themeId)) || null;
  const css = useMemo(() => themeCss(theme), [theme]);
  const ctx = useMemo(() => ({ manifest, theme: theme && !theme.default ? theme : null, avatars, save, shop, reloadShop }), [manifest, theme, avatars, save, shop, reloadShop]);
  return { themeId: theme ? themeId : PM_DEFAULT_THEME, pick, css, ctx };
}

export function ThemePicker({ value, onChange }) {
  const { manifest, shop } = usePmTheme();
  const themes = manifest?.themes || [{ id: PM_DEFAULT_THEME, name: '사무실(기본)', emoji: '🏢' }];
  const lock = (t) => (t.id === PM_DEFAULT_THEME ? null : shop?.themes?.find((x) => x.id === t.id) || { unlocked: false, need: null });
  return (
    <label className="tpick" title={shop ? `팀 누적 토큰 ${shop.team} — 테마는 팀 누적으로 해금` : ''}>
      <span>테마</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="화면 테마 선택">
        {themes.map((t) => { const l = lock(t); const off = l && !l.unlocked; return <option key={t.id} value={t.id} disabled={off}>{off ? '🔒' : t.emoji} {t.name}{off && l.need ? ` (팀 ${l.need}토큰)` : ''}</option>; })}
      </select>
    </label>
  );
}

// 아바타 = 캐릭터 SVG + 장착 아이템 SVG 겹치기. 상태 애니메이션은 클래스(pmc-상태)로.
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
// 등급·가격·보유 표시. 잠긴 것도 미리보기는 된다(저장만 구매 후).
function Price({ x, owned }) {
  return <small className={`czr r-${x.rarity || 'basic'}`}>{!x.price ? '무료' : owned ? '보유' : `🔒 ${x.price}토큰`}</small>;
}

export function useWallet(name) {
  const [w, setW] = useState(null);
  const load = useCallback(() => fetch('/api/pm/shop?name=' + encodeURIComponent(name), { cache: 'no-store' }).then((r) => r.json()).then((j) => { if (j.success) setW(j.wallet); }).catch(() => {}), [name]);
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

export function WalletPanel({ name }) {
  const [w] = useWallet(name);
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

export function CustomizePanel({ name, canEdit = true, editNote = '' }) {
  const { manifest, avatars, save, reloadShop } = usePmTheme();
  const [wallet, reloadWallet] = useWallet(name);
  const saved = avatars[name];
  const [cfg, setCfg] = useState(() => ({ char: saved?.char || 'human', items: { ...(saved?.items || {}) } }));
  const [st, setSt] = useState('working');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCfg({ char: saved?.char || 'human', items: { ...(saved?.items || {}) } }); }, [name, saved]);
  useEffect(() => { setMsg(''); }, [name]);
  if (!manifest) return <p className="muted">꾸미기 목록 불러오는 중…</p>;
  const setItem = (slot, id) => setCfg((c) => ({ ...c, items: { ...c.items, [slot]: c.items[slot] === id ? undefined : id } }));
  const ownedSet = new Set(wallet?.owned || []);
  const isOwned = (key, price) => !price || ownedSet.has(key);
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
    try { await save(name, next); setMsg(next.char ? '저장됨 — 모든 관리자 화면에 반영' : '기본 모습으로 되돌림'); } catch (e) { setMsg(`저장 실패: ${e.message || e}`); } finally { setBusy(false); }
  };
  return (
    <div className="cz">
      <div className="czprev">
        <Avatar cfg={cfg} state={st} size={112} />
        {wallet && <div className="czbal"><b>🪙 {wallet.balance}</b><span>토큰 잔액</span></div>}
        <div className="czst" role="group" aria-label="미리보기 상태">
          {manifest.states.map((s) => <ToggleChip key={s} on={st === s} onClick={() => setSt(s)}>{({ idle: '대기', working: '작업중', off: '꺼짐', error: '오류', handoff: '넘김' })[s] || s}</ToggleChip>)}
        </div>
      </div>
      <h3>캐릭터 <small>{manifest.characters.length}종</small></h3>
      <div className="czgrid">
        {manifest.characters.map((c) => (
          <SelectCard key={c.id} className="czopt" on={cfg.char === c.id} pressed={cfg.char === c.id} onClick={() => setCfg((x) => ({ ...x, char: c.id }))}>
            <img src={c.src} alt="" loading="lazy" /><span>{c.name}</span><Price x={c} owned={isOwned(`char.${c.id}`, c.price)} />
          </SelectCard>
        ))}
      </div>
      {SLOTS.map(([slot, label]) => {
        const list = manifest.items.filter((x) => x.category === slot);
        return (
          <div key={slot}>
            <h3>{label} <small>{list.length}</small></h3>
            <div className="czgrid">
              {list.map((x) => (
                <SelectCard key={x.id} className="czopt" on={cfg.items[slot] === x.id} pressed={cfg.items[slot] === x.id} onClick={() => setItem(slot, x.id)}>
                  <img src={x.src} alt="" loading="lazy" /><span>{x.name}</span><Price x={x} owned={isOwned(x.id, x.price)} />
                </SelectCard>
              ))}
            </div>
          </div>
        );
      })}
      <div className="czact">
        {!canEdit && <span className="czmsg" role="note">{editNote || '편집 권한 없음'}</span>}
        {canEdit && needBuy.map((x) => (
          <Button key={x.key} variant="primary" size="sm" disabled={busy || !wallet || wallet.balance < x.price} onClick={() => doBuy(x)}>
            {x.name} {x.price}토큰으로 사기{wallet && wallet.balance < x.price ? ' (부족)' : ''}
          </Button>
        ))}
        <Button variant="primary" loading={busy} disabled={!canEdit || needBuy.length > 0} title={needBuy.length ? '잠긴 품목을 먼저 사야 저장됩니다' : ''} onClick={() => doSave({ char: cfg.char, items: Object.fromEntries(Object.entries(cfg.items).filter(([, v]) => v)) })}>{busy ? '저장 중…' : '저장'}</Button>
        <Button disabled={!canEdit || busy} onClick={() => doSave({ char: '', items: {} })}>기본 모습</Button>
        {msg && <span className="czmsg" role="status">{msg}</span>}
      </div>
      <style jsx global>{`
        .drawer .cz h3 { color: #1b1f2a; margin: 12px 0 6px; font-size: 13px; } .drawer .cz small { color: #4a5263; font-weight: normal; }
        .cz .czprev { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; background: #fff; border: 1px solid #d6dae3; border-radius: 8px; padding: 10px; }
        .cz .czst { display: flex; flex-wrap: wrap; gap: 4px; }
        .cz .czgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(72px, 1fr)); gap: 6px; }
        .cz .czopt { display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 6px 2px; min-height: 72px; background: #fff; color: #1b1f2a; border: 2px solid #d6dae3; border-radius: 8px; font: inherit; font-size: 11px; cursor: pointer; }
        .cz .czopt img { width: 40px; height: 40px; }
        .cz .czopt.on { border-color: #1d5fbf; background: #eaf2ff; }
        .cz .czact { position: sticky; bottom: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; padding: 8px 0; background: #f6f7fa; }
        .cz .czr { font-size: 10px; border-radius: 6px; padding: 0 4px; background: #e6e9ef; color: #1b1f2a; }
        .cz .czr.r-rare { background: #dbe8ff; color: #0f3a80; } .cz .czr.r-legendary { background: #fff0c2; color: #5c3d00; }
        .cz .czmsg { font-size: 12px; color: #1b1f2a; }
        .cz .czbal { margin-left: auto; display: flex; flex-direction: column; align-items: flex-end; } .cz .czbal b { font-size: 20px; } .cz .czbal span { font-size: 11px; color: #4a5263; }
        .drawer .wal .sum { display: flex; gap: 10px; } .drawer .wal .sum div { flex: 1; background: #fff; border: 1px solid #d6dae3; border-radius: 8px; padding: 8px; text-align: center; }
        .drawer .wal .sum b { display: block; font-size: 18px; } .drawer .wal .sum span { font-size: 11px; color: #4a5263; }
        .drawer .wal h3 { color: #1b1f2a; margin: 12px 0 6px; font-size: 13px; } .drawer .walh { list-style: none; padding: 0; margin: 0; display: grid; gap: 4px; font-size: 12px; }
        .drawer .walh li { background: #fff; border: 1px solid #e3e6ec; border-radius: 6px; padding: 4px 8px; color: #1b1f2a; }
      `}</style>
    </div>
  );
}
