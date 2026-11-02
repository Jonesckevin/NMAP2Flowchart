import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';

import { contentTypeFor, createAssetStore, createStaticHandler, decodeEmbeddedAssets } from './static.mjs';

const BIG_JS = `/* ${'bundle '.repeat(300)}*/\nconsole.log('nmap2flowchart');\n`;

const FILES = {
  '/index.html': '<!doctype html><html><body><div id="root"></div></body></html>',
  '/assets/app-abc123.js': BIG_JS,
  '/assets/tiny.css': 'body{margin:0}',
  '/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
  '/site.webmanifest': '{"name":"NMAP2Flowchart"}',
};

async function start(files = FILES) {
  const server = http.createServer(createStaticHandler({ assets: createAssetStore(files) }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}

function rawRequest(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const request = http.request({ host: target.hostname, port: target.port, path: target.pathname, method, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }),
      );
    });
    request.on('error', reject);
    request.end();
  });
}

test('serves the shell with nginx-parity security headers', async (t) => {
  const server = await start();
  t.after(server.close);

  for (const route of ['/', '/index.html']) {
    const response = await fetch(`${server.base}${route}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^text\/html/);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-frame-options'), 'SAMEORIGIN');
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.match(response.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(response.headers.get('cache-control'), 'no-cache');
    assert.match(await response.text(), /id="root"/);
  }
});

test('hashed assets are immutable and typed correctly', async (t) => {
  const server = await start();
  t.after(server.close);

  const response = await fetch(`${server.base}/assets/app-abc123.js`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/javascript/);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal(await response.text(), BIG_JS);

  const manifest = await fetch(`${server.base}/site.webmanifest`);
  assert.match(manifest.headers.get('content-type'), /^application\/manifest\+json/);

  const icon = await fetch(`${server.base}/favicon.svg`);
  assert.match(icon.headers.get('content-type'), /^image\/svg\+xml/);
});

test('compresses text responses only when the client accepts gzip', async (t) => {
  const server = await start();
  t.after(server.close);

  const compressed = await rawRequest(`${server.base}/assets/app-abc123.js`, {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  assert.equal(compressed.status, 200);
  assert.equal(compressed.headers['content-encoding'], 'gzip');
  assert.equal(compressed.headers.vary, 'Accept-Encoding');
  assert.equal(gunzipSync(compressed.body).toString('utf8'), BIG_JS);

  const plain = await rawRequest(`${server.base}/assets/app-abc123.js`);
  assert.equal(plain.headers['content-encoding'], undefined);
  assert.equal(plain.body.toString('utf8'), BIG_JS);

  const small = await rawRequest(`${server.base}/assets/tiny.css`, { headers: { 'Accept-Encoding': 'gzip' } });
  assert.equal(small.headers['content-encoding'], undefined);
  assert.equal(small.body.toString('utf8'), 'body{margin:0}');
});

test('revalidates with ETags', async (t) => {
  const server = await start();
  t.after(server.close);

  const first = await fetch(`${server.base}/assets/app-abc123.js`);
  const etag = first.headers.get('etag');
  assert.ok(etag);

  const notModified = await fetch(`${server.base}/assets/app-abc123.js`, { headers: { 'If-None-Match': etag } });
  assert.equal(notModified.status, 304);
  assert.equal(notModified.headers.get('etag'), etag);
  assert.equal(await notModified.text(), '');

  const withWeakTag = await fetch(`${server.base}/assets/app-abc123.js`, { headers: { 'If-None-Match': `W/${etag}` } });
  assert.equal(withWeakTag.status, 304);
});

test('falls back to the shell for SPA routes and 404s missing bundles', async (t) => {
  const server = await start();
  t.after(server.close);

  const deep = await fetch(`${server.base}/scan/some/deep/link`);
  assert.equal(deep.status, 200);
  assert.match(await deep.text(), /id="root"/);

  const unknownFile = await fetch(`${server.base}/robots.txt`);
  assert.equal(unknownFile.status, 200);
  assert.match(await unknownFile.text(), /id="root"/);

  const missingAsset = await fetch(`${server.base}/assets/app-missing.js`);
  assert.equal(missingAsset.status, 404);
});

test('answers the health probe without caching', async (t) => {
  const server = await start();
  t.after(server.close);

  const response = await fetch(`${server.base}/healthz`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/plain; charset=utf-8');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(await response.text(), 'ok\n');
});

test('supports HEAD and rejects other methods', async (t) => {
  const server = await start();
  t.after(server.close);

  const head = await rawRequest(`${server.base}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.ok(Number(head.headers['content-length']) > 0);
  assert.equal(head.body.length, 0);

  const post = await rawRequest(`${server.base}/`, { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.allow, 'GET, HEAD');
});

test('asset stores normalise paths and refuse to start without a shell', () => {
  const assets = createAssetStore({ 'index.html': 'shell', 'assets/app.js': 'code' });
  assert.equal(assets.get('/index.html').body.toString('utf8'), 'shell');
  assert.equal(assets.get('/assets/app.js').immutable, true);
  assert.equal(assets.get('/assets/app.js').compressible, true);

  assert.throws(() => createStaticHandler({ assets: new Map() }), /index\.html/);

  assert.equal(contentTypeFor('/x/app.js'), 'text/javascript; charset=utf-8');
  assert.equal(contentTypeFor('/x/data.bin'), 'application/octet-stream');
});

test('decodes the base64 map produced by the build', () => {
  const decoded = decodeEmbeddedAssets({ '/index.html': Buffer.from('shell').toString('base64') });
  const assets = createAssetStore(decoded);
  assert.equal(assets.get('/index.html').body.toString('utf8'), 'shell');
});
