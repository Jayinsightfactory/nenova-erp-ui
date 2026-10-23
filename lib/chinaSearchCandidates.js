const normalized = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, '');

// Filter only the supplied active DB catalog; never invent a mapping or keep an unrelated prior choice.
export function chinaSearchCandidates(options, search) {
  const terms = String(search ?? '').normalize('NFKC').toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return options;
  return options.filter(item => {
    const haystack = normalized(item.label);
    return terms.every(term => haystack.includes(normalized(term)));
  });
}
