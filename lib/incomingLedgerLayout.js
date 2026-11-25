import cloudReferences from '../data/cloud-cost-reference-evidence.json' with { type: 'json' };
import nativeCostCatalog from '../data/native-cost-source-evidence.json' with { type: 'json' };
import verifiedSupplements from '../data/warehouse-verified-cost-supplement.json' with { type: 'json' };
import { isOrphanWeightDetailRow } from './warehouseWeightRows.js';

export function incomingRowKind(row) {
  if (row.IsWeightRow || [3100, 3101].includes(Number(row.ProdKey)) || isOrphanWeightDetailRow(row)) return 'weight';
  if (Number(row.ProdKey) === 2182) return 'freight';
  return 'goods';
}

const finiteOrNull = value => {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const fileBasename = value => String(value ?? '').split(/[\\/]/).pop().trim();

// Strict scope-locked lookup against SHA-verified Cloud cost workbooks and
// 100% source-audited historical receipts. Never matches across years or rounds.
export function resolveVerifiedWarehouseSupplement(row = {}) {
  const wk = Number(row.WarehouseKey);
  if (!Number.isSafeInteger(wk) || wk <= 0) return null;
  const year = String(row.OrderYear ?? '').trim();
  const week = String(row.OrderWeek ?? '').trim();
  const farm = String(row.FarmName ?? '').trim();
  const inv = String(row.InvoiceNo ?? '').trim();
  const file = fileBasename(row.FileName);
  const docHash = String(row.DocSourceHash ?? '').trim().toLowerCase();

  const cloudMatch = (cloudReferences.records || []).find(e =>
    e.scope.warehouseKey === wk &&
    e.scope.orderYear === year &&
    e.scope.orderWeek === week &&
    e.scope.farmName === farm &&
    e.scope.invoiceNo === inv &&
    e.scope.fileName === file &&
    (!docHash || docHash === String(e.invoiceSource?.sha256 ?? '').toLowerCase())
  );
  if (cloudMatch) {
    return {
      gw: finiteOrNull(cloudMatch.weights?.find(w => w.kind === 'GW')?.kg),
      cw: finiteOrNull(cloudMatch.weights?.find(w => w.kind === 'CW')?.kg),
      freight: finiteOrNull(cloudMatch.freight?.amount),
      freightCurrency: /^[A-Z]{3}$/.test(String(cloudMatch.freight?.currency || '')) ? cloudMatch.freight.currency : '',
    };
  }

  const supplement = (verifiedSupplements.records || []).find(e =>
    e.scope.warehouseKey === wk &&
    e.scope.orderYear === year &&
    e.scope.orderWeek === week &&
    e.scope.farmName === farm &&
    e.scope.invoiceNo === inv &&
    e.scope.fileName === file
  );
  if (supplement) {
    return {
      gw: finiteOrNull(supplement.gw),
      cw: finiteOrNull(supplement.cw),
      freight: finiteOrNull(supplement.freight?.amount),
      freightCurrency: /^[A-Z]{3}$/.test(String(supplement.freight?.currency || '')) ? supplement.freight.currency : '',
    };
  }
  return null;
}

// Header values entered on the web win; native packing uploads keep GW/CW/운송료
// as Product detail rows (or legacy weigth-typo orphan rows), web invoice receipts
// keep non-USD charges in the committed document, and verified source supplements
// fill historical gaps without manufacturing unverified estimates.
export function incomingMasterCosts(row = {}) {
  const headerGw = finiteOrNull(row.GrossWeight);
  const headerCw = finiteOrNull(row.ChargeableWeight);
  const detailGw = finiteOrNull(row.DetailGrossWeight);
  const detailCw = finiteOrNull(row.DetailChargeableWeight);
  const orphanGw = finiteOrNull(row.OrphanGrossWeight);
  const orphanCw = finiteOrNull(row.OrphanChargeableWeight);
  const docGw = finiteOrNull(row.DocGrossWeight);
  const docCw = finiteOrNull(row.DocChargeableWeight);
  const detailFreight = finiteOrNull(row.DetailFreightAmount);
  const documentFreight = finiteOrNull(row.DocFreightAmount);
  const documentCurrency = /^[A-Z]{3}$/.test(String(row.DocFreightCurrency || '')) ? row.DocFreightCurrency : '';
  const supplement = resolveVerifiedWarehouseSupplement(row);
  const refGw = supplement?.gw ?? null;
  const refCw = supplement?.cw ?? null;
  const refFreight = supplement?.freight ?? null;
  const refCurrency = supplement?.freightCurrency ?? '';

  const gw = headerGw ?? detailGw ?? orphanGw ?? docGw ?? refGw;
  const gwSource = headerGw != null ? 'header' : detailGw != null ? 'detail' : orphanGw != null ? 'orphan' : docGw != null ? 'document' : refGw != null ? 'reference' : null;
  const cw = headerCw ?? detailCw ?? orphanCw ?? docCw ?? refCw;
  const cwSource = headerCw != null ? 'header' : detailCw != null ? 'detail' : orphanCw != null ? 'orphan' : docCw != null ? 'document' : refCw != null ? 'reference' : null;
  const freight = detailFreight ?? documentFreight ?? refFreight;
  const freightSource = detailFreight != null ? 'detail' : documentFreight != null ? 'document' : refFreight != null ? 'reference' : null;
  const freightCurrency = detailFreight != null ? '' : documentFreight != null ? documentCurrency : refFreight != null ? refCurrency : '';

  return { gw, gwSource, cw, cwSource, freight, freightCurrency, freightSource };
}

export function incomingCostLabel(value, currency = '') {
  if (value == null) return '';
  const amount = value.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
  return currency ? `${amount} ${currency}` : amount;
}

export function needsReceiptCostLedgerSync(row = {}, costs = incomingMasterCosts(row)) {
  if (!row || Number(row.OrderYear) < 2026 || !/^\d{2}-\d{2}$/.test(String(row.OrderWeek ?? ''))) return false;
  if (!costs || (costs.gw == null && costs.cw == null && costs.freight == null)) return false;
  const wk = Number(row.WarehouseKey);
  const year = String(row.OrderYear ?? '').trim();
  const week = String(row.OrderWeek ?? '').trim();
  const lockedOrphan = (nativeCostCatalog.records || []).some(e =>
    e.scope?.warehouseKey === wk && e.scope?.orderYear === year && e.scope?.orderWeek === week
  );
  if (lockedOrphan) {
    return (costs.gw != null && finiteOrNull(row.GrossWeight) == null)
      || (costs.cw != null && finiteOrNull(row.ChargeableWeight) == null)
      || (costs.freight != null && finiteOrNull(row.DetailFreightAmount) == null);
  }
  return (costs.gw != null && finiteOrNull(row.DetailGrossWeight) == null)
    || (costs.cw != null && finiteOrNull(row.DetailChargeableWeight) == null)
    || (costs.freight != null && finiteOrNull(row.DetailFreightAmount) == null);
}

// Normalizes legacy orphan weight rows (Gross/Chargeable weigth typo) and appends
// read-only bottom rows for 운송료(2182), Gross weight(3100), Chargeable weight(3101)
// when WarehouseDetail lacks them so every receipt shows consistent bottom rows.
export function buildIncomingDetailRows(details = [], masterCosts = null) {
  if (!Array.isArray(details) || !details.length) return details;
  let orphanIdx = 0;
  const normalized = [];
  for (const row of details) {
    if (isOrphanWeightDetailRow(row)) {
      const slot = orphanIdx++;
      const fallbackKg = slot === 0 ? masterCosts?.gw : slot === 1 ? masterCosts?.cw : null;
      const rawSteam = finiteOrNull(row.SteamQuantity);
      const kg = rawSteam != null && rawSteam > 0 ? rawSteam : fallbackKg;
      if (kg == null || kg <= 0) continue;
      const prodKey = slot === 0 ? 3100 : 3101;
      const label = slot === 0 ? 'Gross weight' : 'Chargeable weight';
      normalized.push({
        ...row,
        ProdKey: prodKey,
        ProdName: label,
        DisplayName: label,
        단위: 'kg',
        IsWeightRow: true,
        SteamQuantity: kg,
        LegacyOrphanWeight: true,
      });
      continue;
    }
    normalized.push(row);
  }
  if (!masterCosts) return normalized;
  const hasFreight = normalized.some(r => Number(r.ProdKey) === 2182);
  const hasGw = normalized.some(r => Number(r.ProdKey) === 3100);
  const hasCw = normalized.some(r => Number(r.ProdKey) === 3101);
  const extras = [];
  if (!hasFreight && masterCosts.freight != null) {
    const cur = masterCosts.freightCurrency || '';
    extras.push({
      WdetailKey: 'supplement-2182',
      ProdKey: 2182,
      ProdName: '운송료',
      DisplayName: cur ? `운송료 (${cur})` : '운송료',
      주문코드: '',
      단위: '비용',
      단송이: 1,
      박스송이: 1,
      BoxQuantity: 1,
      BunchQuantity: 1,
      SteamQuantity: 1,
      OutQuantity: 1,
      EstQuantity: 1,
      UPrice: masterCosts.freight,
      TPrice: masterCosts.freight,
      단가: masterCosts.freight,
      총액: masterCosts.freight,
      SupplementCurrency: cur,
      SupplementSource: masterCosts.freightSource,
      IsSupplementRow: true,
    });
  }
  if (!hasGw && masterCosts.gw != null) {
    extras.push({
      WdetailKey: 'supplement-3100',
      ProdKey: 3100,
      ProdName: 'Gross weight',
      DisplayName: 'Gross weight',
      주문코드: '',
      단위: 'kg',
      단송이: 1,
      박스송이: 1,
      BoxQuantity: 1,
      BunchQuantity: 1,
      SteamQuantity: masterCosts.gw,
      OutQuantity: masterCosts.gw,
      EstQuantity: masterCosts.gw,
      UPrice: 0,
      TPrice: 0,
      단가: 0,
      총액: 0,
      IsWeightRow: true,
      SupplementSource: masterCosts.gwSource,
      IsSupplementRow: true,
    });
  }
  if (!hasCw && masterCosts.cw != null) {
    extras.push({
      WdetailKey: 'supplement-3101',
      ProdKey: 3101,
      ProdName: 'Chargeable weight',
      DisplayName: 'Chargeable weight',
      주문코드: '',
      단위: 'kg',
      단송이: 1,
      박스송이: 1,
      BoxQuantity: 1,
      BunchQuantity: 1,
      SteamQuantity: masterCosts.cw,
      OutQuantity: masterCosts.cw,
      EstQuantity: masterCosts.cw,
      UPrice: 0,
      TPrice: 0,
      단가: 0,
      총액: 0,
      IsWeightRow: true,
      SupplementSource: masterCosts.cwSource,
      IsSupplementRow: true,
    });
  }
  return extras.length ? [...normalized, ...extras] : normalized;
}

const textPixels = value => [...String(value ?? '')].reduce((width,character) =>
  width+(/^[\u0000-\u007f]$/.test(character)?8:14),0);

export function incomingColumnWidth(values,{min=42,max=240,padding=14}={}) {
  const largest = values.reduce((width,value)=>Math.max(width,textPixels(value)),0);
  return Math.min(max,Math.max(min,largest+padding));
}

export function incomingQuantityWidth(rows,key,format,{label,min=42,padding=14,include=()=>true,suggestion}={}) {
  const goods=rows.filter(include);
  const sum=goods.reduce((total,row)=>total+(Number(row[key])||0),0);
  return incomingColumnWidth([
    label,format(sum),...goods.map(row=>row[key]==null&&suggestion?suggestion(row):format(row[key])),
  ],{min,padding});
}
