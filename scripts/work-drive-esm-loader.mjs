// scripts/work-drive-esm-loader.mjs — lib/*.js 는 Next 전용이라 확장자 없는 상대 import('./workManuals')를 쓴다.
// 노드 스크립트(소급·점검)가 lib 를 직접 읽을 수 있게, 상대 경로에 확장자가 없고 .js/.mjs/.cjs 파일이 있으면 붙여 준다. 그 외는 기본 동작.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier, context, nextResolve) {
  if (/^\.\.?\//.test(specifier) && !/\.[a-z]+$/i.test(specifier) && context.parentURL) {
    const base = new URL(specifier, context.parentURL);
    for (const ext of ['.js', '.mjs', '.cjs']) {
      const candidate = base.href + ext;
      if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate, context);
    }
  }
  return nextResolve(specifier, context);
}
