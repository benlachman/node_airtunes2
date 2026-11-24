var events = require('events'),
    util = require('util'),
    config = require('./config.js'),
    clock = require('./monotonic_clock.js'),
    nu = require('./num_util.js');

var SEQ_NUM_WRAP = Math.pow(2, 16);

var PACKETS_PER_SECOND = config.sampling_rate / config.frames_per_packet;
// Receivers play a packet 2s after its nominal time, so anything later than
// this may miss its slot. Skip ahead in one step rather than stay on the edge.
var MAXIMUM_LATE_PACKETS = Math.floor(1.5 * PACKETS_PER_SECOND);
var LATE_PACKETS_AFTER_SKIP = Math.floor(0.5 * PACKETS_PER_SECOND);
// Longest uninterrupted send. Queued UDP packets only leave, and other work
// only runs, once this returns to the event loop.
var MAXIMUM_BURST_MS = 250;
 
function AudioOut() {
  events.EventEmitter.call(this);

  this.lastSeq = -1;
  this.hasAirTunes = false;
}

util.inherits(AudioOut, events.EventEmitter);

AudioOut.prototype.init = function(devices, circularBuffer) {
  var self = this;
  config.rtp_time_ref = clock.now();

  devices.on('airtunes_devices', function(hasAirTunes) {
    self.hasAirTunes = hasAirTunes;
  });

  devices.on('need_sync', function() {
    // a sync is forced when a new remote device is added
    self.emit('need_sync', self.lastSeq);
  });

  function sendPacket(seq) {
    var packet = circularBuffer.readPacket();

    packet.seq = seq % SEQ_NUM_WRAP;
    packet.timestamp = nu.low32(seq*config.frames_per_packet + 2*config.sampling_rate);

    if(self.hasAirTunes && seq % config.sync_period == 0)
      self.emit('need_sync', seq);

    self.emit('packet', packet);
    packet.release();
  }

  // Drop audio that is too late to play, instead of sending all of it: a sender
  // that cannot keep up would otherwise fall further behind with every burst.
  function skipLatePackets(currentSeq) {
    var late = currentSeq - self.lastSeq;
    if(late <= MAXIMUM_LATE_PACKETS)
      return;

    var skipped = late - LATE_PACKETS_AFTER_SKIP;
    for(var i = 0; i < Math.min(skipped, config.packets_in_buffer); i++)
      circularBuffer.readPacket().release();

    self.lastSeq += skipped;
    console.warn('audio is ' + Math.round(1000 * late / PACKETS_PER_SECOND) + 'ms late, skipping ' +
      Math.round(1000 * skipped / PACKETS_PER_SECOND) + 'ms');
    if(self.hasAirTunes)
      self.emit('need_sync', self.lastSeq);
  }

  function syncAudio() {
    /*
     * Each time syncAudio() runs, a burst of packet is sent.
     * Increasing config.stream_latency lowers CPU usage but increases the size of the burst.
     * If the burst size exceeds the UDP windows size (which we do not know), packets are lost.
     */
    var startedAt = clock.now();
    var elapsed = startedAt - config.rtp_time_ref;

    /*
     * currentSeq is the # of the packet we should be sending now. We have some packets to catch-up
     * since syncAudio is not always running.
     */
    var currentSeq = Math.floor(elapsed*config.sampling_rate/(config.frames_per_packet*1000));

    skipLatePackets(currentSeq);

    while(self.lastSeq < currentSeq) {
      sendPacket(self.lastSeq + 1);
      self.lastSeq++;
      if(clock.now() - startedAt >= MAXIMUM_BURST_MS)
        break;
    }

    // reschedule ourselves: right away if there is still audio to catch up on
    setTimeout(syncAudio, self.lastSeq < currentSeq ? 0 : config.stream_latency);
  }

  syncAudio();
}

module.exports = AudioOut;