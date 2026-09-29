// READ-ONLY DB helper for golden tests. Loads .env.local (worktree or NENOVA_ENV_FILE). SELECT only.
const fs = require('fs'); const path = require('path'); const sql = require('mssql');
function loadEnv() {
  const cands = [process.env.NENOVA_ENV_FILE, path.join(__dirname, '../../.env.local'), 'C:/Users/USER/nenova-erp-ui-wt-manual/.env.local'].filter(Boolean);
  for (const f of cands) { if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z_0-9]+)\s*=\s*(.*)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); }
    return; }
}
loadEnv();
let pool;
async function q(text, params = {}) {
  if (!/^\s*(SELECT|WITH)\b/i.test(text)) throw new Error('read-only: SELECT only');
  pool = pool || await sql.connect({ server: process.env.DB_SERVER, port: +(process.env.DB_PORT || 1433), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, options: { encrypt: false, trustServerCertificate: true }, requestTimeout: 120000 });
  const r = pool.request(); for (const [k, v] of Object.entries(params)) r.input(k, v);
  return (await r.query(text)).recordset;
}
async function close() { if (pool) await pool.close(); }
module.exports = { q, close, sql };
