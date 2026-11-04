import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAggregate3, decodeAggregate3, encodeOwnerOf, encodeTokenURI, encodeGetAgentWallet, decodeAddress, decodeString, idCalls, SEL } from '../abi.mjs';

test('selectors and calldata', () => {
  assert.equal(encodeOwnerOf(1), SEL.ownerOf + '0'.repeat(63) + '1');
  assert.equal(encodeTokenURI(255), SEL.tokenURI + '0'.repeat(62) + 'ff');
  assert.equal(encodeGetAgentWallet(2).length, 2 + 8 + 64);
});
test('aggregate3 encode starts with selector and round-trips a synthetic return', () => {
  const enc = encodeAggregate3(idCalls(1));
  assert.ok(enc.startsWith('0x82ad56cb'));
  // build a return: [(true, 0x..32 bytes), (false, 0x)]
  const w = (n) => BigInt(n).toString(16).padStart(64, '0');
  const ret1 = '0x' + w(0x20) + w(2) + w(0x40) + w(0xc0) + // offsets
    w(1) + w(0x40) + w(32) + '00'.repeat(12) + 'ab'.repeat(20) +
    w(0) + w(0x40) + w(0);
  const out = decodeAggregate3(ret1);
  assert.equal(out.length, 2);
  assert.equal(out[0].success, true); assert.equal(decodeAddress(out[0].returnData), '0x' + 'ab'.repeat(20));
  assert.equal(out[1].success, false); assert.equal(out[1].returnData, '0x');
});
test('decodeString', () => {
  const w = (n) => BigInt(n).toString(16).padStart(64, '0');
  const s = 'https://x.example/c.json', hex = Buffer.from(s).toString('hex').padEnd(64, '0');
  assert.equal(decodeString('0x' + w(0x20) + w(s.length) + hex), s);
  assert.equal(decodeString('0x'), null);
  assert.equal(decodeString('0x' + w(0x20) + w(9999) + hex), null);
});
