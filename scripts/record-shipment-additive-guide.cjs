// Uses exactly the same synthetic API boundary and assertions as the browser smoke.
process.argv.push('--record');
require('./smoke-shipment-additive.cjs');
