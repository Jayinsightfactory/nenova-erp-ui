const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_ROWS = 10_000;
const MAX_SHEETS = 40;

const STATUS_LABELS = {
  matched: '일치',
  review: '검토',
  missing: '미매칭',
  conflict: '충돌',
};

function text(value) {
  return value == null ? '' : String(value).trim();
}

function sameText(a, b) {
  return text(a).toLocaleLowerCase() === text(b).toLocaleLowerCase();
}

function rowResult(hfCode, status, reviewStatus = '', sourceRow = null) {
  const review = text(reviewStatus);
  const showReview = review && !/^match(?:ed)?$/i.test(review) && ['review', 'missing'].includes(status);
  const label = showReview ? `${STATUS_LABELS[status]} (${review})` : STATUS_LABELS[status];
  return { hfCode: text(hfCode), status, label, reviewStatus: review, sourceRow: sourceRow ?? null };
}

function reviewRank(status) {
  const value = text(status).toLocaleLowerCase();
  if (value === 'no match') return 4;
  if (value === 'check') return 3;
  if (value && !/^match(?:ed)?$/.test(value)) return 2;
  if (value) return 1;
  return 0;
}

function compareReviewRows(a, b) {
  const rankDelta = reviewRank(b.reviewStatus) - reviewRank(a.reviewStatus);
  if (rankDelta) return rankDelta;
  const normalizedDelta = text(a.reviewStatus).toLocaleLowerCase().localeCompare(text(b.reviewStatus).toLocaleLowerCase());
  if (normalizedDelta) return normalizedDelta;
  const sourceA = Number.isSafeInteger(a.sourceRow) ? a.sourceRow : Number.MAX_SAFE_INTEGER;
  const sourceB = Number.isSafeInteger(b.sourceRow) ? b.sourceRow : Number.MAX_SAFE_INTEGER;
  if (sourceA !== sourceB) return sourceA - sourceB;
  return text(a.reviewStatus).localeCompare(text(b.reviewStatus));
}

function resolveRows(rows) {
  if (!rows.length) return null;
  const hfCodes = new Set(rows.map(row => text(row.hfCode)).filter(Boolean));
  if (hfCodes.size > 1) return rowResult('', 'conflict');
  if (rows.some(row => !text(row.hfCode))) {
    const blank = rows.filter(row => !text(row.hfCode)).sort(compareReviewRows)[0];
    return rowResult('', 'missing', blank.reviewStatus, blank.sourceRow);
  }
  const selected = [...rows].sort(compareReviewRows)[0];
  if (selected.reviewStatus && !/^match(?:ed)?$/i.test(text(selected.reviewStatus))) {
    return rowResult(selected.hfCode, 'review', selected.reviewStatus, selected.sourceRow);
  }
  return rowResult(selected.hfCode, 'matched', selected.reviewStatus, selected.sourceRow);
}

export function normalizeHfMapping(mapping) {
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) throw new Error('HF 사전 형식이 올바르지 않습니다.');
  if (!Array.isArray(mapping.rows) || mapping.rows.length > MAX_ROWS) throw new Error(`HF 사전 행 수는 ${MAX_ROWS}개 이하여야 합니다.`);
  const rows = mapping.rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error(`${index + 1}행의 형식이 올바르지 않습니다.`);
    const prodKey = row.prodKey == null || row.prodKey === '' ? null : Number(row.prodKey);
    if (prodKey != null && (!Number.isSafeInteger(prodKey) || prodKey <= 0)) throw new Error(`${index + 1}행의 품목번호가 올바르지 않습니다.`);
    const values = ['prodCode', 'prodName', 'country', 'hfCode', 'reviewStatus'];
    for (const key of values) if (row[key] != null && typeof row[key] !== 'string' && typeof row[key] !== 'number') throw new Error(`${index + 1}행 ${key} 값이 올바르지 않습니다.`);
    const sourceRow = row.sourceRow == null || row.sourceRow === '' ? null : Number(row.sourceRow);
    if (sourceRow != null && (!Number.isSafeInteger(sourceRow) || sourceRow < 1)) throw new Error(`${index + 1}행의 원본 행 번호가 올바르지 않습니다.`);
    return {
      prodKey,
      prodCode: text(row.prodCode),
      prodName: text(row.prodName),
      country: text(row.country),
      hfCode: text(row.hfCode),
      reviewStatus: text(row.reviewStatus),
      sourceRow,
    };
  });
  return { sourceFile: text(mapping.sourceFile), sourceSheet: text(mapping.sourceSheet), rows };
}

