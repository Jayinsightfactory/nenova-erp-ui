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
    async read({userId, text, week, force = false, allowAnalyze = true}, analyze) {
      if (typeof userId !== 'string' || !userId.trim()) throw new Error('분석 저장 사용자 확인이 필요합니다.');
      const identity = analysisKey(text, week);
      const file = path.join(directory, digest(userId), digest(identity) + '.json');
      async function saved() {
        let raw;
        try { raw = await fs.readFile(file, 'utf8'); }
        catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        const record = JSON.parse(raw);
        if (record.version !== 1 || record.identity !== identity || !record.data?.success || !Array.isArray(record.data.orders) || !Number.isFinite(record.savedAt)) throw new Error('저장된 분석을 확인할 수 없습니다. 관리자에게 문의하세요.');
        return {...record.data, analysisStorage: {savedAt: record.savedAt, cacheHit: true}};
      }
      if (!force) { const result = await saved(); if (result) return result; }
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
          await fs.writeFile(temp, JSON.stringify({version: 1, identity, savedAt, data}), {flag: 'wx', mode: 0o600});
          await fs.rename(temp, file);
          return {...data, analysisStorage: {savedAt, cacheHit: false}};
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
