// Pure i18n dictionaries, country tile metadata, AWB/date helpers, and legacy China review predicates
import { parseAwbFields } from '../importAwbFields.js';
import { pendingManifestIssues } from '../packingManifestReconciliation.js';
import { packingAmountIssues } from '../packingAmountReview.js';
import { blockingPackingIssues } from '../packingReceiptDatePolicy.js';

// Additional UI copy; document data, country keys and workbook labels stay unchanged.
const UI_COPY = {
  candidates: ["추천 후보","Suggested matches","Candidatos"],
  confirmMatch: ["이 품목으로 확인","Confirm match","Esta es"],
  searchFallback: ["후보가 맞지 않으면 카탈로그에서 검색","Search catalog if no candidate fits","Buscar en el catálogo si ninguno es correcto..."],
  searchCatalog: ["카탈로그 품목 검색","Search catalog","Buscar en el catálogo..."],
  noResults: ["검색 결과가 없습니다.","No results","Sin resultados"],
  awbTitle: ["AWB · 항공 운송장","AWB · Air Waybill","AWB · Guía aérea"],
  awbSub: ["항공 운송료 패킹 리스트 · 로컬 처리, AI 호출 없음","Air freight packing list · local processing, no AI call","Packing list aéreo · proceso local, sin IA"],
  awbUpload: ["AWB PDF 업로드 (선택)","AWB PDF upload (optional)","PDF del AWB (opcional)"],
  awbDrop: ["또는 AWB PDF를 끌어 놓으세요 · 자동 입력 후 확인","or drop an AWB PDF here · review auto-filled fields","o arrastra el PDF del AWB aquí (intenta auto-rellenar)"],
  pdfLimit: ["PDF 최대 20MiB","PDF up to 20MiB","PDF: máximo 20MiB."],
  pdfOnly: ["PDF 파일만 지원합니다.","Only PDF files are accepted.","Solo se aceptan archivos PDF."],
  pdfReading: ["PDF 읽는 중…","Reading PDF…","Leyendo PDF…"],
  pdfReadError: ["PDF를 읽지 못했습니다.","Could not read PDF.","Error leyendo PDF."],
  localReaderUnavailable: ["로컬 PDF 리더를 사용할 수 없습니다. 직접 입력하세요.","Local PDF reader unavailable. Fill in the fields manually.","Lector PDF local no disponible. Rellena los campos manualmente."],
  week: ["주차","Week","Semana"],
  date: ["문서 날짜","Document date","Fecha"],
  company: ["운송사","Carrier","Compañía"],
  total: ["합계","Total","Total"],
  unitPrice: ["운송료 단가","Freight unit price","U.Price"],
  awbForm: ["운송장 정보","Air waybill details","Datos del AWB"],
  manageCompanies: ["운송사 관리","Manage carriers","Gestionar compañías"],
  newCompany: ["새 운송사 (예: KOREAN AIR)","New carrier (e.g. KOREAN AIR)","Nueva compañía (ej. KOREAN AIR)"],
  add: ["추가","Add","Añadir"],
  invoice: ["인보이스 번호","Invoice #","Invoice #"],
  weights: ["중량 및 운송료","Weights and charges","Pesos y total"],
  gwLabel: ["총중량 (GW) · kg","Gross weight (GW) · kg","GW (Gross Weight) — kg"],
  cwLabel: ["운임 적용 중량 (CW) · kg","Chargeable weight (CW) · kg","CW (Chargeable Weight) — kg"],
  priceLabel: ["운송료 1 단가 · USD/kg","Line 1 unit price · USD/kg","U.Price línea 1 (운송료) — USD/kg"],
  totalLabel: ["인보이스 합계 · USD","Invoice total · USD","Total invoice — USD"],
  previewCharges: ["패킹 리스트 운송료 미리보기","Packing list charges preview","Cómo quedará en el packing list:"],
  charge1: ["운송료 1","Freight line 1","운송료 #1"],
  charge2: ["운송료 2","Freight line 2","운송료 #2"],
  validationTitle: ["다음 항목을 확인해야 생성할 수 있습니다.","Complete these fields before generating:","No se puede generar todavía:"],
  companyRequired: ["운송사를 선택하세요.","Carrier is required.","Compañía obligatoria."],
  weekRequired: ["주차를 입력하세요 (예: 21-01).","Week is required (e.g. 21-01).","Semana obligatoria (ej. 21-01)."],
  awbRequired: ["AWB 번호를 입력하세요.","AWB number is required.","Número de AWB obligatorio."],
  dateRequired: ["문서 날짜를 입력하세요 (YYYY/MM/DD).","Document date is required (YYYY/MM/DD).","Fecha del documento obligatoria (YYYY/MM/DD)."],
  gwRequired: ["총중량 (GW)을 입력하세요.","Gross weight (GW) is required.","GW (Gross Weight) obligatorio."],
  cwRequired: ["운임 적용 중량 (CW)을 입력하세요.","Chargeable weight (CW) is required.","CW (Chargeable Weight) obligatorio."],
  totalRequired: ["인보이스 합계 (USD)를 입력하세요.","Invoice total (USD) is required.","Total (USD) obligatorio."],
  priceRequired: ["운송료 1 단가를 입력하세요.","Line 1 unit price is required.","U.Price línea 1 obligatorio."],
  negativeCharge: ["운송료 2가 음수입니다. 운송료 1 단가를 낮추세요.","Line 2 is negative. Reduce the line 1 unit price.","U.Price línea 1 demasiado alto: deja la línea 2 negativa. Bájalo."],
  noFields: ["인식된 항목이 없습니다. 직접 입력하세요.","No fields recognized. Fill in the form manually.","PDF leído pero no se reconocieron campos. Rellena el formulario manualmente."],
  autoFilled: ["자동 입력됨 · 나머지 항목을 입력하고 값을 확인하세요","Auto-filled · review values and complete remaining fields","Auto-rellenado · revísalo y completa lo demás"],
  weekFromFile: ["파일명에서 읽은 주차","Week read from filename","Semana leída del nombre del archivo"],
  totalMismatch: ["합계 불일치","Total mismatch","Total no coincide"],
  multiFarm: ["여러 농장 인보이스","Multi-farm invoices","Invoices de varias fincas"],
  autoSupplier: ["인보이스별 공급업체 자동 감지","Auto-detects supplier per invoice","Detecta proveedor por invoice"],
  autoFarm: ["인보이스별 농장 자동 감지","Auto-detects farm per invoice","Detecta finca por invoice"],
  perInvoice: ["인보이스별 패킹 리스트 생성","One packing list per invoice","Un packing list por invoice"],
  awbTile: ["항공 운송료 · EXCEL, FREIGHTWISE","Air freight · EXCEL, FREIGHTWISE","Aviones — EXCEL, FREIGHTWISE"],
  awbBadge: ["운송장","Air waybill","AWB"],
  localMode: ["Claude API 분석 · 저장 결과·완료 구간 재사용 · 실패 시 자동 재호출 없음","Claude API analysis · reuse saved results · no automatic retry","Análisis Claude API · reutilizar resultados · sin reintento automático"],
  noMatchesFile: ["Excel에 유효한 매칭이 없습니다.","No valid matches in Excel.","No hay matches válidos en Excel."],
  noInvoices: ["PDF에서 인보이스를 찾지 못했습니다.","No invoices found in PDF","No se encontraron invoices en PDF"],
  errorPrefix: ["오류: ","Error: ","Error: "],
  countryNames: [{"NL":"네덜란드","CN":"중국","CO":"콜롬비아","EC":"에콰도르","TH":"태국","AU":"호주","US":"미국","VN":"베트남"},{"NL":"Netherlands","CN":"China","CO":"Colombia","EC":"Ecuador","TH":"Thailand","AU":"Australia","US":"USA","VN":"Vietnam"},{"NL":"Países Bajos","CN":"China","CO":"Colombia","EC":"Ecuador","TH":"Tailandia","AU":"Australia","US":"EE. UU.","VN":"Vietnam"}],
};
function packingText(lang) {
  const index = lang === 'en' ? 1 : lang === 'es' ? 2 : 0;
  return Object.fromEntries(Object.entries(UI_COPY).map(([key, values]) => [key, values[index]]));
}

