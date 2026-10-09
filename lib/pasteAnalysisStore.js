'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {analysisKey} = require('./pasteInboxPreanalysis');
const pending = new Map();
const digest = value => crypto.createHash('sha256').update(value).digest('hex');

// Private, untracked runtime data survives the existing in-place Cafe24 deploy.
// No expiry: only an explicit reanalysis replaces a successful analysis.
function createPasteAnalysisStore(directory = path.join(process.cwd(), 'data/runtime/paste-analysis')) {
  return {
    async read({userId, text, week, force = false, allowAnalyze = true, lookupOnly = false}, analyze) {
      if (typeof userId !== 'string' || !userId.trim()) throw new Error('분석 저장 사용자 확인이 필요합니다.');
      const identity = analysisKey(text, week);
      const filename = digest(identity) + '.json';
      const file = path.join(directory, 'shared', filename);
      const valid = record => record.version === 1 && record.identity === identity && record.data?.success === true && Array.isArray(record.data.orders) && Number.isFinite(record.savedAt) && record.savedAt >= 0;
      // Legacy folders contain only successful analyses, never workspace drafts,
      // leases or completion locks. Exact source/full-year identity is mandatory.
      async function migrateLegacy() {
        let entries;
        try { entries = await fs.readdir(directory, {withFileTypes: true}); }
        catch (error) { if (error.code === 'ENOENT') return; throw error; }
        let newest;
        for (const entry of entries.filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name)).sort((a, b) => a.name.localeCompare(b.name))) {
          let record;
          try { record = JSON.parse(await fs.readFile(path.join(directory, entry.name, filename), 'utf8')); }
          catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) continue; throw error; }
          if (valid(record) && (!newest || record.savedAt > newest.savedAt)) newest = {...record, authorHash: entry.name};
        }
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
          await fs.writeFile(temp, JSON.stringify({version: 1, identity, savedAt, authorId: userId, data}), {flag: 'wx', mode: 0o600});
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
