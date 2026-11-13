'use strict';

const { setImmediate: yieldTurn } = require('node:timers/promises');

// Share column names and only strings that occur often enough to save bytes.
async function encodeDriveFileTable(files, isClosed = () => false) {
  const keys = new Set();
  const counts = new Map();
  for (const [index, file] of files.entries()) {
    for (const [key, value] of Object.entries(file)) {
      keys.add(key);
      if (typeof value === 'string') counts.set(value, (counts.get(value) || 0) + 1);
    }
    if (index % 256 === 255) {
      await yieldTurn();
      if (isClosed()) return null;
    }
  }

  const columns = [...keys];
  const strings = [];
  const dictionary = new Map();
  const rows = [];
  for (const [index, file] of files.entries()) {
    rows.push(columns.map(key => {
      if (!Object.hasOwn(file, key) || file[key] === undefined) return -1;
      const value = file[key];
      if (typeof value !== 'string' || counts.get(value) < 3) return [value];
      if (!dictionary.has(value)) {
        dictionary.set(value, strings.length);
        strings.push(value);
      }
      return dictionary.get(value);
    }));
    if (index % 256 === 255) {
      await yieldTurn();
      if (isClosed()) return null;
    }
  }
  return { version: 1, columns, strings, rows };
}

const { decodeDriveList } = require('./workDriveListDecode.cjs');
module.exports = { encodeDriveFileTable, decodeDriveList };
