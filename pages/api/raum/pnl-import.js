// 라움 다차수 견적서 업로드. preview/save 모두 같은 XLSX multipart를 서버에서 다시 파싱한다.
import crypto from 'crypto';
import fs from 'fs';
import formidable from 'formidable';
import XLSX from 'xlsx';
import { withAuth } from '../../../lib/auth';
import { resolveActiveOrderYear } from '../../../lib/orderUtils';
import {
  parseRaumQuoteWorkbookGroups, lookupErpRefPrices, loadLearnedCosts, loadRaumConsignedSet,
  prepareRaumPnlImportPreview, saveRaumPnlImportBatch, DEFAULT_NENOVA_PCT,
} from '../../../lib/raumPnl';

export const config = { api: { bodyParser: false } };

const learnKey = (s) => String(s || '').replace(/[\s ]+/g, ' ').trim().toLowerCase();
const localDate = (value) => value
  ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  : null;

function asField(value) { return Array.isArray(value) ? value[0] : value; }

function previewToken(raw, snapshots, batches) {
  const state = Object.keys(snapshots).sort().map(k => [k, snapshots[k]?.version || 'new']);
  const groups = batches.map(b => [String(b.orderYear), String(b.major), b.itemFingerprint || '', b.preservation || {}]);
  return crypto.createHash('sha256').update(raw).update(JSON.stringify({ state, groups })).digest('hex');
}

async function enrichBatch(parsed, orderYear) {
  const warnings = [...(parsed.warnings || [])];
  let refs = {};
  try {
    refs = await lookupErpRefPrices(parsed.items.map(it => ({ name: it.name, price: it.price })), parsed.major, orderYear);
  } catch (e) {
    warnings.push(`전산 참고단가 조회 실패: ${e.message}`);
  }
  let learned = {};
  try {
    learned = await loadLearnedCosts(parsed.items.map(it => it.name));
  } catch (e) {
    warnings.push(`학습 매입단가 조회 실패: ${e.message}`);
  }
  if (refs.__arrivalError) {
    warnings.push(refs.__arrivalError);
    delete refs.__arrivalError;
  }
  let consignedSet = new Set();
  try {
    consignedSet = await loadRaumConsignedSet(parsed.items.map(it => it.name));
  } catch (e) {
    warnings.push(`수동 사입 지정 조회 실패: ${e.message}`);
  }
  const items = parsed.items.map(it => {
    const consigned = !!it.consigned || consignedSet.has(learnKey(it.name));
    const ref = refs[it.name] || null;
    const learnedCost = learned[learnKey(it.name)];
    let costPrice = null;
    let costSource = null;
    if (!consigned && learnedCost != null) { costPrice = learnedCost; costSource = 'learned'; }
    else if (!consigned && ref?.isArrival && ref.refPrice != null) { costPrice = ref.refPrice; costSource = 'arrival'; }
    return {
      ...it, consigned, consignedManual: !it.consigned && consigned,
      costPrice, costSource, costLearned: costSource === 'learned',
      refPrice: consigned ? null : (ref?.refPrice ?? null),
      refSource: consigned ? '사입(원산지 없음) — 손익 제외' : (ref?.refSource ?? null),
      isArrival: !consigned && !!ref?.isArrival,
      erpSalePrice: ref?.erpSalePrice ?? null, erpQty: ref?.erpQty ?? null,
      erpFromPrev: ref?.erpFromPrev ?? false, erpW2Qty: ref?.erpW2Qty ?? 0,
      imChecked: !!ref, imQty: ref?.imQty ?? null, imFirstDtm: ref?.imFirstDtm ?? null,
      imLastDtm: ref?.imLastDtm ?? null, imModCnt: ref?.imModCnt ?? 0,
      prodKey: ref?.prodKey ?? null, prodName: ref?.prodName ?? null,
      prodKeySource: ref?.matchType === '확정매핑' ? 'explicit-map' : 'auto',
    };
  });
  return {
    ...parsed, orderYear, quoteDate: localDate(parsed.quoteDate), items, warnings,
    sheets: parsed.sheets.map(s => ({
      sheetName: s.sheetName, branch: s.branch, itemCount: s.items.length,
      parsedSupply: s.parsedSupply, summarySupply: s.summarySupply, summaryTotal: s.summaryTotal,
    })),
  };
}

async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });
  const form = formidable({ maxFileSize: 30 * 1024 * 1024, keepExtensions: true, multiples: false });
  let fields; let files;
  try {
    [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
    });
  } catch (e) {
    return res.status(400).json({ success: false, error: `업로드 파싱 실패: ${e.message}` });
  }
  const file = Array.isArray(files.file) ? files.file[0] : files.file;
  if (!file) return res.status(400).json({ success: false, error: 'file 필드 필요' });
  try {
    const raw = fs.readFileSync(file.filepath);
    const workbook = XLSX.read(raw, { type: 'buffer', cellDates: true, cellNF: false, cellStyles: false });
    const parsed = parseRaumQuoteWorkbookGroups(XLSX, workbook);
    if (!parsed.batches.length) return res.status(400).json({ success: false, error: parsed.warnings[0] || '파싱된 품목이 없습니다.', warnings: parsed.warnings });

    const batches = await Promise.all(parsed.batches.map(async (batch) => {
      const orderYear = batch.quoteDate ? String(batch.quoteDate.getFullYear()) : resolveActiveOrderYear(`${batch.major}-01`);
      return enrichBatch(batch, orderYear);
    }));
    const prepared = await prepareRaumPnlImportPreview(batches);
    const canonicalBatches = prepared.batches;
    const snapshots = prepared.snapshots;
    const token = previewToken(raw, snapshots, canonicalBatches);
    const mode = String(asField(fields.mode) || 'preview').toLowerCase();

    if (mode === 'save') {
      const received = String(asField(fields.previewToken) || '');
      if (!received || received !== token) {
        return res.status(409).json({ success: false, error: '미리보기 이후 결산이 변경되었거나 다른 파일입니다. 다시 미리보기 후 저장하세요.' });
      }
      const failed = canonicalBatches.flatMap(b => b.verification || []).filter(c => !c.ok);
      if (failed.length) return res.status(400).json({ success: false, error: '합계 검증에 실패해 전체 저장을 차단했습니다.', batches: canonicalBatches, warnings: parsed.warnings });
      const actor = req.user?.userName || req.user?.userId || 'user';
      const saved = await saveRaumPnlImportBatch({
        batches: canonicalBatches, sourceFile: file.originalFilename || 'upload.xlsx', actor, expectedSnapshots: snapshots,
      });
      return res.status(200).json({ success: true, saved, batchCount: saved.length });
    }
    if (mode !== 'preview') return res.status(400).json({ success: false, error: 'mode는 preview 또는 save여야 합니다.' });
    return res.status(200).json({
      success: true, mode: 'preview', fileName: file.originalFilename || 'upload.xlsx',
      previewToken: token, batches: canonicalBatches, warnings: parsed.warnings,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  } finally {
    try { fs.unlinkSync(file.filepath); } catch { /* temp cleanup only */ }
  }
}

export default withAuth(handler);
