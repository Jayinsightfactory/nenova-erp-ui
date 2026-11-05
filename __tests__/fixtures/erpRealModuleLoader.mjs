// Node-only resolver for Next's extensionless server imports. No production module is mocked.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
export async function resolve(specifier,context,nextResolve){
  try{return await nextResolve(specifier,context);}catch(error){
    if(specifier.startsWith('.'))for(const suffix of ['.js','.mjs','.json']){
      const url=new URL(specifier+suffix,context.parentURL);
      if(fs.existsSync(fileURLToPath(url)))return nextResolve(url.href,context);
    }
    throw error;
  }
}
export async function load(url,context,nextLoad){
  return nextLoad(url,url.endsWith('.json')?{...context,importAttributes:{...context.importAttributes,type:'json'}}:context);
}
