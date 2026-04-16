// pages/api/agent/backup.js
// 백업 컨트롤: 파이프라인 실행 이력 + 데이터 스냅샷 관리
import { withAuth } from '../../../lib/auth';
import { getPool } from '../../../lib/db';
import sql from 'mssql';

async function handler(req, res) {
  const pool = await getPool();

  // 테이블 자동 생성
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='_agent_pipeline_runs' AND xtype='U')
    CREATE TABLE _agent_pipeline_runs (
      id INT IDENTITY(1,1) PRIMARY KEY,
      run_id NVARCHAR(100),
      status NVARCHAR(20) DEFAULT 'running',
      rooms_scanned INT DEFAULT 0,
      rooms_saved INT DEFAULT 0,
      messages_sent INT DEFAULT 0,
      issues_found INT DEFAULT 0,
      duration_sec FLOAT DEFAULT 0,
      summary NVARCHAR(MAX),
      error_log NVARCHAR(MAX),
      created_at DATETIME DEFAULT GETDATE(),
      completed_at DATETIME NULL
    )
  `);

  if (req.method === 'POST') {
    // 파이프라인 실행 기록 등록/업데이트
    const { run_id, status, rooms_scanned, rooms_saved, messages_sent, issues_found, duration_sec, summary, error_log } = req.body;
    if (!run_id) return res.status(400).json({ success: false, error: 'run_id 필요' });

    // UPSERT: run_id 있으면 UPDATE, 없으면 INSERT
    const existing = await pool.request()
      .input('run_id', sql.NVarChar(100), run_id)
      .query(`SELECT id FROM _agent_pipeline_runs WHERE run_id=@run_id`);

    if (existing.recordset.length > 0) {
      await pool.request()
        .input('run_id', sql.NVarChar(100), run_id)
        .input('status', sql.NVarChar(20), status || 'completed')
        .input('rooms_scanned', sql.Int, rooms_scanned || 0)
        .input('rooms_saved', sql.Int, rooms_saved || 0)
        .input('messages_sent', sql.Int, messages_sent || 0)
        .input('issues_found', sql.Int, issues_found || 0)
        .input('duration_sec', sql.Float, duration_sec || 0)
        .input('summary', sql.NVarChar(sql.MAX), JSON.stringify(summary || {}))
        .input('error_log', sql.NVarChar(sql.MAX), error_log || '')
        .query(`UPDATE _agent_pipeline_runs SET 
          status=@status, rooms_scanned=@rooms_scanned, rooms_saved=@rooms_saved,
          messages_sent=@messages_sent, issues_found=@issues_found, duration_sec=@duration_sec,
          summary=@summary, error_log=@error_log, completed_at=GETDATE()
          WHERE run_id=@run_id`);
    } else {
      await pool.request()
        .input('run_id', sql.NVarChar(100), run_id)
        .input('status', sql.NVarChar(20), status || 'running')
        .input('summary', sql.NVarChar(sql.MAX), JSON.stringify(summary || {}))
        .query(`INSERT INTO _agent_pipeline_runs (run_id, status, summary) VALUES (@run_id, @status, @summary)`);
    }

    return res.json({ success: true, run_id });

  } else if (req.method === 'GET') {
    // 파이프라인 실행 이력 조회
    const { limit = 50 } = req.query;
    const result = await pool.request()
      .input('limit', sql.Int, parseInt(limit))
      .query(`SELECT TOP (@limit) * FROM _agent_pipeline_runs ORDER BY created_at DESC`);

    return res.json({ success: true, data: result.recordset });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler);
