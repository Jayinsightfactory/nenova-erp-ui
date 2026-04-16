// pages/api/agent/issues.js
// 이슈 컨트롤: agent가 감지한 이슈 등록/조회/상태변경
import { withAuth } from '../../../lib/auth';
import { getPool } from '../../../lib/db';
import sql from 'mssql';

async function handler(req, res) {
  const pool = await getPool();

  // 테이블 자동 생성
  await pool.request().query(`
    IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='_agent_issues' AND xtype='U')
    CREATE TABLE _agent_issues (
      id INT IDENTITY(1,1) PRIMARY KEY,
      room_name NVARCHAR(200),
      issue_type NVARCHAR(50),
      severity NVARCHAR(20) DEFAULT 'warning',
      title NVARCHAR(500),
      detail NVARCHAR(MAX),
      status NVARCHAR(20) DEFAULT 'open',
      resolved_at DATETIME NULL,
      resolved_by NVARCHAR(100) NULL,
      pipeline_run_id NVARCHAR(100),
      created_at DATETIME DEFAULT GETDATE()
    )
  `);

  if (req.method === 'POST') {
    // 이슈 등록
    const { room_name, issue_type, severity, title, detail, pipeline_run_id } = req.body;
    if (!title) return res.status(400).json({ success: false, error: 'title 필요' });

    const result = await pool.request()
      .input('room_name', sql.NVarChar(200), room_name || '')
      .input('issue_type', sql.NVarChar(50), issue_type || 'alert')
      .input('severity', sql.NVarChar(20), severity || 'warning')
      .input('title', sql.NVarChar(500), title)
      .input('detail', sql.NVarChar(sql.MAX), JSON.stringify(detail || ''))
      .input('pipeline_run_id', sql.NVarChar(100), pipeline_run_id || '')
      .query(`INSERT INTO _agent_issues (room_name, issue_type, severity, title, detail, pipeline_run_id) 
              VALUES (@room_name, @issue_type, @severity, @title, @detail, @pipeline_run_id);
              SELECT SCOPE_IDENTITY() AS id`);

    return res.json({ success: true, id: result.recordset[0].id });

  } else if (req.method === 'PATCH') {
    // 이슈 상태 변경 (resolve, dismiss 등)
    const { id, status, resolved_by } = req.body;
    if (!id) return res.status(400).json({ success: false, error: 'id 필요' });

    await pool.request()
      .input('id', sql.Int, id)
      .input('status', sql.NVarChar(20), status || 'resolved')
      .input('resolved_by', sql.NVarChar(100), resolved_by || req.user?.userId || '')
      .query(`UPDATE _agent_issues SET status=@status, resolved_at=GETDATE(), resolved_by=@resolved_by WHERE id=@id`);

    return res.json({ success: true });

  } else if (req.method === 'GET') {
    // 이슈 조회
    const { status = 'open', limit = 100 } = req.query;
    const result = await pool.request()
      .input('status', sql.NVarChar(20), status)
      .input('limit', sql.Int, parseInt(limit))
      .query(`SELECT TOP (@limit) * FROM _agent_issues WHERE status=@status ORDER BY created_at DESC`);

    return res.json({ success: true, data: result.recordset });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler);
