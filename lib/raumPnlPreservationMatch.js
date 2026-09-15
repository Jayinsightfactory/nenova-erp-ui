// Pure one-to-one matcher for preserving WebRaumPnlItem metadata on re-import.
// It intentionally returns collisions instead of choosing between differing saved costs/maps.

const normalizeSpace = (value) => String(value ?? '').replace(/[\s ]+/g, ' ').trim();
const costKey = (value) => normalizeSpace(value).toLowerCase();
const itemName = (item) => item?.name ?? item?.ItemName;
const itemUnit = (item) => item?.unit ?? item?.Unit;
const itemPrice = (item) => item?.price ?? item?.SalePrice ?? 0;
const itemQty = (item) => item?.qty ?? item?.Qty;
const itemSupply = (item) => item?.supply ?? item?.SaleAmount;
const isConsigned = (item) => Number(item?.consigned ?? item?.IsConsigned ?? 0) ? 'C' : '';
const isCustom = (item) => Number(item?.isCustom ?? item?.IsCustom ?? 0) !== 0;
const sourceRemark = (item) => normalizeSpace(item?.sourceRemark ?? item?.SourceRemark ?? item?.remark ?? item?.Remark);

function numberKey(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(6) : `missing:${String(value ?? '')}`;
}

function exactKey(item, partnerCode) {
  const unit = String(partnerCode).toLowerCase() === 'shilla' ? `|${normalizeSpace(itemUnit(item))}` : '';
  return `${costKey(itemName(item))}${unit}|${Number(itemPrice(item)).toFixed(2)}|${isConsigned(item)}`;
}

function fallbackKey(item) {
  return `${costKey(itemName(item))}|${normalizeSpace(itemUnit(item))}|${isConsigned(item)}`;
}

function contentKey(item) {
  return `${numberKey(itemQty(item))}|${numberKey(itemSupply(item))}`;
}

function preservationMetadataKey(row) {
  // The core only carries a manual (or legacy no-source) cost forward.  Automatic
  // Shilla/arrival costs are recalculated and must not manufacture an ambiguity.
  const preservedManualCost = row?.CostPrice != null && (row?.CostSource === 'manual' || !row?.CostSource)
    ? Number(row.CostPrice)
    : null;
  return JSON.stringify([
    preservedManualCost,
    row?.ProdKey ?? null,
  ]);
}

function addToIndex(index, key, value) {
  if (!index.has(key)) index.set(key, []);
  index.get(key).push(value);
}

function candidateLabel(item) {
  return `${normalizeSpace(itemName(item)) || '품목명 없음'}${normalizeSpace(itemUnit(item)) ? ` ${normalizeSpace(itemUnit(item))}` : ''}`;
}

/**
 * Match incoming canonical P&L items to ordinary existing DB rows without mutation.
 *
 * @param {Array<object>} incomingItems canonical parser/import rows.
 * @param {Array<object>} existingRows WebRaumPnlItem DB rows; IsCustom rows are excluded.
 * @param {string} partnerCode `shilla` includes unit in exact identity; Raum keeps legacy identity.
 * @returns {{matches: Array<object|null>, fallbackCount: number, collisions: Array<object>}}
 * `matches[i]` is the original existing row for incomingItems[i], or null when no safe match exists.
 * A collision has `reason`, candidate DB indexes, and a Korean `message`; callers must block saving.
 */
