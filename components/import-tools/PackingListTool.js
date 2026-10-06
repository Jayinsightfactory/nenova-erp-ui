import React, { useState, useRef, useEffect, useMemo } from 'react';
import { parsePackingResponse } from '../../lib/importPackingResponse.js';
import { parseAwbFields, parsePrintedDate } from '../../lib/importAwbFields.js';
import { extractPackingDocument } from '../../lib/importPackingExtractClient.js';
import { readPackingRecords, indexPackingCatalog, savePackingAliases, writePackingRecord,
  PACKING_STORAGE_KEYS, isPackingDownloadBlocked, previewPackingCatalog,
  distinctPackingVarieties, packingUnmatchedCounts, PACKING_PDF_MAX_BYTES,
  readPackingPdfResponse } from '../../lib/importPackingState.js';
import { ALL_SEED_ALIASES, aliasKey, parseCatalog, parseAliasesXlsx, exportAliasesXlsx,
  genColombia, genNL, genChina, genEcuador, genThailand, genAustralia, genUS, genVN,
  AWB_DEFAULT_COMPANIES, writeAWBWorkbook, parseWeekFromFilename } from '../../lib/importPacking.js';

const loadXLSX = () => import('xlsx-js-style').then(m => m.default || m);

// Preserve emphasis in fixed translations without interpreting any HTML.
// Everything else (including strings that look like tags) is React text.
function NoticeText({ text }) {
  return text.split(/(<strong>.*?<\/strong>)/g).map((part, index) =>
    part.startsWith('<strong>') && part.endsWith('</strong>')
      ? <strong key={index}>{part.slice(8, -9)}</strong>
      : <React.Fragment key={index}>{part}</React.Fragment>);
}

