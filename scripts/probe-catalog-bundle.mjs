const BASE = 'https://nenovaweb.com';
const html = await (await fetch(`${BASE}/catalog`)).text();
const scripts = [...html.matchAll(/src="(\/_next\/static\/[^"]+)"/g)].map(m => m[1]);
const found = { flex25: false, width25: false, imgInner: false, linearZoom: false };
for (const s of scripts) {
  const t = await (await fetch(`${BASE}${s}`)).text();
  if (/flex:\s*0\s+0\s+25%/.test(t)) found.flex25 = true;
  if (/width:\s*25%/.test(t)) found.width25 = true;
  if (t.includes('composer-slot-img-inner')) found.imgInner = true;
  if (t.includes('objectFit:"contain"') && t.includes('zoom * 100')) found.linearZoom = true;
}
console.log(JSON.stringify(found, null, 2));
