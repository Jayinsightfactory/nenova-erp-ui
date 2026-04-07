// pages/api/dev/git-log.js
// 로컬 개발 전용 — Git 로그/diff 정보 반환
// Railway 배포 환경에서는 git 명령 없음 → 빈 데이터 반환

import { execSync } from 'child_process';
import path from 'path';

const ROOT = path.resolve(process.cwd());

function run(cmd) {
  try {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8', timeout: 5000 }).trim();
  } catch {
    return '';
  }
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const { type = 'log' } = req.query;

  try {
    if (type === 'log') {
      // 최근 커밋 목록
      const raw = run('git log --pretty=format:"%H|%h|%s|%an|%ai|%D" -30');
      const commits = raw.split('\n').filter(Boolean).map(line => {
        const [hash, shortHash, subject, author, date, refs] = line.split('|');
        return { hash, shortHash, subject, author, date, refs };
      });

      // 현재 브랜치
      const branch = run('git rev-parse --abbrev-ref HEAD');

      // 변경되지 않은 파일 (staged + unstaged)
      const statusRaw = run('git status --porcelain');
      const status = statusRaw.split('\n').filter(Boolean).map(line => ({
        code: line.slice(0, 2).trim(),
        file: line.slice(3).trim(),
      }));

      return res.status(200).json({ success: true, branch, commits, status });
    }

    if (type === 'diff') {
      // 특정 커밋의 변경 파일 목록
      const { hash } = req.query;
      if (!hash) return res.status(400).json({ success: false, error: 'hash 필요' });
      const raw = run(`git show --name-status --format="" ${hash}`);
      const files = raw.split('\n').filter(Boolean).map(line => {
        const parts = line.split('\t');
        return { code: parts[0], file: parts[1], newFile: parts[2] };
      });
      const stat = run(`git show --stat --format="" ${hash}`);
      return res.status(200).json({ success: true, files, stat });
    }

    if (type === 'show') {
      // 특정 커밋의 diff 내용
      const { hash } = req.query;
      if (!hash) return res.status(400).json({ success: false, error: 'hash 필요' });
      const diff = run(`git show --unified=3 --no-color ${hash}`);
      return res.status(200).json({ success: true, diff: diff.slice(0, 50000) }); // 최대 50KB
    }

    if (type === 'pending') {
      // 현재 미커밋 diff
      const diff = run('git diff HEAD --no-color');
      const staged = run('git diff --cached --no-color');
      return res.status(200).json({ success: true, diff: (staged + diff).slice(0, 50000) });
    }

    if (type === 'plan') {
      // 플랜 파일 읽기
      const fs = require('fs');
      const planDir = path.join(process.env.USERPROFILE || process.env.HOME || '', '.claude', 'plans');
      let plans = [];
      try {
        const files = fs.readdirSync(planDir).filter(f => f.endsWith('.md'));
        plans = files.map(f => {
          const content = fs.readFileSync(path.join(planDir, f), 'utf8');
          return { name: f, content: content.slice(0, 10000) };
        });
      } catch { /* no plans dir */ }
      return res.status(200).json({ success: true, plans });
    }

    if (type === 'memory') {
      // 작업 이력 md 파일 읽기 (Railway 포함 어디서나 동작)
      const fs = require('fs');
      const docsDir = path.join(ROOT, 'docs');
      let files = [];
      try {
        const names = fs.readdirSync(docsDir).filter(f => f.endsWith('.md'));
        files = names.map(f => {
          const content = fs.readFileSync(path.join(docsDir, f), 'utf8');
          return { name: f, content };
        });
      } catch { /* docs dir 없음 */ }
      return res.status(200).json({ success: true, files });
    }

    return res.status(400).json({ success: false, error: '지원하지 않는 type' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
