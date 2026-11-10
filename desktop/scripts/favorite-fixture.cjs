'use strict';
// Account server fixture for isolated Electron processes. Optional file models server persistence.
const fs = require('node:fs');
module.exports = function favoriteFixture(file) {
  const accounts = file && fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  return async (request, actor) => {
    if (request.headers.get('x-favorite-owner') !== actor) return Response.json({success:false},{status:409});
    const rows = accounts[actor] ||= [];
    if (request.method !== 'GET') {
      const body = await request.json();
      const i = rows.findIndex(row => row.FavoriteKey === body.favoriteKey);
      if (request.method === 'POST') {
        const id = Math.max(0,...rows.map(row=>row.FavoriteKey))+1;
        rows.push({FavoriteKey:id,SortOrder:id,FavName:body.name,FilterData:body.filterData});
      } else if (request.method === 'PATCH' && i >= 0) {
        rows[i].FilterData = JSON.stringify({...JSON.parse(rows[i].FilterData),alias:body.alias});
      } else if (request.method === 'DELETE' && i >= 0) rows.splice(i,1);
      if (file) fs.writeFileSync(file,JSON.stringify(accounts));
    }
    return Response.json({success:true,favorites:rows});
  };
};
