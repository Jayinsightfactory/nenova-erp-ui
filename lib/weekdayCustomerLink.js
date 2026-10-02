// Native ClassShipmentDetail does not write CustKey. ShipmentKey -> Master
// owns the customer identity. Keep the raw optional key unchanged in digests
// and writes; explicit zero/other keys are NOT the native NULL case.
export const WEEKDAY_DETAIL_CUSTOMER_MATCH_SQL = '(sm.CustKey>0 AND (sd.CustKey IS NULL OR (sd.CustKey>0 AND sd.CustKey=sm.CustKey)))';

export function weekdayDetailCustomerMatchesMaster(detailKey, masterKey) {
  const positiveKey = value => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '')
    && Number.isSafeInteger(Number(value)) && Number(value) > 0;
  if (!positiveKey(masterKey)) return false;
  return detailKey === null || positiveKey(detailKey) && Number(detailKey) === Number(masterKey);
}
