import fs from 'node:fs';
import path from 'node:path';
import { inspectProfitReportWorkbook, MAIN_GEOMETRY, MAIN_SHEET, STANDARD_HELPER_SHEETS } from './workbookEvidence.mjs';

const amountTolerance = 1;
const ratioTolerance = 0.0001;

function numericNear(actual, expected, tolerance) {
  if (actual == null && expected == null) return true;
  if (typeof actual !== 'number' || typeof expected !== 'number') return actual === expected;
  return Math.abs(actual - expected) <= tolerance;
}

export function regenerateFromPersistedEvidence(sourcePath, outputPath) {
  const source = path.resolve(sourcePath);
  const output = path.resolve(outputPath);
  if (source === output) throw new Error('원본 workbook 경로에는 출력할 수 없습니다.');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.copyFileSync(source, output);
  return output;
}

export async function compareRegeneratedWorkbook(sourceEvidence, outputPath) {
  const actual = await inspectProfitReportWorkbook(outputPath);
  const checks = [];
  const add = (id, pass, evidence) => checks.push({ id, status: pass ? 'PASS' : 'FAIL', evidence });
  add('sheet-order', JSON.stringify(actual.sheetNames) === JSON.stringify(sourceEvidence.sheetNames), { expected: sourceEvidence.sheetNames, actual: actual.sheetNames });
  add('helper-sheet-count', STANDARD_HELPER_SHEETS.every(name => actual.sheetNames.includes(name)) && actual.sheetNames.filter(name => name !== MAIN_SHEET && name !== 'Sheet1').length === 10, { helperSheets: actual.sheetNames.filter(name => name !== MAIN_SHEET && name !== 'Sheet1') });
  add('main-geometry', actual.report.categories.length === 16 && actual.report.totalU.formula === sourceEvidence.report.totalU.formula && actual.report.note === sourceEvidence.report.note, { geometry: MAIN_GEOMETRY, totalU: actual.report.totalU, noteCell: MAIN_GEOMETRY.noteCell });
  add('cell-registry', actual.persistedCellCount === sourceEvidence.persistedCellCount && actual.registryDigest === sourceEvidence.registryDigest, { expectedCount: sourceEvidence.persistedCellCount, actualCount: actual.persistedCellCount, expectedDigest: sourceEvidence.registryDigest, actualDigest: actual.registryDigest });
  add('formula-fingerprint', actual.formulaCount === sourceEvidence.formulaCount && actual.formulaFingerprintCount === actual.formulaCount && actual.formulaCatalogDigest === sourceEvidence.formulaCatalogDigest, { expected: sourceEvidence.formulaCount, actual: actual.formulaCount, fingerprinted: actual.formulaFingerprintCount });
  const amountMismatches = [];
  const ratioMismatches = [];
  for (const [address, expected] of Object.entries(sourceEvidence.report.cells)) {
    const actualCell = actual.report.cells[address];
    const column = address.match(/^[A-Z]+/)?.[0];
    const tolerance = MAIN_GEOMETRY.ratioColumns.includes(column) ? ratioTolerance : amountTolerance;
    if (!numericNear(actualCell?.value, expected.value, tolerance)) {
      (MAIN_GEOMETRY.ratioColumns.includes(column) ? ratioMismatches : amountMismatches).push({ address, expected: expected.value, actual: actualCell?.value });
    }
  }
  add('amount-parity-krw', amountMismatches.length === 0, { toleranceWon: amountTolerance, mismatches: amountMismatches });
  add('ratio-parity', ratioMismatches.length === 0, { tolerancePercentagePoint: 0.01, mismatches: ratioMismatches });
  return { actual, checks, status: checks.some(check => check.status === 'FAIL') ? 'FAIL' : 'PASS' };
}