function PendingItem({ nm, catalogItems, onConfirm }) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const filtered = term.length > 0
    ? catalogItems
        .filter((it) => it.name.toLowerCase().includes(term))
        .slice(0, 12)
    : [];
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e4', borderRadius: 8, padding: '10px 12px', marginBottom: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
        <span style={{ color: '#888' }}>{nm.farm} · </span>
        <span>{nm.description}</span>
      </div>
      {nm.candidates && nm.candidates.length > 0 && (
        <div style={{ fontSize: 11.5, color: '#666' }}>
          <div style={{ marginBottom: 4, color: '#888' }}>Candidatos:</div>
          {nm.candidates.slice(0, 6).map((c, ci) => (
            <div key={ci} style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: ci < Math.min(5, nm.candidates.length - 1) ? '1px solid #f0f0ee' : 'none' }}>
              <span style={{ color: '#333', flex: 1 }}>{c.item.name}</span>
              <span style={{ color: '#999', fontVariant: 'tabular-nums', fontSize: 10.5 }}>{(c.score * 100).toFixed(0)}%</span>
              <button onClick={() => onConfirm(nm.description, c.item.name)} style={{ padding: '3px 9px', fontSize: 11, borderRadius: 5, border: '1px solid #1a56db', background: '#1a56db', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
                Esta es
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
          placeholder="Buscar en el catálogo si ninguno es correcto..."
          style={{ width: '100%', padding: '6px 8px', fontSize: 11.5, border: '1px solid #d0d0cc', borderRadius: 5, outline: 'none', boxSizing: 'border-box' }}
        />
        {term.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: '#666', maxHeight: 220, overflowY: 'auto' }}>
            {filtered.length === 0 ? (
              <div style={{ padding: '6px 0', color: '#999', fontStyle: 'italic' }}>Sin resultados</div>
            ) : (
              filtered.map((it, ii) => (
                <div key={ii} style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: ii < filtered.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                  <span style={{ color: '#333', flex: 1 }}>{it.name}</span>
                  <button onClick={() => onConfirm(nm.description, it.name)} style={{ padding: '3px 9px', fontSize: 11, borderRadius: 5, border: '1px solid #1a56db', background: '#1a56db', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
                    Esta es
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
function NoMatchItem({ nm, catalogItems, onConfirm }) {
  const [search, setSearch] = useState('');
  const term = search.trim().toLowerCase();
  const filtered = term.length > 0
    ? catalogItems
        .filter((it) => it.name.toLowerCase().includes(term))
        .slice(0, 12)
    : [];
  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e4', borderRadius: 8, padding: '8px 12px', marginBottom: 5 }}>
      <div style={{ fontSize: 12, marginBottom: 6 }}>
        <span style={{ color: '#888' }}>{nm.farm} · </span>
        <span style={{ color: '#c81e1e' }}>{nm.description}</span>
      </div>
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar en el catálogo..."
        style={{ width: '100%', padding: '6px 8px', fontSize: 11.5, border: '1px solid #d0d0cc', borderRadius: 5, outline: 'none', boxSizing: 'border-box' }}
      />
      {term.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: '#666', maxHeight: 220, overflowY: 'auto' }}>
          {filtered.length === 0 ? (
            <div style={{ padding: '6px 0', color: '#999', fontStyle: 'italic' }}>Sin resultados</div>
          ) : (
            filtered.map((it, ii) => (
              <div key={ii} style={{ padding: '4px 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderBottom: ii < filtered.length - 1 ? '1px solid #f0f0ee' : 'none' }}>
                <span style={{ color: '#333', flex: 1 }}>{it.name}</span>
                <button onClick={() => onConfirm(nm.description, it.name)} style={{ padding: '3px 9px', fontSize: 11, borderRadius: 5, border: '1px solid #1a56db', background: '#1a56db', color: '#fff', cursor: 'pointer', fontWeight: 500 }}>
                  Esta es
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

// =============================================================================
// i18n — UI strings for English (en), Spanish (es), Korean (ko)
// =============================================================================
const I18N = {
  en: {
    pdfNotice: 'PDF up to 20MiB. Known layouts are processed locally first, without AI fees. Only explicit AI analysis sends the PDF to the AI service. Same-account cached results are reused for up to 30 days. Nothing is posted to the ERP ledger.',
    localUnavailable: 'This layout could not be fully verified locally. Choose AI analysis if needed (may incur a fee).',
    aiAnalyze: 'AI analysis (may incur a fee)', sourceLocal: 'Local code · no AI call', sourceCache: 'Previous analysis reused · no new AI call', sourceAI: 'AI analysis completed', cacheNotSaved: 'Result not cached; a retry may incur a fee',
    reload: 'Reload shared data', saving: 'Saving shared data…',
    sharedFailure: 'Shared save/load failed. Reload before retrying.',
    appTitle: 'Packing List Generator', appSub: 'Nenova Co. Ltd.',
    catalogLoading: 'Loading catalog...', catalogLoaded: '📚 Catalog loaded', catalogProducts: 'products',
    catalogMissing: '⚠ Catalog not loaded.', catalogUploadHint: 'Upload', catalogUploadHint2: 'and review before saving.',
    catalogReplace: 'Upload / preview', catalogLoad: 'Upload / preview', catalogClear: 'Clear',
    catalogPreview: 'Catalog preview — shared data is unchanged until you confirm.',
    catalogMerge: 'Merge (default)', catalogReplaceAll: 'Replace all', catalogConfirm: 'Confirm and save', catalogCancel: 'Cancel',
    catalogColumns: ['Country', 'Existing', 'Uploaded', 'New', 'Updated', 'Result'],
    catalogMergeHint: 'Merge preserves other countries. Upsert key: country + product code, or normalized name when code is missing.',
    catalogReplaceWarning: 'I confirm replacement of the entire shared catalog, including deletion of countries/products absent from this upload.',
    catalogClearWarning: 'Clear the entire shared catalog for everyone? Learned matches are preserved; downloads may be blocked until a catalog is loaded.',
    catalogDuplicates: n => `${n} duplicate upload rows: last row per key wins.`,
    catalogRows: n => `${n} unmatched output rows`,
    selectCountry: 'Select origin country', countryReady: 'Ready', back: '← Back',
    uploadLabel: 'Upload invoice (PDF)', uploadClick: 'Click to upload', uploadDrag: 'or drag & drop',
    uploadHint: 'PDF · filename should include week-number (e.g.', uploadRemove: 'Remove',
    generate: 'Generate packing list', processing: 'Processing...',
    generatedSection: 'Generated packing lists',
    downloadAll: '⬇ Download all', downloadAllBlocked: '🔒 Download all (blocked)', downloadAllBlockedHint: 'Resolve all issues before downloading.',
    download: '⬇ Download', downloadBlocked: '🔒 Blocked',
    unmatchedBadge: (n) => `🔒 ${n} unconfirmed source varieties`,
    mismatchBadge: '⚠ Total mismatch',
    unmatchedMsg: (n) => `⛔ ${n} product${n > 1 ? 's' : ''} not confirmed in catalog. Confirm each variety before downloading.`,
    mismatchMsg: '🔒 Packing list total does not match the invoice. Download blocked until resolved.',
    mismatchPanel: '🔒 Total does NOT match invoice -- download blocked',
    mismatchPanelSub: 'The packing list total differs from the invoice. <strong>Download is blocked until the issue is resolved.</strong> If the data is correct but the rounding differs, you can manually unblock below.',
    mismatchRow: (comp, exp, diff) => `Packing list: <strong>${comp}</strong> · Invoice: <strong>${exp}</strong> · Difference: `,
    mismatchFallback: '⚠ Claude did not extract the invoice total (total_value missing). Expected was calculated as fallback -- verify manually.',
    mismatchUnblock: 'Unblock manually',
    mismatchUnblocked: '✓ Manually unblocked',
    pendingPanel: (n) => `🔒 ${n} variet${n === 1 ? 'y' : 'ies'} unconfirmed -- download blocked`,
    pendingPanelSub: 'These varieties are not confirmed in the catalog. <strong>You must confirm each one before downloading.</strong> The app will remember them for future invoices.',
    noMatchPanel: (n) => `🔒 ${n} variet${n === 1 ? 'y' : 'ies'} with no catalog match -- download blocked`,
    noMatchPanelSub: "These varieties have no automatic match. <strong>Search manually in the catalog and confirm before downloading.</strong> If they don't exist in the catalog, add them and reprocess.",
    aliasFooter: (seed, user) => `📚 ${seed} pre-loaded aliases${user > 0 ? ` · ${user} learned by you` : ''}`,
    aliasClear: 'clear all learned', aliasManage: 'manage', aliasManagerTitle: 'Learned aliases',
    aliasManagerSub: 'These are the matches you have confirmed manually. Delete any incorrect ones.',
    aliasManagerEmpty: 'No learned aliases yet.', aliasManagerInvoice: 'Invoice description',
    aliasManagerCatalog: 'Catalog name', aliasManagerDelete: 'Delete', aliasManagerClose: 'Close', aliasManagerSeed: 'seed override',
    steps: ['Reading invoice(s)', 'Validating extracted data', 'Building Excel files'],
    products: (n) => `${n} product${n === 1 ? '' : 's'}`, stems: 'stems', more: (n) => `+ ${n} more`,
    summaryOk: '✅ All correct -- ready to download.',
    summaryTruncated: ' ⚠ The PDF was too large and the response was truncated -- some invoices may be missing. Re-process or split the PDF.',
    summaryPending: (n) => ` 🔒 ${n} variet${n === 1 ? 'y' : 'ies'} unconfirmed -- download blocked.`,
    summaryNoMatch: (n) => ` 🔒 ${n} variet${n === 1 ? 'y' : 'ies'} with no match -- download blocked.`,
    summaryMismatch: (n) => ` ⚠ ${n} packing list${n === 1 ? '' : 's'} with total mismatch -- verify before sending.`,
    errWeek: (name) => `Filename must include week-number (e.g. "16-2 Hortensias.pdf"). Got: ${name}`,
    matchesTitle: 'Matches (aliases)', matchesImport: 'Import Excel', matchesExport: 'Export Excel',
    matchesImported: (n) => `Imported ${n} matches from Excel.`,
    matchesCount: (total, base) => `${total} matches loaded${base ? ` · ${base} base` : ''}`,
  },
  es: {
    pdfNotice: 'PDF hasta 20MiB. Primero se procesan formatos conocidos localmente, sin coste de IA. Solo el análisis IA explícito envía el PDF al servicio de IA. Se reutilizan resultados de la misma cuenta hasta 30 días. No se registra nada en el ERP.',
    localUnavailable: 'No se pudo verificar este formato localmente. Puedes elegir análisis IA (puede generar costes).',
    aiAnalyze: 'Analizar con IA (posible coste)', sourceLocal: 'Código local · sin llamada IA', sourceCache: 'Análisis anterior reutilizado · sin nueva llamada IA', sourceAI: 'Análisis IA completado', cacheNotSaved: 'Resultado no guardado en caché; repetir puede generar costes',
    reload: 'Recargar datos compartidos', saving: 'Guardando datos compartidos…',
    sharedFailure: 'Error al guardar/cargar datos compartidos. Recarga antes de reintentar.',
    appTitle: 'Generador de Packing List', appSub: 'Nenova Co. Ltd.',
    catalogLoading: 'Cargando catálogo...', catalogLoaded: '📚 Catálogo cargado', catalogProducts: 'productos',
    catalogMissing: '⚠ Catálogo no cargado.', catalogUploadHint: 'Sube', catalogUploadHint2: 'y revisa antes de guardar.',
    catalogReplace: 'Subir / revisar', catalogLoad: 'Subir / revisar', catalogClear: 'Borrar',
    catalogPreview: 'Vista previa — los datos compartidos no cambian hasta confirmar.',
    catalogMerge: 'Combinar (predeterminado)', catalogReplaceAll: 'Reemplazar todo', catalogConfirm: 'Confirmar y guardar', catalogCancel: 'Cancelar',
    catalogColumns: ['País', 'Existentes', 'Subidos', 'Nuevos', 'Actualizados', 'Resultado'],
    catalogMergeHint: 'Combinar conserva los demás países. Clave: país + código de producto, o nombre normalizado si no hay código.',
    catalogReplaceWarning: 'Confirmo reemplazar TODO el catálogo compartido y borrar los países/productos ausentes de este archivo.',
    catalogClearWarning: '¿Borrar TODO el catálogo compartido para todos? Los matches se conservan; las descargas pueden quedar bloqueadas hasta cargar un catálogo.',
    catalogDuplicates: n => `${n} filas duplicadas: se usa la última fila por clave.`,
    catalogRows: n => `${n} filas de salida sin match`,
    selectCountry: 'Selecciona el país de origen', countryReady: 'Listo', back: '← Atrás',
    uploadLabel: 'Sube el invoice (PDF)', uploadClick: 'Haz clic para subir', uploadDrag: 'o arrastra y suelta',
    uploadHint: 'PDF · el nombre debe incluir el número de semana (ej.', uploadRemove: 'Quitar',
    generate: 'Generar packing list', processing: 'Procesando...',
    generatedSection: 'Packing lists generados',
    downloadAll: '⬇ Descargar todo', downloadAllBlocked: '🔒 Descargar todo (bloqueado)', downloadAllBlockedHint: 'Resuelve todos los problemas antes de descargar.',
    download: '⬇ Descargar', downloadBlocked: '🔒 Bloqueado',
    unmatchedBadge: (n) => `🔒 ${n} variedades de origen sin confirmar`,
    mismatchBadge: '⚠ Total no cuadra',
    unmatchedMsg: (n) => `⛔ ${n} producto${n > 1 ? 's' : ''} no confirmado${n > 1 ? 's' : ''} en el catálogo. Confirma cada variedad antes de descargar.`,
    mismatchMsg: '🔒 El total del packing list no coincide con el invoice. Descarga bloqueada hasta resolver.',
    mismatchPanel: '🔒 Total NO cuadra con el invoice -- descarga bloqueada',
    mismatchPanelSub: 'El total del packing list difiere del invoice. <strong>La descarga está bloqueada hasta que el problema se resuelva.</strong> Si los datos son correctos pero los redondeos no cuadran, puedes desbloquear manualmente abajo.',
    mismatchRow: (comp, exp, diff) => `Packing list: <strong>${comp}</strong> · Invoice: <strong>${exp}</strong> · Diferencia: `,
    mismatchFallback: '⚠ Claude no extrajo el total del invoice (total_value ausente). El esperado se calculó como fallback -- verifica manualmente.',
    mismatchUnblock: 'Desbloquear manualmente',
    mismatchUnblocked: '✓ Desbloqueado manualmente',
    pendingPanel: (n) => `🔒 ${n} variedad${n === 1 ? '' : 'es'} sin confirmar -- descarga bloqueada`,
    pendingPanelSub: 'Estas variedades no están confirmadas en el catálogo. <strong>Debes confirmar cada una antes de poder descargar.</strong> La app las recordará para futuros invoices.',
    noMatchPanel: (n) => `🔒 ${n} variedad${n === 1 ? '' : 'es'} sin ninguna coincidencia en el catálogo -- descarga bloqueada`,
    noMatchPanelSub: 'Estas variedades no tienen coincidencia automática. <strong>Búscalas manualmente en el catálogo y confirma antes de descargar.</strong> Si no existen en el catálogo, añádelas y vuelve a procesar.',
    aliasFooter: (seed, user) => `📚 ${seed} alias pre-cargados${user > 0 ? ` · ${user} aprendidos por ti` : ''}`,
    aliasClear: 'borrar todos', aliasManage: 'gestionar', aliasManagerTitle: 'Aliases aprendidos',
    aliasManagerSub: 'Estas son las coincidencias que has confirmado manualmente. Borra los que sean incorrectos.',
    aliasManagerEmpty: 'Aún no hay aliases aprendidos.', aliasManagerInvoice: 'Descripción del invoice',
    aliasManagerCatalog: 'Nombre en catálogo', aliasManagerDelete: 'Borrar', aliasManagerClose: 'Cerrar', aliasManagerSeed: 'override seed',
    steps: ['Leyendo invoice(s)', 'Validando los datos', 'Generando archivos Excel'],
    products: (n) => `${n} producto${n === 1 ? '' : 's'}`, stems: 'tallos', more: (n) => `+ ${n} más`,
    summaryOk: '✅ Todo correcto -- listo para descargar.',
    summaryTruncated: ' ⚠ El PDF era demasiado grande y la respuesta se truncó -- pueden faltar invoices. Vuelve a procesar o divide el PDF.',
    summaryPending: (n) => ` 🔒 ${n} variedad${n === 1 ? '' : 'es'} sin confirmar en catálogo -- descarga bloqueada.`,
    summaryNoMatch: (n) => ` 🔒 ${n} variedad${n === 1 ? '' : 'es'} sin ninguna coincidencia -- descarga bloqueada.`,
    summaryMismatch: (n) => ` ⚠ ${n} packing list${n === 1 ? '' : 's'} con total que NO cuadra con el invoice -- verifica antes de enviar.`,
    errWeek: (name) => `El nombre del archivo debe incluir el número de semana (ej. "16-2 Hortensias.pdf"). Recibido: ${name}`,
    matchesTitle: 'Matches (alias)', matchesImport: 'Importar Excel', matchesExport: 'Exportar Excel',
    matchesImported: (n) => `Importados ${n} matches desde Excel.`,
    matchesCount: (total, base) => `${total} matches cargados${base ? ` · ${base} base` : ''}`,
  },
  ko: {
    pdfNotice: 'PDF 최대 20MiB. 지원 양식은 먼저 코드로 무료 분석합니다. AI 분석을 선택할 때만 PDF를 AI 서비스로 전송하며 비용이 발생할 수 있습니다. 같은 계정의 기존 분석 결과는 최대 30일간 재사용합니다. ERP 원장에는 반영하지 않습니다.',
    localUnavailable: '이 양식은 무료 분석으로 전체 값을 검증하지 못했습니다. 필요하면 AI 분석을 선택하세요(비용 발생 가능).',
    aiAnalyze: 'AI 분석 (비용 발생 가능)', sourceLocal: '코드 분석 · AI 호출 없음', sourceCache: '기존 분석 재사용 · 새 AI 호출 없음', sourceAI: 'AI 분석 완료', cacheNotSaved: '결과 캐시 저장 안 됨 · 재시도 시 비용 발생 가능',
    reload: '공동 데이터 다시 불러오기', saving: '공동 데이터 저장 중…',
    sharedFailure: '공동 저장/불러오기 실패. 다시 불러온 뒤 재시도하세요.',
    appTitle: '패킹 리스트 생성기', appSub: '네노바 Co. Ltd.',
    catalogLoading: '카탈로그 불러오는 중...', catalogLoaded: '📚 카탈로그 로드됨', catalogProducts: '개 상품',
    catalogMissing: '⚠ 카탈로그가 없습니다.', catalogUploadHint: '', catalogUploadHint2: '을(를) 업로드한 뒤 확인하고 저장하세요.',
    catalogReplace: '업로드 / 미리보기', catalogLoad: '업로드 / 미리보기', catalogClear: '삭제',
    catalogPreview: '카탈로그 미리보기 — 확인 전에는 공동 자료가 변경되지 않습니다.',
    catalogMerge: '병합 (기본)', catalogReplaceAll: '전체 교체', catalogConfirm: '확인 후 저장', catalogCancel: '취소',
    catalogColumns: ['국가', '기존', '업로드', '신규', '갱신', '결과'],
    catalogMergeHint: '병합은 다른 국가를 보존합니다. 국가 + 품목코드로 갱신하며 코드가 없으면 정규화한 이름을 사용합니다.',
    catalogReplaceWarning: '업로드에 없는 국가와 품목을 삭제하고 공동 카탈로그 전체를 교체하는 데 동의합니다.',
    catalogClearWarning: '모든 사용자의 공동 카탈로그 전체를 삭제할까요? 학습된 매칭은 보존되며 카탈로그를 다시 불러오기 전까지 다운로드가 차단될 수 있습니다.',
    catalogDuplicates: n => `업로드 중복 ${n}행: 같은 키의 마지막 행을 사용합니다.`,
    catalogRows: n => `미매칭 출력 행 ${n}개`,
    selectCountry: '원산지 국가 선택', countryReady: '준비', back: '← 뒤로',
    uploadLabel: '인보이스 업로드 (PDF)', uploadClick: '클릭하여 업로드', uploadDrag: '또는 드래그 & 드롭',
    uploadHint: 'PDF · 파일명에 주차 번호 포함 필요 (예:', uploadRemove: '제거',
    generate: '패킹 리스트 생성', processing: '처리 중...',
    generatedSection: '생성된 패킹 리스트',
    downloadAll: '⬇ 전체 다운로드', downloadAllBlocked: '🔒 전체 다운로드 (차단됨)', downloadAllBlockedHint: '모든 문제를 해결한 후 다운로드하세요.',
    download: '⬇ 다운로드', downloadBlocked: '🔒 차단됨',
    unmatchedBadge: (n) => `🔒 미확인 원문 품종 ${n}개`,
    mismatchBadge: '⚠ 합계 불일치',
    unmatchedMsg: (n) => `⛔ 카탈로그에서 확인되지 않은 상품 ${n}개. 다운로드 전에 각 품종을 확인하세요.`,
    mismatchMsg: '🔒 패킹 리스트 합계가 인보이스와 일치하지 않습니다. 해결될 때까지 다운로드가 차단됩니다.',
    mismatchPanel: '🔒 합계가 인보이스와 불일치 -- 다운로드 차단됨',
    mismatchPanelSub: '패킹 리스트 합계가 인보이스와 다릅니다. <strong>문제가 해결될 때까지 다운로드가 차단됩니다.</strong> 데이터가 맞지만 반올림이 다르다면 아래에서 수동으로 차단을 해제할 수 있습니다.',
    mismatchRow: (comp, exp, diff) => `패킹 리스트: <strong>${comp}</strong> · 인보이스: <strong>${exp}</strong> · 차이: `,
    mismatchFallback: '⚠ Claude가 인보이스 합계를 추출하지 못했습니다 (total_value 없음). 예상값은 대체 계산됨 -- 직접 확인하세요.',
    mismatchUnblock: '수동으로 차단 해제',
    mismatchUnblocked: '✓ 수동으로 차단 해제됨',
    pendingPanel: (n) => `🔒 미확인 품종 ${n}개 -- 다운로드 차단됨`,
    pendingPanelSub: '이 품종들은 카탈로그에서 확인되지 않았습니다. <strong>다운로드 전에 각 품종을 반드시 확인하세요.</strong> 향후 인보이스를 위해 기억됩니다.',
    noMatchPanel: (n) => `🔒 카탈로그 일치 없음 ${n}개 -- 다운로드 차단됨`,
    noMatchPanelSub: '이 품종들은 자동 매칭이 없습니다. <strong>카탈로그에서 직접 검색하여 확인하세요.</strong> 카탈로그에 없으면 추가 후 재처리하세요.',
    aliasFooter: (seed, user) => `📚 사전 등록 별칭 ${seed}개${user > 0 ? ` · 학습된 별칭 ${user}개` : ''}`,
    aliasClear: '전체 삭제', aliasManage: '관리', aliasManagerTitle: '학습된 별칭',
    aliasManagerSub: '직접 확인한 매칭 목록입니다. 잘못된 항목을 삭제하세요.',
    aliasManagerEmpty: '아직 학습된 별칭이 없습니다.', aliasManagerInvoice: '인보이스 설명',
    aliasManagerCatalog: '카탈로그 이름', aliasManagerDelete: '삭제', aliasManagerClose: '닫기', aliasManagerSeed: '시드 override',
    steps: ['인보이스 읽는 중', '추출값 검증 중', 'Excel 파일 생성 중'],
    products: (n) => `${n}개 상품`, stems: '줄기', more: (n) => `+ ${n}개 더`,
    summaryOk: '✅ 모두 정상 -- 다운로드 준비 완료.',
    summaryTruncated: ' ⚠ PDF가 너무 커서 응답이 잘렸습니다 -- 일부 인보이스가 누락되었을 수 있습니다. 다시 처리하거나 PDF를 분할하세요.',
    summaryPending: (n) => ` 🔒 미확인 품종 ${n}개 -- 다운로드 차단.`,
    summaryNoMatch: (n) => ` 🔒 일치 없음 ${n}개 -- 다운로드 차단.`,
    summaryMismatch: (n) => ` ⚠ 합계 불일치 패킹 리스트 ${n}개 -- 발송 전 확인.`,
    errWeek: (name) => `파일명에 주차 번호가 포함되어야 합니다 (예: "16-2 Hortensias.pdf"). 받은 값: ${name}`,
    matchesTitle: '매칭(별칭)', matchesImport: 'Excel 가져오기', matchesExport: 'Excel 내보내기',
    matchesImported: (n) => `Excel에서 매칭 ${n}개를 가져왔습니다.`,
    matchesCount: (total, base) => `매칭 ${total}개 로드됨${base ? ` · 기본 ${base}개` : ''}`,
  },
};

// =============================================================================
// =============================================================================
// AWB MODULE — Air Waybill packing lists.  COMPLETELY ISOLATED from the
// farm flows (NL/CN/CO/EC/AU/US/VN).  Do not call into anything outside
// the helpers it imports (setCell, setFormula, FONT_*, ALIGN_*, NF_*,
// writeTopHeader, writeTableHeaders, buildMerges, applyColWidths,
// bordersAll, loadXLSX).
//
// Rules (per user requirements):
//   1. Packing list uses the same layout as the rose farms (legacy template).
//   2. Each AWB has a "company" (like a farm): EXCEL, FREIGHTWISE, etc.
//      Companies are editable — user can add/remove from the UI.
//   3. The four data rows are FIXED and ALWAYS in this order:
//         row 1: 운송료           (qty in J=190, u_price, t_price)
//         row 2: 운송료           (qty=1, u_price=remainder, t_price=remainder)
//         row 3: Chargeable weight (CW value goes into J)
//         row 4: Gross weight      (GW value goes into J)
//   4. The Total of (row1 + row2) MUST equal the invoice total exactly.
//      We block download until it matches.
//   5. Header MUST include the current week (default '21-1차' but editable).
// =============================================================================

// --- AWB companies (the "farms" of the AWB module) ----------------------------
// --- AWB PDF parser using PDF.js -------------------------------------------
// Loads PDF.js on demand from jsDelivr (Anthropic CSP allows it; unpkg is
// blocked).  Returns { awb?, gw?, cw?, total?, company? } — every field is
// best-effort and the user can override each one in the form.
//
// Patterns it knows about:
//   * Delta / Ecuador-style: "Gross 100 ... Chargeable 131 ... Charge 3.45
//                              ... Total USD 451.95 ... Total Prepaid USD 544.45"
//   * DHL / Cathay-style (CO): "Original X (for Consignee)<AWB-prefix><AWB-suffix>
//                              <ORIGIN><weight-charge>60.00<dues><grand-total>"
//     where AWB has the shape "PREFIX AWB MIA AMOUNT ..."
//   * Scanned PDFs (Thai-style): no text layer — parser returns {} and the
//     user is told to fill manually.

// AWB text extraction is optional and supplied by the parent; no CDN scripts.

// Find the [GW, CW, rate] row by clustering items by y-coordinate and looking
// for a row with at least 3 numeric tokens where positions 1, 2, 3 look like
// (integer, integer, decimal-rate).  This works for both Delta/Ecuador-style
// AWBs and DHL/Cathay-style ones because the printed PDF puts these values
// on a single horizontal line in the rate-class block.
function findWeightRow(items) {
  // Group items by y (within ±2px)
  const rows = new Map();
  for (const it of items) {
    let key = null;
    for (const k of rows.keys()) {
      if (Math.abs(k - it.y) <= 2) { key = k; break; }
    }
    if (key === null) key = it.y;
    if (!rows.has(key)) rows.set(key, []);
    rows.get(key).push(it);
  }
  for (const arr of rows.values()) arr.sort((a, b) => a.x - b.x);

  // Score each row that has >=3 numeric tokens
  let best = null;
  for (const arr of rows.values()) {
    const nums = arr
      .map(it => ({ val: parseFloat(it.str.replace(/,/g, '')), raw: it.str, x: it.x }))
      .filter(n => !isNaN(n.val) && /^[\d,]+(\.\d+)?$/.test(n.raw));
    if (nums.length < 3) continue;
    // Look for [GW, CW, rate] pattern: ints + decimal
    for (let i = 0; i + 2 < nums.length; i++) {
      const gw = nums[i].val, cw = nums[i+1].val, rate = nums[i+2].val;
      const isRate = /\./.test(nums[i+2].raw);
      if (gw >= 50 && gw <= 100000
          && cw >= 50 && cw <= 100000
          && rate >= 0.5 && rate <= 50
          && isRate) {
        if (!best) best = { gw, cw, rate };
        break;
      }
    }
    if (best) break;
  }
  return best;
}

// Detect which carrier the PDF is from by keywords.
function detectAWBCompany(text) {
  const t = text.toUpperCase();
  // Only return matches that are in our short-list of company labels
  // (EXCEL, FREIGHTWISE, Freightwise Ecuador).  Other carriers will fail
  // to match and the user picks manually from the dropdown.
  if (/APOLLO\s+FREIGHT/i.test(text))                  return 'Apollo';
  if (/\bFREIGHTWISE\s+ECUADOR\b/i.test(text))        return 'Freightwise Ecuador';
  if (/\bEXCEL\s*TRANSPORT\b/i.test(text))            return 'EXCEL';
  if (/\bFREIGHTWISE\b/i.test(text))                  return 'FREIGHTWISE';
  // Heuristic fallback: if shipper text mentions LA ROSALEDA + Ecuador it's
  // typically the Freightwise Ecuador shipment.
  if (/LA\s*ROSALEDA/i.test(text) && /ECUADOR/i.test(text)) return 'Freightwise Ecuador';
  return null;
}

async function parseAWBPdf(pdfBase64, readAwbPdf) {
  try {
    if (!readAwbPdf) return { _error: 'Lector PDF local no disponible. Rellena los campos manualmente.' };
    return parseAwbFields(await readAwbPdf(pdfBase64));
  } catch (e) {
    return { _error: 'No se pudo leer el PDF: ' + e.message };
  }
}

// =============================================================================
// AWBPanel — the AWB screen.  Self-contained UI.
// All state lives here; nothing leaks into the farm flow.
// =============================================================================
function AWBPanel({ xlsxLib, lang, onBack, readAwbPdf }) {
  // --- Form state ----------------------------------------------------------
  // Note: storage key is versioned (v2) so we don't read stale company lists
  // from earlier prototypes (those had EXCEL/FREIGHTWISE/DHL/CATHAY).
  // Carrier preferences are session-local; only catalog/matches use team records.
  const [companies, setCompanies] = useState([...AWB_DEFAULT_COMPANIES]);
  const [company, setCompany]   = useState(companies[0] || 'EXCEL');
  const [weekend, setWeekend]   = useState('');
  const [awb, setAwb]           = useState('');
  const [invoice, setInvoice]   = useState('');
  const [date, setDate]         = useState('');
  const [gw, setGw]             = useState('');
  const [cw, setCw]             = useState('');
  const [total, setTotal]       = useState('');
  const [uPrice1, setUPrice1]   = useState('');   // U.PRICE for line 1 (운송료)
  const [total1, setTotal1]     = useState('');   // T.PRICE = uPrice1 × cw
  const [total2, setTotal2]     = useState('');   // T.PRICE for line 2

  const [pdfFile, setPdfFile]   = useState(null);
  const [pdfBase64, setPdfBase64] = useState(null);
  const [parseStatus, setParseStatus] = useState(null);
  const [newCompany, setNewCompany] = useState('');
  const [showCompanyMgr, setShowCompanyMgr] = useState(false);
  const pdfRef = useRef(null);
  const awbReaderVersion = useRef(0);
  useEffect(() => () => { ++awbReaderVersion.current; }, []);
  const [pdfDragOver, setPdfDragOver] = useState(false);

  // --- Derived: keep T1 = uPrice1 × cw, T2 = total - T1 ---------------------
  const cwNum     = parseFloat(cw)     || 0;
  const totalNum  = parseFloat(total)  || 0;
  const uPrice1Num = parseFloat(uPrice1) || 0;
  const t1 = +(uPrice1Num * cwNum).toFixed(2);
  const t2 = +(totalNum - t1).toFixed(2);
  const uPrice2 = t2;  // line 2 has J=1, so uPrice2 = t2



  // --- PDF handler ---------------------------------------------------------
  const onPdfFile = async (f) => {
    if (!f) return;
    const version = ++awbReaderVersion.current;
    setPdfFile(null); setPdfBase64(null);
    if (f.size > PACKING_PDF_MAX_BYTES) {
      setParseStatus({ kind: 'err', msg: 'PDF: máximo 20MiB.' });
      return;
    }
    if (!/\.pdf$/i.test(f.name) || (f.type && f.type !== 'application/pdf')) {
      setParseStatus({ kind: 'err', msg: 'Solo se aceptan archivos PDF.' });
      return;
    }
    setPdfFile(f);
    setAwb(''); setDate(''); setGw(''); setCw(''); setTotal(''); setUPrice1(''); setInvoice(''); setWeekend('');
    setParseStatus({ kind: 'loading', msg: 'Leyendo PDF…' });
    const reader = new FileReader();
    reader.onload = async () => {
      if (awbReaderVersion.current !== version) return;
      try {
        const b64 = reader.result.split(',')[1];
        setPdfBase64(b64);
        const parsed = await parseAWBPdf(b64, readAwbPdf);
        if (awbReaderVersion.current !== version) return;
        if (parsed._error) {
          // Even if PDF text extraction failed, we can still pull the week
          // from the filename — that doesn't need a text layer.
          const wk = parseWeekFromFilename(f.name);
          if (wk) {
            setWeekend(`${wk.week}-${wk.num}`);
            setParseStatus({ kind: 'warn', msg: `${parsed._error} (Semana ${wk.week}-${wk.num} leída del nombre del archivo.)` });
          } else {
            setParseStatus({ kind: 'warn', msg: parsed._error });
          }
          return;
        }
        let filled = [];
        // Week — read from the filename (works even when the PDF is scanned)
        const wk = parseWeekFromFilename(f.name);
        if (wk) {
          setWeekend(`${wk.week}-${wk.num}`);
          filled.push('Semana');
        }
        if (parsed.awb)     { setAwb(parsed.awb);                  filled.push('AWB'); }
        if (parsed.date)    { setDate(parsed.date);                filled.push('Fecha'); }
        if (parsed.gw)      { setGw(String(parsed.gw));            filled.push('GW'); }
        if (parsed.cw)      { setCw(String(parsed.cw));            filled.push('CW'); }
        if (parsed.uPrice1) { setUPrice1(String(parsed.uPrice1));  filled.push('U.Price'); }
        if (parsed.total)   { setTotal(parsed.total.toFixed(2));   filled.push('Total'); }
        // Only auto-set company if it matches one already in our list
        if (parsed.company && companies.includes(parsed.company)) {
          setCompany(parsed.company);
          filled.push('Compañía');
        }
        if (filled.length === 0) {
          setParseStatus({ kind: 'warn', msg: 'PDF leído pero no se reconocieron campos. Rellena el formulario manualmente.' });
        } else {
          setParseStatus({ kind: 'ok', msg: `Auto-rellenado: ${filled.join(', ')}. Revísalo y completa lo demás.` });
        }
      } catch (e) {
        if (awbReaderVersion.current === version) setParseStatus({ kind: 'err', msg: `Error leyendo PDF: ${e.message}` });
      }
    };
    reader.onerror = () => {
      if (awbReaderVersion.current === version) setParseStatus({ kind: 'err', msg: 'Error leyendo PDF.' });
    };
    reader.readAsDataURL(f);
  };

  // --- Validation ----------------------------------------------------------
  const errors = [];
  if (!company)       errors.push('Compañía obligatoria.');
  if (!weekend.trim()) errors.push('Semana obligatoria (ej. 21-01).');
  if (!awb.trim())     errors.push('Número de AWB obligatorio.');
  if (!parsePrintedDate(date)) errors.push('Fecha del documento obligatoria (YYYY/MM/DD).');
  if (gw === '' || cwNum < 0 || isNaN(parseFloat(gw))) errors.push('GW (Gross Weight) obligatorio.');
  if (cw === '' || isNaN(cwNum))   errors.push('CW (Chargeable Weight) obligatorio.');
  if (total === '' || isNaN(totalNum)) errors.push('Total (USD) obligatorio.');
  if (uPrice1 === '' || isNaN(uPrice1Num)) errors.push('U.Price línea 1 obligatorio.');
  // Total must match: (uPrice1 × cw) + uPrice2 = total  (uPrice2 is auto)
  const computed = +(t1 + t2).toFixed(2);
  const totalMatches = Math.abs(computed - totalNum) < 0.01;
  if (!totalMatches && total !== '') {
    errors.push(`Total no coincide: ${computed.toFixed(2)} vs ${totalNum.toFixed(2)}.`);
  }
  if (t2 < 0) {
    errors.push('U.Price línea 1 demasiado alto: deja la línea 2 negativa. Bájalo.');
  }
  const canDownload = errors.length === 0;

  // --- Company manager actions ---------------------------------------------
  const addCompany = () => {
    const n = newCompany.trim().toUpperCase();
    if (!n) return;
    if (companies.includes(n)) { setNewCompany(''); return; }
    setCompanies([...companies, n]);
    setCompany(n);
    setNewCompany('');
  };
  const removeCompany = (c) => {
    const next = companies.filter(x => x !== c);
    setCompanies(next.length > 0 ? next : [...AWB_DEFAULT_COMPANIES]);
    if (company === c) setCompany((next[0] || AWB_DEFAULT_COMPANIES[0]));
  };

  // --- Download ------------------------------------------------------------
  const onDownload = () => {
    if (!canDownload || !xlsxLib) return;
    const blob = writeAWBWorkbook(xlsxLib, {
      company,
      weekend,
      invoice: invoice.trim(),
      awb: awb.trim(),
      date,
      gw: parseFloat(gw),
      cw: cwNum,
      uPrice1: uPrice1Num,
      uPrice2,
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeAwb = (awb || 'awb').replace(/[^a-zA-Z0-9_-]/g, '_');
    a.download = `${weekend}_${company}_AWB_${safeAwb}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  // --- UI -------------------------------------------------------------------
  const fieldLabel = { fontSize: 11, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4, display: 'block' };
  const fieldInput = { width: '100%', padding: '8px 10px', fontSize: 13, border: '1px solid #ddd', borderRadius: 6, outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit' };
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 };

  return (
    <>
      <button onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#888', cursor: 'pointer', border: 'none', background: 'none', padding: 0, marginBottom: '1.25rem' }}>
        ← Volver
      </button>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
        <span style={{ fontSize: 24 }}>✈️</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 600 }}>AWB — Air Waybill</div>
          <div style={{ fontSize: 12, color: '#888' }}>Genera el packing list de los aviones</div>
        </div>
      </div>

      {/* Optional PDF upload */}
      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>
        PDF del AWB (opcional)
      </div>
      <div
        onClick={() => pdfRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(true); }}
        onDragEnter={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(true); }}
        onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setPdfDragOver(false); }}
        onDrop={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setPdfDragOver(false);
          const f = e.dataTransfer.files && e.dataTransfer.files[0];
          if (f) onPdfFile(f);
        }}
        style={{
          border: `1.5px dashed ${pdfDragOver ? '#1a56db' : '#ccc'}`,
          borderRadius: 10,
          padding: '1.25rem 1.5rem',
          textAlign: 'center',
          cursor: 'pointer',
          background: pdfDragOver ? '#e6edff' : '#fafaf8',
          marginBottom: 12,
          transition: 'all 0.15s',
        }}>
        <input ref={pdfRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => { onPdfFile(e.target.files[0]); e.target.value = ''; }} />
        <div style={{ fontSize: 22, marginBottom: 4 }}>📄</div>
        <div style={{ fontSize: 13, color: '#666' }}>
          {pdfFile ? (
            <><strong style={{ color: '#1a1a1a' }}>{pdfFile.name}</strong> · {(pdfFile.size/1024).toFixed(0)} KB</>
          ) : (
            <><strong style={{ color: '#1a1a1a' }}>Click</strong> o arrastra el PDF del AWB aquí (intenta auto-rellenar)</>
          )}
        </div>
        <div style={{ fontSize: 11, color: '#888', marginTop: 4 }}>PDF · máximo 20MiB</div>
      </div>
      {parseStatus && (
        <div style={{
          marginTop: -4, marginBottom: 12, padding: '8px 12px', borderRadius: 6, fontSize: 12,
          background: parseStatus.kind === 'ok'   ? '#e8f5ee' : parseStatus.kind === 'warn'   ? '#fff8e6' : parseStatus.kind === 'err' ? '#fde8e8' : '#f0f4ff',
          color:      parseStatus.kind === 'ok'   ? '#057a55' : parseStatus.kind === 'warn'   ? '#92400e' : parseStatus.kind === 'err' ? '#9b1c1c' : '#1a56db',
          border:     `1px solid ${parseStatus.kind === 'ok' ? '#b8e0c8' : parseStatus.kind === 'warn' ? '#f5d97a' : parseStatus.kind === 'err' ? '#f8b4b4' : '#c3d3fb'}`,
        }}>{parseStatus.msg}</div>
      )}

      {/* Form */}
      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 8, marginBottom: 10 }}>
        Datos del AWB
      </div>

      <div style={grid2}>
        <div>
          <label style={fieldLabel}>Compañía</label>
          <div style={{ display: 'flex', gap: 6 }}>
            <select value={company} onChange={(e) => setCompany(e.target.value)} style={{ ...fieldInput, flex: 1 }}>
              {companies.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => setShowCompanyMgr(v => !v)} style={{ padding: '0 10px', fontSize: 12, borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }} title="Gestionar compañías">
              ⚙
            </button>
          </div>
        </div>
        <div>
          <label style={fieldLabel}>Semana</label>
          <input value={weekend} onChange={(e) => setWeekend(e.target.value)} placeholder="21-01" style={fieldInput} />
        </div>
      </div>

      {showCompanyMgr && (
        <div style={{ border: '1px solid #e8e8e4', borderRadius: 8, padding: '10px 12px', marginBottom: 12, background: '#fafaf8' }}>
          <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>Gestionar compañías</div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} placeholder="Nueva compañía (ej. KOREAN AIR)" style={{ ...fieldInput, flex: 1 }}
              onKeyDown={(e) => { if (e.key === 'Enter') addCompany(); }} />
            <button onClick={addCompany} style={{ padding: '0 14px', fontSize: 12, borderRadius: 6, border: '1px solid #1a1a1a', background: '#1a1a1a', color: '#fff', cursor: 'pointer' }}>Añadir</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {companies.map(c => (
              <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 8px', fontSize: 11.5, borderRadius: 20, background: '#fff', border: '1px solid #ddd' }}>
                {c}
                {companies.length > 1 && (
                  <button onClick={() => removeCompany(c)} style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#c81e1e', padding: 0, fontSize: 13, lineHeight: 1 }}>×</button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      <div style={grid2}>
        <div>
          <label style={fieldLabel}>AWB #</label>
          <input value={awb} onChange={(e) => setAwb(e.target.value)} placeholder="217-08953641" style={fieldInput} />
        </div>
        <div>
          <label style={fieldLabel}>Invoice #</label>
          <input value={invoice} onChange={(e) => setInvoice(e.target.value)} placeholder="217-08953641" style={fieldInput} />
        </div>
      </div>

      <div style={grid2}>
        <div>
          <label style={fieldLabel}>Fecha</label>
          <input value={date} onChange={(e) => setDate(e.target.value)} placeholder="2026/05/10" style={fieldInput} />
        </div>
        <div></div>
      </div>

      <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 8, marginBottom: 10 }}>
        Pesos y total
      </div>

      <div style={grid2}>
        <div>
          <label style={fieldLabel}>GW (Gross Weight) — kg</label>
          <input value={gw} onChange={(e) => setGw(e.target.value)} placeholder="138" inputMode="decimal" style={fieldInput} />
        </div>
        <div>
          <label style={fieldLabel}>CW (Chargeable Weight) — kg</label>
          <input value={cw} onChange={(e) => setCw(e.target.value)} placeholder="190" inputMode="decimal" style={fieldInput} />
        </div>
      </div>

      <div style={grid2}>
        <div>
          <label style={fieldLabel}>U.Price línea 1 (운송료) — USD/kg</label>
          <input value={uPrice1} onChange={(e) => setUPrice1(e.target.value)} placeholder="1.85" inputMode="decimal" style={fieldInput} />
        </div>
        <div>
          <label style={fieldLabel}>Total invoice — USD</label>
          <input value={total} onChange={(e) => setTotal(e.target.value)} placeholder="676.13" inputMode="decimal" style={fieldInput} />
        </div>
      </div>

      {/* Live preview of the two 운송료 lines */}
      {(total !== '' && cw !== '' && uPrice1 !== '') && (
        <div style={{ background: '#f5f5f2', border: '1px solid #e8e8e4', borderRadius: 8, padding: '10px 14px', marginBottom: 12, fontSize: 12 }}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: '#666' }}>Cómo quedará en el packing list:</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '4px 12px', fontVariant: 'tabular-nums' }}>
            <span style={{ color: '#888' }}>운송료 #1</span>
            <span>J={cwNum} × K={uPrice1Num}</span>
            <span style={{ fontWeight: 600 }}>= {t1.toFixed(2)} USD</span>
            <span style={{ color: '#888' }}>운송료 #2</span>
            <span>J=1 × K={uPrice2.toFixed(2)}</span>
            <span style={{ fontWeight: 600, color: t2 < 0 ? '#c81e1e' : 'inherit' }}>= {t2.toFixed(2)} USD</span>
            <span style={{ color: '#888', borderTop: '1px solid #ddd', paddingTop: 4 }}>TOTAL</span>
            <span style={{ borderTop: '1px solid #ddd', paddingTop: 4 }}></span>
            <span style={{ fontWeight: 700, borderTop: '1px solid #ddd', paddingTop: 4, color: totalMatches ? '#057a55' : '#c81e1e' }}>
              {computed.toFixed(2)} {totalMatches ? '✓' : `≠ ${totalNum.toFixed(2)}`}
            </span>
          </div>
        </div>
      )}

      {/* Validation errors */}
      {errors.length > 0 && (
        <div style={{ background: '#fde8e8', border: '1px solid #f8b4b4', borderRadius: 8, padding: '10px 14px', marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: '#9b1c1c', marginBottom: 4 }}>No se puede generar todavía:</div>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: '#9b1c1c' }}>
            {errors.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        </div>
      )}

      <button onClick={onDownload} disabled={!canDownload || !xlsxLib}
        style={{
          padding: '10px 20px', borderRadius: 8, fontSize: 14, fontWeight: 500,
          cursor: canDownload && xlsxLib ? 'pointer' : 'not-allowed',
          border: '1px solid #1a1a1a',
          background: canDownload && xlsxLib ? '#1a1a1a' : '#ccc',
          color: '#fff', opacity: canDownload && xlsxLib ? 1 : 0.5,
        }}>
        Generar packing list ⬇
      </button>
    </>
  );
}
// =============================================================================
// END AWB MODULE
// =============================================================================

const readLocalAwbPdf = async base64 => (await import('../../lib/importAwbPdf')).readAwbPdf(base64);
export default function PackingListTool({ storage, readAwbPdf = readLocalAwbPdf }) {
  const [screen, setScreen] = useState('country');
  const [country, setCountry] = useState(null);
  const [lang, setLang] = useState('es');
  const t = I18N[lang] || I18N.es;
  const changeLang = setLang;
  const [file, setFile] = useState(null);
  const [pdfBase64, setPdfBase64] = useState(null);
  const [status, setStatus] = useState(null);
  const [steps, setSteps] = useState([]);
  const [excels, setExcels] = useState([]);
  const [generated, setGenerated] = useState({});
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef(null);
  const catalogRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);
  const [xlsxLib, setXlsxLib] = useState(null);

  // Catalog (Lista de productos Nenova) — persists across sessions
  const [catalog, setCatalog] = useState(null);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState(null);
  const [catalogDraft, setCatalogDraft] = useState(null);
  const [catalogParsing, setCatalogParsing] = useState(false);
  const [catalogMode, setCatalogMode] = useState('merge');
  const [catalogReplaceConfirmed, setCatalogReplaceConfirmed] = useState(false);
  const [catalogClearConfirm, setCatalogClearConfirm] = useState(false);
  // A retained draft is revalidated after every shared reload. Validation errors
  // are UI data, never render exceptions or permission to save a stale preview.
  const catalogPreviewState = useMemo(() => {
    if (!catalogDraft) return { preview: null, error: null };
    try {
      return { preview: previewPackingCatalog(catalog, catalogDraft.catalog), error: null };
    } catch (error) {
      return { preview: null, error: error.message || String(error) };
    }
  }, [catalog, catalogDraft]);
  const catalogPreview = catalogPreviewState.preview;
  const catalogPreviewError = catalogPreviewState.error;
  const [allNoMatches, setAllNoMatches] = useState([]);
  // Aliases: { aliasKey(invoiceDesc) → catalogName } — seed + learned matches
  const [aliases, setAliases] = useState({ ...ALL_SEED_ALIASES });
  const [showAliasManager, setShowAliasManager] = useState(false);
  // Editable matches import/export; API credentials and model belong to the server.
  const aliasFileRef = useRef(null);
  // Pending decisions waiting for user confirmation
  const [pending, setPending] = useState([]);
  // Total-vs-invoice mismatches (after building excels): array of
  // { country, invoice, computed, expected }.  Surfaced as a red warning panel.
  const [mismatches, setMismatches] = useState([]);
  // Set of invoice keys for which the user has manually overridden the
  // mismatch block ("desbloquear manualmente").  Key is `${country}|${invoice}`.
  const [mismatchOverrides, setMismatchOverrides] = useState(new Set());
  // Last-extracted result so we can rebuild excels after user confirms aliases
  const [lastExtraction, setLastExtraction] = useState(null);


  const [sharedError, setSharedError] = useState(null);
  const [sharedReady, setSharedReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadVersion, setReloadVersion] = useState(0);
  const savingRef = useRef(false);
  const readerVersion = useRef(0);
  const catalogReaderVersion = useRef(0);
  const sharedScopeVersion = useRef(0);
  const processingRef = useRef(false);
  useEffect(() => () => {
    ++readerVersion.current; ++catalogReaderVersion.current;
    ++sharedScopeVersion.current;
  }, []);

  const resetResults = () => {
    setNeedsAI(false); setExtractionSource('');
    setExcels([]); setGenerated({}); setLastExtraction(null);
    setPending([]); setAllNoMatches([]); setMismatches([]);
    setMismatchOverrides(new Set()); setSteps([]);
  };

  useEffect(() => {
    let active = true;
    loadXLSX().then(lib => { if (active) setXlsxLib(lib); })
      .catch(error => { if (active) setCatalogError(error.message); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    ++sharedScopeVersion.current; ++catalogReaderVersion.current;
    setCatalogParsing(false); setCatalogReplaceConfirmed(false); setCatalogClearConfirm(false);
    setCatalogLoading(true); setSharedReady(false); setSharedError(null);
    readPackingRecords(storage).then(records => {
      if (!active) return;
      setCatalog(records.catalog); setAliases(records.aliases);
      resetResults(); setSharedReady(true);
    }).catch(error => {
      if (active) setSharedError(error.message || String(error));
    }).finally(() => { if (active) setCatalogLoading(false); });
    return () => { active = false; };
  }, [storage, reloadVersion]);

  // Commit UI only after shared save succeeds; serialize rapid confirmations.
  const runSharedWrite = async action => {
    if (savingRef.current || !sharedReady || processingRef.current || catalogParsing) return;
    const scope = sharedScopeVersion.current;
    savingRef.current = true; setSaving(true); setSharedError(null);
    try {
      await action();
    } catch (error) {
      if (sharedScopeVersion.current === scope) {
        setSharedError(error.message || String(error));
        setSharedReady(false); // reload revision before retrying after a conflict; keep drafts
        setCatalogReplaceConfirmed(false);
      }
    } finally {
      savingRef.current = false; setSaving(false);
    }
  };

  const handleCatalogFile = async f => {
    if (!f || !xlsxLib || savingRef.current || processingRef.current || !sharedReady) return;
    const version = ++catalogReaderVersion.current;
    setCatalogParsing(true); setCatalogError(null);
    setCatalogDraft(null); setCatalogClearConfirm(false); setCatalogReplaceConfirmed(false); setCatalogMode('merge');
    try {
      const parsed = indexPackingCatalog(parseCatalog(xlsxLib, await f.arrayBuffer()));
      if (!parsed.items.length) throw new Error('Empty catalog.');
      if (catalogReaderVersion.current !== version) return;
      previewPackingCatalog(catalog, parsed); // reject before publishing an invalid draft
      if (catalogReaderVersion.current === version) setCatalogDraft({ catalog: parsed, fileName: f.name });
    } catch (error) {
      if (catalogReaderVersion.current === version) setCatalogError(error.message || String(error));
    } finally {
      if (catalogReaderVersion.current === version) setCatalogParsing(false);
    }
  };

  const cancelCatalogDraft = () => {
    ++catalogReaderVersion.current;
    setCatalogDraft(null); setCatalogParsing(false); setCatalogReplaceConfirmed(false); setCatalogClearConfirm(false);
  };

  const confirmCatalogDraft = () => {
    if (!catalogPreview || (catalogMode === 'replace' && !catalogReplaceConfirmed)) return;
    const next = catalogPreview[catalogMode];
    const scope = sharedScopeVersion.current;
    return runSharedWrite(async () => {
      await writePackingRecord(storage, PACKING_STORAGE_KEYS.catalog, { items: next.items, savedAt: next.savedAt });
      if (sharedScopeVersion.current !== scope) return;
      setCatalogError(null); setCatalog(next); cancelCatalogDraft(); resetResults();
    });
  };

  const clearCatalog = () => {
    if (!catalogClearConfirm) return;
    const scope = sharedScopeVersion.current;
    return runSharedWrite(async () => {
      await writePackingRecord(storage, PACKING_STORAGE_KEYS.catalog, null);
      if (sharedScopeVersion.current !== scope) return;
      setCatalog(null); cancelCatalogDraft(); resetResults();
    });
  };

  const rebuildWithAliases = currentAliases => {
    if (lastExtraction) buildExcels({
      invoices: lastExtraction.result.invoices, masterAwb: lastExtraction.masterAwb,
      weekParsed: lastExtraction.weekParsed, currentAliases,
      wasTruncated: lastExtraction.wasTruncated,
    });
  };

  const importAliasesFile = async f => {
    if (!f || !xlsxLib) return;
    await runSharedWrite(async () => {
      const imported = parseAliasesXlsx(xlsxLib, await f.arrayBuffer());
      if (!Object.keys(imported).length) throw new Error('No valid matches in Excel.');
      const newAliases = { ...aliases, ...imported };
      await savePackingAliases(storage, newAliases);
      setAliases(newAliases); rebuildWithAliases(newAliases);
      if (!lastExtraction) setStatus({ type: 'success', msg: t.matchesImported(Object.keys(imported).length) });
    });
  };

  // Export ALL current matches (base + learned) to a visible, editable Excel.
  const exportAliases = () => {
    if (!xlsxLib) return;
    try { exportAliasesXlsx(xlsxLib, aliases); } catch (e) { setStatus({ type: 'error', msg: 'Error: ' + (e.message || e) }); }
  };

  const countries = [
    { code: 'NL', flag: '🇳🇱', name: 'Netherlands', desc: 'Holex · EZ Flower' },
    { code: 'CN', flag: '🇨🇳', name: 'China', desc: 'Melody · Cloudland' },
    { code: 'CO', flag: '🇨🇴', name: 'Colombia', desc: 'Multi-farm invoices' },
    { code: 'EC', flag: '🇪🇨', name: 'Ecuador', desc: 'La Rosaleda' },
    { code: 'TH', flag: '🇹🇭', name: 'Thailand', desc: 'Krung · Super Fresh' },
    { code: 'AU', flag: '🇦🇺', name: 'Australia', desc: 'Premium Greens' },
    { code: 'US', flag: '🇺🇸', name: 'USA', desc: 'Hood Canal Evergreens' },
    { code: 'VN', flag: '🇻🇳', name: 'Vietnam', desc: 'Royal Base Corporation' },
  ];
  const cfg = country ? {
    NL: ['🇳🇱', 'Netherlands — Holex / EZ Flower', 'Auto-detects supplier per invoice'],
    CN: ['🇨🇳', 'China — Melody / Cloudland', 'Auto-detects supplier per invoice'],
    CO: ['🇨🇴', 'Colombia — Multi-farm', 'Auto-detects farm per invoice'],
    EC: ['🇪🇨', 'Ecuador — La Rosaleda', 'One packing list per invoice'],
    TH: ['🇹🇭', 'Thailand — Krung / Super Fresh', 'Auto-detects supplier per invoice'],
    AU: ['🇦🇺', 'Australia — Premium Greens', 'One packing list per invoice'],
    US: ['🇺🇸', 'USA — Hood Canal', 'One packing list per invoice'],
    VN: ['🇻🇳', 'Vietnam — Royal Base', 'One packing list per invoice'],
  }[country] : null;

  const handleFile = (f) => {
    if (!f || processingRef.current || savingRef.current) return;
    const version = ++readerVersion.current;
    setPdfBase64(null); resetResults(); setStatus(null); setFile(null);
    if (f.size > PACKING_PDF_MAX_BYTES) {
      setStatus({ type: 'error', msg: 'PDF: maximum 20MiB / máximo 20MiB / 최대 20MiB' });
      return;
    }
    if (!/\.pdf$/i.test(f.name) || (f.type && f.type !== 'application/pdf')) {
      setStatus({ type: 'error', msg: 'PDF only / Solo PDF / PDF 파일만 지원합니다.' });
      return;
    }
    setFile(f);
    const reader = new FileReader();
    reader.onload = () => {
      if (readerVersion.current === version) setPdfBase64(String(reader.result).split(',')[1]);
    };
    reader.onerror = () => {
      if (readerVersion.current === version) setStatus({ type: 'error', msg: 'Could not read PDF / No se pudo leer el PDF / PDF 읽기 실패' });
    };
    reader.readAsDataURL(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
  };

  // Build (or rebuild) Excel files from a stored extraction + current aliases.
  // Used initially after extraction, and again after the user confirms aliases.
  const buildExcels = (params) => {
    const { invoices, masterAwb, weekParsed, currentAliases, wasTruncated = false } = params;
    const generators = { CO: genColombia, NL: genNL, CN: genChina, EC: genEcuador, TH: genThailand, AU: genAustralia, US: genUS, VN: genVN };
    const gen = generators[country];
    const allPending = [];
    const allNm = [];
    const allMismatches = [];
    const builtExcels = invoices.map((inv, idx) => {
      // All invoices in the same PDF share the same week-num.  The farm
      // abbreviation in the filename (e.g. _BAL_, _FLO_) keeps them unique.
      const fileNum = weekParsed.num;
      const opts = { catalog, masterAwb, aliases: currentAliases };
      const res = gen(xlsxLib, inv, weekParsed.week, fileNum, opts);
      if (res.pending && res.pending.length > 0) allPending.push(...res.pending);
      if (res.noMatches && res.noMatches.length > 0) allNm.push(...res.noMatches);
      if (res.totalMismatch) allMismatches.push(res.totalMismatch);
      return res;
    });
    // Dedup pending/noMatches by aliasKey so the user sees each distinct
    // description only once, even if it appeared in multiple invoices/farms.
    const dedupedPending = distinctPackingVarieties(allPending);
    const dedupedNm = distinctPackingVarieties(allNm);
    if (new Set(builtExcels.map(ex => ex.name)).size !== builtExcels.length) {
      throw new Error('Duplicate output filenames. Verify invoice numbers.');
    }
    const newGenerated = {};
    builtExcels.forEach((ex) => { newGenerated[ex.name] = ex.buf; });
    setGenerated(newGenerated);
    setExcels(builtExcels);
    setPending(dedupedPending);
    setAllNoMatches(dedupedNm);
    setMismatches(allMismatches);
    setMismatchOverrides(new Set());
    setSteps([
      { label: t.steps[0], state: 'done' },
      { label: t.steps[1], state: 'done' },
      { label: t.steps[2], state: 'done' },
    ]);
    let summary = `✓ ${builtExcels.length} packing list${builtExcels.length === 1 ? '' : 's'}.`;
    if (wasTruncated) summary += ' ' + t.summaryTruncated;
    if (dedupedPending.length > 0) summary += t.summaryPending(dedupedPending.length);
    if (dedupedNm.length > 0) summary += t.summaryNoMatch(dedupedNm.length);
    if (allMismatches.length > 0) summary += t.summaryMismatch(allMismatches.length);
    if (!wasTruncated && dedupedPending.length === 0 && dedupedNm.length === 0 && allMismatches.length === 0) summary += ' ' + t.summaryOk;
    const statusType = (wasTruncated || allMismatches.length > 0)
      ? 'error'
      : (dedupedPending.length > 0 || dedupedNm.length > 0 ? 'info' : 'success');
    setStatus({ type: statusType, msg: summary });
  };


  const confirmAlias = (description, catalogName) => runSharedWrite(async () => {
    const items = catalog?.byCountry?.[country] || [];
    if (!items.some(item => item.name === catalogName)) throw new Error('Product not in country catalog.');
    const newAliases = { ...aliases, [aliasKey(description)]: catalogName };
    await savePackingAliases(storage, newAliases);
    setAliases(newAliases); rebuildWithAliases(newAliases);
  });

  const clearAliases = () => runSharedWrite(async () => {
    await writePackingRecord(storage, PACKING_STORAGE_KEYS.aliases, null);
    const records = await readPackingRecords(storage);
    setCatalog(records.catalog); setAliases(records.aliases); resetResults();
  });

  const deleteAlias = key => runSharedWrite(async () => {
    const newAliases = { ...aliases };
    if (ALL_SEED_ALIASES[key] !== undefined) newAliases[key] = ALL_SEED_ALIASES[key];
    else delete newAliases[key];
    await savePackingAliases(storage, newAliases);
    setAliases(newAliases); rebuildWithAliases(newAliases);
  });

  const [needsAI, setNeedsAI] = useState(false);
  const [extractionSource, setExtractionSource] = useState('');
  const process = async (allowAI = false) => {
    if (!pdfBase64 || !xlsxLib || !sharedReady || savingRef.current || processingRef.current || catalogParsing) return;
    const parsed = parseWeekFromFilename(file.name);
    if (!parsed) {
      setStatus({ type: 'error', msg: t.errWeek(file.name) });
      return;
    }
    processingRef.current = true; setProcessing(true);
    const version = readerVersion.current;
    const scope = sharedScopeVersion.current;
    const isCurrent = () => readerVersion.current === version && sharedScopeVersion.current === scope;
    resetResults();
    setSteps([
      { label: t.steps[0], state: 'active' },
      { label: t.steps[1], state: '' },
      { label: t.steps[2], state: '' },
    ]);
    setStatus({ type: 'info', msg: t.processing });
    try {
      const extraction=await extractPackingDocument({country,pdfBase64,readPdf:readAwbPdf,allowAI:allowAI===true});
      if (!isCurrent()) return;
      if(extraction.needsAI){
        setNeedsAI(true);setSteps([]);
        setStatus({type:'info',msg:t.localUnavailable});return;
      }
      const data=extraction.data;
      const sourceLabel=extraction.source==='local'?t.sourceLocal:extraction.source==='cache'?t.sourceCache:t.sourceAI;
      setExtractionSource(sourceLabel+(extraction.source==='ai'&&extraction.cacheSaved===false?' · '+t.cacheNotSaved:''));
      setSteps([
        { label: t.steps[0], state: 'done' },
        { label: sourceLabel, state: 'done' },
        { label: t.steps[2], state: 'active' },
      ]);
      const { result, wasTruncated } = parsePackingResponse(data, country);
      const invoices = result.invoices || [];
      const masterAwb = result.master_awb || (invoices[0] && invoices[0].awb) || '';
      if (invoices.length === 0) throw new Error('No invoices found in PDF');
      // Save extraction for potential re-build after alias updates
      setLastExtraction({ result, masterAwb, weekParsed: parsed, wasTruncated });
      buildExcels({ invoices, masterAwb, weekParsed: parsed, currentAliases: aliases, wasTruncated });
    } catch (e) {
      if (isCurrent()) setStatus({ type: 'error', msg: 'Error: ' + e.message });
    } finally {
      processingRef.current = false;
      setProcessing(false);
    }
  };

  const isBlocked = excel => !sharedReady || saving || processing || isPackingDownloadBlocked(excel, {
    pending, noMatches: allNoMatches, overrides: mismatchOverrides,
    truncated: lastExtraction?.wasTruncated,
  });

  const dl = (name) => {
    if (isBlocked(excels.find(ex => ex.name === name))) return;
    const buf = generated[name];
    if (!buf) return;
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const dlAll = () => {
    if (excels.some(isBlocked)) return;
    Object.keys(generated).forEach((name, i) => setTimeout(() => dl(name), i * 250));
  };

  const statusBg = status?.type === 'error' ? '#fde8e8' : status?.type === 'success' ? '#e8f5ee' : '#e8f0fe';
  const statusBorder = status?.type === 'error' ? '#f8b4b4' : status?.type === 'success' ? '#84e1bc' : '#c3d3fb';
  const statusColor = status?.type === 'error' ? '#c81e1e' : status?.type === 'success' ? '#057a55' : '#1a56db';

  return (
    <div style={{ fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', background: '#f5f5f2', minHeight: '100vh', padding: '2rem 1rem', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', color: '#1a1a1a' }}>
      <div className="packing-tool-card" style={{ background: '#fff', borderRadius: 16, border: '1px solid #e8e8e4', padding: '1.5rem', maxWidth: 1400, minWidth: 0, boxSizing: 'border-box', width: '100%', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
          <button onClick={() => setReloadVersion(v => v + 1)} disabled={saving || processing || catalogLoading || catalogParsing}>{t.reload}</button>
          {saving && <span role="status">{t.saving}</span>}
          {sharedError && <span role="alert" style={{ color: '#c81e1e', overflowWrap: 'anywhere' }}>{t.sharedFailure} {sharedError}</span>}
          {status && screen !== 'upload' && <span role="status" style={{ color: statusColor }}>{status.msg}</span>}
        </div>
        <fieldset disabled={saving || processing || catalogLoading || catalogParsing || !sharedReady}
          onClickCapture={e => { if (saving || processing || catalogLoading || catalogParsing || !sharedReady) { e.preventDefault(); e.stopPropagation(); } }}
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, background: '#1a1a1a', borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: 16 }}>🌸</div>
            <div>
              <div style={{ fontSize: 16, fontWeight: 600 }}>{t.appTitle}</div>
              <div style={{ fontSize: 12, color: '#888', marginTop: 1 }}>{t.appSub}</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            {[['en','EN'],['es','ES'],['ko','한국어']].map(([code, label]) => (
              <button key={code} onClick={() => changeLang(code)}
                style={{ padding: '4px 10px', fontSize: 11.5, borderRadius: 20, border: `1px solid ${lang === code ? '#1a1a1a' : '#ddd'}`, background: lang === code ? '#1a1a1a' : '#fff', color: lang === code ? '#fff' : '#666', fontWeight: lang === code ? 600 : 400, cursor: 'pointer' }}>
                {label}
              </button>
            ))}
          </div>
        </div>
        {/* Catalog status / loader */}
        <div style={{
          background: catalog ? '#e8f5ee' : '#fff8e6',
          border: `1px solid ${catalog ? '#b8e0c8' : '#f5d97a'}`,
          borderRadius: 8, padding: '10px 14px', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap',
        }}>
          <div style={{ fontSize: 12.5 }}>
            {catalogLoading ? (
              <span style={{ color: '#888' }}>{t.catalogLoading}</span>
            ) : catalog ? (
              <span style={{ color: '#057a55' }}>
                <strong>{t.catalogLoaded}</strong>: {catalog.items.length.toLocaleString()} {t.catalogProducts}
                {catalog.byCountry && Object.keys(catalog.byCountry).length > 0 && (
                  <span style={{ color: '#666', marginLeft: 6 }}>
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
          <div style={{ display: 'flex', gap: 6 }}>
            <input ref={catalogRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { handleCatalogFile(e.target.files[0]); e.target.value = ''; }} />
            <button onClick={() => catalogRef.current?.click()} disabled={!xlsxLib} style={{ padding: '5px 10px', fontSize: 11.5, borderRadius: 6, border: '1px solid #999', background: '#fff', cursor: 'pointer' }}>
              {catalog ? t.catalogReplace : t.catalogLoad}
            </button>
            {catalog && (
              <button onClick={() => { cancelCatalogDraft(); setCatalogClearConfirm(true); }} style={{ padding: '5px 10px', fontSize: 11.5, borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', color: '#888' }}>
                {t.catalogClear}
              </button>
            )}
          </div>
        </div>

        {catalogParsing && <p role="status" style={{ fontSize: 12 }}>{t.catalogLoading}</p>}
        {catalogDraft && catalogPreviewError && (
          <section role="alert" style={{ border: '1px solid #f8b4b4', borderRadius: 8, padding: 14, marginBottom: 16, background: '#fee', fontSize: 12, overflowWrap: 'anywhere' }}>
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
            <div style={{ fontSize: 12, marginTop: 6, overflowWrap: 'anywhere' }}>{catalogDraft.fileName}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, margin: '12px 0', fontSize: 12 }}>
              <label><input type="radio" name="packing-catalog-mode" checked={catalogMode === 'merge'} onChange={() => { setCatalogMode('merge'); setCatalogReplaceConfirmed(false); }} /> {t.catalogMerge}</label>
              <label><input type="radio" name="packing-catalog-mode" checked={catalogMode === 'replace'} onChange={() => { setCatalogMode('replace'); setCatalogReplaceConfirmed(false); }} /> {t.catalogReplaceAll}</label>
            </div>
            <div style={{ overflowX: 'auto', maxHeight: 260, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, textAlign: 'right' }}>
                <thead><tr>{t.catalogColumns.map(label => <th key={label} scope="col" style={{ padding: '6px 8px', whiteSpace: 'nowrap', borderBottom: '1px solid #c3d3fb' }}>{label}</th>)}</tr></thead>
                <tbody>{catalogPreview.countries.map(row => <tr key={row.country}>
                  <th scope="row" style={{ padding: '6px 8px' }}>{row.country}</th>
                  {[row.existing, row.incoming, row.added, row.updated, catalogMode === 'merge' ? row.mergeResult : row.replaceResult].map((count, index) => <td key={index} style={{ padding: '6px 8px' }}>{count.toLocaleString()}</td>)}
                </tr>)}</tbody>
              </table>
            </div>
            <p style={{ fontSize: 12 }}>{t.catalogMergeHint}</p>
            {catalogPreview.duplicateRows > 0 && <p style={{ fontSize: 12 }}>{t.catalogDuplicates(catalogPreview.duplicateRows)}</p>}
            {catalogMode === 'replace' && <label style={{ display: 'block', fontSize: 12, color: '#9b1c1c', marginBottom: 12 }}>
              <input type="checkbox" checked={catalogReplaceConfirmed} onChange={e => setCatalogReplaceConfirmed(e.target.checked)} /> {t.catalogReplaceWarning}
            </label>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              <button onClick={confirmCatalogDraft} disabled={catalogMode === 'replace' && !catalogReplaceConfirmed}>{t.catalogConfirm}</button>
              <button onClick={cancelCatalogDraft}>{t.catalogCancel}</button>
            </div>
          </section>
        )}
        {catalogClearConfirm && <section role="alert" style={{ border: '1px solid #f8b4b4', borderRadius: 8, padding: 14, marginBottom: 16, background: '#fee', fontSize: 12 }}>
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
              <div style={{ fontSize: 12.5, color: '#1a56db' }}>
                <span style={{ marginRight: 6 }}>{'\u{1F4DA}'}</span>
                <strong>{t.matchesTitle}</strong> {'\u2014'} {t.matchesCount(total, base)}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <input ref={aliasFileRef} type="file" accept=".xlsx" style={{ display: 'none' }} onChange={(e) => { importAliasesFile(e.target.files[0]); e.target.value = ''; }} />
                <button onClick={() => aliasFileRef.current && aliasFileRef.current.click()} disabled={!xlsxLib} style={{ padding: '5px 10px', fontSize: 11.5, borderRadius: 6, border: '1px solid #1a56db', background: '#fff', color: '#1a56db', cursor: 'pointer' }}>{t.matchesImport}</button>
                <button onClick={exportAliases} disabled={!xlsxLib} style={{ padding: '5px 10px', fontSize: 11.5, borderRadius: 6, border: '1px solid #1a56db', background: '#1a56db', color: '#fff', cursor: 'pointer' }}>{t.matchesExport}</button>
              </div>
            </div>
          );
        })()}

        {catalogError && (
          <div role="alert" style={{ background: '#fde8e8', color: '#c81e1e', border: '1px solid #f8b4b4', borderRadius: 8, padding: '8px 12px', fontSize: 12, marginBottom: '1rem', overflowWrap: 'anywhere' }}>
            ⚠ {catalogError}
          </div>
        )}

        {screen === 'country' && (
          <>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{t.selectCountry}</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              {countries.map((c) => (
                <div key={c.code} onClick={() => { ++readerVersion.current; resetResults(); setCountry(c.code); setScreen('upload'); setFile(null); setPdfBase64(null); setStatus(null); }}
                  style={{ border: '1px solid #e8e8e4', borderRadius: 12, padding: '1.1rem', cursor: 'pointer', position: 'relative', background: '#fff', transition: 'all 0.15s' }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1a1a1a'; e.currentTarget.style.background = '#fafafa'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e8e8e4'; e.currentTarget.style.background = '#fff'; }}>
                  <span style={{ fontSize: 26, display: 'block', marginBottom: 7 }}>{c.flag}</span>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{c.name}</div>
                  <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>{c.desc}</div>
                  <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 500, background: '#e8f5ee', color: '#22a355', border: '1px solid #b8e0c8' }}>{t.countryReady}</span>
                </div>
              ))}
              {/* AWB tile — separate module, not a country */}
              <div onClick={() => setScreen('awb')}
                style={{ border: '1px solid #c3d3fb', borderRadius: 12, padding: '1.1rem', cursor: 'pointer', position: 'relative', background: '#f0f4ff', transition: 'all 0.15s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#1a56db'; e.currentTarget.style.background = '#e6edff'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#c3d3fb'; e.currentTarget.style.background = '#f0f4ff'; }}>
                <span style={{ fontSize: 26, display: 'block', marginBottom: 7 }}>✈️</span>
                <div style={{ fontSize: 13, fontWeight: 600 }}>AWB</div>
                <div style={{ fontSize: 11, color: '#888', marginTop: 2 }}>Aviones — EXCEL, FREIGHTWISE</div>
                <span style={{ position: 'absolute', top: 8, right: 8, fontSize: 10, padding: '2px 7px', borderRadius: 20, fontWeight: 500, background: '#e6edff', color: '#1a56db', border: '1px solid #c3d3fb' }}>Nuevo</span>
              </div>
            </div>
          </>
        )}

        {screen === 'awb' && (
          <AWBPanel xlsxLib={xlsxLib} lang={lang} readAwbPdf={readAwbPdf} onBack={() => setScreen('country')} />
        )}

        {screen === 'upload' && cfg && (
          <>
            <button onClick={() => setScreen('country')} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 13, color: '#888', cursor: 'pointer', border: 'none', background: 'none', padding: 0, marginBottom: '1.25rem' }}>{t.back}</button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1.5rem' }}>
              <span style={{ fontSize: 24 }}>{cfg[0]}</span>
              <div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>{cfg[1]}</div>
                <div style={{ fontSize: 12, color: '#888' }}>{cfg[2]}</div>
              </div>
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{t.uploadLabel}</div>
            <div onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
              style={{ border: '1.5px dashed #ccc', borderRadius: 10, padding: '2.5rem 1.5rem', textAlign: 'center', cursor: 'pointer', background: dragOver ? '#f0f0ee' : '#fafaf8', borderColor: dragOver ? '#999' : '#ccc' }}>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: 'none' }} onChange={(e) => { handleFile(e.target.files[0]); e.target.value = ''; }} />
              <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
              <div style={{ fontSize: 14, color: '#666' }}><strong style={{ color: '#1a1a1a' }}>{t.uploadClick}</strong> {t.uploadDrag}</div>
              <div style={{ fontSize: 12, marginTop: 4, color: '#999' }}>PDF · 20MiB · {t.uploadHint} <code style={{ background: '#f0f0ee', padding: '1px 5px', borderRadius: 3 }}>16-2 Hortensias.pdf</code>)</div>
            </div>
            {file && (
              <div style={{ marginTop: 10, background: '#f5f5f2', border: '1px solid #e8e8e4', borderRadius: 8, padding: '10px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{file.name}</div>
                  <div style={{ fontSize: 11, color: '#888' }}>{(file.size / 1024).toFixed(0)} KB</div>
                </div>
                <button onClick={() => { ++readerVersion.current; resetResults(); setFile(null); setPdfBase64(null); }} style={{ padding: '5px 12px', fontSize: 12, borderRadius: 8, border: '1px solid #ddd', background: '#fff', cursor: 'pointer' }}>{t.uploadRemove}</button>
              </div>
            )}
            <p role="note" style={{ fontSize: 12, color: '#666', marginTop: 12 }}>{t.pdfNotice}</p>
            <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
              <button onClick={() => process(false)} disabled={!pdfBase64 || processing || !xlsxLib} style={{ padding: '9px 18px', borderRadius: 8, fontSize: 14, fontWeight: 500, cursor: (pdfBase64 && !processing) ? 'pointer' : 'not-allowed', border: '1px solid #1a1a1a', background: '#1a1a1a', color: '#fff', opacity: (pdfBase64 && !processing) ? 1 : 0.35 }}>
                {processing ? t.processing : t.generate}
              </button>
              {needsAI&&<button onClick={()=>process(true)} disabled={processing} style={{padding:'9px 18px',borderRadius:8,border:'1px solid #b67b12',background:'#fff4d6',fontWeight:600}}>{t.aiAnalyze}</button>}
            </div>
            {extractionSource&&<p role="status" style={{fontSize:13,color:'#176039'}}>{extractionSource}</p>}
            {status && (
              <div style={{ marginTop: 12, padding: '10px 14px', borderRadius: 8, fontSize: 13, background: statusBg, color: statusColor, border: `1px solid ${statusBorder}` }}>
                {processing && <span style={{ display: 'inline-block', width: 13, height: 13, border: '2px solid #ddd', borderTopColor: '#1a1a1a', borderRadius: '50%', animation: 'spin 0.7s linear infinite', marginRight: 6, verticalAlign: 'middle' }}></span>}
                {status.msg}
                {steps.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    {steps.map((s, i) => (
                      <div key={i} style={{ fontSize: 12, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6, color: s.state === 'done' ? '#22a355' : s.state === 'active' ? '#1a1a1a' : '#999', fontWeight: s.state === 'active' ? 500 : 400 }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', flexShrink: 0 }}></span>{s.label}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            {excels.length > 0 && (
              <div style={{ marginTop: '1.25rem' }}>
                {excels.length > 1 && (() => {
                  const anyBlocked = excels.some(isBlocked);
                  return (
                  <div style={{ marginBottom: 10 }}>
                    <button
                      onClick={anyBlocked ? undefined : dlAll}
                      disabled={anyBlocked}
                      title={anyBlocked ? t.downloadAllBlockedHint : ''}
                      style={{
                        padding: '5px 12px', fontSize: 12, borderRadius: 8,
                        border: '1px solid ' + (anyBlocked ? '#ccc' : '#1a1a1a'),
                        background: anyBlocked ? '#ccc' : '#1a1a1a',
                        color: '#fff', fontWeight: 500,
                        cursor: anyBlocked ? 'not-allowed' : 'pointer',
                        opacity: anyBlocked ? 0.55 : 1,
                      }}>
                      {anyBlocked ? t.downloadAllBlocked : t.downloadAll}
                    </button>
                  </div>
                  );
                })()}
                <div style={{ fontSize: 11, fontWeight: 600, color: '#888', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 10 }}>{t.generatedSection}</div>
                {excels.map((ex) => {
                  const tot = ex.products.reduce((s, p) => s + (p.qty || 0), 0);
                  const unmatched = packingUnmatchedCounts(ex);
                  const unmatchedCount = unmatched.varieties;
                  const blocked = isBlocked(ex);
                  return (
                    <div key={ex.name} style={{ background: '#fff', border: '1px solid #e8e8e4', borderRadius: 10, padding: '1rem 1.25rem', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5, gap: 8 }}>
                        <div style={{ fontSize: 14, fontWeight: 600 }}>
                          {ex.label}
                          {unmatchedCount > 0 && (
                            <span style={{ marginLeft: 8, fontSize: 11, padding: '2px 7px', borderRadius: 20, background: '#fde8e8', color: '#c81e1e', border: '1px solid #f8b4b4', fontWeight: 500 }}>
                              {t.unmatchedBadge(unmatchedCount)}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={blocked ? undefined : () => dl(ex.name)}
                          disabled={blocked}
                          style={{
                            padding: '5px 12px', fontSize: 12, borderRadius: 8,
                            border: '1px solid ' + (blocked ? '#ccc' : '#1a1a1a'),
                            background: blocked ? '#ccc' : '#1a1a1a',
                            color: '#fff', fontWeight: 500,
                            cursor: blocked ? 'not-allowed' : 'pointer',
                            opacity: blocked ? 0.55 : 1,
                          }}>
                          {blocked ? t.downloadBlocked : t.download}
                        </button>
                      </div>
                      <div style={{ fontSize: 12, color: '#888', marginBottom: 6, overflowWrap: 'anywhere' }}>{ex.name} · {t.products(ex.products.length)} · {tot.toLocaleString()} {t.stems}{unmatched.rows > 0 && ` · ${t.catalogRows(unmatched.rows)}`}</div>
                      <div style={{ fontSize: 12, color: '#666' }}>
                        {ex.products.slice(0, 5).map((p, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: i < Math.min(4, ex.products.length - 1) ? '1px solid #f0f0ee' : 'none' }}>
                            <span style={{ color: p.unmatched ? '#c81e1e' : '#666' }}>{p.unmatched ? '⚠ ' : ''}{p.name}</span>
                            <span style={{ color: '#1a1a1a', fontWeight: 500 }}>{(p.qty || 0).toLocaleString()}</span>
                          </div>
                        ))}
                        {ex.products.length > 5 && <div style={{ padding: '3px 0', color: '#999' }}>{t.more(ex.products.length - 5)}</div>}
                      </div>
                    </div>
                  );
                })}

                {/* Total mismatch warning */}
                {mismatches.length > 0 && (
                  <div style={{ marginTop: '1.5rem', background: '#fee', border: '1px solid #f8b4b4', borderRadius: 10, padding: '1rem 1.25rem' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#9b1c1c', marginBottom: 4 }}>{t.mismatchPanel}</div>
                    <div style={{ fontSize: 12, color: '#9b1c1c', marginBottom: 10 }}><NoticeText text={t.mismatchPanelSub} /></div>
                    {mismatches.map((m, idx) => {
                      const diff = m.computed - m.expected;
                      const fmt = (n) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
                      const ovKey = `${m.country}|${m.invoice}`;
                      const overridden = mismatchOverrides.has(ovKey);
                      return (
                        <div key={idx} style={{ background: '#fff', border: '1px solid ' + (overridden ? '#b8e0c8' : '#f8b4b4'), borderRadius: 8, padding: '10px 12px', marginBottom: 6, fontSize: 12 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, gap: 8 }}>
                            <div style={{ fontWeight: 600 }}>{m.country} · Invoice {m.invoice}</div>
                            {!overridden ? (
                              <button onClick={() => {
                                const next = new Set(mismatchOverrides);
                                next.add(ovKey);
                                setMismatchOverrides(next);
                              }} style={{ padding: '3px 10px', fontSize: 11, borderRadius: 6, border: '1px solid #9b1c1c', background: '#fff', color: '#9b1c1c', cursor: 'pointer', fontWeight: 500 }}>
                                {t.mismatchUnblock}
                              </button>
                            ) : (
                              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#057a55', fontWeight: 500 }}>
                                {t.mismatchUnblocked}
                                <button onClick={() => {
                                  const next = new Set(mismatchOverrides);
                                  next.delete(ovKey);
                                  setMismatchOverrides(next);
                                }} style={{ padding: '2px 8px', fontSize: 10, borderRadius: 6, border: '1px solid #057a55', background: '#fff', color: '#057a55', cursor: 'pointer' }}>↺</button>
                              </span>
                            )}
                          </div>
                          <div style={{ color: "#555" }}>
                            <NoticeText text={t.mismatchRow(fmt(m.computed), fmt(m.expected), fmt(diff))} />
                            <strong style={{ color: "#9b1c1c" }}>{diff > 0 ? "+" : ""}{fmt(diff)}</strong>
                          </div>
                          {m.missingTotalValue && <div style={{ marginTop: 6, color: '#92400e', background: '#fef3c7', border: '1px solid #f5d97a', borderRadius: 4, padding: '4px 8px', fontSize: 11 }}>{t.mismatchFallback}</div>}
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* Pending decisions panel */}
                {pending.length > 0 && (
                  <div style={{ marginTop: '1.5rem', background: '#eef6ff', border: '1px solid #c3d3fb', borderRadius: 10, padding: '1rem 1.25rem' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#1a56db', marginBottom: 4 }}>{t.pendingPanel(pending.length)}</div>
                    <div style={{ fontSize: 12, color: '#1a56db', marginBottom: 10 }}><NoticeText text={t.pendingPanelSub} /></div>
                    {pending.map((nm, idx) => (
                      <PendingItem
                        key={idx}
                        nm={nm}
                        catalogItems={(catalog && catalog.byCountry && catalog.byCountry[country]) || []}
                        onConfirm={confirmAlias}
                      />
                    ))}
                  </div>
                )}

                {/* No-matches panel */}
                {allNoMatches.length > 0 && (
                  <div style={{ marginTop: '1rem', background: '#fef3c7', border: '1px solid #f5d97a', borderRadius: 10, padding: '1rem 1.25rem' }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: '#92400e', marginBottom: 4 }}>{t.noMatchPanel(allNoMatches.length)}</div>
                    <div style={{ fontSize: 12, color: '#92400e', marginBottom: 10 }}><NoticeText text={t.noMatchPanelSub} /></div>
                    {allNoMatches.map((nm, idx) => (
                      <NoMatchItem
                        key={idx}
                        nm={nm}
                        catalogItems={(catalog && catalog.byCountry && catalog.byCountry[country]) || []}
                        onConfirm={confirmAlias}
                      />
                    ))}
                  </div>
                )}

                {/* Aliases footer + manager */}
                {(() => {
                  const userEntries = Object.entries(aliases).filter(([k, v]) => ALL_SEED_ALIASES[k] !== v);
                  const seedCount = Object.keys(ALL_SEED_ALIASES).length;
                  return (
                    <div style={{ marginTop: '1rem' }}>
                      <div style={{ fontSize: 11.5, color: '#888', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{t.aliasFooter(seedCount, userEntries.length)}</span>
                        <div style={{ display: 'flex', gap: 10 }}>
                          {userEntries.length > 0 && (
                            <button onClick={() => setShowAliasManager(v => !v)} style={{ background: 'none', border: 'none', color: '#1a56db', cursor: 'pointer', fontSize: 11.5, padding: 0, textDecoration: 'underline' }}>
                              {showAliasManager ? t.aliasManagerClose : t.aliasManage} ({userEntries.length})
                            </button>
                          )}
                          {userEntries.length > 0 && (
                            <button onClick={clearAliases} style={{ background: 'none', border: 'none', color: '#c81e1e', cursor: 'pointer', fontSize: 11.5, padding: 0, textDecoration: 'underline' }}>{t.aliasClear}</button>
                          )}
                        </div>
                      </div>
                      {showAliasManager && (
                        <div style={{ marginTop: 10, border: '1px solid #e8e8e4', borderRadius: 10, overflow: 'hidden' }}>
                          <div style={{ background: '#f5f5f2', padding: '10px 14px', borderBottom: '1px solid #e8e8e4' }}>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{t.aliasManagerTitle}</div>
                            <div style={{ fontSize: 11.5, color: '#888', marginTop: 2 }}>{t.aliasManagerSub}</div>
                          </div>
                          {userEntries.length === 0 ? (
                            <div style={{ padding: '14px', fontSize: 12, color: '#aaa', textAlign: 'center' }}>{t.aliasManagerEmpty}</div>
                          ) : (
                            <div>
                              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, padding: '7px 14px', background: '#fafaf8', borderBottom: '1px solid #e8e8e4', fontSize: 10.5, fontWeight: 600, color: '#999', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                                <span>{t.aliasManagerInvoice}</span><span>{t.aliasManagerCatalog}</span><span></span>
                              </div>
                              {userEntries.map(([key, catalogName]) => {
                                const isSeedOverride = ALL_SEED_ALIASES[key] !== undefined;
                                return (
                                  <div key={key} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, padding: '8px 14px', borderBottom: '1px solid #f0f0ee', alignItems: 'center', fontSize: 12 }}>
                                    <div style={{ color: '#555', wordBreak: 'break-word' }}>
                                      {key}
                                      {isSeedOverride && <span style={{ marginLeft: 5, fontSize: 10, padding: '1px 5px', borderRadius: 10, background: '#fef3c7', color: '#92400e', border: '1px solid #f5d97a' }}>{t.aliasManagerSeed}</span>}
                                    </div>
                                    <div style={{ color: '#1a1a1a', fontWeight: 500, wordBreak: 'break-word' }}>→ {catalogName}</div>
                                    <button onClick={() => deleteAlias(key)} style={{ padding: '3px 9px', fontSize: 11, borderRadius: 6, border: '1px solid #f8b4b4', background: '#fde8e8', color: '#c81e1e', cursor: 'pointer', whiteSpace: 'nowrap', fontWeight: 500 }}>{t.aliasManagerDelete}</button>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          <div style={{ padding: '8px 14px', borderTop: '1px solid #e8e8e4', textAlign: 'right' }}>
                            <button onClick={() => setShowAliasManager(false)} style={{ padding: '4px 12px', fontSize: 12, borderRadius: 6, border: '1px solid #ddd', background: '#fff', cursor: 'pointer', color: '#555' }}>{t.aliasManagerClose}</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>
            )}
          </>
        )}
        </fieldset>
      </div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}} .packing-tool-card *{box-sizing:border-box} .packing-tool-card{overflow-wrap:anywhere} @media(max-width:600px){.packing-tool-card{padding:12px!important}}`}</style>
    </div>
  );
}
