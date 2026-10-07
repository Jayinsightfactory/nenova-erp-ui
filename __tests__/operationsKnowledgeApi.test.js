import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {assertKnowledgeOrigin,knowledgeApiError} from '../lib/operationsKnowledgeApi.js';

const source=fs.readFileSync(new URL('../pages/api/operations-knowledge/index.js',import.meta.url),'utf8');
const body=source.replace(/^import .*;\r?\n/gm,'').replace('export const config=','const config=').replace('export const createKnowledgeHandler =','const createKnowledgeHandler =').replace('export default withAuth(createKnowledgeHandler());','return createKnowledgeHandler;');
const factory=new Function('withAuth','readKnowledge','mutateKnowledge','assertKnowledgeOrigin','knowledgeApiError',body)(fn=>fn,()=>{},()=>{},assertKnowledgeOrigin,knowledgeApiError);
const headers={host:'example.com','x-forwarded-proto':'https',origin:'https://example.com'};
const response=()=>({statusCode:200,headers:{},setHeader(key,value){this.headers[key]=value;return this;},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}});

test('JSON handler enforces active auth, exact origin, methods and request size',async()=>{
  let reads=0,writes=0;
  const handler=factory({read:async()=>{reads++;return {revision:0,items:[],audit:[],legacyHandoffs:{items:[]}};},mutate:async(payload,options)=>{writes++;assert.equal(payload.action,'CREATE_ITEM');assert.equal(options.actor.userId,'u1');return {revision:1,items:[{id:'ok'}],audit:[]};}});
  let res=response();await handler({method:'GET',user:{userId:'u1',accountActive:true},headers},res);assert.equal(res.statusCode,200);assert.equal(res.body.revision,0);assert.equal(reads,1);
  res=response();await handler({method:'GET',user:{userId:'u1',accountActive:false},headers},res);assert.equal(res.statusCode,403);assert.equal(reads,1);
  res=response();await handler({method:'POST',user:{userId:'u1',accountActive:true},headers:{...headers,origin:'https://evil.example.com'},body:{action:'CREATE_ITEM'}},res);assert.equal(res.statusCode,403);assert.equal(writes,0);
  res=response();await handler({method:'POST',user:{userId:'u1',accountActive:true},headers:{...headers,origin:undefined},body:{action:'CREATE_ITEM'}},res);assert.equal(res.statusCode,403);assert.equal(writes,0);
  res=response();await handler({method:'POST',user:{userId:'u1',accountActive:true},headers:{...headers,'sec-fetch-site':'cross-site'},body:{action:'CREATE_ITEM'}},res);assert.equal(res.statusCode,403);assert.equal(writes,0);
  res=response();await handler({method:'POST',user:{userId:'u1',accountActive:true},headers,body:{action:'CREATE_ITEM'}},res);assert.equal(res.statusCode,200);assert.equal(res.body.revision,1);assert.equal(writes,1);
  res=response();await handler({method:'POST',user:{userId:'u1',accountActive:true},headers:{...headers,'content-length':String(1024*1024+1)},body:{action:'CREATE_ITEM'}},res);assert.equal(res.statusCode,413);assert.equal(writes,1);
  res=response();await handler({method:'DELETE',user:{userId:'u1',accountActive:true},headers},res);assert.equal(res.statusCode,405);assert.equal(res.headers.Allow,'GET, POST');
});
test('JSON handler passes stale conflict without overwrite',async()=>{
  const handler=factory({mutate:async()=>{throw Object.assign(Error('stale'),{statusCode:409});}});
  const res=response();await handler({method:'POST',user:{userId:'u1',accountActive:true},headers,body:{action:'CREATE_ITEM'}},res);
  assert.equal(res.statusCode,409);assert.equal(res.body.error,'stale');
});
test('generic state API blocks direct knowledge key before GET and PUT',async()=>{
  const generic=fs.readFileSync(new URL('../pages/api/import/tools/state.js',import.meta.url),'utf8');
  const executable=generic.replace(/^import .*;\r?\n/gm,'').replace('export const config=','const config=').replace('export default withAuth','return withAuth');
  const handler=new Function('withAuth','readImportTeamRecord','writeImportTeamRecord','listImportTeamHistory','aliasSeed',executable)(fn=>fn,()=>{throw Error('read bypass');},()=>{throw Error('write bypass');},()=>[],[]);
  for(const method of ['GET','PUT']) {const res=response();await handler({method,query:{key:'knowledge.guidance'},user:{userId:'u1',accountActive:true}},res);assert.equal(res.statusCode,403);}
});
