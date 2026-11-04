// Hand-rolled ABI for the ERC-8004 Identity Registry + Multicall3 aggregate3. Read only; no signing, no sending.
export const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
export const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63';
export const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11';
export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';
export const SEL = { ownerOf: '0x6352211e', tokenURI: '0xc87b56dd', getAgentWallet: '0x00339509', balanceOf: '0x70a08231' };

const hex32 = (n) => BigInt(n).toString(16).padStart(64, '0');
const addr32 = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
export const encodeOwnerOf = (id) => SEL.ownerOf + hex32(id);
export const encodeTokenURI = (id) => SEL.tokenURI + hex32(id);
export const encodeGetAgentWallet = (id) => SEL.getAgentWallet + hex32(id);
export const encodeBalanceOf = (holder) => SEL.balanceOf + addr32(holder);

// calls: [{ target, callData }] -> calldata hex (allowFailure = true for every call)
export function encodeAggregate3(calls) {
  const elems = calls.map((c) => {
    const data = c.callData.replace(/^0x/, ''), len = data.length / 2, padded = data.padEnd(Math.ceil(len / 32) * 64, '0');
    return addr32(c.target) + hex32(1) + hex32(0x60) + hex32(len) + padded;
  });
  let off = calls.length * 32; const offs = [];
  for (const e of elems) { offs.push(hex32(off)); off += e.length / 2; }
  return '0x82ad56cb' + hex32(0x20) + hex32(calls.length) + offs.join('') + elems.join('');
}
// -> [{ success, returnData(hex) }]
export function decodeAggregate3(hex) {
  const d = hex.replace(/^0x/, ''), word = (i) => BigInt('0x' + d.slice(i * 2, i * 2 + 64));
  const base = Number(word(0)), n = Number(word(base)), start = base + 32, out = [];
  for (let i = 0; i < n; i++) {
    const t = start + Number(word(start + i * 32));
    const success = word(t) === 1n, bo = t + Number(word(t + 32)), len = Number(word(bo));
    out.push({ success, returnData: '0x' + d.slice((bo + 32) * 2, (bo + 32 + len) * 2) });
  }
  return out;
}
export const decodeUint = (hex) => (hex && hex.length > 2 ? BigInt(hex) : 0n);
// 32-byte word -> lowercase 0x address, or null when not an address-sized return
export function decodeAddress(hex) {
  if (!hex || hex.length < 66) return null;
  return '0x' + hex.slice(2 + 24, 2 + 64).toLowerCase();
}
// ABI-encoded `string` return -> JS string, or null when malformed
export function decodeString(hex) {
  try {
    const d = (hex || '').replace(/^0x/, '');
    if (d.length < 128) return null;
    const off = Number(BigInt('0x' + d.slice(0, 64))) * 2;
    const len = Number(BigInt('0x' + d.slice(off, off + 64)));
    if (off + 64 + len * 2 > d.length) return null;
    return Buffer.from(d.slice(off + 64, off + 64 + len * 2), 'hex').toString('utf8');
  } catch { return null; }
}
// The three per-id reads used by the scan, in a fixed order.
export const idCalls = (id) => [
  { target: IDENTITY_REGISTRY, callData: encodeOwnerOf(id) },
  { target: IDENTITY_REGISTRY, callData: encodeTokenURI(id) },
  { target: IDENTITY_REGISTRY, callData: encodeGetAgentWallet(id) },
];
