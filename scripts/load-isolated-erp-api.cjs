const fs=require('node:fs'),path=require('node:path'),Module=require('node:module');
const suffix=process.platform==='win32'?'-msvc':process.platform==='linux'?'-gnu':'';
const {transformSync}=require(`@next/swc-${process.platform}-${process.arch}${suffix}`);
module.exports=function loadApi(relative,db){
 const root=path.resolve(__dirname,'..'),cache=new Map();
 function load(file){
  file=require.resolve(file);if(cache.has(file))return cache.get(file).exports;
  const local=Module.createRequire(file),mod={exports:{}};cache.set(file,mod);
  const requireScoped=name=>{
   const resolved=name.startsWith('.')?require.resolve(path.resolve(path.dirname(file),name)):null;
   if(resolved===path.join(root,'lib','db.js'))return db;
   if(resolved===path.join(root,'lib','auth.js'))return {withAuth:fn=>fn};
   if(resolved===path.join(root,'lib','withActionLog.js'))return {withActionLog:fn=>fn};
   if(resolved&&resolved.startsWith(path.join(root,'lib')+path.sep)&&resolved.endsWith('.js'))return load(resolved);
   return local(name);
  };
  const code=transformSync(fs.readFileSync(file,'utf8'),false,Buffer.from(JSON.stringify({jsc:{parser:{syntax:'ecmascript',jsx:true}},module:{type:'commonjs'}}))).code;
  new Function('require','module','exports','__filename','__dirname',code)(requireScoped,mod,mod.exports,file,path.dirname(file));return mod.exports;
 }
 return load(path.join(root,relative)).default;
};
