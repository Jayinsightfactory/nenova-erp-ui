function escapeCsv(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function resolveValue(row, column) {
  if (typeof column.value === 'function') return column.value(row);
  return row?.[column.key];
}

export function makeDatedFilename(prefix, ext = 'csv') {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  const safePrefix = String(prefix || 'export').replace(/[\\/:*?"<>|]/g, '_').trim() || 'export';
  return `${safePrefix}_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`;
}

export function downloadTextFile(filename, content, mimeType = 'text/plain;charset=utf-8;') {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadCsv(filename, columns, rows) {
  const lines = [
    columns.map(c => escapeCsv(c.label || c.key)).join(','),
    ...(rows || []).map(row => columns.map(c => escapeCsv(resolveValue(row, c))).join(',')),
  ];
  downloadTextFile(filename, `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8;');
}

export function downloadSectionsCsv(filename, sections) {
  const lines = [];
  for (const section of sections || []) {
    if (!section) continue;
    if (lines.length) lines.push('');
    if (section.title) lines.push(escapeCsv(section.title));
    if (section.columns?.length) {
      lines.push(section.columns.map(c => escapeCsv(c.label || c.key)).join(','));
      for (const row of section.rows || []) {
        lines.push(section.columns.map(c => escapeCsv(resolveValue(row, c))).join(','));
      }
    }
  }
  downloadTextFile(filename, `\uFEFF${lines.join('\r\n')}`, 'text/csv;charset=utf-8;');
}
