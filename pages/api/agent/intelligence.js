// pages/api/agent/intelligence.js
// agent가 방별 분석 결과를 ERP DB에 적재
import { withAuth } from '../../../lib/auth';
import { getPool } from '../../../lib/db';
import sql from 'mssql';

async function handler(req, res) {
  if (req.method === 'POST') {
    // ── agent → ERP: 인사이트 적재 ──
    const { rooms, summary, all_alerts, source = 'agent', pipeline_run_id } = req.body;
    if (!rooms) return res.status(400).json({ success: false, error: 'rooms 필드 필요' });

    const pool = await getPool();

    // 테이블 자동 생성 (최초 1회)
    await pool.request().query(`
      IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='_agent_intelligence' AND xtype='U')
      CREATE TABLE _agent_intelligence (
        id INT IDENTITY(1,1) PRIMARY KEY,
        room_name NVARCHAR(200),
        message_count INT,
        chatbot_role NVARCHAR(500),
        focus_counts NVARCHAR(MAX),
        extracted_fields NVARCHAR(MAX),
        alerts NVARCHAR(MAX),
        intelligence_weights NVARCHAR(MAX),
        summary NVARCHAR(MAX),
        pipeline_run_id NVARCHAR(100),
        created_at DATETIME DEFAULT GETDATE()
      )
    `);

    let inserted = 0;
    for (const [roomName, data] of Object.entries(rooms)) {
      await pool.request()
        .input('room_name', sql.NVarChar(200), roomName)
        .input('message_count', sql.Int, data.message_count || 0)
        .input('chatbot_role', sql.NVarChar(500), data.chatbot_role || '')
        .input('focus_counts', sql.NVarChar(sql.MAX), JSON.stringify(data.focus_counts || {}))
        .input('extracted_fields', sql.NVarChar(sql.MAX), JSON.stringify(data.extracted_fields || {}))
        .input('alerts', sql.NVarChar(sql.MAX), JSON.stringify(data.alerts || []))
        .input('intelligence_weights', sql.NVarChar(sql.MAX), JSON.stringify(data.intelligence_weights || {}))
        .input('summary', sql.NVarChar(sql.MAX), JSON.stringify(summary || {}))
        .input('pipeline_run_id', sql.NVarChar(100), pipeline_run_id || '')
        .query(`INSERT INTO _agent_intelligence 
          (room_name, message_count, chatbot_role, focus_counts, extracted_fields, alerts, intelligence_weights, summary, pipeline_run_id)
          VALUES (@room_name, @message_count, @chatbot_role, @focus_counts, @extracted_fields, @alerts, @intelligence_weights, @summary, @pipeline_run_id)`);
      inserted++;
    }

    return res.json({ success: true, inserted, rooms: Object.keys(rooms).length });

  } else if (req.method === 'GET') {
    // ── ERP/챗봇 → 인사이트 조회 ──
    const { room_name, limit = 50 } = req.query;
    const pool = await getPool();

    let q = `SELECT TOP (@limit) * FROM _agent_intelligence`;
    const request = pool.request().input('limit', sql.Int, parseInt(limit));
    if (room_name) {
      q += ` WHERE room_name = @room_name`;
      request.input('room_name', sql.NVarChar(200), room_name);
    }
    q += ` ORDER BY created_at DESC`;

    const result = await request.query(q);
    return res.json({ success: true, data: result.recordset });
  }

  return res.status(405).json({ success: false, error: 'Method not allowed' });
}

export default withAuth(handler);
