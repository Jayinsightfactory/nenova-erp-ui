/** @type {import('next').NextConfig} */
// 2026-04-09 rebuild
const { execSync } = require('child_process');
const pkg = require('./package.json');

// 배포 버전 = package.json version + 빌드 시점 git short hash
// 실패 시 package version 만 사용 (배포 환경에 git 없을 때)
let commitSha = '';
try {
  commitSha = execSync('git rev-parse --short HEAD', { stdio: ['pipe', 'pipe', 'ignore'] })
    .toString().trim();
} catch (_) { /* ignore */ }

const buildVersion = commitSha
  ? `v${pkg.version}·${commitSha}`
  : `v${pkg.version}`;

const nextConfig = {
  serverExternalPackages: ['mssql'],
  generateBuildId: async () => `build-${Date.now()}`,
  env: {
    NEXT_PUBLIC_BUILD_VERSION: buildVersion,
  },
};

module.exports = nextConfig;
