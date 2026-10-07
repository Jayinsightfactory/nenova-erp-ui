import path from 'node:path';
import JSZip from 'jszip';
import {knowledgeError,ATTACHMENT_TYPES} from './operationsKnowledgeSchema.js';

export const MAX_ATTACHMENT_BYTES=10*1024*1024;
const cleanName=value=>typeof value==='string'&&value.length>0&&value.length<=255&&!/[\u0000-\u001f\u007f\\/]/.test(value)&&value!=='.'&&value!=='..';
export async function inspectAttachment(buffer,name,mime) {
  if(!cleanName(name)||typeof mime!=='string')throw knowledgeError('첨부 파일 이름을 확인하세요.');
  const extension=path.extname(name).toLowerCase(),expected=ATTACHMENT_TYPES[extension];
  const mimeAllowed=expected&&(mime.toLowerCase()===expected[0]||(extension==='.csv'&&mime.toLowerCase()==='application/vnd.ms-excel'));
  if(!mimeAllowed||buffer.length<1||buffer.length>MAX_ATTACHMENT_BYTES)throw knowledgeError('허용되지 않는 첨부 형식 또는 크기입니다.',buffer.length>MAX_ATTACHMENT_BYTES?413:400);
  const head=buffer.subarray(0,16),ascii=head.toString('ascii');
  if(['.jpg','.jpeg'].includes(extension)&&!(head[0]===0xff&&head[1]===0xd8&&head[2]===0xff))throw knowledgeError('JPEG 파일 내용을 확인하세요.');
  if(extension==='.png'&&!head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw knowledgeError('PNG 파일 내용을 확인하세요.');
  if(extension==='.webp'&&!(ascii.startsWith('RIFF')&&ascii.slice(8,12)==='WEBP'))throw knowledgeError('WebP 파일 내용을 확인하세요.');
  if(extension==='.pdf'&&!ascii.startsWith('%PDF-'))throw knowledgeError('PDF 파일 내용을 확인하세요.');
  if(['.docx','.xlsx'].includes(extension)) {
    if(!(head[0]===0x50&&head[1]===0x4b))throw knowledgeError('Office 파일 내용을 확인하세요.');
    let zip;try{zip=await JSZip.loadAsync(buffer,{checkCRC32:false});}catch{throw knowledgeError('Office 파일 구조가 올바르지 않습니다.');}
    const names=Object.keys(zip.files);
    const entries=Object.values(zip.files),expanded=entries.reduce((sum,entry)=>sum+(entry._data?.uncompressedSize||0),0);
    if(names.length>2000||expanded>50*1024*1024||entries.some(entry=>(entry._data?.uncompressedSize||0)>32*1024*1024)||!names.includes('[Content_Types].xml')||!names.includes('_rels/.rels')||!names.includes(extension==='.docx'?'word/document.xml':'xl/workbook.xml')||names.some(entry=>/vbaproject\.bin|macrosheets|activex|embeddings\/.*\.(exe|dll|js|vbs)/i.test(entry)))throw knowledgeError('Office 문서 또는 매크로 포함 여부를 확인하세요.');
    const types=zip.file('[Content_Types].xml');
    if((types?._data?.uncompressedSize||0)>1024*1024)throw knowledgeError('Office 문서 구조가 너무 큽니다.');
    const typeXml=await types.async('string');
    if(/macroEnabled|vbaProject|activeX/i.test(typeXml))throw knowledgeError('매크로 문서는 첨부할 수 없습니다.');
  }
  if(['.csv','.txt'].includes(extension)) {
    const text=buffer.toString('utf8');
    if(text.includes('\uFFFD')||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)||/^\s*<(?:!doctype|html|svg|script|iframe)\b/i.test(text))throw knowledgeError('텍스트 파일 내용을 확인하세요.');
  }
  return {mediaType:expected[0],kind:expected[1]};
}
