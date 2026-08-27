function normalizedNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function normalizedWeekDays(value) {
  const days = value instanceof Set
    ? [...value]
    : Array.isArray(value)
      ? value
      : String(value || '').split(',');
  return [...new Set(days
    .map((day) => String(day || '').trim())
    .filter(Boolean))]
    .sort();
}

/**
 * The estimate list and its detail requests must agree on this exact scope.
 * A request may only update React state while its scope is still current.
 */
export function createEstimateSelectionScope({
  year,
  week,
  selectedId,
  selectedCustKey,
  filterCustKey,
  includeUnfixed = false,
  weekDays,
} = {}) {
  return {
    year: String(year || ''),
    week: String(week || ''),
    selectedId: selectedId == null ? '' : String(selectedId),
    selectedCustKey: normalizedNumber(selectedCustKey),
    filterCustKey: normalizedNumber(filterCustKey),
    includeUnfixed: Boolean(includeUnfixed),
    weekDays: normalizedWeekDays(weekDays),
  };
}

export function sameEstimateSelectionScope(left, right) {
  const a = createEstimateSelectionScope(left);
  const b = createEstimateSelectionScope(right);
  return a.year === b.year
    && a.week === b.week
    && a.selectedId === b.selectedId
    && a.selectedCustKey === b.selectedCustKey
    && a.filterCustKey === b.filterCustKey
    && a.includeUnfixed === b.includeUnfixed
    && a.weekDays.join('|') === b.weekDays.join('|');
}

export function shouldReloadCapturedEstimateSelection(capturedScope, renderedScope) {
  return sameEstimateSelectionScope(capturedScope, renderedScope);
}

// A selected top-filter customer is also the active left row only when its
// customer key agrees. Keep that row's group identity across a reload.
export function resolveEstimateReloadSelection({ selectedCust, selectedId, selectedCustKey } = {}) {
  const filterCustKey = normalizedNumber(selectedCust?.CustKey);
  const rowCustKey = normalizedNumber(selectedCustKey);
  if (filterCustKey) {
    return filterCustKey === rowCustKey && selectedId != null
      ? { groupId: selectedId, custKey: filterCustKey }
      : { custKey: filterCustKey };
  }
  return rowCustKey ? { groupId: selectedId, custKey: rowCustKey } : null;
}

/**
 * Keeps independent list/detail/mismatch requests from applying after a newer
 * selection scope is active. Each channel also supersedes its own prior call.
 */
export function createEstimateSelectionState() {
  let generation = 0;
  let activeScope = createEstimateSelectionScope();
  let requestId = 0;
  const latestByChannel = new Map();

  const syncScope = (scope) => {
    const normalized = createEstimateSelectionScope(scope);
    if (!sameEstimateSelectionScope(activeScope, normalized)) {
      generation += 1;
      activeScope = normalized;
    }
    return activeScope;
  };

  return {
    syncScope,
    begin(channel, scope) {
      const normalized = syncScope(scope);
      const token = {
        channel: String(channel),
        generation,
        id: ++requestId,
        scope: normalized,
      };
      latestByChannel.set(token.channel, token.id);
      return token;
    },
    // Background callbacks may hold an old React render. They must never make
    // their captured scope current again after the user has moved elsewhere.
    beginIfCurrent(channel, requestedScope, renderedScope) {
      const current = syncScope(renderedScope);
      if (!sameEstimateSelectionScope(requestedScope, current)) return null;
      const token = {
        channel: String(channel),
        generation,
        id: ++requestId,
        scope: current,
      };
      latestByChannel.set(token.channel, token.id);
      return token;
    },
    // A fresh list request supersedes every earlier list/detail/mismatch
    // response, even when the visible selection scope itself is unchanged.
    beginFreshIfCurrent(channel, requestedScope, renderedScope) {
      const current = syncScope(renderedScope);
      if (!sameEstimateSelectionScope(requestedScope, current)) return null;
      generation += 1;
      const token = {
        channel: String(channel),
        generation,
        id: ++requestId,
        scope: current,
      };
      latestByChannel.set(token.channel, token.id);
      return token;
    },
    shouldApply(token, renderedScope) {
      return Boolean(token)
        && token.generation === generation
        && latestByChannel.get(token.channel) === token.id
        && sameEstimateSelectionScope(token.scope, activeScope)
        // React has rendered the newer scope before its synchronizing effect.
        // Reject the small render → effect window as well.
        && (renderedScope === undefined || sameEstimateSelectionScope(token.scope, renderedScope));
    },
    currentScope() {
      return activeScope;
    },
  };
}
