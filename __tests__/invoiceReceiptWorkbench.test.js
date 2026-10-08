const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const babel = require('next/dist/compiled/babel/core');

const root = path.join(__dirname, '..');
const componentPath = path.join(root, 'components/import-tools/InvoiceReceiptWorkbench.js');
const source = fs.readFileSync(componentPath, 'utf8');
const adapterSource = fs.readFileSync(path.join(root, 'lib/importPackingReceiptAdapter.js'), 'utf8');
const workflowSource = fs.readFileSync(path.join(root, 'lib/invoiceReceiptWorkflow.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles/InvoiceReceipt.module.css'), 'utf8');
const packingSource = fs.readFileSync(path.join(root, 'components/import-tools/PackingListTool.js'), 'utf8');
const pageSource = fs.readFileSync(path.join(root, 'pages/import/tools.js'), 'utf8');

test('component compiles and is connected only through the bounded packing source props', () => {
  babel.transformSync(source, {
    filename: componentPath,
    presets: [require('next/dist/compiled/babel/preset-react')],
    configFile: false,
    babelrc: false,
  });
  assert.match(packingSource, /onReceiptSourceChange\(\{[\s\S]*?excels,[\s\S]*?invoices:\s*lastExtraction\.result\.invoices,[\s\S]*?country,[\s\S]*?file,[\s\S]*?products:\s*erpMatches\.products,[\s\S]*?reviewConfirmed,[\s\S]*?truncated:/);
  assert.match(pageSource, /<InvoiceReceiptWorkbench \{\.\.\.receiptSource\}\/>/);
  assert.doesNotMatch(pageSource, /receiptSource&&<InvoiceReceiptWorkbench/);
  assert.match(pageSource, /EMPTY_RECEIPT_SOURCE=Object\.freeze/);
  assert.match(pageSource, /입고 등록은 초안·미리보기·명시 확인 후에만 실행/);
  assert.match(source, /import InvoiceReceiptCostReview from '\.\/InvoiceReceiptCostReview\.js'/);
});

test('cost review is gated by a committed operation for the current revision and refreshes after save', () => {
  assert.match(source, /operation\.status === 'COMMITTED'/);
  assert.match(source, /Number\(operation\.documentRevision\) === Number\(documentValue\.revision\)/);
  assert.match(source, /currentRevisionCommitted = !selected\.dirty/);
  assert.match(source, /committedOperations\.length > 0 && \(selected\.dirty \|\| !currentRevisionCommitted\)/);
  assert.match(source, /currentRevisionCommitted[\s\S]*?<InvoiceReceiptCostReview document=\{documentValue\} onSaved=\{refreshAfterCostSave\}[\s\S]*?autoProcess=\{receiptReadbackPassed\} onStageChange=\{onCostStageChange\} \/>/);
  assert.match(source, /refreshAfterCostSave[\s\S]*?readDocument\(documentId\)[\s\S]*?if \(!isCurrent\(\)\) return;[\s\S]*?installSavedDocument\(refreshed\)/);
  assert.match(source, /도착원가 PENDING/);
  assert.match(source, /도착원가 STALE/);
  assert.match(source, /입고 확정 후 문서가 편집되어 이전 원가는 현재 revision에 적용되지 않습니다/);
});

test('source hash and stable identities come from original File bytes, not generated workbook buffers', () => {
  assert.match(source, /sha256File\(file\)/);
  assert.match(adapterSource, /file\.arrayBuffer\(\)/);
  assert.match(adapterSource, /subtle\.digest\('SHA-256'/);
  assert.match(adapterSource, /invoice-receipt-line/);
  assert.doesNotMatch(adapterSource, /generated\?\.qty|generated\.qty/);
});

test('draft, preview, commit and operation recovery follow the connected API contract', () => {
  assert.match(source, /'\/api\/import\/receipts\/drafts'/);
  assert.match(source, /`\/api\/import\/receipts\/\$\{target\.document\.documentId\}`/);
  assert.match(source, /`\/api\/import\/receipts\/\$\{target\.document\.documentId\}\/preview`/);
  assert.match(source, /body:\s*JSON\.stringify\(\{\s*revision:\s*target\.document\.revision\s*\}\)/);
  assert.match(source, /`\/api\/import\/receipts\/\$\{pending\.documentId\}\/commit`/);
  for (const field of ['operationId', 'receiptPartId', 'baselineDigest', 'reason', 'allowPendingCost']) {
    assert.match(source + adapterSource, new RegExp(`\\b${field}\\b`));
  }
  assert.match(adapterSource, /allowPendingCost:\s*true/);
  assert.match(source, /`\/api\/import\/receipts\/operations\/\$\{pending\.operationId\}`/);
  assert.match(source, /storePendingOperation\(selected\.document\.documentId, operation\)[\s\S]*?submitReceiptCommit\(operation\)/,
    'operation identity must be persisted before commit fetch');
  assert.match(source, /buildReceiptCommitPending\(\{[\s\S]*?document: selected\.document, preview: selected\.preview, reason, operationId, receiptPartId/);
  assert.match(source, /submitReceiptCommit\(operation\)/);
  assert.match(source, /submitReceiptCommit\(pending\)/);
  assert.match(source, /error\.httpStatus = response\.status/);
  assert.match(source, /error\.resultUnknown = data\?\.resultUnknown/);
  assert.match(source, /isVerifiedReceiptCommitRejection\(error\)/);
  assert.match(source, /invalidatePreview: true/);
  assert.match(source, /같은 작업 다시 확인·재시도/);
  assert.match(source, /if \(data\.operation\)[\s\S]*?return;[\s\S]*?submitReceiptCommit\(pending\)/,
    'a found in-flight operation must not be resent; a null readback may retry only the saved request');
  assert.match(source, /결과가 확정되지 않아 원래 요청 전체와 같은 operationId를 보존했습니다/);
  assert.doesNotMatch(source, /\/api\/warehouse/);
});

test('receipt revisions reuse the latest committed receipt part and only initial commits create one', () => {
  assert.match(source, /receiptPartIdForCommit,/);
  assert.match(source, /const receiptPartId = receiptPartIdForCommit\(selected\.document, newUuid\)/);
  assert.doesNotMatch(source, /receiptPartId:\s*newUuid\(\)/);
});

test('commit stays gated by saved clean preview with zero issues and explicit reason dialog', () => {
  assert.match(source, /!record\.dirty/);
  assert.match(source, /record\.preview\?\.canCommit === true/);
  assert.match(source, /issues\.length === 0/);
  assert.match(source, /disabled=\{!confirmReason\.trim\(\)\}/);
  assert.match(source, /Warehouse와 재고에 영향을 줍니다/);
  assert.match(source, /분석 완료는 입고 완료가 아닙니다/);
  assert.match(source, /ERP 입고가 등록된 상태가 아닙니다/);
  assert.match(source, /preview\?\.lines/);
  assert.match(source, /output\.outQuantity/);
  assert.match(source, /output\.outUnit/);
  assert.match(source, /재고 반영은 원시 박스·단·송이가 아니라 서버 미리보기/);
});

test('workbench exposes editable raw quantities, explicit metadata, saved history and safe issue copy', () => {
  for (const token of ['boxQuantity', 'bunchQuantity', 'stemQuantity', 'priceUnit', 'unitPrice', 'currency', 'lineAmount']) {
    assert.match(source, new RegExp(token));
  }
  for (const label of ['입고 연도', '세부차수', '농장 선택', '인보이스 연도', '입고일', 'GW', 'CW', '운임 통화']) {
    assert.ok(source.includes(label), `missing ${label}`);
  }
  assert.match(source, /\/api\/arrival-cost\?lookup=farms/);
  assert.match(source, /같은 연도·세부차수 저장 문서/);
  assert.match(source, /documentValue\.history/);
  assert.match(source, /navigator\.clipboard\.writeText/);
  assert.match(source, /<textarea ref=\{copyRef\} readOnly value=\{issueBrief\}/);
  assert.match(source, /ERP 헤더 FreightRate \(USD\/kg\)/);
  assert.match(source, /운송·부대비 총액 \(원가\)/);
  assert.match(source, /type="search" list="invoice-receipt-products"/);
  assert.match(source, /productByLabel\.get\(value\)/);
  assert.match(source, /productSearch: value, prodKey: product \? Number\(product\.ProdKey\) : null/);
  assert.match(source, /committedLineIds\.has\(line\.lineId\)/);
  assert.match(source, /확정 입고 행의 품목은 변경할 수 없습니다/);
  assert.doesNotMatch(source, /dangerouslySetInnerHTML|innerHTML/);
});

test('saved receipt documents remain reachable without re-uploading a source file', () => {
  assert.match(source, /const EMPTY_LIST = Object\.freeze\(\[\]\)/);
  assert.doesNotMatch(source, /if \(!file \|\| !invoices\.length \|\| !excels\.length\) \{\s*setRecords\(\[\]\)/);
  assert.match(source, /aria-label="저장 인보이스 검색"/);
  assert.match(source, /저장 연도/);
  assert.match(source, /저장 세부차수/);
  assert.match(source, /setBrowseScope/);
  assert.match(source, /loadDocument\(item\.documentId\)/);
  assert.match(packingSource, /products: erpMatches\?\.products \|\| EMPTY_RECEIPT_ITEMS/);
});

test('1920 workbench is dense, scroll-safe and keeps headers and issue rail visible', () => {
  assert.match(css, /\.root\s*\{[^}]*font-size:\s*14px/s);
  assert.match(css, /\.sheetScroll\s*\{[^}]*max-width:\s*100%[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.sheet\s*\{[^}]*min-width:\s*1460px/s);
  assert.match(css, /\.sheet th\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.issues\s*\{[^}]*position:\s*sticky/s);
  assert.match(css, /\.modal\s*\{[^}]*max-height:\s*calc\(100vh - 48px\)/s);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid/s);
  assert.doesNotMatch(css, /width:\s*1920px|height:\s*1080px/);
});

test('automatic receipt progress is scope-locked and never commits or approves cost', () => {
  const auto = source.slice(source.indexOf('async function runAutomaticPreparation'), source.indexOf('async function readDocument'));
  assert.match(auto, /runReceiptPreparation/);
  assert.match(auto, /previewDraft:\s*document\s*=>\s*previewDraft\(\{\s*document\s*\}\)/);
  assert.match(auto, /saveDraftRecord\(\{ \.\.\.target, document: record \}, isCurrent, false\)/);
  assert.match(auto, /assertReceiptScope\(returned, target\.document, returned\.revision\)/);
  assert.match(auto, /sameRevision && result\.preview/);
  assert.match(auto, /Number\(returned\.revision\) > 0/);
  assert.match(auto, /result\.stage === 'draft' && result\.status === 'UNKNOWN'/);
  assert.doesNotMatch(auto, /result\.stage === 'draft' && result\.status === 'FAILED'/);
  assert.doesNotMatch(auto, /commitReceipt\(|submitReceiptCommit\(|cost-revisions/);
  assert.match(source, /event\.documentId !== documentId/);
  assert.match(source, /event\.revision/);
  assert.match(source, /setBusy\('auto-workflow'\)/);
  assert.match(source, /<fieldset disabled=\{Boolean\(busy\)\}/);
  assert.match(source, /verifyReceiptDocument\(fresh, \{ \.\.\.expected, operationId: pending\.operationId/);
  assert.match(source, /if \(verified\.operation\.operationId !== pending\.operationId/);
  assert.match(source, /if \(!isCurrent\(\)\) return;\s+installSavedDocument\(fresh\)/);
  assert.match(source, /const sameRevision = existing[\s\S]*existing\.stageProgress/);
  assert.match(source, /conversion: \{ id: 'conversion', status: 'waiting', displayStatus: '기존 문서'/);
  assert.match(source, /draft: \{ id: 'draft', status: 'passed'/);
  assert.match(source, /validation: \{ id: 'validation', status: 'waiting', displayStatus: '미리보기 필요'/);
  assert.match(source, /현재 revision의 COMMITTED operation 확인/);
  assert.match(source, /const isCurrent = \(\) => workflowGenerationRef\.current === generation && selectedIdRef\.current === documentId/);
  assert.match(source, /if \(!isCurrent\(\)\) return;\s+installSavedDocument\(fresh\)/);
  assert.match(source, /error\.staleWorkflowResponse/);
  assert.match(source, /refreshError\.receiptReadbackFailure = true/);
  const readbackRetry = source.slice(source.indexOf('async function retryReceiptReadback'), source.indexOf('async function copyBrief'));
  assert.doesNotMatch(readbackRetry, /submitReceiptCommit\(/);
  assert.match(readbackRetry, /readDocument\(pending\.documentId\)/);
  assert.match(readbackRetry, /clearPendingCommit\(pending\.documentId\)/);
  assert.match(workflowSource, /result\.documentId\) !== key\(document\.documentId\)/);
  assert.match(workflowSource, /Number\(result\.revision\) !== Number\(document\.revision\)/);
  assert.match(workflowSource, /draftSaveAttempted/);
});

test('definite automatic draft rejection stays editable; manual-save recovery lock is unknown-only', () => {
  const auto = source.slice(source.indexOf('async function runAutomaticPreparation'), source.indexOf('async function readDocument'));
  const manualSave = source.slice(source.indexOf('async function saveDraft()'), source.indexOf('function installSavedDocument'));
  assert.match(auto, /if \(result\.stage === 'draft' && result\.status === 'UNKNOWN'\)[\s\S]*?recoveryRequired: true/);
  assert.doesNotMatch(auto, /\['UNKNOWN', 'FAILED'\]/);
  assert.match(manualSave, /if \(error\.resultUnknown \|\| !error\.httpStatus \|\| error\.httpStatus >= 500\)[\s\S]*?recoveryRequired: true/);
  assert.match(manualSave, /setManualStage\(selected\.document\.documentId, 'draft', error\.resultUnknown \|\| !error\.httpStatus \|\| error\.httpStatus >= 500 \? 'unknown' : 'failed'/);
});

test('stage cards expose all independent workflow boundaries and cost stays gated on receipt readback', () => {
  for (const id of ['conversion', 'draft', 'validation', 'receipt', 'receiptVerify', 'cost', 'costSave', 'costVerify']) {
    assert.ok(source.includes(`'${id}'`), `missing stage ${id}`);
  }
  assert.match(source, /selected\.stageProgress\?\.receiptVerify\?\.status === 'passed'/);
  assert.match(source, /selected\.recoveryRequired\s*&&\s*<button[\s\S]*?같은 문서 다시 불러오기/);
  assert.match(source, /입고 readback만 재조회/);
  assert.match(workflowSource, /status: 'WAITING_CONFIRMATION'/);
  assert.match(workflowSource, /return \{ status: unknown \? 'UNKNOWN' : 'FAILED'/);
});

test('packing conversion mismatch requires per-row quantity review and preserves unrelated source warnings', () => {
  assert.match(source, /sourceEvidence\?\.conversionValidation\?\.status === 'MISMATCH'/);
  assert.match(source, /line\.reviewed\?\.conversionConfirmed !== true \|\| line\.reviewed\?\.confirmed !== true/);
  assert.match(source, /difference\.sourceValue/);
  assert.match(source, /difference\.generatedValue/);
  assert.match(source, /입고 \$\{quantityLabel\} 직접 입력/);
  assert.match(source, /conversionConfirmed: Boolean\(confirmed\)/);
  assert.match(source, /confirmed: false, conversionConfirmed: false/);
  assert.match(source, /disabled=\{!quantityField \|\| nullableNumber\(line\[quantityField\]\) == null\}/);
  assert.match(source, /현재 입력 수량 유지·차이 검토 확인/);
  assert.doesNotMatch(source, /conversionQuantityEdited/);
  assert.match(source, /if \(unresolvedConversionMismatchLines\(selected\.document\)\.length\)/);
  assert.match(source, /const unresolvedConversions = unresolvedConversionMismatchLines\(target\.document\)/);
  assert.match(source, /filter\(warning => warning !== CONVERSION_MISMATCH_WARNING\)/);
  assert.match(source, /unresolvedConversionMismatchLines\(document\)\.length \? \[\.\.\.warnings, CONVERSION_MISMATCH_WARNING\] : warnings/);
  assert.match(source, /GW·CW·잘림 등 다른 원문 경고는 별도 검토 전까지 유지됩니다/);
});
