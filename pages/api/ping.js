// pages/api/ping.js — DB 연결 진단용 (임시)
import { getPool } from '../../lib/db';

export default async function handler(req, res) {
  const result = { env: {}, db: null, error: null };

  // 환경변수 확인 (값은 마스킹)
  result.env = {
    DB_SERVER:   process.env.DB_SERVER   ? '✅ 설정됨' : '❌ 없음',
    DB_PORT:     process.env.DB_PORT     ? '✅ 설정됨' : '❌ 없음 (기본 1433)',
    DB_NAME:     process.env.DB_NAME     ? '✅ 설정됨' : '❌ 없음',
    DB_USER:     process.env.DB_USER     ? '✅ 설정됨' : '❌ 없음',
    DB_PASSWORD: process.env.DB_PASSWORD ? '✅ 설정됨' : '❌ 없음',
    JWT_SECRET:  process.env.JWT_SECRET  ? '✅ 설정됨' : '⚠️ 없음 (기본값 사용)',
  };

  // DB 연결 테스트
  try {
    const pool = await getPool();
    const r = await pool.request().query('SELECT 1 AS ok');
    result.db = r.recordset[0].ok === 1 ? '✅ 연결 성공' : '❌ 응답 이상';
  } catch (err) {
    result.db = '❌ 연결 실패';
    result.error = err.message;
  }

  return res.status(200).json(result);
}
