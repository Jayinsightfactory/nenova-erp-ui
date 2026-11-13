import JSZip from 'jszip';

const decode = s => s.replace(/&#x([0-9a-f]+);|&#(\d+);|&(amp|lt|gt|quot|apos);/gi,(_,hex,num,named)=>hex?String.fromCodePoint(parseInt(hex,16)):num?String.fromCodePoint(Number(num)):({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"}[named.toLowerCase()]));

// Extract only text boxes in worksheet drawing parts; pictures are not treated as text.
export async function readFarmDrawingText(buffer) {
  const zip=await JSZip.loadAsync(buffer),texts=[];
  for(const name of Object.keys(zip.files).filter(n=>/^xl\/drawings\/drawing\d+\.xml$/.test(n)).sort()) {
    const xml=await zip.file(name).async('string');
    for(const match of xml.matchAll(/<(?:\w+:)?txBody\b[^>]*>([\s\S]*?)<\/(?:\w+:)?txBody>/g)) {
      const paragraphs=[...match[1].matchAll(/<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/g)].map(p=>
        [...p[1].matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>|<(?:\w+:)?br\s*\/?\s*>/g)].map(t=>t[1]===undefined?'\n':decode(t[1])).join(''));
      const text=paragraphs.join('\n').trim();
      if((/^[-－–*＊]\s*\S/m.test(text)) && /\d+\s*(?:단|박스|송이)?\s*[（(]/.test(text))texts.push(text);
    }
  }
  return texts.join('\n\n');
}
