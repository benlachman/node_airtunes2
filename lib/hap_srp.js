/*
  SRP-6a client for HomeKit / AirPlay 2 pair-setup (RFC 5054 3072-bit group,
  g = 5, SHA-512), built on native BigInt.

  Drop-in for fast-srp-hap's SrpClient with `hap = true`: same constructor
  arguments, same computeA / setB / computeM1 / checkM2 / computeK, same
  hashing and padding except that the shared secret is hashed without leading
  zero bytes, as receivers do (1 pairing in 256 failed before). fast-srp-hap
  does its modular exponentiation in pure-JS jsbn, which costs ~2.5 s per
  pairing on a Raspberry Pi Zero 2 W; native BigInt is roughly ten times faster.
*/
const crypto = require('crypto');

const N_LENGTH_BITS = 3072;
const N_LENGTH_BYTES = N_LENGTH_BITS / 8;
const HASH = 'sha512';

const N = BigInt('0x' + `
  FFFFFFFF FFFFFFFF C90FDAA2 2168C234 C4C6628B 80DC1CD1 29024E08
  8A67CC74 020BBEA6 3B139B22 514A0879 8E3404DD EF9519B3 CD3A431B
  302B0A6D F25F1437 4FE1356D 6D51C245 E485B576 625E7EC6 F44C42E9
  A637ED6B 0BFF5CB6 F406B7ED EE386BFB 5A899FA5 AE9F2411 7C4B1FE6
  49286651 ECE45B3D C2007CB8 A163BF05 98DA4836 1C55D39A 69163FA8
  FD24CF5F 83655D23 DCA3AD96 1C62F356 208552BB 9ED52907 7096966D
  670C354E 4ABC9804 F1746C08 CA18217C 32905E46 2E36CE3B E39E772C
  180E8603 9B2783A2 EC07A28F B5C55DF0 6F4C52C9 DE2BCBF6 95581718
  3995497C EA956AE5 15D22618 98FA0510 15728E5A 8AAAC42D AD33170D
  04507A33 A85521AB DF1CBA64 ECFB8504 58DBEF0A 8AEA7157 5D060C7D
  B3970F85 A6E1E4C7 ABF5AE8C DB0933D7 1E8C94E0 4A25619D CEE3D226
  1AD2EE6B F12FFA06 D98A0864 D8760273 3EC86A64 521F2B18 177B200C
  BBE11757 7A615D6C 770988C0 BAD946E2 08E24FA0 74E5AB31 43DB5BFC
  E0FD108E 4B82D120 A93AD2CA FFFFFFFF FFFFFFFF
`.replace(/\s+/g, ''));
const g = 5n;

function bufferToBigInt(buffer) {
  return buffer.length ? BigInt('0x' + buffer.toString('hex')) : 0n;
}

// Minimal big-endian encoding (no leading zero bytes), like jsbn toBuffer(true).
function bigIntToBuffer(value) {
  let hex = value.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  return Buffer.from(hex, 'hex');
}

function padTo(buffer, length) {
  if (buffer.length > length) throw new Error('Negative padding');
  return Buffer.concat([Buffer.alloc(length - buffer.length), buffer]);
}

function bigIntToPaddedBuffer(value) {
  return padTo(bigIntToBuffer(value), N_LENGTH_BYTES);
}

function hash(...parts) {
  const digest = crypto.createHash(HASH);
  for (const part of parts) digest.update(part);
  return digest.digest();
}

function modPow(base, exponent, modulus) {
  let result = 1n;
  base %= modulus;
  while (exponent > 0n) {
    if (exponent & 1n) result = (result * base) % modulus;
    exponent >>= 1n;
    base = (base * base) % modulus;
  }
  return result;
}

function mod(value, modulus) {
  const r = value % modulus;
  return r < 0n ? r + modulus : r;
}

class SrpClient {
  constructor(params, salt, identity, password, secret) {
    this._identity = identity;
    this._salt = salt;
    this._k = bufferToBigInt(hash(bigIntToPaddedBuffer(N), bigIntToPaddedBuffer(g)));
    this._x = bufferToBigInt(hash(salt, hash(Buffer.concat([identity, Buffer.from(':'), password]))));
    this._a = bufferToBigInt(secret);
    this._A = bigIntToPaddedBuffer(modPow(g, this._a, N));
  }

  computeA() {
    return this._A;
  }

  setB(B) {
    const bNum = bufferToBigInt(B);
    if (bNum <= 0n || bNum >= N) throw new Error('invalid server-supplied "B", must be 1..N-1');
    const u = bufferToBigInt(hash(padTo(this._A, N_LENGTH_BYTES), padTo(B, N_LENGTH_BYTES)));
    const base = mod(bNum - this._k * modPow(g, this._x, N), N);
    const S = modPow(base, this._a + u * this._x, N);
    this._K = hash(bigIntToBuffer(S)); // receivers drop leading zero bytes here, but not in A or B
    this._B = B;

    const hN = hash(bigIntToBuffer(N));
    const hG = hash(bigIntToBuffer(g));
    for (let i = 0; i < hN.length; i++) hN[i] ^= hG[i];
    this._M1 = hash(hN, hash(this._identity), this._salt, this._A, B, this._K);
    this._M2 = hash(this._A, this._M1, this._K);
  }

  computeM1() {
    if (!this._M1) throw new Error('incomplete protocol');
    return this._M1;
  }

  checkM2(M2) {
    const proof = Buffer.from(M2 || []);
    if (!this._M2 || proof.length !== this._M2.length || !crypto.timingSafeEqual(this._M2, proof)) {
      throw new Error('server is not authentic');
    }
  }

  computeK() {
    if (!this._K) throw new Error('incomplete protocol');
    return this._K;
  }
}

module.exports = { SrpClient };
