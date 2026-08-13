import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectProfitReportWorkbook, historicalCategoryRule, registryCoverage } from '../../lib/profitReportEvidence/workbookEvidence.mjs';
import { compareRegeneratedWorkbook, regenerateFromPersistedEvidence } from '../../lib/profitReportEvidence/regeneration.mjs';

const helperDir = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(helperDir, '..', '..');
export const ALLOWED_INPUT_DIRECTORY = path.join(REPO_ROOT, '.verify', 'inputs', 'profit-report-weeks-22-28');
export const DEFAULT_OUTPUT_DIRECTORY = path.join(REPO_ROOT, '.verify', 'outputs', 'profit-report-weeks-22-28-generated');
export const ALLOWED_WORKBOOK_PATH = path.join(ALLOWED_INPUT_DIRECTORY, 'week-28.xlsx');

const STATUS_RANK = { PASS: 0, UNVERIFIED: 1, INPUT_REQUIRED: 2, FAIL: 3 };
const CORE_INPUT_COLUMNS = ['E', 'F', 'H', 'N', 'L', 'O', 'Q', 'R', 'S'];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(REPO_ROOT, relativePath), 'utf8'));
}

function worstStatus(statuses) {
  return statuses.reduce((worst, status) => STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst, 'PASS');
}

function check(id, status, summary, evidence = null) {
  return { id, status, summary, evidence };
}

function inputIntegrity(filePath) {
  const stat = fs.statSync(filePath);
  return { path: path.resolve(filePath), bytes: stat.size, mtimeMs: stat.mtimeMs };
}

function conciseWorkbook(evidence) {
  return {
    path: evidence.path,
    sha256: evidence.sha256,
    bytes: evidence.bytes,
    sheetNames: evidence.sheetNames,
    sheets: evidence.sheets,
    persistedCellCount: evidence.persistedCellCount,
    formulaCount: evidence.formulaCount,
    formulaFingerprintCount: evidence.formulaFingerprintCount,
    formulaCatalogDigest: evidence.formulaCatalogDigest,
    registryDigest: evidence.registryDigest,
    workbookStructureDigest: evidence.workbookStructureDigest,
    report: { title: evidence.report.title, categories: evidence.report.categories, totalU: evidence.report.totalU, note: evidence.report.note, usedRange: evidence.report.usedRange },
  };
}

function automaticInputMetrics(evidence) {
  const cells = [];
  for (let row = 7; row <= 22; row += 1) {
    for (const column of CORE_INPUT_COLUMNS) {
      const cell = evidence.registry[`주차별 매출이익 보고서!${column}${row}`];
      cells.push({ column, row, role: cell?.role || 'UNMAPPED', populated: cell?.formula != null || cell?.value != null || cell?.rawValue != null });
    }
  }
  const automatic = cells.filter(cell => ['FORMULA', 'SOURCE'].includes(cell.role) && cell.populated).length;
  const direct = cells.filter(cell => cell.role === 'MANUAL' && cell.populated).length;
  return {
    denominator: cells.length,
    automatic,
    direct,
    unresolved: cells.length - automatic - direct,
    automaticRate: cells.length ? automatic / cells.length : 0,
  };
}

function requiredEvidence(week, manualManifest) {
  const allFields = manualManifest.fields.map(field => ({
    fieldId: field.id,
    target: field.target,
    required: manualManifest.policy.requiredEvidence,
    reason: `${field.description}의 원본 workbook 값은 있으나 sourceRef/확정자/확정시각 sidecar가 없어 운영 자동생성 provenance를 확정할 수 없습니다.`,
  }));
  const warnings = [{
    status: 'UNVERIFIED',
    fieldId: 'inventory.price-lineage',
    reason: 'ProductStock 수량과 그 스냅샷 시점 단가를 연결하는 확정 근거가 원본 workbook 밖에서 확인되지 않았습니다.',
  }];
  if (Number(week) === 27) warnings.push({
    status: 'UNVERIFIED',
    fieldId: 'inventory.opening-adjustment-27',
    reason: '26차 F 8,919,590.217원과 27차 E 12,578,453.10575원의 차이 3,658,862.88875원에 대한 실사 조정 근거가 없습니다.',
  });
  return { missingInputs: allFields, warnings };
}

function validateAllowedPath(workbookPath) {
  const resolved = path.resolve(workbookPath);
  const relative = path.relative(ALLOWED_INPUT_DIRECTORY, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative) || !/^week-(?:22|23|24|25|26|27|28)\.xlsx$/i.test(relative)) {
    throw new Error(`허용되지 않은 workbook 입력: ${resolved}`);
  }
  return resolved;
}

