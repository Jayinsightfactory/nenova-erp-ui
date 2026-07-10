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
  // 2026-07-10 Turbopack 프로덕션 빌드가 hydration 안 되는 산출물을 만드는 장애(런타임 엔트리 미실행,
  // __NEXT_P 미등록 — 전 페이지 버튼 무반응)로 webpack 빌드로 전환. 아래는 webpack 용 브라우저 폴리필 설정:
  // pptxgenjs(카탈로그 PPT)가 node:fs/https 등을 조건부 참조 — 클라이언트 번들에서는 비활성 처리.
  webpack: (config, { isServer, webpack }) => {
    if (!isServer) {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource) => {
          resource.request = resource.request.replace(/^node:/, '');
        })
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false, https: false, http: false, zlib: false,
        path: false, os: false, crypto: false, stream: false, child_process: false,
      };
    }
    return config;
  },
  env: {
    NEXT_PUBLIC_BUILD_VERSION: buildVersion,
  },
  async rewrites() {
    return [
      // 런타임 업로드 사진 — /uploads/photos/YYYY/MM/DD/uuid.jpg (인증 없음)
      // public/ 은 빌드 시점 고정이므로 API 라우트로 파일시스템 직접 스트리밍
      { source: '/uploads/photos/:path*', destination: '/api/public/photo/:path*' },
      { source: '/uploads/catalog/:path*', destination: '/api/public/catalog/:path*' },
    ];
  },
  async headers() {
    return [
      // n8n 한글 오버레이는 자주 갱신되므로 항상 최신본을 받도록 캐시 비활성
      {
        source: '/n8n-ko/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-cache, no-store, must-revalidate' }],
      },
    ];
  },
};

module.exports = nextConfig;
