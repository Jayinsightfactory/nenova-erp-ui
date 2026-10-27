// Report-only, immutable source selection. No SQL, persistence, or freight calculation.
const attestations = require('../data/profit-report-evidence/awb-weight-attestations.v1.json');
const present = value => value !== null && value !== undefined && value !== '';
const awbKey = value => String(value || '').replace(/[-\s]/g, '');
const scopeKey = row => `${row.OrderYear}|${row.OrderWeek}|${awbKey(row.OrderNo)}`;
const name = row => String(row.ProdName ?? row.prodName ?? '').trim();

function matchingAttestation(masters, records) {
  if (!masters.length) return null;
  return records.find(record => {
    const key = `${record.orderYear}|${record.orderWeek}|${record.awb}`;
    const anchors = masters.filter(m => Number(m.WarehouseKey) === record.warehouseKey
      && String(m.FarmName || '').trim().toUpperCase() === record.farmName);
    return anchors.length === 1 && masters.every(m => scopeKey(m) === key && !Number(m.isDeleted || 0))
      && new Set(masters.map(m => Number(m.WarehouseKey))).size === masters.length;
  }) || null;
}

function exactAuxiliaryRow(row, expected, warehouseKey) {
  if (Number(row.WarehouseKey) !== warehouseKey) return false;
  return Object.entries(expected).every(([key, value]) => {
    const selected = Object.prototype.hasOwnProperty.call(row, `Evidence${key}`) ? `Evidence${key}` : key;
    // A missing selected column is not evidence of SQL NULL.
    if (!Object.prototype.hasOwnProperty.call(row, selected)) return false;
    if (value === null) return row[selected] === null;
    if (key === 'OrderCode') return String(row[selected]) === value;
    return present(row[selected]) && Number(row[selected]) === value;
  });
}

/** Resolve one exact year/subweek/AWB group. Native values, including zero, win.
 * Auxiliary fingerprints attest to the same source document, not to GW/CW.
 * They do not change the caller's existing goods/freight classification.
 */
function resolveFreightWeightEvidence({ masters = [], rows = [], snapshots = [], manual = {}, weightOfRow,
  isGrossWeightItem, isChargeableWeightItem, isFreightRow, baseCountry } = {}, records = attestations.records) {
  const record = matchingAttestation(masters, records);
  const result = { matched: Boolean(record), grossWeight: null, chargeableWeight: null,
    photoFields: [], sourceRefs: [], evidence: [], auxiliaryDetailKeys: [], nativeDifferences: [] };
  if (!record) return result;
  if (![weightOfRow, isGrossWeightItem, isChargeableWeightItem, isFreightRow, baseCountry].every(fn => typeof fn === 'function'))
    return { ...result, matched: false };
  const keySet = new Set(masters.map(m => Number(m.WarehouseKey)));
  if (rows.some(row => !keySet.has(Number(row.WarehouseKey)))) return { ...result, matched: false };
  const countries = rows.filter(row => !isFreightRow({ ...row,
    FarmName: masters.find(m => Number(m.WarehouseKey) === Number(row.WarehouseKey))?.FarmName }))
    .map(row => String(row.CounName ?? row.counName ?? '').trim()).filter(Boolean).map(baseCountry);
  if (!countries.length || countries.some(country => country !== '태국'))
    return { ...result, matched: false };
  for (const expected of record.nonInventoryAuxiliaryRows) {
    const candidates = rows.filter(row => Number(row.WdetailKey) === expected.WdetailKey);
    if (candidates.length === 1 && exactAuxiliaryRow(candidates[0], expected, record.warehouseKey))
      result.auxiliaryDetailKeys.push(expected.WdetailKey);
  }
  const fingerprintMatches = result.auxiliaryDetailKeys.length === record.nonInventoryAuxiliaryRows.length
    && record.grossWeight > 0 && record.chargeableWeight >= record.grossWeight;
  for (const [field, isNamed] of [['GrossWeight', isGrossWeightItem], ['ChargeableWeight', isChargeableWeightItem]]) {
    const output = field === 'GrossWeight' ? 'grossWeight' : 'chargeableWeight';
    const namedRows = rows.filter(row => isNamed(name(row)));
    const nativeSnapshots = snapshots.filter(row => keySet.has(Number(row.WarehouseKey)) && present(row[field]));
    const headers = masters.filter(row => present(row[field]));
    const native = present(manual[field]) ? Number(manual[field])
      : nativeSnapshots.length ? nativeSnapshots.reduce((sum, row) => sum + Number(row[field]), 0)
      : namedRows.length ? namedRows.reduce((sum, row) => sum + Number(weightOfRow ? weightOfRow(row) : row.SteamQuantity), 0)
      : headers.length ? headers.reduce((sum, row) => sum + Number(row[field]), 0) : null;
    // Invalid/negative explicit native input also blocks photo replacement.
    if (native !== null) {
      result[output] = Number.isFinite(native) && native >= 0 ? native : null;
      if (!Number.isFinite(native) || Math.abs(native - record[output]) > 0.01)
        result.nativeDifferences.push({ id: record.id, orderYear: record.orderYear, orderWeek: record.orderWeek,
          awb: record.awb, field, photoValue: record[output], nativeValue: Number.isFinite(native) ? native : null,
          source: present(manual[field]) ? 'manual' : nativeSnapshots.length ? 'freight_cost_snapshot' : namedRows.length ? 'named_weight_row' : 'warehouse_header' });
    }
    else if (fingerprintMatches) { result[output] = record[output]; result.photoFields.push(field); }
  }
  // Do not manufacture an inverted pair by combining a newer partial native
  // record with the old photo. Preserve native fields; withdraw photo fields.
  if (result.photoFields.length && result.grossWeight != null && result.chargeableWeight != null
    && result.grossWeight > result.chargeableWeight + 0.01) {
    for (const field of result.photoFields) result[field === 'GrossWeight' ? 'grossWeight' : 'chargeableWeight'] = null;
    result.photoFields = [];
    result.photoRejectedReason = 'native_photo_weight_pair_conflict';
  }
  if (result.photoFields.length) {
    result.sourceRefs.push(record.id);
    result.evidence.push({ id: record.id, source: record.source, confirmedOn: record.confirmedOn,
      orderYear: record.orderYear, orderWeek: record.orderWeek, awb: record.awb, warehouseKey: record.warehouseKey,
      grossWeight: record.grossWeight, chargeableWeight: record.chargeableWeight,
      appliedFields: [...result.photoFields], basis: record.basis,
      auxiliaryDetailKeys: [...result.auxiliaryDetailKeys], auxiliaryBasis: record.auxiliaryBasis });
  }
  return result;
}

module.exports = { resolveFreightWeightEvidence };
