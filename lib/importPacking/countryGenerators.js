// Country packing-list Excel workbook generators (CO, NL, CN, EC, TH, AU, US, VN)
import { printedReceiptBunchQuantity } from '../receiptBunchQuantity.js';
import { assertLegacyChinaReviewed } from '../importChinaLegacyReview.js';
import { isModernChinaInvoice, isStructuredChinaInvoice } from '../importChinaInvoiceFormat.js';
import { chinaSourceQuantities } from '../importChinaSourceQuantities.js';
import { isNlInvoiceOwnCode } from '../nlInvoiceCustomerCode.js';
import { normalizeNlOriginCode, nlOriginTariffBucket } from '../nlInvoiceTariffReference.js';
import {
  aliasKey,
  findBestMatch,
  makeProductResolver,
  packingSourceKey,
  stemsPerBoxCO,
} from './catalogAndMatching.js';
import {
  ANTIOQUIA_FARMS,
  BUNCH_ST_NL,
  NL_MASTER_IDX,
  detectCOFarm,
  familyNL,
  formatAwbNL,
  mapProductNL,
  resolveProductNL,
} from './countryRules.js';
import {
  NF_PRICE2,
  NF_PRICE3,
  buildSheet19_2,
  writeDataRowAU,
  writeDataRowCN,
  writeDataRowCOAntioquia,
  writeDataRowCOBogota,
  writeDataRowEC,
  writeDataRowNL,
  writeDataRowTH,
  writeDataRowUS,
  writeDataRowVN,
} from './excelSheetBuilder.js';

