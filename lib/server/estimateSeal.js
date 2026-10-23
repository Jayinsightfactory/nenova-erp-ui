// Server-only deployment secret: never import this module from a browser component.
export function readEstimateSeal() {
  const base64 = (process.env.NENOVA_ESTIMATE_SEAL_PNG || '').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length > 60000 ||
      !Buffer.from(base64, 'base64').subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    throw new Error('Estimate print seal is not configured');
  }
  return `data:image/png;base64,${base64}`;
}