// =============================================================================
// i18n — UI strings for English (en), Spanish (es), Korean (ko)
// =============================================================================
const I18N = {
  en: {
    pdfNotice: 'PDF up to 20MiB. Reuse saved results and completed segments, then analyze with Claude API (fees may apply). No automatic retry. ERP registration requires the receipt registration action.',
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
    pdfNotice: 'PDF hasta 20MiB. Reutiliza resultados y segmentos guardados; análisis Claude API con posible coste. Sin reintento automático. El registro ERP requiere confirmación.',
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
    pdfNotice: 'PDF 최대 20MiB. 기존 결과와 완료 구간을 먼저 재사용하고 Claude API로 분석합니다(비용 발생 가능). 실패 시 자동 재호출하지 않습니다. 입고등록 전 ERP 원장은 변경하지 않습니다.',
    localUnavailable: '이 양식은 무료 분석으로 전체 값을 검증하지 못했습니다. 필요하면 AI 분석을 선택하세요(비용 발생 가능).',
    aiAnalyze: 'AI 분석 (비용 발생 가능)', sourceLocal: '코드 분석 · AI 호출 없음', sourceCache: '기존 분석 재사용 · 새 AI 호출 없음', sourceAI: 'AI 분석 완료', cacheNotSaved: '결과 캐시 저장 안 됨 · 재시도 시 비용 발생 가능',
    reload: '공동 데이터 다시 불러오기', saving: '공동 데이터 저장 중…',
    sharedFailure: '공동 저장/불러오기 실패. 다시 불러온 뒤 재시도하세요.',
    appTitle: '패킹 리스트 생성기', appSub: '네노바 수입부',
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
    aliasManagerCatalog: '카탈로그 이름', aliasManagerDelete: '삭제', aliasManagerClose: '닫기', aliasManagerSeed: '기본 별칭 수정',
    steps: ['인보이스 읽는 중', '추출값 검증 중', '엑셀 파일 생성 중'],
    products: (n) => `${n}개 상품`, stems: '줄기', more: (n) => `+ ${n}개 더`,
    summaryOk: '✅ 모두 정상 -- 다운로드 준비 완료.',
    summaryTruncated: ' ⚠ PDF가 너무 커서 응답이 잘렸습니다 -- 일부 인보이스가 누락되었을 수 있습니다. 다시 처리하거나 PDF를 분할하세요.',
    summaryPending: (n) => ` 🔒 미확인 품종 ${n}개 -- 다운로드 차단.`,
    summaryNoMatch: (n) => ` 🔒 일치 없음 ${n}개 -- 다운로드 차단.`,
    summaryMismatch: (n) => ` ⚠ 합계 불일치 패킹 리스트 ${n}개 -- 발송 전 확인.`,
    errWeek: (name) => `파일명에 주차 번호가 포함되어야 합니다 (예: "16-2 Hortensias.pdf"). 받은 값: ${name}`,
    matchesTitle: '매칭(별칭)', matchesImport: '엑셀 가져오기', matchesExport: '엑셀 내보내기',
    matchesImported: (n) => `엑셀에서 매칭 ${n}개를 가져왔습니다.`,
    matchesCount: (total, base) => `매칭 ${total}개 로드됨${base ? ` · 기본 ${base}개` : ''}`,
  },
};

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