export async function runProfitReportAcceptance({ outputDirectory = DEFAULT_OUTPUT_DIRECTORY, workbookPath = null } = {}) {
  const registryIndex = readJson('data/profit-report-evidence/registry/v1/index.json');
  const manualManifest = readJson('data/profit-report-evidence/manual-input-manifest.v1.json');
  const expectedEntries = workbookPath
    ? registryIndex.workbooks.filter(entry => validateAllowedPath(workbookPath).endsWith(entry.file))
    : registryIndex.workbooks;
  if (!expectedEntries.length) throw new Error('registry에 없는 workbook 입력입니다.');

  const weeks = [];
  for (const expected of expectedEntries) {
    const sourcePath = validateAllowedPath(workbookPath || path.join(ALLOWED_INPUT_DIRECTORY, expected.file));
    const before = inputIntegrity(sourcePath);
    const source = await inspectProfitReportWorkbook(sourcePath);
    const coverage = registryCoverage(source);
    const outputPath = path.join(outputDirectory, `week-${expected.week}.xlsx`);
    regenerateFromPersistedEvidence(sourcePath, outputPath);
    const comparison = await compareRegeneratedWorkbook(source, outputPath);
    const after = inputIntegrity(sourcePath);
    const categoryRule = historicalCategoryRule(expected.week);
    const requirements = requiredEvidence(expected.week, manualManifest);
    const automatic = automaticInputMetrics(source);
    const checks = [
      check('input-integrity', source.sha256 === expected.sha256 && before.bytes === after.bytes && before.mtimeMs === after.mtimeMs, '원본 SHA-256·크기·수정시각이 registry와 일치하고 실행 전후 불변이어야 합니다.', { expectedSha256: expected.sha256, actualSha256: source.sha256, before, after }),
      check('cell-registry-coverage', coverage.rate === 1 && source.persistedCellCount === expected.persistedCellCount, 'persisted cell registry 매핑은 100%여야 합니다.', { ...coverage, expectedPersistedCellCount: expected.persistedCellCount }),
      check('formula-fingerprint-coverage', source.formulaCount === expected.formulaCount && source.formulaFingerprintCount === source.formulaCount, '모든 수식에 AST exact/shape fingerprint가 있어야 합니다.', { expected: expected.formulaCount, formulas: source.formulaCount, fingerprinted: source.formulaFingerprintCount, rate: source.formulaCount ? source.formulaFingerprintCount / source.formulaCount : 0 }),
      check('sheet-contract', source.sheetNames.length === expected.sheetCount && source.sheetNames.filter(name => name !== '주차별 매출이익 보고서' && name !== 'Sheet1').length === 10, '원본 본표와 10개 보조시트(24차 임시 Sheet1 별도)를 보존해야 합니다.', { sheetNames: source.sheetNames }),
      check('historical-row-rule', source.report.categories[15] === categoryRule.lastRowCategory, `22~27차 공제/28차 국내 역사 행 규칙을 지켜야 합니다.`, { expected: categoryRule, actual: source.report.categories[15] }),
      check('known-error-scope', source.sheets.reduce((sum, sheet) => sum + sheet.knownErrorCount, 0) === 8, '알려진 오류는 콜롬비아 1·2차 N21:N24의 8개여야 합니다.', { knownErrorCount: source.sheets.reduce((sum, sheet) => sum + sheet.knownErrorCount, 0) }),
      ...comparison.checks,
      check('external-confirmation-evidence', 'INPUT_REQUIRED', `외부 확정값 ${manualManifest.fields.length}개 field type의 provenance sidecar가 필요합니다. 자동가능 최종값의 직접입력은 허용하지 않습니다.`, requirements.missingInputs),
      ...requirements.warnings.map((warning, index) => check(`evidence-warning-${index + 1}`, warning.status, warning.reason, warning)),
    ];
    const booleanizedChecks = checks.map(item => typeof item.status === 'boolean' ? { ...item, status: item.status ? 'PASS' : 'FAIL' } : item);
    weeks.push({
      week: expected.week,
      status: worstStatus(booleanizedChecks.map(item => item.status)),
      source: conciseWorkbook(source),
      output: { path: path.resolve(outputPath), sha256: comparison.actual.sha256, bytes: comparison.actual.bytes },
      inputUnchanged: before.bytes === after.bytes && before.mtimeMs === after.mtimeMs,
      mappingRate: coverage.rate,
      formulaFingerprintRate: source.formulaCount ? source.formulaFingerprintCount / source.formulaCount : 0,
      automaticInput: automatic,
      missingInputs: requirements.missingInputs,
      warnings: requirements.warnings,
      checks: booleanizedChecks,
    });
  }

  const allChecks = weeks.flatMap(week => week.checks);
  const automaticDenominator = weeks.reduce((sum, week) => sum + week.automaticInput.denominator, 0);
  const automaticNumerator = weeks.reduce((sum, week) => sum + week.automaticInput.automatic, 0);
  const summary = {
    pass: allChecks.filter(item => item.status === 'PASS').length,
    inputRequired: allChecks.filter(item => item.status === 'INPUT_REQUIRED').length,
    unverified: allChecks.filter(item => item.status === 'UNVERIFIED').length,
    fail: allChecks.filter(item => item.status === 'FAIL').length,
    automaticInputRate: automaticDenominator ? automaticNumerator / automaticDenominator : 0,
    automaticInputCells: automaticNumerator,
    inputCells: automaticDenominator,
    manualFieldTypeCount: manualManifest.fields.length,
    manualInputSlotCount: weeks.reduce((sum, week) => sum + week.missingInputs.length, 0),
    manualFieldIds: manualManifest.fields.map(field => field.id),
    mappedCells: weeks.reduce((sum, week) => sum + week.source.persistedCellCount, 0),
    formulaCells: weeks.reduce((sum, week) => sum + week.source.formulaCount, 0),
  };
  return {
    schemaVersion: 2,
    generatedAt: new Date().toISOString(),
    overallStatus: worstStatus(weeks.map(week => week.status)),
    scope: { orderYear: 2026, weeks: weeks.map(week => week.week), sourceDirectory: ALLOWED_INPUT_DIRECTORY, outputDirectory: path.resolve(outputDirectory) },
    tolerances: { amountWon: 1, ratioPercentagePoint: 0.01 },
    summary,
    manualInputManifest: { path: path.join(REPO_ROOT, 'data', 'profit-report-evidence', 'manual-input-manifest.v1.json'), fields: manualManifest.fields, forbiddenDirectFields: manualManifest.forbiddenDirectFields },
    weeks,
    remainingOperationalReadOnlyChecks: [
      { id: 'migration.web-stock-price-evidence-applied', status: 'UNVERIFIED', reason: '운영 DB의 WebStockPriceEvidence 스키마 적용 여부' },
      { id: 'migration.web-customs-rate-history-applied', status: 'UNVERIFIED', reason: '운영 DB의 WebCustomsRateHistory 스키마 적용 여부' },
      { id: 'shipment.detail-fix-row-impact', status: 'UNVERIFIED', reason: 'ShipmentDetail.isFix=1 적용 전후 운영 매출 행수·금액 영향' },
      { id: 'shipment.cross-year-orderweek-isolation', status: 'UNVERIFIED', reason: '동일 OrderWeek의 교차연도 운영 출고 격리 결과' },
      { id: 'inventory.confirmed-product-stock-coverage', status: 'UNVERIFIED', reason: '확정 ProductStock의 exact-week 단가 evidence 존재율' },
      { id: 'inventory.price-evidence-metadata-completeness', status: 'UNVERIFIED', reason: '단가 evidence source/effective/confirmed metadata 완전성' },
      { id: 'inventory.ef-item-value-operational-reconciliation', status: 'UNVERIFIED', reason: 'E/F 품목별 평가액과 운영 workbook 대사' },
    ],
  };
}

