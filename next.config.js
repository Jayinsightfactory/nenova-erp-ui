/** @type {import('next').NextConfig} */
// 2026-04-09 rebuild
const nextConfig = {
  serverExternalPackages: ['mssql'],
  generateBuildId: async () => {
    return `build-${Date.now()}`;
  },
};

module.exports = nextConfig;
