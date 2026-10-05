// Test-only extension resolution for the real Next.js modules. Compatible with
// Node 20.6+ (CI) and Node 24 (local); no production module is replaced.
import path from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  try { return await nextResolve(specifier, context); }
  catch (error) {
    if ((error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'ERR_UNSUPPORTED_DIR_IMPORT')
      && /^\.\.?\//.test(specifier) && !path.extname(specifier)) {
      return nextResolve(`${specifier}.js`, context);
    }
    throw error;
  }
}
