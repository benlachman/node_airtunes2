const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { EncryptedFrameReader, ResponseReader } = require('../lib/rtsp_framing');
const { Credentials } = require('../lib/homekit/credentials');

const body = Buffer.concat([crypto.randomBytes(200), Buffer.from('\r\n\r\n'), crypto.randomBytes(200)]);
const response = Buffer.concat([Buffer.from(`RTSP/1.0 200 OK\r\nCSeq: 2\r\nContent-Length: ${body.length}\r\n\r\n`), body]);

test('a response split at any byte is delivered once, whole', () => {
  for (let split = 1; split < response.length; split++) {
    const reader = new ResponseReader();
    reader.push(response.subarray(0, split));
    assert.strictEqual(reader.next(), null, `delivered early at ${split}`);
    reader.push(response.subarray(split));
    const { header, message } = reader.next();
    assert.match(header, /^RTSP\/1\.0 200 OK/);
    assert.deepStrictEqual(message, response);
    assert.strictEqual(reader.next(), null);
  }
});

test('responses that arrive together are delivered separately', () => {
  const empty = Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 3\r\n\r\n');
  const reader = new ResponseReader();
  reader.push(Buffer.concat([response, empty, response]));
  assert.deepStrictEqual([reader.next(), reader.next(), reader.next()].map(r => r.message.length), [response.length, empty.length, response.length]);
  assert.strictEqual(reader.next(), null);
});

test('an unreasonable length is refused', () => {
  const reader = new ResponseReader();
  reader.push(Buffer.from('RTSP/1.0 200 OK\r\nContent-Length: 999999999\r\n\r\n'));
  assert.throws(() => reader.next(), /too large/);
});

test('encrypted frames split at any byte decrypt to the original', () => {
  const sender = new Credentials();
  sender.writeKey = crypto.randomBytes(32);
  const message = crypto.randomBytes(1500);
  const encrypted = sender.encrypt(message);
  for (let split = 1; split < encrypted.length; split++) {
    const receiver = new Credentials(), frames = new EncryptedFrameReader();
    receiver.readKey = sender.writeKey;
    const first = receiver.decrypt(frames.push(encrypted.subarray(0, split)));
    const second = receiver.decrypt(frames.push(encrypted.subarray(split)));
    assert.deepStrictEqual(Buffer.concat([first, second]), message);
  }
});

test('line breaks inside a binary body do not corrupt the next response', () => {
  // Pairing replies carry random keys; the old reader prepended them to the next reply
  const reader = new ResponseReader();
  reader.push(Buffer.from('RTSP/1.0 200 OK\r\nContent-Length: 6\r\n\r\nab\r\ncd'));
  reader.push(Buffer.from('RTSP/1.0 200 OK\r\nCSeq: 3\r\n\r\n'));
  reader.next();
  assert.strictEqual(reader.next().header, 'RTSP/1.0 200 OK\r\nCSeq: 3\r\n\r\n');
});