async function parseAWBPdf(pdfBase64, readAwbPdf, t) {
  try {
    if (!readAwbPdf) return { _error: t.localReaderUnavailable };
    return parseAwbFields(await readAwbPdf(pdfBase64));
  } catch (e) {
    return { _error: t.pdfReadError + ' ' + e.message };
  }
}

function seoulCalendarDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

const EMPTY_RECEIPT_ITEMS=Object.freeze([]);
const LEGACY_CN_REVIEW_STATUS = 'LEGACY_CN_REVIEW_REQUIRED';
const LEGACY_CN_REVIEW_MESSAGE = '구형 중국 인보이스는 행별 단위·PCS·송이 및 통화를 확인하고, 이어서 중량·운송비 검토를 마쳐야 생성할 수 있습니다.';
const isLegacyChinaInvoice = invoice => invoice?.source_format === 'china_legacy_invoice_xlsx'
  || (invoice?.source_format !== 'china_legacy_invoice_reviewed' && (invoice?.legacyReviewRequired === true
    || invoice?.reviewStatus === LEGACY_CN_REVIEW_STATUS));
function unresolvedExtractionIssues(invoices = [], result = null) {
  const issues = [
    ...pendingManifestIssues(result),
    ...(result?.amount_review_country==='CO'?packingAmountIssues(result):[]),
    ...(Array.isArray(result?.extractionIssues) ? result.extractionIssues : []),
    ...(Array.isArray(result?.extraction_issues) ? result.extraction_issues : []),
    ...invoices.flatMap(invoice => [
      ...(Array.isArray(invoice?.extractionIssues) ? invoice.extractionIssues : []),
      ...(Array.isArray(invoice?.extraction_issues) ? invoice.extraction_issues : []),
    ]),
  ];
  // Source/AI status flags are not proof that a validation issue was cleared.
  // Only the canonical reviewer may remove a resolved issue from the array.
  return blockingPackingIssues(issues);
}
function inlineJsonPayload(data) {
  if (!Array.isArray(data?.content)) return null;
  const text = data.content.filter(block => block?.type === 'text').map(block => block.text || '').join('');
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try { return JSON.parse(text.slice(start, end + 1)); } catch { return null; }
}
function chinaLegacyReviewPayload(data, result = null) {
  const envelope = inlineJsonPayload(data);
  const direct = data?.legacyReview || data?.legacy_review || data?.reviewOnly || data?.review_only
    || envelope?.legacyReview || envelope?.legacy_review || envelope?.reviewOnly || envelope?.review_only
    || data;
  const invoices = result?.invoices || direct?.invoices || envelope?.invoices || [];
  const marked = String(direct?.status || direct?.reviewStatus || envelope?.status || envelope?.reviewStatus || '').toUpperCase() === LEGACY_CN_REVIEW_STATUS
    || direct?.legacyReviewRequired === true || envelope?.legacyReviewRequired === true
    || invoices.some(isLegacyChinaInvoice);
  if (!marked) return null;
  return {
    ...direct,
    status: LEGACY_CN_REVIEW_STATUS,
    invoices,
    reviewRows: direct?.reviewRows || direct?.review_rows || direct?.rows
      || envelope?.reviewRows || envelope?.review_rows || envelope?.rows || null,
    extractionIssues: direct?.extractionIssues || direct?.extraction_issues
      || envelope?.extractionIssues || envelope?.extraction_issues || result?.extractionIssues || [],
  };
}

