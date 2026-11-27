import React, { useState } from 'react';
import styles from '../../styles/ImportPacking.module.css';
import { ALL_SEED_ALIASES } from '../../lib/importPacking.js';
import { packingText } from '../../lib/importPacking/packingToolSupport.js';

// Preserve emphasis in fixed translations without interpreting any HTML.
// Everything else (including strings that look like tags) is React text.
function NoticeText({ text }) {
  return text.split(/(<strong>.*?<\/strong>)/g).map((part, index) =>
    part.startsWith('<strong>') && part.endsWith('</strong>')
      ? <strong key={index}>{part.slice(8, -9)}</strong>
      : <React.Fragment key={index}>{part}</React.Fragment>);
}

function PendingItem({ nm, catalogItems, onConfirm, lang = 'ko' }) {
  const t = packingText(lang);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const filtered = term.length > 0
    ? catalogItems
        .filter((it) => it.name.toLowerCase().includes(term))
        .slice(0, 12)
    : [];
  return (
    <div style={{ background: '#fff', border: '1px solid #dce4ef', borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
      <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
        <span style={{ color: '#526580' }}>{nm.farm} · </span>
        <span>{nm.description}</span>
      </div>
      {nm.candidates && nm.candidates.length > 0 && (
        <div style={{ fontSize: 13, color: '#526580' }}>
          <div style={{ marginBottom: 4, color: '#526580' }}>{t.candidates}:</div>
          {nm.candidates.slice(0, 6).map((c, ci) => (
            <div key={ci} style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: ci < Math.min(5, nm.candidates.length - 1) ? '1px solid #edf2f8' : 'none' }}>
              <span style={{ color: '#172b4d', flex: 1 }}>{c.item.name}</span>
              <span style={{ color: '#526580', fontVariant: 'tabular-nums', fontSize: 13 }}>{(c.score * 100).toFixed(0)}%</span>
              <button onClick={() => onConfirm(nm.description, c.item.name)} style={{ padding: '3px 9px', fontSize: 13, borderRadius: 5, border: '1px solid #2457c5', background: '#2457c5', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
                {t.confirmMatch}
              </button>
            </div>
          ))}
        </div>
      )}
      {/* Search-the-catalog fallback */}
      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px dashed #e0e0db' }}>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.searchFallback} aria-label={t.searchFallback}
          style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0cc', borderRadius: 5, boxSizing: 'border-box' }}
        />
        {term.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 13, color: '#526580' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '6px 0', color: '#526580', fontStyle: 'italic' }}>{t.noResults}</div>
            ) : (
              filtered.map((it, ii) => (
                <div key={ii} style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: ii < filtered.length - 1 ? '1px solid #edf2f8' : 'none' }}>
                  <span style={{ color: '#172b4d', flex: 1 }}>{it.name}</span>
                  <button onClick={() => onConfirm(nm.description, it.name)} style={{ padding: '3px 9px', fontSize: 13, borderRadius: 5, border: '1px solid #2457c5', background: '#2457c5', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
                    {t.confirmMatch}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// NoMatchItem — like PendingItem but for no-candidates case (yellow panel).
// =============================================================================
function NoMatchItem({ nm, catalogItems, onConfirm, lang = 'ko' }) {
  const t = packingText(lang);
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const filtered = term.length > 0
    ? catalogItems
        .filter((it) => it.name.toLowerCase().includes(term))
        .slice(0, 12)
    : [];
  return (
    <div style={{ background: '#fff', border: '1px solid #dce4ef', borderRadius: 8, padding: '8px 12px', marginBottom: 5 }}>
      <div style={{ fontSize: 13, marginBottom: 6 }}>
        <span style={{ color: '#526580' }}>{nm.farm} · </span>
        <span style={{ color: '#c81e1e' }}>{nm.description}</span>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t.searchCatalog} aria-label={t.searchCatalog}
        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid #d0d0cc', borderRadius: 5, boxSizing: 'border-box' }}
      />
      {term.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 13, color: '#526580' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '6px 0', color: '#526580', fontStyle: 'italic' }}>{t.noResults}</div>
          ) : (
            filtered.map((it, ii) => (
              <div key={ii} style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: ii < filtered.length - 1 ? '1px solid #edf2f8' : 'none' }}>
                <span style={{ color: '#172b4d', flex: 1 }}>{it.name}</span>
                <button onClick={() => onConfirm(nm.description, it.name)} style={{ padding: '3px 9px', fontSize: 13, borderRadius: 5, border: '1px solid #2457c5', background: '#2457c5', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
                  {t.confirmMatch}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function renderPackingMismatchAndAliasesFooter({
  mismatches,
  mismatchOverrides,
  setMismatchOverrides,
  pending,
  allNoMatches,
  aliases,
  showAliasManager,
  setShowAliasManager,
  clearAliases,
  deleteAlias,
  t,
}) {
  return (
    <>
                {/* Total mismatch warning */}
                {mismatches.length > 0 && (
                  <div style={{ marginTop: 16, background: '#fee', border: '1px solid #f8b4b4', borderRadius: 10, padding: '1rem 1.25rem' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#9b1c1c', marginBottom: 4 }}>{t.mismatchPanel}</div>
                    <div style={{ fontSize: 13, color: '#9b1c1c', marginBottom: 10 }}><NoticeText text={t.mismatchPanelSub} /></div>
                    {mismatches.map((m, idx) => {
                      const diff = m.computed - m.expected;
                      const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      const ovKey = `${m.country}|${m.invoice}`;
                      const overridden = mismatchOverrides.has(ovKey);
                      return (
                        <div key={idx} style={{ background: '#fff', border: '1px solid ' + (overridden ? '#b8e0c8' : '#f8b4b4'), borderRadius: 8, padding: '10px 12px', marginBottom: 6, fontSize: 13 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', marginBottom: 4, gap: 8 }}>
                            <div style={{ fontWeight: 600 }}>{t.countryNames[m.country] || m.country} · {t.invoice} {m.invoice}</div>
                            {!overridden ? (
                              <button onClick={() => {
                                const next = new Set(mismatchOverrides);
                                next.add(ovKey);
                                setMismatchOverrides(next);
                              }} style={{ padding: '3px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #9b1c1c', background: '#fff', color: '#9b1c1c', cursor: 'pointer', fontWeight: 500 }}>
                                {t.mismatchUnblock}
                              </button>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, color: '#057a55', fontWeight: 500 }}>
                                {t.mismatchUnblocked}
                                <button onClick={() => {
                                  const next = new Set(mismatchOverrides);
                                  next.delete(ovKey);
                                  setMismatchOverrides(next);
                                }} style={{ padding: '2px 8px', fontSize: 13, borderRadius: 6, border: '1px solid #057a55', background: '#fff', color: '#057a55', cursor: 'pointer' }}>↺</button>
                              </span>
                            )}
                          </div>
                          <div style={{ color: "#526580" }}>
                            <NoticeText text={t.mismatchRow(fmt(m.computed), fmt(m.expected), fmt(diff))} />
                            <strong style={{ color: "#9b1c1c" }}>{diff > 0 ? "+" : ""}{fmt(diff)}</strong>
                          </div>
                          {m.missingTotalValue && <div style={{ marginTop: 6, color: '#92400e', background: '#fef3c7', border: '1px solid #f5d97a', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}>{t.mismatchFallback}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {(pending.length>0||allNoMatches.length>0)&&<p style={{fontSize:13,color:'#92400e'}}>전산 미매칭은 위 표의 품목을 눌러 선택·저장하세요. 매칭이 끝나기 전에는 다운로드되지 않습니다.</p>}

                {/* Aliases footer + manager */}
                {(() => {
                  const userEntries = Object.entries(aliases).filter(([k, v]) => ALL_SEED_ALIASES[k] !== v);
                  const seedCount = Object.keys(ALL_SEED_ALIASES).length;
                  return (
                    <div style={{ marginTop: '1rem' }}>
                      <div style={{ fontSize: 13, color: '#526580', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{t.aliasFooter(seedCount, userEntries.length)}</span>
                        <div style={{ display: 'flex', gap: 10 }}>
                          {userEntries.length > 0 && (
                            <button onClick={() => setShowAliasManager(v => !v)} style={{ background: 'none', border: 'none', color: '#2457c5', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}>
                              {showAliasManager ? t.aliasManagerClose : t.aliasManage} ({userEntries.length})
                            </button>
                          )}
                          {userEntries.length > 0 && (
                            <button onClick={clearAliases} style={{ background: 'none', border: 'none', color: '#c81e1e', cursor: 'pointer', fontSize: 13, padding: 0, textDecoration: 'underline' }}>{t.aliasClear}</button>
                          )}
                        </div>
                      </div>
                      {showAliasManager && (
                        <div style={{ marginTop: 10, border: '1px solid #dce4ef', borderRadius: 10, overflow: 'hidden' }}>
                          <div style={{ background: '#f4f7fb', padding: '10px 14px', borderBottom: '1px solid #dce4ef' }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.aliasManagerTitle} · 레거시 추천 별칭 (ERP 확정 매칭과 별도)</div>
                            <div style={{ fontSize: 13, color: '#526580', marginTop: 2 }}>{t.aliasManagerSub}</div>
                          </div>
                          {userEntries.length === 0 ? (
                            <div style={{ padding: '14px', fontSize: 13, color: '#526580', textAlign: 'center' }}>{t.aliasManagerEmpty}</div>
                          ) : (
                            <div className={styles.aliasScroll}>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, padding: '7px 14px', background: '#f8fafc', borderBottom: '1px solid #dce4ef', fontSize: 13, fontWeight: 600, color: '#526580', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                <span>{t.aliasManagerInvoice}</span><span>{t.aliasManagerCatalog}</span><span></span>
                              </div>
                              {userEntries.map(([key, catalogName]) => {
                                const isSeedOverride = ALL_SEED_ALIASES[key] !== undefined;
                                return (
                                  <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, padding: '8px 14px', borderBottom: '1px solid #edf2f8', alignItems: 'center', fontSize: 13 }}>
                                    <div style={{ color: '#526580', wordBreak: 'break-word' }}>
                                      {key}
                                      {isSeedOverride && <span style={{ marginLeft: 5, fontSize: 13, padding: '1px 5px', borderRadius: 10, background: '#fef3c7', color: '#92400e', border: '1px solid #f5d97a' }}>{t.aliasManagerSeed}</span>}
                                    </div>
                                    <div style={{ color: '#172b4d', fontWeight: 500, wordBreak: 'break-word' }}>→ {catalogName}</div>
                                    <button onClick={() => deleteAlias(key)} style={{ padding: '3px 9px', fontSize: 13, borderRadius: 6, border: '1px solid #f8b4b4', background: '#fde8e8', color: '#c81e1e', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 500 }}>{t.aliasManagerDelete}</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div style={{ padding: '8px 14px', borderTop: '1px solid #dce4ef', textAlign: 'right' }}>
                            <button onClick={() => setShowAliasManager(false)} style={{ padding: '4px 12px', fontSize: 13, borderRadius: 6, border: '1px solid #ccd6e5', background: '#fff', cursor: 'pointer', color: '#526580' }}>{t.aliasManagerClose}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
    </>
  );
}

export default function PackingMismatchAndAliasesFooter(props) {
  return renderPackingMismatchAndAliasesFooter(props);
}

export { NoticeText, PendingItem, NoMatchItem, renderPackingMismatchAndAliasesFooter };
