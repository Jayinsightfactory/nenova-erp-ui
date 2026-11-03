// bank 스키마 ensure. DDL 은 docs/migrations/2026-11-03_bank_schema.sql (bank 스키마에만 쓴다).
import fs from 'node:fs';
import path from 'node:path';
import { query } from '../db.js';

export const MIGRATION_FILE = 'docs/migrations/2026-11-03_bank_schema.sql';

export function loadStaticDdlBatches(root = process.cwd()) {
  const text = fs.readFileSync(path.join(root, MIGRATION_FILE), 'utf8');
  return text.split(/^\s*GO\s*$/im).map((s) => s.trim()).filter(Boolean);
}

let p = null;
export function ensureBankSchema() {
  if (p) return p;
  p = (async () => { for (const b of loadStaticDdlBatches()) await query(b); })().catch((e) => { p = null; throw e; });
  return p;
}