export function matchChinaHfCode(product, mapping, products) {
  const safeProduct = product && typeof product === 'object' ? product : {};
  const normalized = normalizeHfMapping(mapping);
  const allRows = normalized.rows;
  const prodKey = safeProduct.prodKey == null || safeProduct.prodKey === '' ? '' : String(safeProduct.prodKey).trim();
  const prodCode = text(safeProduct.prodCode);
  const prodName = text(safeProduct.prodName);
  if (text(safeProduct.country) && text(safeProduct.country) !== '중국') return rowResult('', 'missing');
  const chinaRows = allRows.filter(row => !row.country || row.country === '중국');
  const foreignExactRows = allRows.filter(row => row.country && row.country !== '중국'
    && ((prodKey && String(row.prodKey ?? '') === prodKey) || (prodCode && sameText(row.prodCode, prodCode))));
  if (foreignExactRows.length) return rowResult('', 'missing');

  // Source identity drives fallback: a missing source ProdKey permits code matching;
  // only a source row missing both identifiers permits exact-name matching.
  if (prodKey) {
    const byKey = chinaRows.filter(row => String(row.prodKey ?? '') === prodKey);
    if (byKey.length) {
      if (!prodCode || byKey.some(row => !text(row.prodCode) || !sameText(row.prodCode, prodCode))) return rowResult('', 'conflict');
      return resolveRows(byKey);
    }
  }

  if (prodCode) {
    const codeRows = chinaRows.filter(row => sameText(row.prodCode, prodCode));
    if (codeRows.some(row => row.prodKey != null && String(row.prodKey) !== prodKey)) return rowResult('', 'conflict');
    const sourceFallbacks = codeRows.filter(row => row.prodKey == null);
    if (sourceFallbacks.length) {
      if (!Array.isArray(products)) return rowResult('', 'conflict');
      const catalogMatches = products.filter(item => sameText(item?.prodCode, prodCode));
      if (catalogMatches.length !== 1 || sourceFallbacks.length !== 1) return rowResult('', 'conflict');
      if (prodKey && String(catalogMatches[0].prodKey ?? '') !== prodKey) return rowResult('', 'conflict');
      return resolveRows(sourceFallbacks);
    }
    if (codeRows.length) return rowResult('', 'conflict');
  }

  if (prodName) {
    const nameRows = chinaRows.filter(row => sameText(row.prodName, prodName));
    if (nameRows.some(row => row.prodKey != null || text(row.prodCode))) return rowResult('', 'conflict');
    const sourceFallbacks = nameRows.filter(row => row.prodKey == null && !text(row.prodCode));
    if (sourceFallbacks.length) {
      if (!Array.isArray(products)) return rowResult('', 'conflict');
      const catalogMatches = products.filter(item => sameText(item?.prodName, prodName));
      if (catalogMatches.length !== 1 || sourceFallbacks.length !== 1) return rowResult('', 'conflict');
      if (prodKey && String(catalogMatches[0].prodKey ?? '') !== prodKey) return rowResult('', 'conflict');
      if (prodCode && !sameText(catalogMatches[0].prodCode, prodCode)) return rowResult('', 'conflict');
      return resolveRows(sourceFallbacks);
    }
  }
  return rowResult('', 'missing');
}

function bytesOf(input) {
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new Error('엑셀 파일 바이트가 필요합니다.');
}