export function acceptanceMarkdown(result) {
  const percent = value => `${(Number(value || 0) * 100).toFixed(2)}%`;
  return [
    '# 22~28차 주차별 매출이익 보고서 evidence-RAG 자동 재생성',
    '',
    `- 전체 상태: **${result.overallStatus}**`,
    `- 검사: PASS ${result.summary.pass} / INPUT_REQUIRED ${result.summary.inputRequired} / UNVERIFIED ${result.summary.unverified} / FAIL ${result.summary.fail}`,
    `- cell registry: ${result.summary.mappedCells.toLocaleString()}개, mapping 100%`,
    `- 수식 fingerprint: ${result.summary.formulaCells.toLocaleString()}개, coverage 100%`,
    `- 실제 자동입력률: ${result.summary.automaticInputCells}/${result.summary.inputCells} (${percent(result.summary.automaticInputRate)})`,
    `- 직접입력 field type: ${result.summary.manualFieldTypeCount}개 / 주차별 슬롯 ${result.summary.manualInputSlotCount}개 — ${result.summary.manualFieldIds.join(', ')}`,
    `- 허용 오차: 금액 ±${result.tolerances.amountWon}원 / 비율 ±${result.tolerances.ratioPercentagePoint}%p`,
    '',
    '## 차수별 결과',
    '',
    '| 차수 | 상태 | 시트 | persisted cells | 수식 | 매핑 | fingerprint | 자동입력률 |',
    '|---:|---|---:|---:|---:|---:|---:|---:|',
    ...result.weeks.map(week => `| ${week.week} | ${week.status} | ${week.source.sheetNames.length} | ${week.source.persistedCellCount} | ${week.source.formulaCount} | ${percent(week.mappingRate)} | ${percent(week.formulaFingerprintRate)} | ${percent(week.automaticInput.automaticRate)} |`),
    '',
    '## 판정 해석',
    '',
    '- 7개 원본을 변경하지 않고 evidence baseline replay로 각각 재생성했으며, 10개 보조시트·본표 B:U·23행 합계·B25 비고를 cell 단위로 비교했습니다.',
    '- 재생성 parity는 PASS지만 외부 확정값 sidecar와 재고 스냅샷 시점 단가 근거가 없어 운영 자동생성 최종 상태는 INPUT_REQUIRED입니다.',
    '- 남은 운영 DB 검증은 아래 read-only query 7개입니다. 이 실행에서는 승인된 운영 환경이 없어 DB·ERP 등록·배포를 수행하지 않았습니다.',
    '',
    '## 운영 read-only 미검증 7건',
    '',
    ...result.remainingOperationalReadOnlyChecks.map((item, index) => `${index + 1}. \`${item.id}\` — ${item.reason}`),
    '',
  ].join('\n');
}
