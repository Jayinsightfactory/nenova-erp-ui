// .env.local 의 DB_* 를 process.env 로 읽는다(lib/db.js 는 import 시점에 env 를 읽으므로 먼저 호출).
import fs from 'node:fs';
import path from 'node:path';

export function loadEnv() {
  const cands = [process.env.ENV_FILE, path.join(process.cwd(), '.env.local'), 'C:/Users/USER/nenova-erp-ui/.env.local'].filter(Boolean);
  const file = cands.find((f) => fs.existsSync(f));
  if (!file) throw new Error('.env.local 을 찾지 못했습니다(ENV_FILE 로 지정 가능).');
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return file;
}

export function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const nxt = argv[i + 1];
      if (nxt !== undefined && !nxt.startsWith('--')) { opt[k] = nxt; i += 1; } else opt[k] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}
