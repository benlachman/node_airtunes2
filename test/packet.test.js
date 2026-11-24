const test = require('node:test');
const assert = require('node:assert');
const PacketPool = require('../lib/packet_pool');

test('a recycled packet does not keep the previous encoded audio', () => {
  const pool = new PacketPool();
  const packet = pool.getPacket();
  packet.alac = Buffer.from('old');
  packet.release();
  assert.strictEqual(pool.getPacket().alac, null);
});