function genColombia(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, masterAwb = null, aliases = {}, farmMatches = null } = opts;
  const ws = {};
  const farm = detectCOFarm(inv.supplier || '', farmMatches);
  const isAntioquia = farm.coRegion ? farm.coRegion === 'ANTIOQUIA' : ANTIOQUIA_FARMS.has(farm.abbr);
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  // Use master AWB for Bogotá (single AWB for all farms in shipment)
  const awbRaw = (isAntioquia ? (inv.awb || '') : (masterAwb || inv.awb || ''));
  const awb = awbRaw.replace(/[^0-9]/g, '');

  // Match each invoice line to a catalog product
  const products = inv.products || [];
  const pending = [];   // line items needing user confirmation
  const noMatches = []; // line items with NO good candidate at all
  const resolveCO = makeProductResolver('CO', catalog, aliases, {
    farm: farm.name, farmAbbr: farm.abbr, invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolvedProducts = products.map((p, i) => resolveCO(p, i));

  // Forzar stems/caja correctos por finca+familia (ver STEMS_PER_BOX_CO):
  // alstro=160 en toda CO, Teucali clavel=300, etc.  Solo wholesale (pcs>0);
  // el modo retail no usa steam_box.  Recalculamos total_stems para que el
  // resumen de pantalla coincida con el Excel (J=F*H).
  for (const p of resolvedProducts) {
    if ((p.pcs || 0) > 0) {
      const boxOverride = stemsPerBoxCO(farm.abbr, p.matchedName, null);
      if (boxOverride != null) {
        p.steam_box = boxOverride;
        p.total_stems = (p.pcs || 0) * boxOverride;
      }
    }
  }

  // ===========================================================================
  // ANTIOQUIA / hortensias — fixed A1:L58 layout matching the 19-2 template
  // ===========================================================================
  const freightTotal = Number.isFinite(Number(inv.freight_total)) ? Number(inv.freight_total)
    : Number.isFinite(Number(inv.freight)) ? Number(inv.freight) : 0;
  const grossWeightCO = Number(inv.gross_weight) > 0 ? Number(inv.gross_weight) : null;
  const chargeableWeightCO = Number(inv.vol_weight) > 0 ? Number(inv.vol_weight) : null;
  const appendStandardPseudoRows = (target, { freight = 0, gw = null, cw = null, weightCountCells = true } = {}) => {
    if (freight !== 0) {
      target.push({
        matchedName: '운송료',
        isPseudo: true,
        cellF: 1, cellG: 1, cellH: 1, cellI: 1, cellJ: 1,
        cellK: freight, cellL: freight,
        lineTotal: freight,
      });
    }
    if (gw !== null && gw > 0) {
      target.push({
        matchedName: 'Gross weight',
        isPseudo: true,
        ...(weightCountCells ? { cellF: 1, cellG: 1, cellH: 1, cellI: 1 } : {}),
        cellJ: gw,
        lineTotal: 0,
      });
    }
    if (cw !== null && cw > 0) {
      target.push({
        matchedName: 'Chargeable weight',
        isPseudo: true,
        ...(weightCountCells ? { cellF: 1, cellG: 1, cellH: 1, cellI: 1 } : {}),
        cellJ: cw,
        lineTotal: 0,
      });
    }
  };
  if (isAntioquia) {
    const adaptedA = [...resolvedProducts];
    appendStandardPseudoRows(adaptedA, {
      freight: freightTotal > 0 ? freightTotal : 0,
      gw: grossWeightCO,
      cw: chargeableWeightCO,
    });
    const { computedTotal } = buildSheet19_2(ws, {
      grower: farm.name,
      weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
      products: adaptedA,
      priceFmt: NF_PRICE2,
      writeDataRow: writeDataRowCOAntioquia,
    });
    // Use the invoice_total declared on the PDF as the authoritative anchor.
    // It's independent of the per-row extraction, so any missed or
    // duplicated row will surface as a mismatch.  Fall back to the
    // row sum only if invoice_total isn't available.
    const rowSumA = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
    const invoiceTotalA = Number(inv.invoice_total) || 0;
    const expectedTotal = invoiceTotalA > 0 ? invoiceTotalA : (rowSumA + (freightTotal > 0 ? freightTotal : 0));
    const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
      ? { computed: computedTotal, expected: expectedTotal, country: 'CO', invoice: inv.invoice || '' }
      : null;
    const sheetName = `CO-수국 ${farm.short}`.slice(0, 31);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
    return {
      name:  `${wk}-${num}_CO_${farm.abbr}_${inv.invoice || 'PL'}.xlsx`,
      label: `${farm.name} · Invoice ${inv.invoice || ''}`,
      grossWeight: grossWeightCO,
      chargeableWeight: chargeableWeightCO,
      // Match Excel J-cell semantics: when both pcs and steam_box are positive
      // (wholesale box rows), Excel writes J = pcs × steam_box; retail (pcs=0)
      // or legacy rows without steam_box use total_stems.
      products: resolvedProducts.map((p) => ({ name: p.matchedName, qty: (Number(p.pcs) > 0 && Number(p.steam_box) > 0) ? Number(p.pcs) * Number(p.steam_box) : ((Number(p.total_stems) || 0) || ((p.pcs || 0) * (p.steam_box || 30))), unmatched: p.unmatched, viaAlias: p.viaAlias,
        sourceName: p.description ?? '', matchingDescription: p.description ?? '' })),
      pending,
      noMatches,
      totalMismatch,
      buf,
    };
  }

  // ===========================================================================
  // BOGOTÁ — same 19-2 layout as Antioquia
  // ===========================================================================
  // Append 운송료 (freight) and weights as pseudo-rows if present
  const adapted = [...resolvedProducts];
  appendStandardPseudoRows(adapted, {
    freight: freightTotal > 0 ? freightTotal : 0,
    gw: grossWeightCO,
    cw: chargeableWeightCO,
  });
  const { computedTotal } = buildSheet19_2(ws, {
    grower: farm.name,
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products: adapted,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowCOBogota,
  });
  // CO Bogotá invoice total INCLUDES freight (PHYTO, Documents, etc.).
  // The model extracts invoice_total as the FINAL grand total printed on the
  // PDF (already includes freight/phyto), so we compare it directly against
  // computedTotal (which is also row-sum + freight row).
  // Fall back to (rowSum + freight) only when invoice_total is missing.
  const rowSumB = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const invoiceTotalB = Number(inv.invoice_total) || 0;
  const expectedTotal = invoiceTotalB > 0 ? invoiceTotalB : (rowSumB + freightTotal);
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'CO', invoice: inv.invoice || '' }
    : null;
  const sheetName = 'BOG CO';
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_CO_${farm.abbr}_${inv.invoice || 'PL'}.xlsx`,
    label: `${farm.name} · Invoice ${inv.invoice || ''}`,
    grossWeight: grossWeightCO,
    chargeableWeight: chargeableWeightCO,
    // Match Excel J-cell semantics (same rationale as Antioquia branch above).
    products: resolvedProducts.map((p) => ({ name: p.matchedName, qty: (Number(p.pcs) > 0 && Number(p.steam_box) > 0) ? Number(p.pcs) * Number(p.steam_box) : ((Number(p.total_stems) || 0) || ((p.pcs || 0) * (p.steam_box || 30))), unmatched: p.unmatched, viaAlias: p.viaAlias,
      sourceName: p.description ?? '', matchingDescription: p.description ?? '' })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

function genNL(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = formatAwbNL(inv.awb || '');

  // Process raw invoice lines: each line has {cl, description, stems, price}
  // Step 1: split CL2 vs rest, mapping name and computing bunch_st
  function process(line) {
    const fam = familyNL(line.description);
    const bunch_st = BUNCH_ST_NL[fam] || 1;
    const name = mapProductNL(line.description);
    const org = normalizeNlOriginCode(line.org);
    const tariffBucket = nlOriginTariffBucket(line.description, org);
    return { ...line, org, tariffBucket, name, bunch_st, fam };
  }
  // Step 2: consolidate by raw source identity + price + tariff/origin bucket within a block.
  // Different invoice descriptions or EU vs non-EU origins remain separated.
  function consolidate(lines) {
    const seen = {};
    const out = [];
    for (const l of lines) {
      const key = JSON.stringify([packingSourceKey(l.description), l.price, l.tariffBucket]);
      if (key in seen) {
        out[seen[key]].total_bunch += l.stems / l.bunch_st;
      } else {
        seen[key] = out.length;
        out.push({ name: l.name, bunch_st: l.bunch_st, total_bunch: l.stems / l.bunch_st, u_price: l.price, originalDesc: l.description, ...(l.org ? { org: l.org } : {}) });
      }
    }
    return out;
  }
  // Step 3: sort by master list index, fallback to alphabetical
  function sortByMaster(arr) {
    arr.sort((a, b) => {
      const ia = NL_MASTER_IDX[a.name] ?? 9999;
      const ib = NL_MASTER_IDX[b.name] ?? 9999;
      if (ia !== ib) return ia - ib;
      return a.name.localeCompare(b.name);
    });
    return arr;
  }

  const lines = (inv.lines || []).map(process);
  const block1 = sortByMaster(consolidate(lines.filter(l => isNlInvoiceOwnCode(l.cl))));
  const block2 = sortByMaster(consolidate(lines.filter(l => !isNlInvoiceOwnCode(l.cl))));
  const products = [...block1, ...block2];

  // HARD VALIDATION: every product name must exist in the NL catalog.
  // mapProductNL has its own dictionary, but if a product is missing from
  // it (or maps to something not in the catalog), the description would
  // Detect supplier — defaults to Holex for backward compatibility when the
  // model doesn't return inv.supplier (older prompts didn't have that field).
  const supplierRaw = (inv.supplier || '').trim();
  const su = supplierRaw.toUpperCase();
  const supplier =
    /EZ\s*FLOWER|EZFLOWER/i.test(su) ? { name: 'EZ Flower', abbr: 'EZ',  pfx: 'NL_EZ' } :
    /HOLEX/i.test(su)                ? { name: 'Holex',     abbr: 'H',   pfx: 'NL_H'  } :
    { name: supplierRaw || 'Holex', abbr: 'H', pfx: 'NL_H' };  // safe default

  // Pending / no-match panels carry the supplier name so the UI shows it clearly.
  const pending = [];
  const noMatches = [];
  const items = (catalog && catalog.byCountry && catalog.byCountry.NL) || [];
  const catalogNameSet = new Set(items.map(it => it.name));
  for (const p of products) {
    const description = p.originalDesc ?? '';
    const resolution = resolveProductNL(description, items, aliases);
    p.name = resolution.matchedName;
    p.unmatched = resolution.unmatched;
    p.viaAlias = resolution.viaAlias;
    if (!resolution.unmatched) continue;
    const sourceKey = packingSourceKey(description);
    const hasErpAlias = Object.prototype.hasOwnProperty.call(aliases, sourceKey);
    if (hasErpAlias) {
      if (catalogNameSet.has(aliases[sourceKey])) {
        p.name = aliases[sourceKey];
        p.viaAlias = true;
        continue;
      }
      // A stale/deleted ERP identity is authoritative failure evidence. Do not
      // silently fall back to the built-in NL dictionary target.
      p.name = description;
      p.unmatched = true;
      p.staleAlias = true;
      const m = findBestMatch(description, items);
      if (m.candidates && m.candidates.length > 0) {
        pending.push({ farm: supplier.name, farmAbbr: 'NL', invoice: inv.invoice || 'PROFORMA', lineIdx: 0, description, candidates: m.candidates });
      } else {
        noMatches.push({ farm: supplier.name, farmAbbr: 'NL', invoice: inv.invoice || 'PROFORMA', lineIdx: 0, description, candidates: [] });
      }
      continue;
    }
    if (!catalogNameSet.has(p.name)) {
      // If we have an alias for the original description, use it
      const aKey = aliasKey(p.originalDesc || p.name);
      if (aliases[aKey] && catalogNameSet.has(aliases[aKey])) {
        p.name = aliases[aKey];
        p.viaAlias = true;
      } else {
        // Fall through to pending
        p.unmatched = true;
        // Try to get candidates for the user
        const m = findBestMatch(p.originalDesc || p.name, items);
        const legacyDescription = p.originalDesc || p.name;
        if (m.candidates && m.candidates.length > 0) {
          pending.push({ farm: supplier.name, farmAbbr: 'NL', invoice: inv.invoice || 'PROFORMA', lineIdx: 0, description: legacyDescription, candidates: m.candidates });
        } else {
          noMatches.push({ farm: supplier.name, farmAbbr: 'NL', invoice: inv.invoice || 'PROFORMA', lineIdx: 0, description: legacyDescription, candidates: [] });
        }
      }
    }
  }

  // Adapt to writeDataRowNL signature: F=pcs (here 0/1), G=bunch_st, H=steam_box (per box),
  // I=total_bunch, J=I*G, K=u_price, L=K*J.  We don't have steam_box from the
  // raw input so we leave it as 0 (it's mostly informational for NL).
  const adapted = (products || []).map((p) => ({
    matchedName: p.name || '',
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    pcs: 1,
    bunch_st: p.bunch_st || 1,
    steam_box: 0,                      // not provided per line for Holex/EZ Flower
    total_bunch: p.total_bunch || 0,
    u_price: p.u_price || 0,
  }));
  // Pseudo rows.  vol_weight is the "Chargeable weight" — Holex labels this
  // explicitly, but EZ Flower calls it "Net Weight" in the Delivery section,
  // so we also accept inv.net_weight as a fallback in case the model used
  // that key name instead.
  const volWeight = Number(inv.vol_weight) || Number(inv.net_weight) || 0;
  if (volWeight > 0) adapted.push({ matchedName: 'Chargeable weight', isPseudo: true, cellJ: volWeight, lineTotal: 0 });
  if (inv.gross_weight) adapted.push({ matchedName: 'Gross weight', isPseudo: true, cellJ: inv.gross_weight, lineTotal: 0 });
  const fr = (inv.freight || 0) + (inv.handling || 0);
  if (fr > 0) adapted.push({ matchedName: '운송료', isPseudo: true, cellF: 1, cellG: 1, cellH: 1, cellI: 1, cellJ: 1, cellK: fr, cellL: fr, lineTotal: fr });

  const { computedTotal } = buildSheet19_2(ws, {
    grower: supplier.name,
    weekend, invoice: inv.invoice || 'PROFORMA', awb, date: inv.date || '',
    bchLabel: 'BUNCH/ST',
    products: adapted,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowNL,
  });
  // NL invoice total INCLUDES freight + handling (inv.total_value is the
  // grand total).  We compare computedTotal directly.
  const expectedTotal = Number(inv.total_value) || 0;
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'NL', invoice: inv.invoice || '' }
    : null;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, `NL-${supplier.name}`);
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  const safeInv = (inv.invoice || 'PROFORMA').replace(/[\\/:*?"<>|]/g, '_');
  return {
    name: `${wk}-${num}_${supplier.pfx}_${safeInv}.xlsx`,
    label: `${supplier.name} · Invoice ${inv.invoice || 'PROFORMA'}`,
    products: products.map((p) => ({ name: p.name, qty: (p.total_bunch || 0) * (p.bunch_st || 1), unmatched: p.unmatched, viaAlias: p.viaAlias,
      sourceName: p.originalDesc ?? '', matchingDescription: p.originalDesc ?? '' })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

function genChina(XLSX, inv, wk, num, opts = {}) {
  if (inv.source_format === 'china_legacy_invoice_xlsx') {
    throw new Error('중국 구형 인보이스의 단위·통화 확인 전에는 패킹 파일을 생성할 수 없습니다.');
  }
  if (inv.source_format === 'china_legacy_invoice_reviewed') assertLegacyChinaReviewed(inv);
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const supplier = inv.supplier || 'Unknown';
  const isMelody = /melody/i.test(supplier);
  const isWorkbook = isStructuredChinaInvoice(inv.source_format);
  const pfx = isMelody ? 'MEL' : /hubfresh|鲜集/i.test(supplier) ? 'HUB' : 'CLD';
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Resolve every invoice line against catalog CN.  Same hard guarantee as
  // CO/AU: no description is allowed in the Excel unless it matches a
  // catalog name.  Anything else lands in the pending panel.
  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  if (isWorkbook) {
    const fields = ['pcs', 'bunch_st', 'steam_box', 'total_bunch', 'total_stems', 'u_price', 't_price'];
    for (const p of rawProducts) {
      const printedPdf = p.source_format === 'china_invoice_pdf';
      if (p.source_format !== inv.source_format || fields.some(key => !(printedPdf && key === 'bunch_st' && p[key] == null) && (!Number.isFinite(p[key]) || p[key] < 0))
        || p.pcs <= 0 || p.total_bunch <= 0
        || Math.round(p.total_bunch * p.u_price * 100) !== Math.round(p.t_price * 100)
        || (!(printedPdf && (p.bunch_st == null || typeof p.quantity_warning === 'string')) && Math.abs(p.bunch_st * p.total_bunch - p.total_stems) > 0.01)
        || Math.abs(p.steam_box * p.pcs - p.total_stems) > 0.01) {
        throw new Error('중국 인보이스 원본 수량/숫자를 확인해 주세요: row ' + p.source_row);
      }
    }
  }
  const resolveCN = makeProductResolver('CN', catalog, aliases, {
    farm: supplier, farmAbbr: pfx, invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveCN(p, i));

  const products = resolved.map((p) => ({
    matchedName: isWorkbook && p.stem_length ? `${p.unmatched ? p.source_description : p.matchedName} [length: ${p.stem_length}]` : p.matchedName,
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    ...chinaSourceQuantities(p),
    ...(isWorkbook ? { source_format: isModernChinaInvoice(p.source_format) ? p.source_format : 'china_invoice_xlsx', total_stems: p.total_stems } : {}),
    u_price: p.u_price || 0,
  }));
  // 3 extra rows the China template carries after the products.  These names
  // must equal Product.ProdName exactly (2182 운송료, 3100 Gross weight,
  // 3101 Chargeable weight) so nenova.exe usp_CreateWarehouse and the web
  // /incoming upload resolve a ProdKey instead of storing ProdKey=NULL.
  //   운송료:               F=G=H=I=J=1,  K=freight,  L==K*I (cached value)
  //   Gross weight:         F=G=H=I=1,    J=gross_weight
  //   Chargeable weight:    F=G=H=I=1,    J=vol_weight
  // ExcelLoadingPackingList skips rows whose F/I/J are blank, so the freight
  // value MUST be one 운송료 row carrying the SUM of every non-flower charge,
  // including negative claims/deducts.
  if (isWorkbook && Array.isArray(inv.additional_costs)) {
    let workbookFreight = 0;
    for (const cost of inv.additional_costs) {
      if (!Number.isFinite(cost.amount) || !Number.isFinite(cost.quantity) || !Number.isFinite(cost.unit_price)
        || cost.quantity < 0 || Math.abs(cost.quantity * cost.unit_price - cost.amount) > 0.01) {
        throw new Error('중국 인보이스 부대비용 숫자를 확인해 주세요.');
      }
      workbookFreight += cost.amount;
    }
    workbookFreight = Math.round((workbookFreight + Number.EPSILON) * 1e6) / 1e6;
    if (workbookFreight !== 0) {
      products.push({ matchedName: '운송료', isPseudo: true,
        cellF: 1, cellG: 1, cellH: 1, cellI: 1, cellJ: 1,
        cellK: workbookFreight, cellL: { formula: 'K*I', value: workbookFreight },
        lineTotal: workbookFreight,
        costBreakdown: inv.additional_costs.map(cost => ({ description: cost.description, amount: cost.amount })) });
    }
  } else if ((inv.freight || 0) !== 0) {
    products.push({
      matchedName: '운송료',
      isPseudo: true,
      cellF: 1, cellG: 1, cellH: 1, cellI: 1, cellJ: 1,
      cellK: inv.freight,
      cellL: { formula: 'K*I', value: inv.freight },        // signal the writer to put =K{r}*I{r}
      lineTotal: inv.freight,
    });
  }
  if (inv.gross_weight) {
    products.push({
      matchedName: 'Gross weight',
      isPseudo: true,
      cellF: 1, cellG: 1, cellH: 1, cellI: 1,
      cellJ: inv.gross_weight,
      lineTotal: 0,
    });
  }
  if (inv.vol_weight) {
    products.push({
      matchedName: 'Chargeable weight',
      isPseudo: true,
      cellF: 1, cellG: 1, cellH: 1, cellI: 1,
      cellJ: inv.vol_weight,
      lineTotal: 0,
    });
  }
  const { computedTotal } = buildSheet19_2(ws, {
    grower: supplier,
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowCN,
  });
  // CN invoice total INCLUDES freight, so we compare directly against the
  // expected sum.  The expected total = sum(products.t_price) which is
  // the gross invoice total before freight; we want the GRAND total INCLUDING
  // freight, so we add inv.total_value if present, else fall back.
  const expectedTotal = isWorkbook
    ? Number(inv.invoice_total)
    : (Number(inv.total_value) > 0)
    ? Number(inv.total_value)
    : ((inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0) + (Number(inv.freight) || 0));
  const itemSubtotal = rawProducts.reduce((s, p) => s + Number(p.t_price), 0);
  const computedItems = products.filter(p => !p.isPseudo).reduce((s, p) => s + p.total_bunch * p.u_price, 0);
  const costTotal = isWorkbook && Array.isArray(inv.additional_costs)
    ? inv.additional_costs.reduce((s, c) => s + c.amount, 0) : Number(inv.freight) || 0;
  const workbookMismatch = isWorkbook && (![expectedTotal, itemSubtotal, Number(inv.item_subtotal), costTotal, Number(inv.freight),
    inv.total_boxes, inv.total_bunches, inv.total_stems].every(Number.isFinite)
    || Math.abs(computedItems - itemSubtotal) > 0.01
    || Math.abs(itemSubtotal - Number(inv.item_subtotal)) > 0.01
    || Math.abs(costTotal - Number(inv.freight)) > 0.01
    || Math.abs(rawProducts.reduce((s, p) => s + p.pcs, 0) - inv.total_boxes) > 0.01
    || Math.abs(rawProducts.reduce((s, p) => s + p.total_bunch, 0) - inv.total_bunches) > 0.01
    || Math.abs(rawProducts.reduce((s, p) => s + p.total_stems, 0) - inv.total_stems) > 0.01
    || Math.abs(computedTotal - expectedTotal) > 0.01);
  const totalMismatch = workbookMismatch || (!isWorkbook && expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5)
    ? { computed: computedTotal, expected: expectedTotal, country: 'CN', invoice: inv.invoice || '' }
    : null;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'CN-' + pfx);
  if (isWorkbook) wb.Workbook = { CalcPr: { fullCalcOnLoad: true, calcOnSave: true } };
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_CN_${pfx}_${String(inv.invoice || 'PL').replace(/[\\/:*?"<>|]/g, '_')}.xlsx`,
    label: `${supplier} · Invoice ${inv.invoice || ''}`,
    grossWeight: Number.isFinite(inv.gross_weight) ? inv.gross_weight : null,
    chargeableWeight: Number.isFinite(inv.vol_weight) ? inv.vol_weight : null,
    products: resolved.map((p) => ({ name: isWorkbook && p.stem_length ? `${p.unmatched ? p.source_description : p.matchedName} [length: ${p.stem_length}]` : p.matchedName,
      qty: p.total_bunch || 0, unmatched: p.unmatched, viaAlias: p.viaAlias,
      // Preview metadata only. Never substitute these values into ERP writes.
      sourceName: p.source_description ?? p.description ?? '',
      matchingDescription: p.description ?? '',
      matchedName: p.matchedName,
      boxes: Number.isFinite(p.pcs) ? p.pcs : null,
      stems: Number.isFinite(p.total_stems) ? p.total_stems : null,
      unitPrice: Number.isFinite(p.u_price) ? p.u_price : null,
      lineAmount: Number.isFinite(p.t_price) ? p.t_price : null,
      stemLength: p.stem_length || '',
      ...(isWorkbook ? { source_row: p.source_row, stem_length: p.stem_length, matchReason: p.matchReason } : {}) })),
    pending,
    noMatches,
    totalMismatch,
    ...(isWorkbook ? { itemSubtotal: computedItems, additionalCostTotal: costTotal,
      invoiceTotal: computedTotal, sourceTotals: { boxes: inv.total_boxes, bunches: inv.total_bunches, stems: inv.total_stems } } : {}),
    buf,
  };
}