export function validateChinaHfWorkbookArchive(input) {
  const bytes = bytesOf(input);
  if (bytes.byteLength > MAX_FILE_BYTES) throw new Error('파일 크기는 5MiB 이하여야 합니다.');
  if (bytes.byteLength < 22) throw new Error('올바른 .xlsx 파일이 아닙니다.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const start = Math.max(0, bytes.length - 65_557);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= start; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('xlsx ZIP 중앙 디렉터리를 찾을 수 없습니다.');
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || directorySize === 0xffffffff || directoryOffset === 0xffffffff) throw new Error('ZIP64 xlsx 파일은 지원하지 않습니다.');
  if (entries > 10_000 || directoryOffset + directorySize > eocd || directoryOffset + directorySize > bytes.length) throw new Error('xlsx 중앙 디렉터리가 올바르지 않습니다.');
  let offset = directoryOffset;
  let total = 0;
  for (let i = 0; i < entries; i += 1) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error('xlsx 중앙 디렉터리 항목이 올바르지 않습니다.');
    const compressed = view.getUint32(offset + 20, true);
    const uncompressed = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    if (compressed === 0xffffffff || uncompressed === 0xffffffff) throw new Error('ZIP64 xlsx 파일은 지원하지 않습니다.');
    total += uncompressed;
    if (total > MAX_UNCOMPRESSED_BYTES) throw new Error('압축 해제 파일 크기는 64MiB 이하여야 합니다.');
    offset += 46 + nameLength + extraLength + commentLength;
    if (offset > directoryOffset + directorySize) throw new Error('xlsx 중앙 디렉터리 크기가 올바르지 않습니다.');
  }
  if (offset !== directoryOffset + directorySize) throw new Error('xlsx 중앙 디렉터리 길이가 올바르지 않습니다.');
  return { fileBytes: bytes.byteLength, uncompressedBytes: total, entries };
}

function headerKey(value) {
  return text(value).normalize('NFKC').replace(/[\s._-]+/g, '').toLocaleLowerCase();
}

function pickHeader(headers, names) {
  const accepted = new Set(names.map(headerKey));
  return headers.findIndex(value => accepted.has(headerKey(value)));
}

function codeCellText(row, columnIndex, fieldName, rowNumber) {
  if (columnIndex < 0) return '';
  const cell = row.getCell(columnIndex + 1);
  const value = cell.value;
  if (value && typeof value === 'object' && value.formula && value.result == null) {
    throw new Error(`${rowNumber}행 ${fieldName}: 수식에 저장된 결과가 없어 코드를 확인할 수 없습니다.`);
  }
  const raw = value && typeof value === 'object'
    ? (Array.isArray(value.richText) ? value.richText.map(part => part.text || '').join('') : value.result)
    : value;
  if (raw == null || raw === '') return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw)) {
    throw new Error(`${rowNumber}행 ${fieldName}: 숫자 코드는 안전한 정수여야 합니다.`);
  }
  const format = text(cell.numFmt) || 'General';
  if (/^general$/i.test(format) || format === '@' || format === '0') return String(raw);
  if (/^0+$/.test(format)) return String(raw).padStart(format.length, '0');
  throw new Error(`${rowNumber}행 ${fieldName}: 숫자 서식 '${format}'은 코드로 안전하게 변환할 수 없습니다.`);
}

