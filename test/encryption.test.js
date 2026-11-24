const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const enc = require('../lib/homekit/encryption').default;
const { Credentials } = require('../lib/homekit/credentials');

test('matches the RFC 8439 AEAD test vector', () => {
  const key = Buffer.from('808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f', 'hex');
  const nonce = Buffer.from('070000004041424344454647', 'hex');
  const aad = Buffer.from('50515253c0c1c2c3c4c5c6c7', 'hex');
  const plainText = Buffer.from("Ladies and Gentlemen of the class of '99: If I could offer you only one tip for the future, sunscreen would be it.");
  const [cipherText, tag] = enc.encryptAndSeal(plainText, aad, nonce, key);
  assert.strictEqual(tag.toString('hex'), '1ae10b594f09e26a7e902ecbd0600691');
  assert.ok(cipherText.toString('hex').startsWith('d31a8d34648e60db7b86afbc53ef7ec2'));
  assert.deepStrictEqual(enc.verifyAndDecrypt(cipherText, tag, aad, nonce, key), plainText);
});

test('8-byte nonces are left-padded, and no AAD is allowed', () => {
  const key = crypto.randomBytes(32), nonce = Buffer.from('PS-Msg05');
  const [cipherText, tag] = enc.encryptAndSeal(Buffer.from('hello'), null, nonce, key);
  const padded = Buffer.concat([Buffer.alloc(4), nonce]);
  assert.strictEqual(enc.verifyAndDecrypt(cipherText, tag, null, padded, key).toString(), 'hello');
});

test('tampered data is rejected', () => {
  const key = crypto.randomBytes(32), nonce = crypto.randomBytes(8);
  const [cipherText, tag] = enc.encryptAndSeal(Buffer.from('hello'), null, nonce, key);
  cipherText[0] ^= 1;
  assert.strictEqual(enc.verifyAndDecrypt(cipherText, tag, null, nonce, key), null);
});

test('control messages round-trip across several frames', () => {
  const sender = new Credentials(), receiver = new Credentials();
  sender.writeKey = receiver.readKey = crypto.randomBytes(32);
  const message = crypto.randomBytes(2500);
  assert.deepStrictEqual(receiver.decrypt(sender.encrypt(message)), message);
});

test('encrypted audio is cipher text, tag, then the nonce', () => {
  const credentials = new Credentials();
  credentials.writeKey = crypto.randomBytes(32);
  const aad = crypto.randomBytes(8), audio = crypto.randomBytes(1416);
  const packet = credentials.encryptAudio(audio, aad, 65535);
  assert.strictEqual(packet.length, 1416 + 16 + 8);
  const nonce = packet.subarray(-8);
  assert.strictEqual(nonce.readBigUInt64LE(), 65535n);
  assert.deepStrictEqual(enc.verifyAndDecrypt(packet.subarray(0, 1416), packet.subarray(1416, 1432), aad, nonce, credentials.writeKey), audio);
});
