// Read Anthropic SSE through message_stop. Partial output is never a result.
export async function readPackingProviderResponse(response) {
  if (!response.headers?.get('content-type')?.includes('text/event-stream')) return response.json();
  if (!response.body) throw Object.assign(new Error('Missing PDF stream'), {code:'PDF_STREAM_MISSING'});
  const decoder=new TextDecoder();let pending='',message=null,stopped=false,bytes=0;
  const consume=frame=>{
    const raw=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
    if(!raw)return;
    const event=JSON.parse(raw);
    if(event.type==='error')throw Object.assign(new Error('PDF provider stream failed'),{code:'PDF_STREAM_PROVIDER_ERROR'});
    if(event.type==='message_start')message={...event.message,content:[],usage:{...event.message.usage}};
    if(event.type==='content_block_start'&&message)message.content[event.index]={...event.content_block};
    if(event.type==='content_block_delta'&&message){
      const block=message.content[event.index];
      if(!block)throw new Error('PDF stream block missing');
      if(event.delta.type==='text_delta')block.text=(block.text||'')+event.delta.text;
    }
    if(event.type==='message_delta'&&message){Object.assign(message,event.delta);Object.assign(message.usage,event.usage);}
    if(event.type==='message_stop')stopped=true;
  };
  for await(const chunk of response.body){
    bytes+=chunk.byteLength;if(bytes>10*1024*1024)throw Object.assign(new Error('PDF stream too large'),{code:'PDF_STREAM_TOO_LARGE'});
    pending+=decoder.decode(chunk,{stream:true});
    pending=pending.replace(/\r\n/g,'\n');
    let end;while((end=pending.indexOf('\n\n'))>=0){consume(pending.slice(0,end));pending=pending.slice(end+2);}
  }
  pending+=decoder.decode();if(pending.trim())consume(pending);
  if(!message||!stopped)throw Object.assign(new Error('PDF stream ended before completion'),{code:'PDF_STREAM_INCOMPLETE'});
  return message;
}

export function packingProviderFailureCode(error) {
  const code=error?.cause?.code||error?.code||error?.name;
  return /^(UND_ERR_HEADERS_TIMEOUT|UND_ERR_BODY_TIMEOUT|ETIMEDOUT|ECONNRESET|AbortError|TimeoutError|PDF_STREAM_[A-Z_]+)$/.test(code||'')?code:'PDF_PROVIDER_RESPONSE_FAILED';
}
