// Partner/year scoped free-form notes for the P&L workspace.
// This web-only store never reads or writes ERP order/shipment/stock ledgers.
import { query, sql, withTransaction } from './db.js';
import {
  normalizePnlSpecialNoteText,
  normalizePnlSpecialNoteYear,
  RaumPnlSpecialNoteInputError,
} from './raumPnlSpecialNotePolicy.js';

export class RaumPnlSpecialNoteError extends Error {
  constructor(code, message, statusCode = 400) {
    super(message);
    this.name = 'RaumPnlSpecialNoteError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

function normalizeInput(fn, value) {
  try { return fn(value); }
  catch (error) {
    if (error instanceof RaumPnlSpecialNoteInputError) {
      throw new RaumPnlSpecialNoteError(error.code, error.message, error.statusCode);
    }
    throw error;
  }
}

function cleanRevision(value) {
  const revision = String(value ?? '').trim().toLowerCase();
  if (!revision) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(revision)) {
    throw new RaumPnlSpecialNoteError('PNL_SPECIAL_NOTE_REVISION_INVALID', '특이사항 버전 정보가 올바르지 않습니다. 다시 불러와 주세요.');
  }
  return revision;
}

const SCHEMA_PROBE_SQL = `
SELECT CASE WHEN OBJECT_ID(N'dbo.WebRaumPnlSpecialNote', N'U') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'PartnerCode') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'OrderYear') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'NoteText') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'Revision') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'UpdatedAt') IS NOT NULL
                  AND COL_LENGTH(N'dbo.WebRaumPnlSpecialNote', N'UpdatedBy') IS NOT NULL
             THEN 1 ELSE 0 END AS Ready`;

export async function assertPnlSpecialNoteSchema(tQuery = query) {
  const result = await tQuery(SCHEMA_PROBE_SQL, {});
  if (Number(result?.recordset?.[0]?.Ready) !== 1) {
    throw new RaumPnlSpecialNoteError('PNL_SPECIAL_NOTE_SCHEMA_MISSING', '특이사항 기능 설치가 아직 끝나지 않았습니다. 업데이트 후 다시 확인하세요.', 503);
  }
}

const SELECT_NOTE_SQL = `
SELECT PartnerCode, OrderYear, NoteText, Revision, UpdatedAt, UpdatedBy
  FROM dbo.WebRaumPnlSpecialNote
 WHERE PartnerCode=@partnerCode AND OrderYear=@orderYear`;

const SELECT_NOTE_FOR_UPDATE_SQL = `
SELECT PartnerCode, OrderYear, NoteText, Revision, UpdatedAt, UpdatedBy
  FROM dbo.WebRaumPnlSpecialNote WITH (UPDLOCK, HOLDLOCK)
 WHERE PartnerCode=@partnerCode AND OrderYear=@orderYear`;

function noteParams(partnerCode, orderYear) {
  return {
    partnerCode: { type: sql.NVarChar(20), value: String(partnerCode) },
    orderYear: { type: sql.Char(4), value: String(orderYear) },
  };
}

function serializeNote(row, partnerCode, orderYear) {
  return {
    partnerCode: String(row?.PartnerCode ?? partnerCode),
    orderYear: String(row?.OrderYear ?? orderYear),
    text: String(row?.NoteText ?? ''),
    revision: row?.Revision ? String(row.Revision).toLowerCase() : null,
    updatedAt: row?.UpdatedAt ?? null,
    updatedBy: row?.UpdatedBy ? String(row.UpdatedBy) : '',
  };
}

export async function loadPnlSpecialNote({ partnerCode, orderYear }, tQuery = query) {
  const year = normalizeInput(normalizePnlSpecialNoteYear, orderYear);
  await assertPnlSpecialNoteSchema(tQuery);
  const result = await tQuery(SELECT_NOTE_SQL, noteParams(partnerCode, year));
  return serializeNote(result?.recordset?.[0], partnerCode, year);
}

export async function savePnlSpecialNote({ partnerCode, orderYear, text, expectedRevision, actor }, options = {}) {
  const year = normalizeInput(normalizePnlSpecialNoteYear, orderYear);
  const noteText = normalizeInput(normalizePnlSpecialNoteText, text);
  const revision = cleanRevision(expectedRevision);
  const updatedBy = String(actor || 'user').trim().slice(0, 100) || 'user';
  const runTransaction = options.runTransaction || withTransaction;

  return runTransaction(async (tQuery) => {
    await assertPnlSpecialNoteSchema(tQuery);
    const baseParams = noteParams(partnerCode, year);
    const existingResult = await tQuery(SELECT_NOTE_FOR_UPDATE_SQL, baseParams);
    const existing = existingResult?.recordset?.[0] || null;
    const currentRevision = existing?.Revision ? String(existing.Revision).toLowerCase() : null;
    if (currentRevision !== revision) {
      throw new RaumPnlSpecialNoteError('PNL_SPECIAL_NOTE_STALE', '다른 사용자가 특이사항을 먼저 수정했습니다. 최신 내용을 다시 불러온 뒤 저장하세요.', 409);
    }
    if (existing && String(existing.NoteText ?? '') === noteText) {
      return { note: serializeNote(existing, partnerCode, year), changed: false };
    }
    if (!existing && !noteText) {
      return { note: serializeNote(null, partnerCode, year), changed: false };
    }

    const params = {
      ...baseParams,
      noteText: { type: sql.NVarChar(sql.MAX), value: noteText },
      actor: { type: sql.NVarChar(100), value: updatedBy },
    };
    const result = existing
      ? await tQuery(`UPDATE dbo.WebRaumPnlSpecialNote
                        SET NoteText=@noteText, Revision=NEWID(), UpdatedAt=SYSUTCDATETIME(), UpdatedBy=@actor
                      OUTPUT inserted.PartnerCode, inserted.OrderYear, inserted.NoteText, inserted.Revision, inserted.UpdatedAt, inserted.UpdatedBy
                      WHERE PartnerCode=@partnerCode AND OrderYear=@orderYear`, params)
      : await tQuery(`INSERT INTO dbo.WebRaumPnlSpecialNote (PartnerCode, OrderYear, NoteText, Revision, UpdatedBy)
                     OUTPUT inserted.PartnerCode, inserted.OrderYear, inserted.NoteText, inserted.Revision, inserted.UpdatedAt, inserted.UpdatedBy
                     VALUES (@partnerCode, @orderYear, @noteText, NEWID(), @actor)`, params);
    return { note: serializeNote(result?.recordset?.[0], partnerCode, year), changed: true };
  });
}

export const PNL_SPECIAL_NOTE_SQL = Object.freeze({
  schemaProbe: SCHEMA_PROBE_SQL,
  select: SELECT_NOTE_SQL,
  selectForUpdate: SELECT_NOTE_FOR_UPDATE_SQL,
});
