"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const crypto = require("crypto");
const ALGORITHM = 'chacha20-poly1305';
const AUTH_TAG_OPTIONS = { authTagLength: 16 };
// 64-bit nonces are left-padded with zeros to the 96 bits the cipher takes
function fullNonce(nonce) {
    return nonce.byteLength == 8 ? Buffer.concat([Buffer.alloc(4), nonce]) : nonce;
}
function verifyAndDecrypt(cipherText, mac, AAD, nonce, key) {
    try {
        const decipher = crypto.createDecipheriv(ALGORITHM, key, fullNonce(nonce), AUTH_TAG_OPTIONS);
        if (AAD != null) decipher.setAAD(AAD, { plaintextLength: cipherText.length }); // must be called before data
        decipher.setAuthTag(mac);
        return Buffer.concat([decipher.update(cipherText), decipher.final()]);
    }
    catch (e) {
        return null;
    }
}

function encryptAndSeal(plainText, AAD, nonce, key) {
    const cipher = crypto.createCipheriv(ALGORITHM, key, fullNonce(nonce), AUTH_TAG_OPTIONS);
    if (AAD != null) cipher.setAAD(AAD, { plaintextLength: plainText.length }); // must be called before data
    const cipherText = cipher.update(plainText);
    cipher.final();
    return [cipherText, cipher.getAuthTag()];
}
// function getPadding(buffer, blockSize) {
//     return buffer.length % blockSize === 0
//         ? Buffer.alloc(0)
//         : Buffer.alloc(blockSize - (buffer.length % blockSize));
// }
function HKDF(hashAlg, salt, ikm, info, size) {
    // create the hash alg to see if it exists and get its length
    var hash = crypto.createHash(hashAlg);
    var hashLength = hash.digest().length;
    // now we compute the PRK
    var hmac = crypto.createHmac(hashAlg, salt);
    hmac.update(ikm);
    var prk = hmac.digest();
    var prev = Buffer.alloc(0);
    var output;
    var buffers = [];
    var num_blocks = Math.ceil(size / hashLength);
    info = Buffer.from(info);
    for (var i = 0; i < num_blocks; i++) {
        var hmac = crypto.createHmac(hashAlg, prk);
        var input = Buffer.concat([
            prev,
            info,
            Buffer.from(String.fromCharCode(i + 1))
        ]);
        hmac.update(input);
        prev = hmac.digest();
        buffers.push(prev);
    }
    output = Buffer.concat(buffers, size);
    return output.slice(0, size);
}
exports.default = {
    encryptAndSeal,
    verifyAndDecrypt,
    HKDF
};
