module.exports=function(source){
 if(this.resourcePath.endsWith('.css'))return `const css=${JSON.stringify(source)};const s=document.createElement('style');s.textContent=css;document.head.append(s);export default new Proxy({},{get:(_,key)=>key});`;
 return require('next/dist/compiled/babel/core').transformSync(source,{filename:this.resourcePath,presets:[[require('next/dist/compiled/babel/preset-react'),{runtime:'automatic'}]],configFile:false,babelrc:false}).code;
};