export function matchRaumPnlPreservationRows(incomingItems, existingRows, partnerCode) {
  const incoming = Array.isArray(incomingItems) ? incomingItems : [];
  const existing = Array.isArray(existingRows) ? existingRows : [];
  const exactIndex = new Map();
  const fallbackIndex = new Map();
  for (const [existingIndex, row] of existing.entries()) {
    if (isCustom(row)) continue;
    const entry = {
      row,
      existingIndex,
      exact: exactKey(row, partnerCode),
      fallback: fallbackKey(row),
      content: contentKey(row),
      source: sourceRemark(row),
      metadata: preservationMetadataKey(row),
    };
    addToIndex(exactIndex, entry.exact, entry);
    addToIndex(fallbackIndex, entry.fallback, entry);
  }

  const matches = Array(incoming.length).fill(null);
  const used = new Set();
  const collisions = [];
  const sourceContentConflicts = new Map();
  const sourceCardinalityConflicts = new Map();
  let fallbackCount = 0;
  const exactCandidateCounts = incoming.map(item => (exactIndex.get(exactKey(item, partnerCode)) || []).length);

  const available = (candidates) => candidates.filter(candidate => !used.has(candidate.existingIndex));
  const take = (incomingIndex, candidate, viaFallback) => {
    matches[incomingIndex] = candidate.row;
    used.add(candidate.existingIndex);
    if (viaFallback) fallbackCount += 1;
  };
  const allSameMetadata = (candidates) => new Set(candidates.map(candidate => candidate.metadata)).size === 1;
  const hasPreservedMetadata = (candidates) => candidates.some(candidate => candidate.metadata !== '[null,null]');

  function hasStableUniqueSources(indices, groupCandidates) {
    if (indices.length !== groupCandidates.length || indices.length === 0) return false;
    const incomingSources = indices.map(index => sourceRemark(incoming[index]));
    const existingSources = groupCandidates.map(candidate => candidate.source);
    if (incomingSources.some(source => !source) || existingSources.some(source => !source)) return false;
    if (new Set(incomingSources).size !== incomingSources.length || new Set(existingSources).size !== existingSources.length) return false;
    const existingSet = new Set(existingSources);
    return incomingSources.every(source => existingSet.has(source));
  }

  function safelyMatch(indices, index, keyForItem, viaFallback) {
    const groups = new Map();
    for (const incomingIndex of indices) addToIndex(groups, keyForItem(incoming[incomingIndex]), incomingIndex);

    for (const [key, groupIndices] of groups) {
      // Fallback runs after exact matching.  Its cardinality/source plan must
      // only see rows still eligible for this phase, never an already consumed
      // exact-price row from the same fallback identity.
      const groupCandidates = available(index.get(key) || []);
      const stableSources = hasStableUniqueSources(groupIndices, groupCandidates);

      // A changed source-group cardinality can be an inserted/deleted row plus
      // a moved and edited old row.  Matching an identical-looking incoming row
      // would steal old manual metadata, so do not consume this group.
      // No existing row is the normal first-upload case, not an ambiguity.
      if (groupCandidates.length === 0) continue;
      // If the old rows carry no manual/legacy cost or product key, connecting
      // one of them is observationally equivalent to leaving it unmatched.
      // Only protect an increased group when actual preserved metadata exists.
      if (groupIndices.length !== groupCandidates.length && hasPreservedMetadata(groupCandidates)) {
        for (const incomingIndex of groupIndices) sourceCardinalityConflicts.set(incomingIndex, groupCandidates);
        continue;
      }

      // Content comes first: stable row labels alone cannot distinguish a
      // reordered workbook when quantity/sale amount identify each old row.
      // It must be unique on both sides.  Otherwise the first duplicate input
      // row could consume a different source row before stable-source matching.
      const incomingContentCounts = new Map();
      for (const incomingIndex of groupIndices) {
        if (matches[incomingIndex]) continue;
        const signature = contentKey(incoming[incomingIndex]);
        incomingContentCounts.set(signature, (incomingContentCounts.get(signature) || 0) + 1);
      }
      for (const incomingIndex of groupIndices) {
        const signature = contentKey(incoming[incomingIndex]);
        const candidates = available(groupCandidates).filter(candidate => candidate.content === signature);
        if (incomingContentCounts.get(signature) === 1 && candidates.length === 1) take(incomingIndex, candidates[0], viaFallback);
      }

      // With the same cardinality and the same unique source set, an exact
      // identity group can safely retain a row's metadata after that source row
      // alone was edited.  Do not apply this to price fallback: a moved row with
      // changed prices has no unchanged qty/supply signature to prove position.
      if (stableSources && !viaFallback) {
        for (const incomingIndex of groupIndices) {
          if (matches[incomingIndex]) continue;
          const source = sourceRemark(incoming[incomingIndex]);
          const candidates = available(groupCandidates).filter(candidate => candidate.source === source);
          if (candidates.length === 1) take(incomingIndex, candidates[0], false);
        }
      } else {
        // Outside a stable source set, source locations are trusted only when
        // their quantity and sale amount also agree.
        for (const incomingIndex of groupIndices) {
          if (matches[incomingIndex]) continue;
          const item = incoming[incomingIndex];
          const source = sourceRemark(item);
          if (!source) continue;
          const sourceCandidates = available(groupCandidates).filter(candidate => candidate.source === source);
          const candidates = sourceCandidates.filter(candidate => candidate.content === contentKey(item));
          if (!viaFallback && sourceCandidates.length && !candidates.length
            && groupCandidates.length > 1 && !allSameMetadata(groupCandidates)) {
            sourceContentConflicts.set(incomingIndex, sourceCandidates);
          }
          if (candidates.length === 1) take(incomingIndex, candidates[0], viaFallback);
        }
      }

      // Preserve the legacy singleton behavior, including a qty/amount edit.
      for (const incomingIndex of groupIndices) {
        if (matches[incomingIndex] || sourceContentConflicts.has(incomingIndex)) continue;
        const candidates = available(groupCandidates);
        if (candidates.length === 1) take(incomingIndex, candidates[0], viaFallback);
      }
      // Identical preserved metadata has no observable preservation choice.
      for (const incomingIndex of groupIndices) {
        if (matches[incomingIndex] || sourceContentConflicts.has(incomingIndex)) continue;
        const candidates = available(groupCandidates);
        if (candidates.length && allSameMetadata(candidates)) take(incomingIndex, candidates[0], viaFallback);
      }
    }
  }

  const exactIndices = incoming.map((_, index) => index).filter(index => exactCandidateCounts[index] > 0);
  safelyMatch(exactIndices, exactIndex, item => exactKey(item, partnerCode), false);

  // Never use fallback to escape an ambiguous exact identity. Price changes only get fallback
  // when that incoming item had no exact candidate at all.
  const fallbackIndices = incoming.map((_, index) => index)
    .filter(index => !matches[index] && exactCandidateCounts[index] === 0);
  safelyMatch(fallbackIndices, fallbackIndex, fallbackKey, true);

  for (const incomingIndex of incoming.map((_, index) => index)) {
    if (matches[incomingIndex]) continue;
    const item = incoming[incomingIndex];
    const exactCandidates = available(exactIndex.get(exactKey(item, partnerCode)) || []);
    const usingFallback = exactCandidateCounts[incomingIndex] === 0;
    const candidates = usingFallback
      ? available(fallbackIndex.get(fallbackKey(item)) || [])
      : exactCandidates;
    const sourceCardinalityConflict = sourceCardinalityConflicts.get(incomingIndex);
    const sourceConflict = sourceContentConflicts.get(incomingIndex);
    if (sourceCardinalityConflict) {
      collisions.push({
        code: 'PRESERVATION_MATCH_AMBIGUOUS', reason: 'source-cardinality-change', incomingIndex,
        itemName: normalizeSpace(itemName(item)), partnerCode: String(partnerCode || ''),
        candidateIndexes: sourceCardinalityConflict.map(candidate => candidate.existingIndex),
        message: `${candidateLabel(item)}: 같은 원본 품목의 행 수가 달라 추가·삭제와 이동·수정된 기존행을 안전하게 구분할 수 없습니다.`,
      });
    } else if (sourceConflict) {
      collisions.push({
        code: 'PRESERVATION_MATCH_AMBIGUOUS', reason: 'source-location-content-mismatch', incomingIndex,
        itemName: normalizeSpace(itemName(item)), partnerCode: String(partnerCode || ''),
        candidateIndexes: sourceConflict.map(candidate => candidate.existingIndex),
        message: `${candidateLabel(item)}: 같은 원본 위치의 기존행 수량 또는 금액이 달라 삽입·이동 여부를 안전하게 판단할 수 없습니다.`,
      });
    } else if (candidates.length > 1 && !allSameMetadata(candidates)) {
      const reason = usingFallback ? 'fallback-preservation-metadata-differ' : 'exact-preservation-metadata-differ';
      collisions.push({
        code: 'PRESERVATION_MATCH_AMBIGUOUS', reason, incomingIndex,
        itemName: normalizeSpace(itemName(item)), partnerCode: String(partnerCode || ''),
        candidateIndexes: candidates.map(candidate => candidate.existingIndex),
        message: `${candidateLabel(item)}: 기존행 ${candidates.length}개가 서로 다른 수기원가 또는 품목 연결을 가져 안전하게 보존할 수 없습니다.`,
      });
    }
  }

  return { matches, fallbackCount, collisions };
}

export const matchRaumPnlImportedPreservationRows = matchRaumPnlPreservationRows;
