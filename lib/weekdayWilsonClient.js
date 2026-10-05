// Wilson is a web classification of the existing ERP date total, never a second ERP row.
export const wilsonRecordKey = record => [Number(record.year), record.orderWeek, Number(record.custKey), Number(record.prodKey), record.date].join('|');
export function wilsonWriteInput(record) {
  return Object.fromEntries(['year','majorWeek','orderWeek','custKey','prodKey','date','unit','wilsonQuantity','expectedTotal','expectedRevision'].map(key=>[key,record[key]]));
}
export function wilsonPendingAfterSave(records, submission) {
  const payload = submission?.payload;
  if (!payload || !Array.isArray(payload.changes)) return [];
  return (Array.isArray(records) ? records : []).filter(record=>
    Number.isSafeInteger(record.custKey) && record.custKey > 0 && record.custKey === payload.custKey
    && typeof record.expectedTotal === 'number' && Number.isFinite(record.expectedTotal) && record.expectedTotal >= 0
    && typeof record.wilsonQuantity === 'number' && Number.isFinite(record.wilsonQuantity)
    && record.wilsonQuantity >= 0 && record.wilsonQuantity <= record.expectedTotal
    && record.majorWeek === record.orderWeek?.slice(0,2)
    && [...payload.changes,...(Array.isArray(submission.metadataChanges)?submission.metadataChanges:[])].some(change=>change.year === record.year && change.orderWeek===record.orderWeek
      && change.prodKey === record.prodKey && change.unit === record.unit
      && (!change.wilsonRecord || JSON.stringify(change.wilsonRecord)===JSON.stringify(record))
      && change.dates?.some(day=>day.date===record.date && typeof day.quantity === 'number' && day.quantity===record.expectedTotal)));
}

export function validateWilsonWriteResponse(record, result) {
  if(result?.success !== true || result.erpChanged !== false || !result.record
    || wilsonRecordKey(result.record)!==wilsonRecordKey(record)
    || result.record.majorWeek !== record.majorWeek || result.record.unit !== record.unit
    || result.record.expectedTotal !== record.expectedTotal || result.record.wilsonQuantity !== record.wilsonQuantity
    || !Number.isSafeInteger(result.record.revision) || result.record.revision < 1) {
    throw new Error('윌슨 저장 응답을 확인할 수 없습니다.');
  }
  return result.record;
}
