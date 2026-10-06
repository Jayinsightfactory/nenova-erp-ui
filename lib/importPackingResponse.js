export function parsePackingResponse(data, country) {
  if (!['CO','NL','CN','EC','TH','AU','US','VN'].includes(country)) throw new Error('Unsupported packing country.');
  if (!data || !Array.isArray(data.content)) throw new Error("Invalid PDF analysis response.");
  let wasTruncated = (data.stop_reason === 'max_tokens');
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  // Find the start of the JSON object
  const jsonStart = text.indexOf('{');
  if (jsonStart < 0) throw new Error('No JSON found in response: ' + text.slice(0, 200));
  let jsonText = text.slice(jsonStart);
  // Try strict parse first
  let result = null;
  try {
    result = JSON.parse(jsonText);
  } catch (firstErr) {
    // Strategy 1: trim trailing junk (markdown fences, prose) and retry.
    // This handles the common case where the model adds ``` after the JSON.
    const lastBrace = jsonText.lastIndexOf('}');
    if (lastBrace > 0 && lastBrace < jsonText.length - 1) {
      try {
        result = JSON.parse(jsonText.slice(0, lastBrace + 1));
      } catch (_) { /* fall through to invoice-level recovery */ }
    }
    if (result === null) {
    // Response may be truncated. Try to recover by closing open structures.
    // Strategy: walk the string tracking brackets/quotes; truncate at last complete object in invoices array; then close.
    try {
      let depth = 0, inStr = false, escape = false;
      let lastSafeEnd = -1;       // position right after a top-level invoice element (after its '}')
      let inInvoicesArr = false;
      let invDepth = 0;            // depth of objects within invoices array (1 = invoice object level)
      // Locate start of "invoices":[
      const invIdx = jsonText.indexOf('"invoices"');
      let arrayStart = -1;
      if (invIdx >= 0) {
        const colonIdx = jsonText.indexOf('[', invIdx);
        if (colonIdx >= 0) arrayStart = colonIdx;
      }
      for (let i = 0; i < jsonText.length; i++) {
        const c = jsonText[i];
        if (escape) { escape = false; continue; }
        if (inStr) {
          if (c === '\\') escape = true;
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') { inStr = true; continue; }
        if (i === arrayStart) { inInvoicesArr = true; continue; }
        if (!inInvoicesArr) continue;
        if (c === '{') invDepth++;
        else if (c === '}') {
          invDepth--;
          if (invDepth === 0) lastSafeEnd = i + 1;
        } else if (c === ']' && invDepth === 0) { break; }
      }
      if (lastSafeEnd > 0) {
        // Cut after the last complete invoice and close the structure
        const truncated = jsonText.slice(0, lastSafeEnd) + ']}';
        result = JSON.parse(truncated);
        // Detect REAL truncation: there was content after lastSafeEnd that
        // we discarded (an incomplete invoice).  If the only thing after
        // was whitespace + ']}' / ']' / trailing markdown, it wasn't a
        // truncation, just slightly malformed JSON we cleaned up.
        const tail = jsonText.slice(lastSafeEnd).replace(/\s+/g, '');
        const tailIsJustClosers = /^[\]}\s,`]*$/.test(tail) || tail === '';
        if (!tailIsJustClosers) {
          wasTruncated = true;
          console.warn('Recovered from truncated JSON. Some invoices may be missing.');
        }
      } else {
        throw firstErr;
      }
    } catch (recovErr) {
      // Last resort: report position from original error
      throw new Error('JSON parse failed (response may be too large). ' + (firstErr.message || ''));
    }
    }  // end of if (result === null)
  }

  if (!result || !Array.isArray(result.invoices) || !result.invoices.length) throw new Error("No invoices found in PDF");
  const key = country === 'NL' ? 'lines' : 'products';
  result = { ...result, invoices: result.invoices.map(invoice => {
    if (!invoice || !Array.isArray(invoice[key]) || !invoice[key].length) {
      throw new Error('Invalid invoice product rows.');
    }
    for (const row of invoice[key]) {
      if (!row || typeof row.description !== 'string' || !row.description.trim()) {
        throw new Error('Invalid invoice product description.');
      }
      for (const field of ['pcs','bunch_st','steam_box','total_stems','total_bunch','stems','price','u_price','t_price']) {
        if (row[field] != null && (!Number.isFinite(Number(row[field])) || Number(row[field]) < 0)) {
          throw new Error('Invalid invoice number: ' + field);
        }
      }
    }
    for (const field of ['freight','freight_total','handling','gross_weight','vol_weight','invoice_total','total_value']) {
      if (invoice[field] != null && !Number.isFinite(Number(invoice[field]))) throw new Error('Invalid invoice number: ' + field);
    }
    return { ...invoice, invoice: invoice.invoice == null ? '' : String(invoice.invoice) };
  }) };
  return { result, wasTruncated };
}
