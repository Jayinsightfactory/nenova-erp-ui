const fs = require('node:fs');
const assert = require('node:assert/strict');

const source = fs.readFileSync('components/Layout.js', 'utf8');
assert.match(source, /fetch\('\/api\/favorites\?page=dashboard-menu'\)/, 'menu favorites must load for the signed-in user');
assert.match(source, /method: existing \? 'DELETE' : 'POST'/, 'the star must add and remove a menu favorite');
assert.match(source, /page: 'dashboard-menu'[\s\S]*filterData: JSON\.stringify\(\{ href: item\.href \}\)/, 'saved favorite must map back to the canonical menu route');
assert.match(source, /favoriteKey: existing\.favoriteKey/, 'removal must target only the saved favorite record');
assert.match(source, /data-testid="sidebar-favorite-toggle"/, 'star must have a stable test/accessibility target');
assert.match(source, /aria-pressed=\{isFavorite\}/, 'star state must be exposed to keyboard and assistive technology');
assert.match(source, /isFavorite \? '★' : '☆'/, 'active and inactive states must be visually distinct');
assert.match(source, /!favoriteHrefs\.has\(item\.href\)/, 'favorites must not be duplicated in their original menu group');
assert.match(source, /nav-favorites/, 'saved menu items must appear in the favorites section');
assert.match(source, /disabled=\{!user\?\.userId \|\| favoriteBusyHref !== ''\}/, 'toggle must prevent anonymous and overlapping writes');

const api = fs.readFileSync('pages/api/favorites.js', 'utf8');
assert.match(api, /WHERE FavoriteKey=@fk AND UserID=@uid/, 'favorite removal must remain owner-scoped');
console.log('PC sidebar menu favorites tests passed');
