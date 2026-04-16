// pages/api/agent/image-upload.js
// agent가 이미지를 multipart/form-data로 업로드 → DB 저장 → 공개 URL 반환
import { withAuth } from '../../../lib/auth';
import { getPool } from '../../../lib/db';
import sql from 'mssql';
import formidable from 'formidable';
import fs from 'fs';
import crypto from 'crypto';

export const config = {
  api: { bodyParser: false },
};

async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const pool = await getPool();

  // 테이블 자동 생성
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='_agent_images' AND xtype='U')
    CREATE TABLE _agent_images (
      id NVARCHAR(40) PRIMARY KEY,
      filename NVARCHAR(300),
      mime NVARCHAR(100),
      size_bytes INT,
      data VARBINARY(MAX),
      room_name NVARCHAR(200),
      pipeline_run_id NVARCHAR(100),
      created_at DATETIME DEFAULT GETDATE()
    )
  `);

  try {
    const form = formidable({ maxFileSize: 20 * 1024 * 1024, keepExtensions: true });
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err); else resolve([fields, files]);
      });
    });

    const file = Array.isArray(files.image) ? files.image[0] : files.image;
    if (!file) return res.status(400).json({ success: false, error: 'image 필드 필요' });

    const fileBuffer = fs.readFileSync(file.filepath);
    const id = crypto.randomBytes(12).toString('hex');
    const roomName = (fields.room_name && (Array.isArray(fields.room_name) ? fields.room_name[0] : fields.room_name)) || '';
    const runId = (fields.pipeline_run_id && (Array.isArray(fields.pipeline_run_id) ? fields.pipeline_run_id[0] : fields.pipeline_run_id)) || '';
    const mime = file.mimetype || 'image/jpeg';
    const filename = file.originalFilename || 'upload.jpg';

    await pool.request()
      .input('id', sql.NVarChar(40), id)
      .input('filename', sql.NVarChar(300), filename)
      .input('mime', sql.NVarChar(100), mime)
      .input('size_bytes', sql.Int, fileBuffer.length)
      .input('data', sql.VarBinary(sql.MAX), fileBuffer)
      .input('room_name', sql.NVarChar(200), roomName)
      .input('pipeline_run_id', sql.NVarChar(100), runId)
      .query(`INSERT INTO _agent_images (id, filename, mime, size_bytes, data, room_name, pipeline_run_id)
              VALUES (@id, @filename, @mime, @size_bytes, @data, @room_name, @pipeline_run_id)`);

    // 공개 URL 생성 (인증 없이 접근 가능한 public 엔드포인트)
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'https';
    const publicUrl = `${protocol}://${host}/api/public/image/${id}`;

    try { fs.unlinkSync(file.filepath); } catch {}

    return res.json({
      success: true,
      id,
      url: publicUrl,
      size: fileBuffer.length,
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: e.message });
  }
}

export default withAuth(handler);
