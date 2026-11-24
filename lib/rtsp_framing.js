/*
  TCP delivers arbitrary chunks: a response can arrive in pieces, or several
  can arrive at once. These split a byte stream back into whole units.
*/
const HEADER_END = Buffer.from('\r\n\r\n');
const MAXIMUM_BUFFERED_BYTES = 4 * 1024 * 1024;
const FRAME_OVERHEAD_BYTES = 2 + 16; // little-endian length prefix + auth tag

function append(buffered, chunk) {
  const combined = buffered.length ? Buffer.concat([buffered, chunk]) : chunk;
  if (combined.length > MAXIMUM_BUFFERED_BYTES) throw new Error('response too large');
  return combined;
}

// Whole encrypted frames from an encrypted control channel.
class EncryptedFrameReader {
  constructor() {
    this.buffered = Buffer.alloc(0);
  }

  // Returns the complete frames received so far as one buffer (may be empty).
  push(chunk) {
    this.buffered = append(this.buffered, chunk);
    let end = 0;
    while (end + 2 <= this.buffered.length) {
      const frameLength = this.buffered.readUInt16LE(end) + FRAME_OVERHEAD_BYTES;
      if (end + frameLength > this.buffered.length) break;
      end += frameLength;
    }
    const frames = this.buffered.subarray(0, end);
    this.buffered = this.buffered.subarray(end);
    return frames;
  }
}

// Whole RTSP responses (header plus Content-Length body).
class ResponseReader {
  constructor() {
    this.buffered = Buffer.alloc(0);
  }

  push(chunk) {
    this.buffered = append(this.buffered, chunk);
  }

  // Returns { header, message } for the next complete response, or null.
  next() {
    const headerEnd = this.buffered.indexOf(HEADER_END);
    if (headerEnd < 0) return null;
    const bodyStart = headerEnd + HEADER_END.length;
    const header = this.buffered.toString('utf8', 0, bodyStart);
    const contentLength = /^content-length:\s*(\d+)/im.exec(header);
    const messageEnd = bodyStart + (contentLength ? parseInt(contentLength[1], 10) : 0);
    if (messageEnd > MAXIMUM_BUFFERED_BYTES) throw new Error('response too large');
    if (this.buffered.length < messageEnd) return null;
    const message = this.buffered.subarray(0, messageEnd);
    this.buffered = this.buffered.subarray(messageEnd);
    return { header, message };
  }
}

module.exports = { EncryptedFrameReader, ResponseReader };
