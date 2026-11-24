const test = require('node:test');
const assert = require('node:assert');
const net = require('net');
const RTSP = require('../lib/rtsp');

// A receiver that answers the first request with `reply`.
async function connectTo(reply) {
  const server = net.createServer(socket => {
    socket.on('error', () => {});
    socket.once('data', () => reply(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new RTSP.Client(50, null, { lastSeq: 0 }, { airplay2: true, transient: true });
  const ended = new Promise(resolve => client.on('end', resolve));
  client.startHandshake({ control: { port: 1 }, timing: { port: 2 } }, '127.0.0.1', server.address().port);
  return { client, ended, close: () => { if (client.status !== 7) client.cleanup('stopped'); server.close(); } };
}

test('an unreadable pairing response ends this receiver without throwing', async () => {
  const session = await connectTo(socket => {
    socket.write('RTSP/1.0 200 OK\r\nCSeq: 1\r\n\r\n');
    socket.once('data', () => socket.write('not an rtsp response\r\n\r\n'));
  });
  assert.ok(['pair_failed', 'protocol_error'].includes(await session.ended));
  session.close();
});

test('an exception while handling a response ends this receiver without throwing', async () => {
  const session = await connectTo(socket => socket.write('RTSP/1.0 200 OK\r\n\r\n'));
  session.client.processData = () => { throw new TypeError("Cannot read properties of undefined (reading 'Content-Length')"); };
  assert.strictEqual(await session.ended, 'protocol_error');
  session.close();
});

test('a response body in a later TCP segment is waited for', async () => {
  const session = await connectTo(socket => {
    socket.write('RTSP/1.0 200 OK\r\nCSeq: 1\r\nContent-Length: 4\r\n\r\n');
    setTimeout(() => socket.write('body'), 30);
  });
  const message = await new Promise(resolve => { session.client.processData = (header, data) => resolve(data); });
  assert.ok(message.toString().endsWith('\r\n\r\nbody'));
  session.close();
});
