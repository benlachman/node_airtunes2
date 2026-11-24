const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { SrpClient } = require('../lib/hap_srp');

const N = toBigInt(crypto.getDiffieHellman('modp15').getPrime());
const g = 5n;
const identity = Buffer.from('Pair-Setup');
const password = Buffer.from('3939');
const salt = Buffer.alloc(16, 7);

function toBigInt(buffer) {
  return BigInt('0x' + buffer.toString('hex'));
}

function padded(value) {
  return Buffer.from(value.toString(16).padStart(768, '0'), 'hex');
}

function hash(...parts) {
  return crypto.createHash('sha512').update(Buffer.concat(parts)).digest();
}

function modPow(base, exponent) {
  let result = 1n;
  for (base %= N; exponent > 0n; exponent >>= 1n, base = base * base % N) {
    if (exponent & 1n) result = result * base % N;
  }
  return result;
}

// The receiver's side, as HomePods and the Ecobee compute it: A and B are
// hashed at full length, the shared secret without its leading zero bytes.
function createReceiver() {
  const b = toBigInt(Buffer.alloc(32, 9));
  const x = toBigInt(hash(salt, hash(identity, Buffer.from(':'), password)));
  const v = modPow(g, x);
  const k = toBigInt(hash(padded(N), padded(g)));
  const B = padded((k * v + modPow(g, b)) % N);

  return {
    B,
    verify(A, clientProof) {
      const u = toBigInt(hash(A, B));
      const secret = padded(modPow(toBigInt(A) * modPow(v, u), b));
      const K = hash(secret.subarray(secret.findIndex(byte => byte !== 0)));
      const groupHash = hash(padded(N)).map((byte, i) => byte ^ hash(Buffer.from([5]))[i]);
      const expectedProof = hash(groupHash, hash(identity), salt, A, B, K);
      return { secret, K, accepted: expectedProof.equals(clientProof), proof: hash(A, clientProof, K) };
    }
  };
}

function pair(clientSecretNumber) {
  const clientSecret = Buffer.alloc(32, 1);
  clientSecret.writeUInt32BE(clientSecretNumber, 28);
  const receiver = createReceiver();
  const client = new SrpClient(null, salt, identity, password, clientSecret);
  client.setB(receiver.B);
  return { client, A: client.computeA(), ...receiver.verify(client.computeA(), client.computeM1()) };
}

function assertPaired({ client, K, accepted, proof }) {
  assert.ok(accepted);
  client.checkM2(proof);
  assert.deepStrictEqual(client.computeK(), K);
}

test('pairs when nothing starts with a zero byte', () => {
  const result = pair(1);
  assert.notStrictEqual(result.secret[0], 0);
  assert.notStrictEqual(result.A[0], 0);
  assertPaired(result);
});

test('pairs when the shared secret starts with a zero byte', () => {
  const result = pair(16);
  assert.strictEqual(result.secret[0], 0);
  assertPaired(result);
});

test('pairs when the public key starts with a zero byte', () => {
  const result = pair(504);
  assert.strictEqual(result.A[0], 0);
  assertPaired(result);
});

test('rejects a wrong proof', () => {
  const { client } = pair(1);
  assert.throws(() => client.checkM2(Buffer.alloc(64)), /not authentic/);
  assert.throws(() => client.checkM2(undefined), /not authentic/);
});