function genEcuador(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Resolve every line against catalog EC.
  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveEC = makeProductResolver('EC', catalog, aliases, {
    farm: 'La Rosaleda', farmAbbr: 'ROS', invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveEC(p, i));

  const products = resolved.map((p) => ({
    matchedName: p.matchedName,
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    pcs: p.pcs ?? 0,
    bunch_st: p.bunch_st ?? 0,
    steam_box: p.steam_box ?? 0,
    total_bunch: p.total_bunch == null || p.total_bunch === '' ? printedReceiptBunchQuantity(p) : Number(p.total_bunch),
    total_stems: p.total_stems || 0,
    u_price: p.u_price || 0,
  }));
  const ecFreight = Number.isFinite(Number(inv.freight)) ? Number(inv.freight)
    : Number.isFinite(Number(inv.freight_total)) ? Number(inv.freight_total) : 0;
  if (ecFreight > 0) {
    products.push({ matchedName: '운송료', isPseudo: true, cellF: 1, cellG: 1, cellH: 1, cellI: 1, cellJ: 1, cellK: ecFreight, cellL: ecFreight, lineTotal: ecFreight });
  }
  if (Number(inv.gross_weight) > 0) {
    products.push({ matchedName: 'Gross weight', isPseudo: true, cellJ: Number(inv.gross_weight), lineTotal: 0 });
  }
  if (Number(inv.vol_weight) > 0) {
    products.push({ matchedName: 'Chargeable weight', isPseudo: true, cellJ: Number(inv.vol_weight), lineTotal: 0 });
  }
  const { computedTotal } = buildSheet19_2(ws, {
    grower: 'La Rosaleda',
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowEC,
  });
  const expectedTotal = (Number(inv.invoice_total) > 0)
    ? Number(inv.invoice_total)
    : ((inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0) + (ecFreight > 0 ? ecFreight : 0));
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'EC', invoice: inv.invoice || '' }
    : null;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'EC-Rosaleda');
  const packingRatios = resolved.slice(0, 52).map(row => row.bunches_per_box ?? null);
  if (packingRatios.some(ratio => ratio != null)) wb.Custprops = { packingBunchesPerBox: JSON.stringify(packingRatios) };
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_EC_ROS_${inv.invoice || 'PL'}.xlsx`,
    label: `La Rosaleda · Invoice ${inv.invoice || ''}`,
    products: resolved.map((p) => ({ name: p.matchedName, qty: p.total_stems || 0, unmatched: p.unmatched, viaAlias: p.viaAlias,
      sourceName: p.description ?? '', matchingDescription: p.description ?? '' })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

// THAILAND — Krung Thep Interflora and Super Fresh.  Orchid invoices.
// One invoice per supplier per shipment.  Variety descriptions extracted
// verbatim from the invoice (no catalog matching for now).  Sheet matches
// the reference template ("Super Fresh" sheet name) used by Nenova.
function genThailand(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Detect supplier.  We only have two known suppliers; default to whatever
  // Claude returned in inv.supplier, else fall back to a generic label.
  const supplierRaw = (inv.supplier || '').trim();
  const su = supplierRaw.toUpperCase();
  const supplier =
    /KRUNG/i.test(su)        ? { name: 'Krung',       abbr: 'KRG' } :
    /SUPER\s*FRESH/i.test(su) ? { name: 'Super Fresh', abbr: 'SF'  } :
    { name: supplierRaw || 'Thailand', abbr: 'TH' };

  // For TH we don't (yet) have a translation catalog — products go in verbatim.
  // The resolver still runs so aliases the user adds later will be honored.
  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveTH = makeProductResolver('TH', catalog, aliases, {
    farm: supplier.name, farmAbbr: supplier.abbr, invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveTH(p, i));

  // Adapt to the buildSheet19_2 product shape used by writeDataRowTH.
  //
  // Thailand orchid invoices have FIXED stems-per-bunch values that depend on
  // the variety family (the model is often unreliable here, so we override):
  //   * Mokara (MOK*)            → 5 stems / bunch
  //   * "loose blooms"           → 100 stems / bunch  (sold loose, not bunched)
  //   * Dendrobium / Oncidium    → 10 stems / bunch
  // Once bunch_st is locked we recompute total_bunch from t_price (which we
  // trust because invoice_total is validated separately), so the J=I*G,
  // L=K*J formulas produce the exact totals that appear on the invoice.
  const thBunchSt = (name) => {
    const n = (name || '').toUpperCase();
    if (/LOOSE\s*BLOOM/.test(n)) return 100;
    if (/\bMOK\b|MOKARA/.test(n))  return 5;
    return 10;  // Dendrobium, Oncidium, default
  };
  const products = resolved.map((p) => {
    const bunch_st = thBunchSt(p.matchedName || p.description);
    const uPrice   = Number(p.u_price) || 0;
    const tPrice   = Number(p.t_price) || 0;
    // Prefer recomputed total_bunch from t_price (most reliable).  Fall back
    // to the model's value only if t_price/u_price is missing.
    const total_bunch_model = Number(p.total_bunch) || 0;
    const total_bunch_calc  = (uPrice > 0 && tPrice > 0)
      ? Math.round(tPrice / (uPrice * bunch_st))
      : total_bunch_model;
    return {
      matchedName: p.matchedName,
      unmatched:   p.unmatched,
      viaAlias:    p.viaAlias,
      bunch_st,
      total_bunch: total_bunch_calc,
      u_price:     uPrice,
    };
  });

  const thFreight = Number.isFinite(Number(inv.freight)) ? Number(inv.freight)
    : Number.isFinite(Number(inv.freight_total)) ? Number(inv.freight_total) : 0;
  if (thFreight > 0) {
    products.push({ matchedName: '운송료', isPseudo: true, cellF: 1, cellG: 1, cellH: 1, cellI: 1, cellJ: 1, cellK: thFreight, cellL: thFreight, lineTotal: thFreight });
  }
  if (Number(inv.gross_weight) > 0) {
    products.push({ matchedName: 'Gross weight', isPseudo: true, cellJ: Number(inv.gross_weight), lineTotal: 0 });
  }
  if (Number(inv.vol_weight) > 0) {
    products.push({ matchedName: 'Chargeable weight', isPseudo: true, cellJ: Number(inv.vol_weight), lineTotal: 0 });
  }

  const { computedTotal } = buildSheet19_2(ws, {
    grower: supplier.name,
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    bchLabel: 'BUNCH/ST',
    products,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowTH,
  });

  // Anchor the total to invoice_total (Claude extracts it directly from the
  // PDF) so missed/duplicated rows surface as a mismatch.  Fall back to the
  // row sum when invoice_total isn't available.
  const rowSum = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const invoiceTotalDeclared = Number(inv.invoice_total) || 0;
  const expectedTotal = invoiceTotalDeclared > 0 ? invoiceTotalDeclared : (rowSum + (thFreight > 0 ? thFreight : 0));
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'TH', invoice: inv.invoice || '' }
    : null;

  const wb = XLSX.utils.book_new();
  // The reference template uses the literal sheet name 'Super Fresh' even for
  // Krung — keeping that quirk so downstream consumers (Nenova templates)
  // don't have to adjust.
  XLSX.utils.book_append_sheet(wb, ws, 'Super Fresh');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  // Sanitize the invoice number for use in the filename (Krung uses "17-Q/2026"
  // which contains a slash that would break the filesystem path).
  const safeInv = (inv.invoice || 'PL').replace(/[\\/:*?"<>|]/g, '_');
  return {
    name:  `${wk}-${num}_TH_${supplier.abbr}_${safeInv}.xlsx`,
    label: `${supplier.name} · Invoice ${inv.invoice || ''}`,
    products: resolved.map((p) => ({
      name: p.matchedName,
      qty: (p.total_bunch || 0) * (p.bunch_st || p.bunchSt || 1),
      unmatched: p.unmatched,
      viaAlias: p.viaAlias,
      sourceName: p.description ?? '',
      matchingDescription: p.description ?? '',
    })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

function genAustralia(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Match each invoice line against catalog AU using aliases + auto-match.
  const products = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveAU = makeProductResolver('AU', catalog, aliases, {
    farm: 'Premium Greens', farmAbbr: 'AU', invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolvedProducts = products.map((p, i) => resolveAU(p, i));

  const adaptedAU = [...resolvedProducts];
  if (Number(inv.gross_weight) > 0) {
    adaptedAU.push({ matchedName: 'Gross weight', isPseudo: true, cellJ: Number(inv.gross_weight), lineTotal: 0 });
  }
  if (Number(inv.vol_weight) > 0) {
    adaptedAU.push({ matchedName: 'Chargeable weight', isPseudo: true, cellJ: Number(inv.vol_weight), lineTotal: 0 });
  }

  const { computedTotal } = buildSheet19_2(ws, {
    grower: 'Premium Greens',
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products: adaptedAU,
    priceFmt: NF_PRICE3,
    writeDataRow: writeDataRowAU,
  });
  const expectedTotal = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const totalMismatch = Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'AU', invoice: inv.invoice || '' }
    : null;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, '호주');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_AU_PG_${inv.invoice || 'PL'}.xlsx`,
    label: `Premium Greens · Invoice ${inv.invoice || ''}`,
    products: resolvedProducts.map((p) => ({ name: p.matchedName, qty: p.total_stems == null
      ? (Number.isFinite(p.total_bunch) && p.total_bunch >= 0
        && Number.isFinite(p.bunch_st) && p.bunch_st >= 0
        ? p.total_bunch * p.bunch_st : null)
      : p.total_stems, unmatched: p.unmatched, viaAlias: p.viaAlias,
      sourceName: p.description ?? '', matchingDescription: p.description ?? '' })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

// =============================================================================
// USA / HOOD CANAL EVERGREENS — simple per-box invoice (no freight, just
// boxes × price).  Pseudo rows: Gross weigth + Chargeable weigth at the end.
// =============================================================================
function genUS(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  // Resolve every line against catalog US.
  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveUS = makeProductResolver('US', catalog, aliases, {
    farm: 'Hood Canal', farmAbbr: 'HC', invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveUS(p, i));

  const products = resolved.map((p) => ({
    matchedName: p.matchedName,
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    pcs: p.pcs || 0,
    bunch_st: p.bunch_st,
    steam_box: p.steam_box,
    total_bunch: p.total_bunch == null || p.total_bunch === '' ? printedReceiptBunchQuantity(p) : Number(p.total_bunch),
    total_stems: p.total_stems || 0,
    u_price: p.u_price || 0,
  }));

  // Pseudo rows: Gross weight + Chargeable weight (match Product master ProdKey 3100/3101).
  if (inv.gross_weight) {
    products.push({
      matchedName: 'Gross weight',
      isPseudo: true,
      cellJ: inv.gross_weight,
      lineTotal: 0,
    });
  }
  if (inv.vol_weight) {
    products.push({
      matchedName: 'Chargeable weight',
      isPseudo: true,
      cellJ: inv.vol_weight,
      lineTotal: 0,
    });
  }

  const { computedTotal } = buildSheet19_2(ws, {
    grower: 'Hood Canal',
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    bchLabel: 'BUNCH/ST',
    products,
    priceFmt: NF_PRICE2,
    writeDataRow: writeDataRowUS,
  });

  // Validate against invoice grand total
  const expectedTotal = (inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0);
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'US', invoice: inv.invoice || '' }
    : null;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'US-HC');
  const packingRatios = resolved.slice(0, 52).map(row => row.bunches_per_box ?? null);
  if (packingRatios.some(ratio => ratio != null)) wb.Custprops = { packingBunchesPerBox: JSON.stringify(packingRatios) };
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_US_HC_${inv.invoice || 'PL'}.xlsx`,
    label: `Hood Canal · Invoice ${inv.invoice || ''}`,
    products: resolved.map((p) => ({ name: p.matchedName, qty: p.total_stems || 0, unmatched: p.unmatched, viaAlias: p.viaAlias,
      sourceName: p.description ?? '', matchingDescription: p.description ?? '' })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

// =============================================================================
// VIETNAM / ROYAL BASE CORPORATION — orchid (Phalaenopsis) cut flowers.
// Single farm, per-stem pricing.  No freight, no weight pseudo-rows on the
// reference packing list — just the products + TOTAL row.
// =============================================================================
function genVN(XLSX, inv, wk, num, opts = {}) {
  const { catalog = null, aliases = {} } = opts;
  const ws = {};
  const weekend = `${wk}-${num.padStart(2, '0')}`;
  const awb = (inv.awb || '').replace(/[^0-9]/g, '');

  const rawProducts = inv.products || [];
  const pending = [];
  const noMatches = [];
  const resolveVN = makeProductResolver('VN', catalog, aliases, {
    farm: 'Royal Base', farmAbbr: 'RB', invoice: inv.invoice || '',
    pending, noMatches,
  });
  const resolved = rawProducts.map((p, i) => resolveVN(p, i));

  // Default stems-per-box for orchids when invoice doesn't specify.  The
  // Royal Base reference uses 16 stems/box across all variants.
  const DEFAULT_STEMS_PER_BOX = 16;

  const products = resolved.map((p) => ({
    matchedName: p.matchedName,
    unmatched: p.unmatched,
    viaAlias: p.viaAlias,
    pcs: 0,
    bunch_st: 1,
    steam_box: p.steam_box || DEFAULT_STEMS_PER_BOX,
    total_stems: p.total_stems || 0,
    u_price: p.u_price || 0,
  }));

  const vnFreight = Number.isFinite(Number(inv.freight)) ? Number(inv.freight)
    : Number.isFinite(Number(inv.freight_total)) ? Number(inv.freight_total) : 0;
  if (vnFreight > 0) {
    products.push({ matchedName: '운송료', isPseudo: true, cellF: 1, cellG: 1, cellH: 1, cellI: 1, cellJ: 1, cellK: vnFreight, cellL: vnFreight, lineTotal: vnFreight });
  }
  if (Number(inv.gross_weight) > 0) {
    products.push({ matchedName: 'Gross weight', isPseudo: true, cellJ: Number(inv.gross_weight), lineTotal: 0 });
  }
  if (Number(inv.vol_weight) > 0) {
    products.push({ matchedName: 'Chargeable weight', isPseudo: true, cellJ: Number(inv.vol_weight), lineTotal: 0 });
  }

  const { computedTotal } = buildSheet19_2(ws, {
    grower: 'Royal Base',
    weekend, invoice: inv.invoice || '', awb, date: inv.date || '',
    products,
    priceFmt: NF_PRICE2,
    writeDataRow: writeDataRowVN,
  });

  const expectedTotal = Number(inv.invoice_total) > 0
    ? Number(inv.invoice_total)
    : ((inv.products || []).reduce((s, p) => s + (Number(p.t_price) || 0), 0) + (vnFreight > 0 ? vnFreight : 0));
  const totalMismatch = expectedTotal > 0 && Math.abs(computedTotal - expectedTotal) > 0.5
    ? { computed: computedTotal, expected: expectedTotal, country: 'VN', invoice: inv.invoice || '' }
    : null;

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'VN-RB');
  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellStyles: true });
  return {
    name: `${wk}-${num}_VN_RB_${inv.invoice || 'PL'}.xlsx`,
    label: `Royal Base · Invoice ${inv.invoice || ''}`,
    products: resolved.map((p) => ({ name: p.matchedName, qty: p.total_stems || 0, unmatched: p.unmatched, viaAlias: p.viaAlias,
      sourceName: p.description ?? '', matchingDescription: p.description ?? '' })),
    pending,
    noMatches,
    totalMismatch,
    buf,
  };
}

export {
  genColombia,
  genNL,
  genChina,
  genEcuador,
  genThailand,
  genAustralia,
  genUS,
  genVN,
};
