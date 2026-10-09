const EPSILON = 0.000001;

// The same classifier is used by the preview and the locked transaction.
export function classifyWeekdayConfirmationLifecycle(plans = []) {
  const groups = new Map();
  for (const plan of plans) {
    const key = `${plan.change.year}|${plan.change.custKey}|${plan.change.prodKey}`;
    const group = groups.get(key) || { decreases: 0, increases: 0 };
    const before = new Map((plan.before?.shipmentDates || []).map(row => [row.date, Number(row.shipmentQuantity)]));
    const after = new Map((plan.finalDates || []).map(row => [row.date, Number(row.shipmentQuantity)]));
    for (const date of new Set([...before.keys(), ...after.keys()])) {
      const delta = (after.get(date) || 0) - (before.get(date) || 0);
      if (delta > EPSILON) group.increases += delta;
      if (delta < -EPSILON) group.decreases -= delta;
    }
    groups.set(key, group);
  }
  return plans.map(plan => {
    const group = groups.get(`${plan.change.year}|${plan.change.custKey}|${plan.change.prodKey}`);
    const ownBefore=new Map((plan.before?.shipmentDates || []).map(row=>[row.date,Number(row.shipmentQuantity)]));
    const ownAfter=new Map((plan.finalDates || []).map(row=>[row.date,Number(row.shipmentQuantity)]));
    const ownDateChanged=[...new Set([...ownBefore.keys(),...ownAfter.keys()])]
      .some(date=>Math.abs((ownAfter.get(date)||0)-(ownBefore.get(date)||0))>EPSILON);
    const dateMove = Boolean(plan.changed && ownDateChanged && group.decreases > EPSILON && group.increases > EPSILON);
    const beforeFixed = Boolean(plan.fixed);
    const quantityChanged = Math.abs(plan.newTotal - plan.oldTotal) > EPSILON;
    const finalFixed = plan.newTotal > EPSILON && (beforeFixed || dateMove);
    const cancel = beforeFixed && quantityChanged;
    const confirm = finalFixed && (!beforeFixed || cancel);
    const stages = [];
    if (cancel) stages.push('CANCEL_CONFIRMATION');
    if (quantityChanged) stages.push('SAVE_QUANTITY');
    if (confirm) stages.push('CONFIRM');
    if (dateMove) stages.push('MOVE_DATES');
    if (!stages.length && plan.changed) stages.push('SAVE_DATES');
    return { ...plan, lifecycle: { beforeFixed, finalFixed, dateMove, quantityChanged,
      cancel, confirm, intent: dateMove ? quantityChanged ? 'QUANTITY_AND_DATE' : 'DATE' : quantityChanged ? 'QUANTITY' : 'UNCHANGED',
      consumedDelta: (finalFixed ? plan.newTotal : 0) - (beforeFixed ? plan.oldTotal : 0),
      transitionStages: stages }, fixed: finalFixed };
  });
}
