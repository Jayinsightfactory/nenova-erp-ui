// Customer import mappings retain lengths (50cm/60cm) and other source digits.
export function normalizeImportMappingKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