export async function parseChinaHfWorkbook(arrayBuffer, fileName) {
  if (!/\.xlsx$/i.test(text(fileName))) throw new Error('.xlsx 파일만 업로드할 수 있습니다.');
  const bytes = bytesOf(arrayBuffer);
  validateChinaHfWorkbookArchive(bytes);
  const imported = await import('exceljs');
  const ExcelJS = imported.default || imported;
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (!workbook.worksheets.length || workbook.worksheets.length > MAX_SHEETS) throw new Error(`시트 수는 1~${MAX_SHEETS}개여야 합니다.`);
  const rows = [];
  const reviewStatusesByKey = new Map();
  let sourceSheet = '';
  for (const sheet of workbook.worksheets) {
    const normalizedSheetName = headerKey(sheet.name);
    if (normalizedSheetName === headerKey('HF match review')) {
      let headerRow = null;
      let prodKeyColumn = -1;
      let statusColumn = -1;
      sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
        const values = row.values.slice(1).map(value => value?.text ?? value?.result ?? value ?? '');
        if (headerRow == null) {
          prodKeyColumn = pickHeader(values, ['품목번호', 'ProdKey', 'Product Key']);
          statusColumn = pickHeader(values, ['Status', 'Review Status', 'ReviewStatus', '검토상태', 'Match Status']);
          if (prodKeyColumn < 0 || statusColumn < 0) return;
          headerRow = rowNumber;
          return;
        }
        if (rowNumber <= headerRow) return;
        const rawKey = text(values[prodKeyColumn]);
        const prodKey = /^\d+$/.test(rawKey) ? Number(rawKey) : NaN;
        const status = text(values[statusColumn]);
        // The review worksheet can contain footer labels and formulas. Only real positive product IDs contribute.
        if (!Number.isSafeInteger(prodKey) || prodKey <= 0 || !status) return;
        if (!reviewStatusesByKey.has(prodKey)) reviewStatusesByKey.set(prodKey, new Map());
        const statuses = reviewStatusesByKey.get(prodKey);
        const statusKey = status.toLocaleLowerCase();
        if (!statuses.has(statusKey)) statuses.set(statusKey, status);
      });
      continue;
    }

    let headerRow = null;
    let columns = null;
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rows.length > MAX_ROWS) throw new Error(`HF 사전 행 수는 ${MAX_ROWS}개 이하여야 합니다.`);
      const values = row.values.slice(1).map(value => value?.text ?? value?.result ?? value ?? '');
      if (!headerRow) {
        const hfIndex = pickHeader(values, ['HF CODE', 'HF CODE (HF)', 'HF CODE.']);
        if (hfIndex < 0) return;
        headerRow = rowNumber;
        if (!sourceSheet) sourceSheet = sheet.name;
        columns = {
          hfCode: hfIndex,
          prodKey: pickHeader(values, ['품목번호', 'ProdKey', 'Product Key']),
          prodCode: pickHeader(values, ['품목코드', 'ProdCode', 'Product Code', 'Code']),
          prodName: pickHeader(values, ['품목명', '품명', 'ProdName', 'Product Name', 'Name']),
          country: pickHeader(values, ['국가', 'Country', 'CounName']),
          reviewStatus: pickHeader(values, ['Review Status', 'ReviewStatus', '검토상태', 'Match Status', 'Status']),
        };
        return;
      }
      if (rowNumber <= headerRow) return;
      const value = index => index < 0 ? '' : values[index];
      const rawKey = text(value(columns.prodKey));
      const candidate = {
        prodKey: rawKey ? Number(rawKey) : null,
        prodCode: codeCellText(row, columns.prodCode, '품목코드', rowNumber),
        prodName: text(value(columns.prodName)),
        country: text(value(columns.country)),
        hfCode: codeCellText(row, columns.hfCode, 'HF CODE', rowNumber),
        reviewStatus: text(value(columns.reviewStatus)),
        sourceRow: rowNumber,
      };
      if (candidate.prodKey != null || candidate.prodCode || candidate.prodName || candidate.hfCode) rows.push(candidate);
      if (rows.length > MAX_ROWS) throw new Error(`HF 사전 행 수는 ${MAX_ROWS}개 이하여야 합니다.`);
    });
  }
  if (!rows.length) throw new Error('명시적인 HF CODE 열에서 유효한 사전 행을 찾지 못했습니다.');
  for (const row of rows) {
    if (row.reviewStatus || row.prodKey == null) continue;
    const statuses = reviewStatusesByKey.get(row.prodKey);
    if (!statuses?.size) continue;
    row.reviewStatus = statuses.size > 1 ? 'review정보충돌' : [...statuses.values()][0];
  }
  return normalizeHfMapping({ sourceFile: text(fileName), sourceSheet, rows });
}
