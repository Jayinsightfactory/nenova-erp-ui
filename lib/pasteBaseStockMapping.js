// A stock-note choice belongs to a source row, not to a product-name alias.
const signature = row => JSON.stringify([row?.name || '', row?.matchName || row?.name || '', row?.flowerContext || '']);
const fullSignature = row => JSON.stringify([signature(row), row?.qty ?? null, row?.boxQty ?? null,
  row?.detailQty ?? null, row?.unit || '', row?.detailUnit || '']);

export function normalizeBaseStockFlowerContext(line) {
  const s = String(line || '').trim().replace(/\s+/g, '');
  if (s === '카네') return '카네이션';
  if (s === '리시안') return '리시안셔스';
  if (/^알스트로(?:메리아)?$/i.test(s)) return '알스트로';
  return /^(수국|장미|카네이션|알스트로|루스커스|호주|레몬잎|호접|덴파레|리시안셔스|튤립)$/.test(s) ? s : '';
}

export function baseStockMatchName(name, flowerContext) {
  const productName = String(name || '').trim();
  return productName && flowerContext && !productName.includes(flowerContext)
    ? `${flowerContext} ${productName}` : productName;
}

export function previousBaseStockMatches(rows = [], previous = []) {
  const assigned = new Map();
  const used = new Set();
  const assign = (index, oldIndex) => { assigned.set(index, previous[oldIndex]); used.add(oldIndex); };
  // The quantity-bearing signature identifies a moved row before line numbers
  // are considered; this prevents an inserted same-name row stealing a choice.
  rows.forEach((row, index) => {
    const key = fullSignature(row);
    if (rows.filter(item => fullSignature(item) === key).length !== 1) return;
    const matches = previous.map((old, oldIndex) => ({old, oldIndex})).filter(({old}) => fullSignature(old) === key);
    if (matches.length === 1) assign(index, matches[0].oldIndex);
  });
  const remaining = () => rows.map((row, index) => ({row, index})).filter(({index}) => !assigned.has(index));
  // A quantity edit is safe when there is exactly one remaining row with the
  // same source name and flower context on each side.
  remaining().forEach(({row, index}) => {
    const key = signature(row);
    if (remaining().filter(item => signature(item.row) === key).length !== 1) return;
    const candidates = previous.map((old, oldIndex) => ({old, oldIndex}))
      .filter(({old, oldIndex}) => !used.has(oldIndex) && signature(old) === key);
    if (candidates.length === 1) assign(index, candidates[0].oldIndex);
  });
  // Identical/edited duplicate groups may stay put, but insertion or removal
  // makes their positional identity ambiguous and requires confirmation.
  remaining().forEach(({row, index}) => {
    const key = signature(row);
    const currentGroup = remaining().filter(item => signature(item.row) === key);
    const priorGroup = previous.map((old, oldIndex) => ({old, oldIndex}))
      .filter(({old, oldIndex}) => !used.has(oldIndex) && signature(old) === key);
    if (currentGroup.length !== priorGroup.length || !currentGroup.every(item => priorGroup.some(old => old.old.idx === item.row.idx))) return;
    const found = priorGroup.find(item => item.old.idx === row.idx);
    if (found) assign(index, found.oldIndex);
  });
  return assigned;
}

export function confirmedBaseStockMatch(row, matches, products = []) {
  if (!Array.isArray(matches)) return null;
  const lineMatches = matches.filter(item => item?.idx === row?.idx);
  if (lineMatches.length !== 1) return null;
  const match = lineMatches[0];
  if (!match || signature(match) !== signature(row)
    || match.qty !== row.qty || match.boxQty !== row.boxQty || match.detailQty !== row.detailQty
    || (row.unit && match.unit !== row.unit) || (row.detailUnit && match.detailUnit !== row.detailUnit)) return null;
  const prodKey = Number(match.prodKey);
  if (!Number.isInteger(prodKey) || prodKey <= 0 || !products.some(product => Number(product.ProdKey) === prodKey)) return null;
  return {match, prodKey};
}

export function combinePickedBaseStockInput(notes = [], {mode = 'replace', text = '', matches = [], exclusions = []} = {}) {
  let combinedText = mode === 'append' ? String(text || '') : '';
  const combinedMatches = mode === 'append' ? [...matches] : [];
  const combinedExclusions = mode === 'append' ? [...exclusions] : [];
  for (const note of notes) {
    const source = String(note?.data?.baseStockText || '');
    if (!source.trim()) continue;
    // A stock title is a section boundary; it also resets flower context.
    const prefix = combinedText ? `${combinedText}\n기초재고\n` : combinedText;
    const lineOffset = prefix ? prefix.split(/\r?\n/).length - 1 : 0;
    const charOffset = prefix.length;
    combinedText = prefix + source;
    for (const row of note.data.baseStockMatches || []) combinedMatches.push({...row, idx: row.idx + lineOffset});
    for (const excluded of note.data.baseStockExcludedLines || []) {
      if (Number.isInteger(excluded)) combinedExclusions.push(excluded + lineOffset);
      else if (excluded && typeof excluded === 'object') combinedExclusions.push({...excluded,
        start: excluded.start + charOffset, end: excluded.end + charOffset});
    }
  }
  return {text: combinedText, matches: combinedMatches, exclusions: combinedExclusions};
}
