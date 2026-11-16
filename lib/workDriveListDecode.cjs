'use strict';

// Older servers return files[] directly during a rolling deployment.
function decodeDriveList(payload) {
  const { fileTable, ...metadata } = payload;
  if (!fileTable) return payload;
  const { version, columns, strings, rows } = fileTable;
  if (version !== 1) throw Error('Unsupported drive file table');
  const files = rows.map(values => {
    const file = {};
    for (const [index, key] of columns.entries()) {
      const value = values[index];
      if (value === -1) continue;
      const decoded = Array.isArray(value) ? value[0] : strings[value];
      if (key === '__proto__') {
        Object.defineProperty(file, key, { value: decoded, enumerable: true, writable: true, configurable: true });
      } else {
        file[key] = decoded;
      }
    }
    return file;
  });
  return { ...metadata, files };
}
async function decodeDriveListAsync(payload, {signal, yieldTurn=()=>new Promise(resolve=>setTimeout(resolve,0))}={}) {
  if (!payload.fileTable) return payload;
  const {fileTable,...metadata}=payload, files=[];
  if(fileTable.version!==1)throw Error('Unsupported drive file table');
  for(let offset=0;offset<fileTable.rows.length;offset+=256){
    if(signal?.aborted){const error=Error('Request aborted');error.name='AbortError';throw error;}
    files.push(...decodeDriveList({fileTable:{...fileTable,rows:fileTable.rows.slice(offset,offset+256)}}).files);
    await yieldTurn();
  }
  return {...metadata,files};
}
module.exports = { decodeDriveList, decodeDriveListAsync };
