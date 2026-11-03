// components/pm/PmTheme.js
// /pm 테마 선택기 · 캐릭터 아바타 · 꾸미기 패널. 에셋/목록은 public/pm-themes/manifest.json.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Button, SelectCard, ToggleChip } from './ui';
import { PM_DEFAULT_THEME, readStoredTheme, storeTheme, themeCss } from '../../lib/pmThemes';

export const PmThemeCtx = createContext({ manifest: null, theme: null, avatars: {}, save: null });
export const usePmTheme = () => useContext(PmThemeCtx);

const SLOTS = [['hat', '모자'], ['glasses', '안경'], ['outfit', '옷'], ['desk', '책상 소품'], ['pet', '펫'], ['badge', '배지']];

export function usePmThemeState() {
  const [manifest, setManifest] = useState(null);
  const [themeId, setThemeId] = useState(PM_DEFAULT_THEME);
  const [avatars, setAvatars] = useState({});
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
  const theme = manifest?.themes?.find((t) => t.id === themeId) || null;
  const css = useMemo(() => themeCss(theme), [theme]);
  const ctx = useMemo(() => ({ manifest, theme: theme && !theme.default ? theme : null, avatars, save }), [manifest, theme, avatars, save]);
  return { themeId: theme ? themeId : PM_DEFAULT_THEME, pick, css, ctx };
}

export function ThemePicker({ value, onChange }) {
  const { manifest } = usePmTheme();
  const themes = manifest?.themes || [{ id: PM_DEFAULT_THEME, name: '사무실(기본)', emoji: '🏢' }];
  return (
    <label className="tpick">
      <span>테마</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="화면 테마 선택">
        {themes.map((t) => <option key={t.id} value={t.id}>{t.emoji} {t.name}</option>)}
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
      {under.map((x) => <img key={x.id} src={x.src} alt="" loading="lazy" decoding="async" />)}
      <span className="pbody">
        <img src={ch.src} alt="" loading="lazy" decoding="async" />
        {over.map((x) => <img key={x.id} src={x.src} alt="" loading="lazy" decoding="async" />)}
      </span>
    </span>
  );
}

const RARITY = { basic: '기본', common: '일반', rare: '희귀', legendary: '전설' };
// 등급·가격 표시만(토큰 구매·잠금은 다음 단계 PR — docs/pm-theme-brainstorm.md).
function Price({ x }) {
  return <small className={`czr r-${x.rarity || 'basic'}`}>{RARITY[x.rarity] || '기본'}{x.price ? ` · ${x.price}토큰` : ' · 무료'}</small>;
}

export function CustomizePanel({ name }) {
  const { manifest, avatars, save } = usePmTheme();
  const saved = avatars[name];
  const [cfg, setCfg] = useState(() => ({ char: saved?.char || 'human', items: { ...(saved?.items || {}) } }));
  const [st, setSt] = useState('working');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCfg({ char: saved?.char || 'human', items: { ...(saved?.items || {}) } }); setMsg(''); }, [name, saved]);
  if (!manifest) return <p className="muted">꾸미기 목록 불러오는 중…</p>;
  const setItem = (slot, id) => setCfg((c) => ({ ...c, items: { ...c.items, [slot]: c.items[slot] === id ? undefined : id } }));
  const doSave = async (next) => {
    setBusy(true); setMsg('');
    try { await save(name, next); setMsg(next.char ? '저장됨 — 모든 관리자 화면에 반영' : '기본 모습으로 되돌림'); } catch (e) { setMsg(`저장 실패: ${e.message || e}`); } finally { setBusy(false); }
  };
  return (
    <div className="cz">
      <div className="czprev">
        <Avatar cfg={cfg} state={st} size={112} />
        <div className="czst" role="group" aria-label="미리보기 상태">
          {manifest.states.map((s) => <ToggleChip key={s} on={st === s} onClick={() => setSt(s)}>{({ idle: '대기', working: '작업중', off: '꺼짐', error: '오류', handoff: '넘김' })[s] || s}</ToggleChip>)}
        </div>
      </div>
      <h3>캐릭터 <small>{manifest.characters.length}종</small></h3>
      <div className="czgrid">
        {manifest.characters.map((c) => (
          <SelectCard key={c.id} className="czopt" on={cfg.char === c.id} pressed={cfg.char === c.id} onClick={() => setCfg((x) => ({ ...x, char: c.id }))}>
            <img src={c.src} alt="" loading="lazy" /><span>{c.name}</span><Price x={c} />
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
                  <img src={x.src} alt="" loading="lazy" /><span>{x.name}</span><Price x={x} />
                </SelectCard>
              ))}
            </div>
          </div>
        );
      })}
      <div className="czact">
        <Button variant="primary" loading={busy} onClick={() => doSave({ char: cfg.char, items: Object.fromEntries(Object.entries(cfg.items).filter(([, v]) => v)) })}>{busy ? '저장 중…' : '저장'}</Button>
        <Button disabled={busy} onClick={() => doSave({ char: '', items: {} })}>기본 모습</Button>
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
      `}</style>
    </div>
  );
}