const PACKING_COUNTRIES_META = [
  { code: 'NL', flag: '🇳🇱', name: 'Netherlands', desc: 'Holex · EZ Flower' },
  { code: 'CN', flag: '🇨🇳', name: 'China', desc: 'Hubfresh · Melody · Cloudland' },
  { code: 'CO', flag: '🇨🇴', name: 'Colombia', desc: 'Multi-farm invoices' },
  { code: 'EC', flag: '🇪🇨', name: 'Ecuador', desc: 'La Rosaleda' },
  { code: 'TH', flag: '🇹🇭', name: 'Thailand', desc: 'Krung · Super Fresh' },
  { code: 'AU', flag: '🇦🇺', name: 'Australia', desc: 'Premium Greens' },
  { code: 'US', flag: '🇺🇸', name: 'USA', desc: 'Hood Canal Evergreens' },
  { code: 'VN', flag: '🇻🇳', name: 'Vietnam', desc: 'Royal Base Corporation' },
];

function buildPackingCountryView(country, t) {
  const countryLabels = PACKING_COUNTRIES_META.map(c => ({ ...c, name: t.countryNames[c.code], desc: c.code === 'CO' ? t.multiFarm : c.desc }));
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
  if (cfg) {
    cfg[1] = t.countryNames[country] + ' · ' + PACKING_COUNTRIES_META.find(c => c.code === country).desc.replace('Multi-farm invoices', t.multiFarm);
    cfg[2] = ['NL', 'CN', 'TH'].includes(country) ? t.autoSupplier : country === 'CO' ? t.autoFarm : t.perInvoice;
  }
  return { countryLabels, cfg };
}

export {
  UI_COPY,
  packingText,
  I18N,
  findWeightRow,
  detectAWBCompany,
  parseAWBPdf,
  seoulCalendarDate,
  EMPTY_RECEIPT_ITEMS,
  LEGACY_CN_REVIEW_STATUS,
  LEGACY_CN_REVIEW_MESSAGE,
  isLegacyChinaInvoice,
  unresolvedExtractionIssues,
  inlineJsonPayload,
  chinaLegacyReviewPayload,
  PACKING_COUNTRIES_META,
  buildPackingCountryView,
};
