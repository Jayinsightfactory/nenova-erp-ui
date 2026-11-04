// Both entry points use the same receipt screen; carry the selected receipt and filters.
export function incomingWorkspaceHref({ warehouseKey, from, to, farm, week, q, popup = false } = {}) {
  const params = new URLSearchParams({ tab: 'incoming' });
  if (Number.isSafeInteger(Number(warehouseKey)) && Number(warehouseKey) > 0) params.set('warehouseKey', String(warehouseKey));
  for (const [key, value] of Object.entries({ from, to, farm, week, q })) if (value) params.set(key, String(value));
  if (popup) params.set('popup', '1');
  return `/import/tools?${params}`;
}
