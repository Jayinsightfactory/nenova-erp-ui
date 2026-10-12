'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {analysisKey} = require('./pasteInboxPreanalysis');
const pending = new Map();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');


const legacyIndexes = new Map();
async function legacyIndex(directory, ttlMs) {
  const cached = legacyIndexes.get(directory);
  if (cached && (cached.pending || Date.now() - cached.at < ttlMs)) return cached.pending || cached.value;
  const entry = {};
  const work = (async () => {
        let entries;
        try { entries = await fs.readdir(directory, {withFileTypes: true}); }
        catch (error) { if (error.code === 'ENOENT') return new Map(); throw error; }
        const index = new Map();
        // Older records use fullweek keys. Reuse only exact text and same year.
        const folders = entries.filter(entry => entry.isDirectory() && (entry.name === 'shared' || /^[a-f0-9]{64}$/.test(entry.name))).sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of folders) {
          const folder = path.join(directory, entry.name);
          const filenames = (await fs.readdir(folder)).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort();
          for (const candidate of filenames) {
            let record;
            try { record = JSON.parse(await fs.readFile(path.join(folder, candidate), 'utf8')); }
            catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
            let prior;
            try { prior = JSON.parse(record.identity); } catch { continue; }
            if (record.version !== 1 || !Array.isArray(prior) || prior.length !== 2 || typeof prior[0] !== 'string') continue;
            try { if (analysisKey(prior[1], prior[0]) !== record.identity || digest(record.identity) + '.json' !== candidate) continue; } catch { continue; }
            if (record.data?.success !== true || !Array.isArray(record.data.orders) || !Number.isFinite(record.savedAt) || record.savedAt < 0) continue;
            const identity = JSON.stringify(['year-source-v2', prior[0].slice(0, 4), prior[1]]);
            const newest = index.get(identity);
            if (!newest || record.savedAt > newest.savedAt) index.set(identity, {...record, version: 2, identity, ...(entry.name === 'shared' ? {} : {authorHash: entry.name})});
          }
        }

    return index;
  })();
  entry.pending = work;
  legacyIndexes.set(directory, entry);
  try { entry.value = await work; entry.at = Date.now(); return entry.value; }
  catch (error) { legacyIndexes.delete(directory); throw error; }
  finally { delete entry.pending; }
}

// Private, untracked runtime data survives the existing in-place Cafe24 deploy.
// No expiry: only an explicit reanalysis replaces a successful analysis.
function createPasteAnalysisStore(directory = path.join(process.cwd(), 'data/runtime/paste-analysis'), {legacyIndexTtlMs = 30000} = {}) {
  return {
    async read({userId, text, week, force = false, allowAnalyze = true, lookupOnly = false}, analyze) {
      if (typeof userId !== 'string' || !userId.trim()) throw new Error('분석 저장 사용자 확인이 필요합니다.');
      analysisKey(text, week);
      const identity = JSON.stringify(['year-source-v2', week.slice(0, 4), text]);
      const filename = digest(identity) + '.json';
      const file = path.join(directory, 'shared', filename);
      const valid = record => record.version === 2 && record.identity === identity && record.data?.success === true && Array.isArray(record.data.orders) && Number.isFinite(record.savedAt) && record.savedAt >= 0;
      // Legacy folders contain only successful analyses, never workspace drafts,
      // leases or completion locks. Exact source/full-year identity is mandatory.
      async function migrateLegacy() {
        const newest = (await legacyIndex(directory, legacyIndexTtlMs)).get(identity);
        if (!newest) return;
        await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
        const temp = file + '.' + crypto.randomUUID() + '.migration.tmp';
        try {
          await fs.writeFile(temp, JSON.stringify(newest), {flag: 'wx', mode: 0o600});
          // Exclusive publication cannot overwrite a concurrent shared analysis.
          await fs.link(temp, file).catch(error => { if (error.code !== 'EEXIST') throw error; });
        } finally { await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
      }
      async function saved() {
        let raw;
        try { raw = await fs.readFile(file, 'utf8'); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await migrateLegacy();
          try { raw = await fs.readFile(file, 'utf8'); }
          catch (retryError) { if (retryError.code === 'ENOENT') return null; throw retryError; }
        }
        const record = JSON.parse(raw);
        if (!valid(record)) throw new Error('저장된 분석을 확인할 수 없습니다. 관리자에게 문의하세요.');
        return {...record.data, analysisStorage: {savedAt: record.savedAt, authorId: record.authorId, authorHash: record.authorHash, shared: true, cacheHit: true}};
      }
      if (!force) { const result = await saved(); if (result) return result; }
      if (lookupOnly) return {analysisStorage: {cacheMiss: true}};
      if (pending.has(file)) return structuredClone(await pending.get(file));
      if (!allowAnalyze) throw new Error('자동 분석 20건 사용 · 저장된 분석은 계속 표시됩니다. 새 원문은 지금 분석을 눌러 주세요.');
      const work = (async () => {
        await fs.mkdir(path.dirname(file), {recursive: true, mode: 0o700});
        const lockPath = file + '.lock';
        let lock;
        try { lock = await fs.open(lockPath, 'wx', 0o600); }
        catch (error) { if (error.code === 'EEXIST') throw new Error('다른 창에서 분석 중입니다. 잠시 후 다시 시도하세요. 계속되면 관리자에게 문의하세요.'); throw error; }
        const temp = file + '.' + crypto.randomUUID() + '.tmp';
        try {
          if (!force) { const result = await saved(); if (result) return result; }
          const data = await analyze();
          if (!data?.success || !Array.isArray(data.orders)) throw new Error(data?.error || '분석 실패 · 기존 저장 결과는 보존됩니다.');
          const savedAt = Date.now();
          await fs.writeFile(temp, JSON.stringify({version: 2, identity, savedAt, authorId: userId, data}), {flag: 'wx', mode: 0o600});
          await fs.rename(temp, file);
          return {...data, analysisStorage: {savedAt, authorId: userId, shared: true, cacheHit: false}};
        } finally {
          await fs.unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
          await lock.close();
          await fs.unlink(lockPath);
        }
      })();
      pending.set(file, work);
      try { return structuredClone(await work); }
      finally { pending.delete(file); }
    },
  };
}
module.exports = {createPasteAnalysisStore};
