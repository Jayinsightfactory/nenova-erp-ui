import test from 'node:test';
import assert from 'node:assert/strict';
import {readPackingProviderResponse,packingProviderFailureCode} from '../lib/importPackingProviderStream.js';
const frame=value=>`data: ${JSON.stringify(value)}\n\n`;
function response(events,split=7){
  const bytes=new TextEncoder().encode(events.map(frame).join(''));
  return {headers:new Headers({'content-type':'text/event-stream'}),body:new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=split)c.enqueue(bytes.slice(i,i+split));c.close();}})};
}
const events=[{type:'message_start',message:{content:[],usage:{input_tokens:42},stop_reason:null}},
 {type:'content_block_start',index:0,content_block:{type:'text',text:''}},
 {type:'ping'},{type:'content_block_delta',index:0,delta:{type:'text_delta',text:'{"품목":"수국"}'}},
 {type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:12}},{type:'message_stop'}];
test('chunked UTF8 stream assembles complete JSON and usage',async()=>{
 const result=await readPackingProviderResponse(response(events));
 assert.equal(result.content[0].text,'{"품목":"수국"}');assert.equal(result.stop_reason,'end_turn');
 assert.deepEqual(result.usage,{input_tokens:42,output_tokens:12});
});
test('partial and provider error streams never become success',async()=>{
 await assert.rejects(readPackingProviderResponse(response(events.slice(0,-1))),{code:'PDF_STREAM_INCOMPLETE'});
 await assert.rejects(readPackingProviderResponse(response([{type:'error',error:{type:'overloaded_error'}}])),{code:'PDF_STREAM_PROVIDER_ERROR'});
});
test('transport diagnostic reveals only whitelisted code',()=>{
 assert.equal(packingProviderFailureCode({cause:{code:'UND_ERR_HEADERS_TIMEOUT'}}),'UND_ERR_HEADERS_TIMEOUT');
 assert.equal(packingProviderFailureCode({message:'secret',code:'private-value'}),'PDF_PROVIDER_RESPONSE_FAILED');
});
