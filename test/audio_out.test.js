const test = require('node:test');
const assert = require('node:assert');
const events = require('events');
const clock = require('../lib/monotonic_clock');
const AudioOut = require('../lib/audio_out');

const PACKET_MS = 352 * 1000 / 44100;

// Drive AudioOut on a fake clock. `costMs` is the time each packet takes to send.
function simulate(t, { costMs, seconds, stall }) {
  let now = 1000;
  let pending = null;
  t.mock.method(clock, 'now', () => now);
  t.mock.method(global, 'setTimeout', (fn, delay) => { pending = { fn, at: now + delay }; return {}; });
  t.mock.method(console, 'warn', () => {});

  const audio = new AudioOut();
  const devices = new events.EventEmitter();
  let discarded = 0;
  const buffer = { readPacket: () => { discarded++; return { release() {} }; } };
  const sent = [];
  let burst = 0, longestBurst = 0, worstLate = 0;
  audio.on('packet', packet => {
    discarded--;
    burst++;
    const nominalTime = (packet.timestamp - 2 * 44100) / 44.1; // packets play 2s after this
    worstLate = Math.max(worstLate, now - 1000 - nominalTime);
    sent.push(packet.seq);
    now += costMs;
  });

  audio.init(devices, buffer);
  devices.emit('airtunes_devices', true);
  const end = now + seconds * 1000;
  while (now < end) {
    longestBurst = Math.max(longestBurst, burst);
    burst = 0;
    now = Math.max(now, pending.at);
    if (stall && now >= stall.at) { now += stall.ms; stall = null; }
    const startedAt = now;
    pending.fn();
    simulate.longestTurnMs = Math.max(simulate.longestTurnMs, now - startedAt);
  }
  return { audio, sent, longestBurst, worstLate, discarded, now };
}
simulate.longestTurnMs = 0;

test('keeps up without skipping when sending is cheap', t => {
  const { sent, discarded } = simulate(t, { costMs: 1, seconds: 20 });
  assert.strictEqual(discarded, 0);
  sent.forEach((seq, i) => assert.strictEqual(seq, i));
  assert.ok(sent.length * PACKET_MS > 19000);
});

test('a short stall is caught up in full', t => {
  const { sent, discarded } = simulate(t, { costMs: 1, seconds: 20, stall: { at: 6000, ms: 1000 } });
  assert.strictEqual(discarded, 0);
  sent.forEach((seq, i) => assert.strictEqual(seq, i));
});

test('sustained overload skips audio, never falls more than 2s behind, and yields often', t => {
  simulate.longestTurnMs = 0;
  // Twice real time, like 7 HomePods with the old encryption
  const { sent, audio, worstLate, discarded, now } = simulate(t, { costMs: 2 * PACKET_MS, seconds: 120 });
  assert.ok(discarded > 0, 'nothing was skipped');
  assert.ok(worstLate < 2000, `sent audio ${worstLate}ms late`);
  assert.ok((now - 1000) / PACKET_MS - audio.lastSeq < 2000 / PACKET_MS, 'fell behind');
  assert.ok(simulate.longestTurnMs < 400, `blocked for ${simulate.longestTurnMs}ms`);
  assert.ok(sent.length > 0);
});

test('a huge stall costs one skip, not a huge burst', t => {
  const { longestBurst } = simulate(t, { costMs: 0.01, seconds: 12 * 3600 + 20, stall: { at: 6000, ms: 11 * 3600 * 1000 } });
  assert.ok(longestBurst < 200, `burst of ${longestBurst}`);
});
