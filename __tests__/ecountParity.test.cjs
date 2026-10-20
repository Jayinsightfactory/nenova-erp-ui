'use strict';
const assert=require('node:assert/strict');
const {validate,complete}=require('../scripts/check-ecount-parity.cjs');
const inventory=require('../data/ecount-workbench/parity-inventory.json');
const packets=require('../data/ecount-workbench/parity-packets.json');
const menus=require('../data/ecount-workbench/source-menu.json').menus;
assert.deepEqual(validate(inventory,packets,menus),[]);
assert.equal(inventory.screens.length,373);assert.equal(packets.packets.length,59);
assert.equal(inventory.screens.filter(complete).length,0);
function mutate(fn){const d=structuredClone(inventory);fn(d);return validate(d,packets,menus);}
assert(mutate(d=>{d.screens[0].stage='verified';}).some(x=>x.includes('falsely verified')));
assert(mutate(d=>{d.screens[0].actionCount=0;d.screens[0].actions=[{}];}).length);
assert(mutate(d=>{d.screens[0].actions=[{classification:'save',stage:'observed',sourceExecutionAllowed:true,sourceExecuted:true}];}).some(x=>x.includes('source mutation')));
assert(mutate(d=>{d.screens[0].actions=[{classification:'unknown',stage:'observed',sourceExecutionAllowed:true,sourceExecuted:false}];}).some(x=>x.includes('source mutation')));
assert(mutate(d=>{d.screens[0].dimensions.columns.stage='verified';}).some(x=>x.includes('lacks evidence')));
assert(mutate(d=>{d.screens[0].aliases[0].menuId='NONEXISTENT';}).length);
const badPlan=structuredClone(packets);badPlan.packets[0].screenIds.push(badPlan.packets[0].screenIds[0]);assert(validate(inventory,badPlan,menus).length);
assert.equal(complete(inventory.screens[0]),false);
console.log('PASS ECOUNT parity inventory: unknown counts, evidence gates, source writes blocked, aliases and packet coverage');
