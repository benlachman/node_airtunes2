// Milliseconds that only move forward, at real-time speed. Audio pacing and
// the clock receivers synchronize to must not follow wall-clock corrections
// (a Raspberry Pi without a clock battery can jump by hours after boot).
exports.now = function() {
  return performance.now();
};
