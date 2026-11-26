import { normalizePackingMetadata, normalizePackingDate } from './importPackingMetadata.js';
import {invoiceAwbIdentity} from './invoiceAwbIdentity.js';

function assertOptionalNumber(record, field, { nonNegative = false } = {}) {
  if (!Object.prototype.hasOwnProperty.call(record, field) || record[field] == null) return;
  const value = record[field];
  if (typeof value === 'boolean' || (typeof value === 'string' && !value.trim())
    || (typeof value !== 'number' && typeof value !== 'string')) {
    throw new Error('Invalid invoice number: ' + field);
  }
  const number = Number(value);
  if (!Number.isFinite(number) || (nonNegative && number < 0)) throw new Error('Invalid invoice number: ' + field);
}

function parseLocaleFlexibleNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // European thousands dot + decimal comma: "1.923,00" -> "1923.00"
  if (/^-?\d{1,3}(?:\.\d{3})+,\d+$/.test(trimmed)) {
    const n = Number(trimmed.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  // US thousands comma + decimal dot: "1,923.00" -> "1923.00"
  if (/^-?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  // Decimal comma without thousands separator: "513,00", "0,57", "30,00" -> "513.00"
  if (/^-?\d+,\d{1,4}$/.test(trimmed) && !/^-?\d{1,3},\d{3}$/.test(trimmed)) {
    const n = Number(trimmed.replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }
  const direct = Number(trimmed);
  return Number.isFinite(direct) ? direct : null;
}

const EURO_COUNT_FIELDS = new Set(['total_stems', 'stems', 'total_bunch', 'steam_box']);

function normalizeRowLocaleNumbers(row) {
  if (!row || typeof row !== 'object') return row;
  const usesEuroComma = ['pcs', 'u_price', 't_price', 'price'].some(
    f => typeof row[f] === 'string' && /^-?\d+,\d{1,4}$/.test(row[f].trim()),
  );
  let patched = null;
  for (const field of ['pcs', 'bunch_st', 'steam_box', 'total_stems', 'total_bunch', 'stems', 'price', 'u_price', 't_price']) {
    if (typeof row[field] === 'string' && row[field].trim()) {
      const trimmed = row[field].trim();
      let parsed = null;
      // European thousands dot on integer count fields (e.g. Varietta "1.200" stems with "0,2050" price)
      if (usesEuroComma && EURO_COUNT_FIELDS.has(field) && /^\d{1,3}(?:\.\d{3})+$/.test(trimmed)) {
        const euroInt = Number(trimmed.replace(/\./g, ''));
        if (Number.isFinite(euroInt)) parsed = euroInt;
      }
      if (parsed === null) parsed = parseLocaleFlexibleNumber(trimmed);
      if (parsed !== null && parsed !== Number(trimmed)) {
        patched = patched || { ...row };
        patched[field] = parsed;
      }
    }
  }
  return patched || row;
}

function normalizeInvoiceLocaleNumbers(invoice, rowsKey) {
  if (!invoice || typeof invoice !== 'object') return invoice;
  let next = { ...invoice };
  for (const field of ['freight', 'freight_total', 'handling', 'gross_weight', 'vol_weight', 'invoice_total', 'total_value']) {
    if (typeof next[field] === 'string' && next[field].trim()) {
      const parsed = parseLocaleFlexibleNumber(next[field]);
      if (parsed !== null) next[field] = parsed;
    }
  }
  if (Array.isArray(next[rowsKey])) {
    next[rowsKey] = next[rowsKey].map(normalizeRowLocaleNumbers);
  }
  return next;
}

// Recover CO physical box count when AI copied fractional/full-box equivalent BXS
// (e.g. 7, 7.5, or 7500 from "7,500") instead of physical PCS boxes (e.g. "30,00QBx30" => 30 * 30 = 900).
export function reconcileColombiaBoxPieces(row) {
  if (!row || typeof row !== 'object') return row;
  const normalized = normalizeRowLocaleNumbers(row);
  const pcs = Number(normalized?.pcs);
  const steamBox = Number(normalized?.steam_box);
  const totalStems = Number(normalized?.total_stems);
  if (!(steamBox > 0 && totalStems > 0)) return normalized;
  if (pcs > 0 && Math.abs(pcs * steamBox - totalStems) <= 0.02) return normalized;

  const actualPcs = totalStems / steamBox;
  const exactIntegerBoxes = Number.isFinite(actualPcs) && actualPcs > 0 && Math.abs(actualPcs - Math.round(actualPcs)) <= 1e-6
    ? Math.round(actualPcs)
    : null;

  const quoteSources = [
    normalized?.source_cells?.pcs?.quote,
    normalized?.review_evidence?.pcs?.quote,
    normalized?.evidence?.pcs?.quote,
    normalized?.source_cells?.steam_box?.quote,
    normalized?.review_evidence?.steam_box?.quote,
    normalized?.evidence?.steam_box?.quote,
    normalized?.review_evidence?.boxQuantity?.quote,
    normalized?.source_unit_spec,
  ].filter(v => typeof v === 'string' && v.trim()).join(' | ');

  const packRegex = /(\d+(?:[.,]\d{1,3})?)\s*(?:QB|HB|FB|OB|EB|SB|TB|BX|BXS|BOX|BOXES)\s*(?:[xX×*]\s*(\d+))?\b/gi;
  let match;
  const matches = [];
  while ((match = packRegex.exec(quoteSources)) !== null) {
    const stemsPerBox = match[2] ? Number(match[2]) : steamBox;
    if (stemsPerBox !== steamBox) continue;
    const raw = match[1];
    const candidates = new Set([Number(raw.replace(',', '.'))]);
    if (/^\d{1,3},\d{3}$/.test(raw)) candidates.add(Number(raw.replace(',', '')));
    for (const pieces of candidates) {
      if (Number.isInteger(pieces) && pieces > 0 && Math.abs(pieces * steamBox - totalStems) <= 0.02) {
        matches.push(pieces);
      }
    }
  }
  const uniqueQuoteMatches = [...new Set(matches)];
  if (uniqueQuoteMatches.length === 1) {
    return { ...normalized, pcs: uniqueQuoteMatches[0] };
  }

  // Deterministic BXS Full/Half-box equivalent exclusion:
  // Physical box counts are never fractional (7.5), x1000 3-decimal BXS misreads (7500 from "7,500"),
  // or Full-Box Equivalents (e.g. El Cactus BOXES 1.00 = 2 HB, Varietta FULL BOXES 1,00 = 4 QB).
  // When total_stems * u_price === t_price (proving total_stems is exact) AND actualPcs is an integer,
  // exclude Full-box (actualPcs/4), Half-box (actualPcs/2), or Eighth-box (actualPcs/8) equivalents.
  const uPrice = Number(normalized?.u_price);
  const tPrice = Number(normalized?.t_price);
  const amountVerified = uPrice > 0 && tPrice > 0 && Math.abs(totalStems * uPrice - tPrice) <= 0.05;
  if (exactIntegerBoxes !== null && amountVerified && pcs > 0) {
    const fullEq = exactIntegerBoxes / 4;
    const halfEq = exactIntegerBoxes / 2;
    const eighthEq = exactIntegerBoxes / 8;
    const isFullOrFractionBxs = Math.abs(pcs - fullEq) <= 0.05
      || Math.abs(pcs - halfEq) <= 0.05
      || Math.abs(pcs - eighthEq) <= 0.05;
    const isThousandScaledBxs = pcs >= 1000 && (
      pcs === Math.round(fullEq * 1000)
      || pcs === Math.round(halfEq * 1000)
      || pcs === Math.round(eighthEq * 1000)
    );
    if (isFullOrFractionBxs || isThousandScaledBxs) {
      return { ...normalized, pcs: exactIntegerBoxes };
    }
  }

  return normalized;
}

/**
 * Self-heal Colombia invoice rows & zero-extras totals across fresh, cached, and saved-history payloads.
 * When sum(products.t_price) === invoice_total (±$0.05) and freight_total is absent/null, freight_total is mathematically 0.
 */
export function healColombiaInvoiceExtraction(invoice) {
  if (!invoice || typeof invoice !== 'object') return invoice;
  const localeCleaned = normalizeInvoiceLocaleNumbers(invoice, 'products');
  const rows = Array.isArray(localeCleaned.products)
    ? localeCleaned.products.map(reconcileColombiaBoxPieces)
    : localeCleaned.products;
  let rowsChanged = Array.isArray(rows) && Array.isArray(invoice.products)
    && rows.some((row, idx) => row?.pcs !== invoice.products[idx]?.pcs || row?.t_price !== invoice.products[idx]?.t_price);

  let freightTotal = localeCleaned.freight_total;
  let clearedExtrasIssue = false;
  const declaredTotal = localeCleaned.invoice_total ?? localeCleaned.total_value;
  if ((freightTotal === null || freightTotal === undefined || freightTotal === '')
    && Number.isFinite(Number(declaredTotal)) && Array.isArray(rows) && rows.length > 0
    && rows.every(r => r && Number.isFinite(Number(r.t_price)))) {
    const goodsSum = rows.reduce((sum, r) => sum + Number(r.t_price), 0);
    if (Math.abs(goodsSum - Number(declaredTotal)) <= 0.05) {
      freightTotal = 0;
      clearedExtrasIssue = true;
    }
  }

  const stripExtrasIssue = list => (Array.isArray(list)
    ? list.filter(item => !(clearedExtrasIssue && ['INVOICE_EXTRAS_UNAVAILABLE', 'AMOUNT_COMPONENTS_UNAVAILABLE'].includes(item?.code)))
    : list);

  const cleanedExtractionIssues = stripExtrasIssue(localeCleaned.extractionIssues);
  const cleanedMetadataIssues = stripExtrasIssue(localeCleaned.metadataIssues);
  const cleanedSnakeMetadataIssues = stripExtrasIssue(localeCleaned.metadata_issues);

  let next = {
    ...localeCleaned,
    products: rows,
    ...(freightTotal !== undefined ? { freight_total: freightTotal } : {}),
    ...(cleanedExtractionIssues !== undefined ? { extractionIssues: cleanedExtractionIssues } : {}),
    ...(cleanedMetadataIssues !== undefined ? { metadataIssues: cleanedMetadataIssues } : {}),
    ...(cleanedSnakeMetadataIssues !== undefined ? { metadata_issues: cleanedSnakeMetadataIssues } : {}),
  };
  if (rowsChanged && next.packingReview?.sourceReview) {
    const { sourceReview: _staleSourceReview, ...restReview } = next.packingReview;
    next = { ...next, packingReview: restReview };
  }
  const hasMetadataState = Array.isArray(next.extractionIssues)
    || Array.isArray(next.metadataIssues)
    || Array.isArray(next.metadata_issues)
    || next.metadataReview !== undefined;
  return hasMetadataState ? normalizePackingMetadata(next, 'CO') : next;
}

export function parsePackingResponse(data, country) {
  if (!['CO','NL','CN','EC','TH','AU','US','VN'].includes(country)) throw new Error('Unsupported packing country.');
  if (!data || !Array.isArray(data.content)) throw new Error("Invalid PDF analysis response.");
  let wasTruncated = (data.stop_reason === 'max_tokens');
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  // Find the start of the JSON object
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) throw new Error('No JSON found in response: ' + text.slice(0, 200));
  let jsonText = text.slice(jsonStart);
  // Try strict parse first
  let result = null;
  try {
    result = JSON.parse(jsonText);
  } catch (firstErr) {
    // Strategy 1: trim trailing junk (markdown fences, prose) and retry.
    // This handles the common case where the model adds ``` after the JSON.
    const lastBrace = jsonText.lastIndexOf('}');
    if (lastBrace > 0 && lastBrace < jsonText.length - 1) {
      try {
        result = JSON.parse(jsonText.slice(0, lastBrace + 1));
      } catch (_) { /* fall through to invoice-level recovery */ }
    }
    if (result === null) {
    // Response may be truncated. Try to recover by closing open structures.
    // Strategy: walk the string tracking brackets/quotes; truncate at last complete object in invoices array; then close.
    try {
      let depth = 0, inStr = false, escape = false;
      let lastSafeEnd = -1;       // position right after a top-level invoice element (after its '}')
      let inInvoicesArr = false;
      let invDepth = 0;            // depth of objects within invoices array (1 = invoice object level)
      // Locate start of "invoices":[
      const invIdx = jsonText.indexOf('"invoices"');
      let arrayStart = -1;
      if (invIdx >= 0) {
        const colonIdx = jsonText.indexOf('[', invIdx);
        if (colonIdx >= 0) arrayStart = colonIdx;
      }
      for (let i = 0; i < jsonText.length; i++) {
        const c = jsonText[i];
        if (escape) { escape = false; continue; }
        if (inStr) {
          if (c === '\\') escape = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (i === arrayStart) { inInvoicesArr = true; continue; }
        if (!inInvoicesArr) continue;
        if (c === '{') invDepth++;
        else if (c === '}') {
          invDepth--;
          if (invDepth === 0) lastSafeEnd = i + 1;
        } else if (c === ']' && invDepth === 0) { break; }
      }
      if (lastSafeEnd > 0) {
        // Cut after the last complete invoice and close the structure
        const truncated = jsonText.slice(0, lastSafeEnd) + ']}';
        result = JSON.parse(truncated);
        // Detect REAL truncation: there was content after lastSafeEnd that
        // we discarded (an incomplete invoice).  If the only thing after
        // was whitespace + ']}' / ']' / trailing markdown, it wasn't a
        // truncation, just slightly malformed JSON we cleaned up.
        const tail = jsonText.slice(lastSafeEnd).replace(/\s+/g, '');
        const tailIsJustClosers = /^[\]}\s,`]*$/.test(tail) || tail === '';
        if (!tailIsJustClosers) {
          wasTruncated = true;
          console.warn('Recovered from truncated JSON. Some invoices may be missing.');
        }
      } else {
        throw firstErr;
      }
    } catch (recovErr) {
      // Last resort: report position from original error
      throw new Error('JSON parse failed (response may be too large). ' + (firstErr.message || ''));
    }
    }  // end of if (result === null)
  }

  if (!result || !Array.isArray(result.invoices) || !result.invoices.length) throw new Error("No invoices found in PDF");
  const key = country === 'NL' ? 'lines' : 'products';
  // Century evidence may come from another explicitly dated invoice in this
  // exact PDF and shared checksum-valid MAWB, never from today's year/filename.
  const sharedMaster = country === 'CO' ? invoiceAwbIdentity(result.master_awb) : '';
  const datedSources = sharedMaster ? result.invoices.flatMap(source => {
    const date = normalizePackingDate(source.raw_date,{dateOrder:source.date_order});
    const proof = source.metadata_evidence?.date;
    return date && proof?.quote && proof.quote.includes(date.slice(0,4))
      ? [{year:date.slice(0,4),proof,invoice:source.invoice}] : [];
  }) : [];
  const sourceYears = new Set(datedSources.map(source=>source.year));
  result = { ...result, invoices: result.invoices.map(rawInvoice => {
    const invoice = normalizeInvoiceLocaleNumbers(rawInvoice, key);
    if (!invoice || !Array.isArray(invoice[key]) || !invoice[key].length) {
      throw new Error('Invalid invoice product rows.');
    }
    for (const row of invoice[key]) {
      if (!row || typeof row.description !== 'string' || !row.description.trim()) {
        throw new Error('Invalid invoice product description.');
      }
      for (const field of ['pcs','bunch_st','steam_box','total_stems','total_bunch','stems','price','u_price','t_price']) {
        assertOptionalNumber(row, field, { nonNegative: true });
      }
    }
    for (const field of ['freight','freight_total','handling','gross_weight','vol_weight','invoice_total','total_value']) {
      assertOptionalNumber(invoice, field);
    }
    const master = country === 'CO' ? invoiceAwbIdentity(result.master_awb) : '';
    const printed = invoiceAwbIdentity(invoice.awb);
    if (master && printed && master !== printed) throw new Error('공동 AWB와 송장의 AWB 번호가 다릅니다. 원문을 확인하세요.');
    const peerYear = sourceYears.size === 1 ? datedSources[0] : null;
    const ownYearProof = invoice.date_year_evidence?.quote && String(invoice.date_year_evidence.quote).includes(String(invoice.date_year_evidence.year));
    const sharedYear = peerYear && !ownYearProof && /^\d{4}[/-]/.test(String(invoice.date))
      && String(invoice.date).slice(0,4) === peerYear.year ? {
        ...(invoice.date_year_evidence ? {original_date_year_evidence:invoice.date_year_evidence} : {}),
        date_year:peerYear.year,date_year_evidence:{year:peerYear.year,quote:peerYear.proof.quote,
          page:peerYear.proof.page,source:'SAME_PDF_SHARED_MAWB',masterAwb:sharedMaster,invoice:peerYear.invoice},
      } : {};
    const prepared = {
      ...invoice,
      ...sharedYear,
      ...(master ? {master_awb: result.master_awb, house_awb: printed ? invoice.house_awb : invoice.awb, awb: result.master_awb} : {}),
      invoice: invoice.invoice == null ? '' : String(invoice.invoice),
    };
    if (country === 'CO') {
      return normalizePackingMetadata(healColombiaInvoiceExtraction(prepared), country);
    }
    return normalizePackingMetadata(prepared, country);
  }) };
  if (result.awb_document != null) {
    const awb = result.awb_document;
    if (!awb || typeof awb !== 'object' || Array.isArray(awb)) throw new Error('AWB 인식 결과 형식이 올바르지 않습니다.');
    for (const field of ['gross_weight_kg', 'chargeable_weight_kg', 'packages']) assertOptionalNumber(awb, field, { nonNegative: true });
    if (awb.awb != null && typeof awb.awb !== 'string') throw new Error('AWB 번호 인식값이 올바르지 않습니다.');
    if (awb.invoice_awb != null && typeof awb.invoice_awb !== 'string') throw new Error('인보이스 AWB 번호 인식값이 올바르지 않습니다.');
    if (awb.currency != null && awb.currency !== 'AUD') throw new Error('AWB 통화가 AUD가 아닙니다.');
  }
  return { result, wasTruncated };
}
