import React from 'react';
import styles from '../../styles/ImportPacking.module.css';
import PackingMatchManager from './PackingMatchManager.js';
import { ALL_SEED_ALIASES } from '../../lib/importPacking.js';

export function renderPackingCatalogSection({
  lang,
  changeLang,
  t,
  latestShared,
  saving,
  processing,
  restoringWork,
  catalogLoading,
  catalogParsing,
  sharedReady,
  matchTarget,
  reloadErpMatches,
  erpMatches,
  openSavedErpMatch,
  catalog,
  catalogRef,
  xlsxLib,
  handleCatalogFile,
  cancelCatalogDraft,
  setCatalogClearConfirm,
  catalogDraft,
  catalogPreviewError,
  confirmCatalogDraft,
  catalogPreview,
  catalogMode,
  setCatalogMode,
  catalogReplaceConfirmed,
  setCatalogReplaceConfirmed,
  catalogClearConfirm,
  clearCatalog,
  aliases,
  aliasFileRef,
  importAliasesFile,
  exportAliases,
  catalogError,
}) {
  return (
    <>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', marginBottom: 14, gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: '#172b4d', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>🌸</div>
            <div>
              <div style={{ fontSize: 18, fontWeight: 600 }}>{t.appTitle}</div>
              <div style={{ fontSize: 13, color: '#526580', marginTop: 1 }}>{t.appSub}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {[['en','EN'],['es','ES'],['ko','한국어']].map(([code, label]) => (
              <button key={code} aria-pressed={lang === code} onClick={() => changeLang(code)}
                style={{ padding: '4px 10px', fontSize: 13, borderRadius: 20, border: `1px solid ${lang === code ? '#172b4d' : '#ccd6e5'}`, background: lang === code ? '#172b4d' : '#fff', color: lang === code ? '#fff' : '#526580', fontWeight: lang === code ? 600 : 400, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {latestShared&&<div role="status">팀 공용 매칭이 변경되었습니다. 현재 추출·검토·중량·단가와 입고 초안은 유지됩니다. 다운로드와 새 입고 연결 전 최신 매칭을 적용하세요. <button type="button" disabled={saving||processing} onClick={reloadErpMatches}>최신 팀 매칭 적용</button></div>}
        {erpMatches&&<p style={{margin:'0 0 10px',fontSize:14,color:'#174a36'}}><strong>전산 DB 품목 {erpMatches.products.length.toLocaleString()}개</strong> · 저장된 전산 매칭 {erpMatches.value?.entries?.length??0}개 · 결과 품목을 눌러 검색·매칭하세요.</p>}
        {erpMatches&&<PackingMatchManager entries={erpMatches.value?.entries??[]} products={erpMatches.products}
          disabled={saving||processing||restoringWork||catalogLoading||catalogParsing||!sharedReady||Boolean(matchTarget)} onEdit={openSavedErpMatch} onReload={reloadErpMatches}/>}
        <details style={{marginBottom:12}}><summary style={{cursor:'pointer',fontSize:13}}>기존 업로드 카탈로그 관리 (참고 보관용 · 현재 매칭은 전산 DB 기준)</summary>
        {/* Legacy catalog retained without overriding ERP matching. */}
        <div style={{
          background: catalog ? '#e8f5ee' : '#fff8e6',
          border: `1px solid ${catalog ? '#b8e0c8' : '#f5d97a'}`,
          borderRadius: 8, padding: '10px 14px', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 13 }}>
            {catalogLoading ? (
              <span style={{ color: '#526580' }}>{t.catalogLoading}</span>
            ) : catalog ? (
              <span style={{ color: '#057a55' }}>
                <strong>{t.catalogLoaded}</strong>: {catalog.items.length.toLocaleString()} {t.catalogProducts}
                {catalog.byCountry && Object.keys(catalog.byCountry).length > 0 && (
                  <span style={{ color: '#526580', marginLeft: 6 }}>
                    ({Object.entries(catalog.byCountry).map(([c, list]) => `${c}:${list.length}`).join(' · ')})
                  </span>
                )}
              </span>
            ) : (
              <span style={{ color: '#92400e' }}>
                <strong>{t.catalogMissing}</strong> {t.catalogUploadHint} <code style={{ background: '#fff3c9', padding: '1px 5px', borderRadius: 3 }}>listaproductosnenova.xlsx</code> {t.catalogUploadHint2}
              </span>
            )}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <input ref={catalogRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { handleCatalogFile(e.target.files[0]); e.target.value = ''; }} />
            <button onClick={() => catalogRef.current?.click()} disabled={!xlsxLib} style={{ padding: '5px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #526580', background: '#fff', cursor: 'pointer' }}>
              {catalog ? t.catalogReplace : t.catalogLoad}
            </button>
            {catalog && (
              <button onClick={() => { cancelCatalogDraft(); setCatalogClearConfirm(true); }} style={{ padding: '5px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #ccd6e5', background: '#fff', cursor: 'pointer', color: '#526580' }}>
                {t.catalogClear}
              </button>
            )}
          </div>
        </div>
        </details>
        {catalogParsing && <p role="status" style={{ fontSize: 13 }}>{t.catalogLoading}</p>}
        {catalogDraft && catalogPreviewError && (
          <section role="alert" style={{ border: '1px solid #f8b4b4', borderRadius: 8, padding: 14, marginBottom: 16, background: '#fee', fontSize: 13, overflowWrap: 'anywhere' }}>
            <div style={{ fontWeight: 600 }}>{t.catalogPreview}</div>
            <p>{catalogDraft.fileName}</p>
            <p style={{ color: '#9b1c1c' }}>{catalogPreviewError}</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button onClick={confirmCatalogDraft} disabled>{t.catalogConfirm}</button>
              <button onClick={cancelCatalogDraft}>{t.catalogCancel}</button>
            </div>
          </section>
        )}
        {catalogDraft && catalogPreview && (
          <section aria-label={t.catalogPreview} style={{ border: '1px solid #c3d3fb', borderRadius: 8, padding: 14, marginBottom: 16, background: '#f5f8ff', minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.catalogPreview}</div>
            <div style={{ fontSize: 13, marginTop: 6, overflowWrap: 'anywhere' }}>{catalogDraft.fileName}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '12px 0', fontSize: 13 }}>
              <label><input type="radio" name="packing-catalog-mode" checked={catalogMode === 'merge'} onChange={() => { setCatalogMode('merge'); setCatalogReplaceConfirmed(false); }} /> {t.catalogMerge}</label>
              <label><input type="radio" name="packing-catalog-mode" checked={catalogMode === 'replace'} onChange={() => { setCatalogMode('replace'); setCatalogReplaceConfirmed(false); }} /> {t.catalogReplaceAll}</label>
            </div>
            <div className={styles.tableScroll} tabIndex={0} role="region" aria-label={t.catalogPreview} style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse', fontSize: 13, textAlign: 'right' }}>
                <thead><tr>{t.catalogColumns.map(label => <th key={label} scope="col" style={{ padding: '6px 8px', whiteSpace: 'nowrap', borderBottom: '1px solid #c3d3fb' }}>{label}</th>)}</tr></thead>
                <tbody>{catalogPreview.countries.map(row => <tr key={row.country}>
                  <th scope="row" style={{ padding: '6px 8px' }}>{row.country}</th>
                  {[row.existing, row.incoming, row.added, row.updated, catalogMode === 'merge' ? row.mergeResult : row.replaceResult].map((count, index) => <td key={index} style={{ padding: '6px 8px' }}>{count.toLocaleString()}</td>)}
                </tr>)}</tbody>
              </table>
            </div>
            <p style={{ fontSize: 13 }}>{t.catalogMergeHint}</p>
            {catalogPreview.duplicateRows > 0 && <p style={{ fontSize: 13 }}>{t.catalogDuplicates(catalogPreview.duplicateRows)}</p>}
            {catalogMode === 'replace' && <label style={{ display: 'block', fontSize: 13, color: '#9b1c1c', marginBottom: 12 }}>
              <input type="checkbox" checked={catalogReplaceConfirmed} onChange={e => setCatalogReplaceConfirmed(e.target.checked)} /> {t.catalogReplaceWarning}
            </label>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button onClick={confirmCatalogDraft} disabled={catalogMode === 'replace' && !catalogReplaceConfirmed}>{t.catalogConfirm}</button>
              <button onClick={cancelCatalogDraft}>{t.catalogCancel}</button>
            </div>
          </section>
        )}
        {catalogClearConfirm && <section role="alert" style={{ border: '1px solid #f8b4b4', borderRadius: 8, padding: 14, marginBottom: 16, background: '#fee', fontSize: 13 }}>
          <p style={{ marginTop: 0 }}>{t.catalogClearWarning}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={clearCatalog}>{t.catalogClear}</button>
            <button onClick={() => setCatalogClearConfirm(false)}>{t.catalogCancel}</button>
          </div>
        </section>}

        {/* Matches (alias) como Excel editable */}
        {(() => {
          const total = Object.keys(aliases).length;
          const base = Object.keys(aliases).filter((k) => ALL_SEED_ALIASES[k] === aliases[k]).length;
          return (
            <div style={{
              background: '#eef2ff', border: '1px solid #c3d3fb',
              borderRadius: 8, padding: '10px 14px', marginBottom: '1rem',
              display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
            }}>
              <div style={{ fontSize: 13, color: '#2457c5' }}>
                <span style={{ marginRight: 6 }}>{'\u{1F4DA}'}</span>
                <strong>{t.matchesTitle}</strong> {'\u2014'} {t.matchesCount(total, base)}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                <input ref={aliasFileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { importAliasesFile(e.target.files[0]); e.target.value = ''; }} />
                <button onClick={() => aliasFileRef.current && aliasFileRef.current.click()} disabled={!xlsxLib} style={{ padding: '5px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #2457c5', background: '#fff', color: '#2457c5', cursor: 'pointer' }}>{t.matchesImport}</button>
                <button onClick={exportAliases} disabled={!xlsxLib} style={{ padding: '5px 10px', fontSize: 13, borderRadius: 6, border: '1px solid #2457c5', background: '#2457c5', color: '#fff', cursor: 'pointer' }}>{t.matchesExport}</button>
              </div>
            </div>
          );
        })()}

        {catalogError && (
          <div role="alert" style={{ background: '#fde8e8', color: '#c81e1e', border: '1px solid #f8b4b4', borderRadius: 8, padding: '8px 12px', fontSize: 13, marginBottom: '1rem', overflowWrap: 'anywhere' }}>
            ⚠ {catalogError}
          </div>
        )}
    </>
  );
}

export default function PackingCatalogSection(props) {
  return renderPackingCatalogSection(props);
}
