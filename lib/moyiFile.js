// MOYI 파일 수신 저장 — 멱등(file_id 유니크). 재시도 시 중복 저장 방지.
import { query, sql } from './db';
import crypto from 'crypto';

let _ensured = null;
export async function ensureMoyiFileTable() {
  if (_ensured) return _ensured;
  _ensured = query(
    `IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name='WebMoyiFile')
     BEGIN
       CREATE TABLE WebMoyiFile (
         MoyiFileKey INT IDENTITY(1,1) PRIMARY KEY,
         FileId NVARCHAR(120) NOT NULL,
         Filename NVARCHAR(300), Mime NVARCHAR(120),
         SizeBytes INT NOT NULL, Sha256 CHAR(64) NOT NULL,
         Meta NVARCHAR(MAX),
         Content VARBINARY(MAX),
         Source NVARCHAR(40), ReceivedAt DATETIME NOT NULL DEFAULT GETDATE()
       );
       CREATE UNIQUE INDEX UX_WebMoyiFile_FileId ON WebMoyiFile(FileId);
     END`, {}
  );
  return _ensured;
}

/** 멱등 저장. 이미 있으면 { idempotent:true, ... } 반환(중복 저장 안 함). */
export async function storeMoyiFile({ fileId, filename, mime, buffer, meta, source }) {
  await ensureMoyiFileTable();
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  const existing = await query(
    `SELECT TOP 1 MoyiFileKey, SizeBytes, Sha256, CONVERT(varchar(19),ReceivedAt,120) AS receivedAt FROM WebMoyiFile WHERE FileId=@fid`,
    { fid: { type: sql.NVarChar, value: fileId } }
  );
  if (existing.recordset[0]) {
    const e = existing.recordset[0];
    return { idempotent: true, moyiFileKey: e.MoyiFileKey, sizeBytes: e.SizeBytes, sha256: e.Sha256, receivedAt: e.receivedAt, sha256Match: e.Sha256 === sha256 };
  }

  try {
    const r = await query(
      `INSERT INTO WebMoyiFile (FileId, Filename, Mime, SizeBytes, Sha256, Meta, Content, Source)
       OUTPUT INSERTED.MoyiFileKey
       VALUES (@fid,@fn,@mime,@sz,@sha,@meta,@content,@src)`,
      {
        fid: { type: sql.NVarChar, value: fileId },
        fn: { type: sql.NVarChar, value: (filename || '').slice(0, 300) },
        mime: { type: sql.NVarChar, value: (mime || '').slice(0, 120) },
        sz: { type: sql.Int, value: buffer.length },
        sha: { type: sql.Char(64), value: sha256 },
        meta: { type: sql.NVarChar, value: meta ? JSON.stringify(meta).slice(0, 100000) : null },
        content: { type: sql.VarBinary(sql.MAX), value: buffer },
        src: { type: sql.NVarChar, value: (source || 'moyi').slice(0, 40) },
      }
    );
    return { idempotent: false, moyiFileKey: r.recordset[0].MoyiFileKey, sizeBytes: buffer.length, sha256 };
  } catch (e) {
    // 동시 재시도로 유니크 충돌 → 멱등 처리
    if (/UX_WebMoyiFile_FileId|duplicate key|2601|2627/i.test(e.message)) {
      const again = await query(`SELECT TOP 1 MoyiFileKey, SizeBytes, Sha256 FROM WebMoyiFile WHERE FileId=@fid`, { fid: { type: sql.NVarChar, value: fileId } });
      const a = again.recordset[0] || {};
      return { idempotent: true, moyiFileKey: a.MoyiFileKey, sizeBytes: a.SizeBytes, sha256: a.Sha256, sha256Match: a.Sha256 === sha256, raced: true };
    }
    throw e;
  }
}
