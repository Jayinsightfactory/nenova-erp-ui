'use strict';

const fs = require('node:fs');

function signature(stat) {
  return [stat.dev, stat.ino, stat.size, stat.mtimeNs, stat.ctimeNs].join(':');
}

// The snapshot is established when the bytes have been copied and revalidated.
// Parsing, normalization and ACL filtering can then run while new files arrive.
function captureDriveIndex(file, limit, previousSignature, io = fs) {
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = io.openSync(file, 'r');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return {signature:'missing', unchanged:previousSignature === 'missing', bytes:Buffer.alloc(0)};
    }
    try {
      const st = io.fstatSync(fd, {bigint:true});
      if (!st.isFile() || st.size > BigInt(limit)) throw Error('DRIVE_INDEX_UNREADABLE');
      const before = signature(st);
      const unchanged = previousSignature === before;
      let bytes;
      if (!unchanged) {
        bytes = Buffer.allocUnsafe(Number(st.size));
        let offset = 0;
        while (offset < bytes.length) {
          const n = io.readSync(fd, bytes, offset, bytes.length - offset, offset);
          if (!n) break;
          offset += n;
        }
        if (offset !== bytes.length) continue;
      }
      // Re-resolve the path to catch a concurrent rename/replacement, even when
      // its byte length is identical. File identity and nanosecond times matter.
      if (signature(io.statSync(file, {bigint:true})) !== before) continue;
      return {signature:before, unchanged, bytes};
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    } finally {
      io.closeSync(fd);
    }
  }
  throw Error('DRIVE_INDEX_CHANGED_DURING_COPY');
}

module.exports = {captureDriveIndex};
