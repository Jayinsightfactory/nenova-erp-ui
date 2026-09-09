export function estimateDraftSnapshot(row, kind) {
  if (!row) return null;
  return {
    identity: JSON.stringify([row.ShipmentKey, row.SdetailKey, row.SdateKey, row.EstimateKey, row.ProdKey, row.Unit, row.outDate]),
    value: Number(kind === 'cost' ? (row.SdateKey != null ? row.DateCost : row.Cost) : Math.abs(Number(row.Quantity))),
    name: row.ProdName || '품목',
  };
}

// Reconcile only after an explicit reload. Missing baselines are conflicts,
// including drafts restored from older releases; never silently accept them.
export function reconcileEstimateDrafts({ edits = {}, baselines = {}, rows = [], keyOf, kind }) {
  const next = { ...edits }; const conflicts = []; const snapshots = { ...baselines };
  for (const [key, desired] of Object.entries(edits)) {
    if (desired === '' || desired == null) continue;
    const row = rows.find(item => keyOf(item) === key);
    const current = estimateDraftSnapshot(row, kind); const original = baselines[key];
    if (current && original && current.identity === original.identity && current.value === Number(desired)) {
      delete next[key]; delete snapshots[key];
    } else if (!current || !original || current.identity !== original.identity || current.value !== original.value) {
      conflicts.push({ key, kind, desired, original, current, missing: !current, name: current?.name || original?.name || key });
    }
  }
  return { edits: next, baselines: snapshots, conflicts };
}
