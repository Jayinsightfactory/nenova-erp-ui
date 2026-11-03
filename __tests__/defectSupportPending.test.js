import assert from 'node:assert/strict';
import {isSupportPendingRow}from '../lib/salesDefectSupportStatus.js';
for(const row of [{status:'REGISTERED',estimateKey:10},{status:'COMPLETED'},{status:'MANUAL_COMPLETED'},{status:'DRAFT',estimateKey:10},{exactExistingEstimate:true,exactExistingEstimateKey:10}])assert.equal(isSupportPendingRow(row),false);
for(const row of [{status:'DRAFT'},{status:'CARRYOVER',isCarryoverLedger:true,remainingQuantity:2,estimateKey:10},{status:'REGISTERED',estimateKey:10,missingLinkedEstimate:true},{status:'DRAFT',quantity:6,exactExistingEstimate:false}])assert.equal(isSupportPendingRow(row),true);
console.log('support pending: hide completed, retain partial/review/different quantity passed');

assert.equal(isSupportPendingRow({status:'CARRYOVER',isCarryoverLedger:true,remainingQuantity:5,estimateKey:10,registrationEligibilityCode:'ALREADY_REGISTERED'}),false);

assert.equal(isSupportPendingRow({isCarryoverLedger:true,remainingQuantity:2,processingStatus:'COMPLETED_EXISTING',exactExistingEstimate:true,exactExistingEstimateKey:10916}),false);
