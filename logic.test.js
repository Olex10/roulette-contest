import test from 'node:test';import assert from 'node:assert/strict';import {chipsFor,outcome,payout} from './logic.js';
test('начисление по порогам',()=>{assert.equal(chipsFor(500),15);assert.equal(chipsFor(1000),15);assert.equal(chipsFor(5000),35);assert.equal(chipsFor(10000),110);assert.equal(chipsFor(10001),null)});
test('рулетка',()=>{assert.equal(outcome(0),'zero');assert.equal(outcome(1),'red');assert.equal(outcome(2),'black');assert.equal(payout(15,'red','red'),30);assert.equal(payout(15,'zero','zero'),45);assert.equal(payout(15,'red','black'),0)});
