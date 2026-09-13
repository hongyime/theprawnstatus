import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { probe } from './probe';

it('closes a real loopback response before downloading the complete body', async () => {
  const totalBytes = 256 * 1024;
  let bytesWritten = 0;
  let closed!: () => void;
  const responseClosed = new Promise<void>((resolve) => { closed = resolve; });
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'Content-Length': totalBytes });
    response.flushHeaders();
    const timer = setInterval(() => {
      response.write(Buffer.alloc(8192));
      bytesWritten += 8192;
      if (bytesWritten >= totalBytes) {
        clearInterval(timer);
        response.end();
      }
    }, 10);
    response.on('close', () => { clearInterval(timer); closed(); });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('Missing fixture listener');
    const record = await probe({
      id: 'fixture', name: 'Synthetic fixture', expect: 200,
      url: `http://127.0.0.1:${address.port}/`,
    }, { backoffMs: [] });
    const didClose = await Promise.race([
      responseClosed.then(() => true),
      new Promise<boolean>((resolve) => { deadline = setTimeout(() => resolve(false), 1500); }),
    ]);
    expect(record.s).toBe(200);
    expect(didClose).toBe(true);
    expect(bytesWritten).toBeLessThan(totalBytes / 4);
  } finally {
    clearTimeout(deadline);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => { server.close((error) => error ? reject(error) : resolve()); });
  }
});
