#!/usr/bin/env node

import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { parseArgs } from 'node:util';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer(base, { timeoutMs = 40_000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}healthz`);
      if (response.ok) return;
    } catch {
    }
    await delay(150);
  }
  throw new Error(`server did not answer on ${base} within ${timeoutMs} ms`);
}

async function launch({ binary, docker, script }) {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nmap2flowchart-smoke-'));
  const prefix = script ? [script] : [];
  const args = [...prefix, '--port', String(port), '--no-open', '--data-dir', docker ? '/tmp/smoke' : dataDir];
  if (docker) args.push('--host', '0.0.0.0');
  let child;
  let containerName;

  if (docker) {
    containerName = `nmap2flowchart-smoke-${process.pid}-${port}`;
    const scriptArgs = script ? [`/app/${path.basename(script)}`] : [];
    child = spawn(
      'docker',
      [
        'run',
        '--rm',
        '--name',
        containerName,
        '-p',
        `127.0.0.1:${port}:${port}`,
        '-v',
        `${path.dirname(path.resolve(binary))}:/app:ro`,
        'debian:bookworm-slim',
        `/app/${path.basename(binary)}`,
        ...scriptArgs,
        ...args.slice(prefix.length),
      ],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
  } else {
    child = spawn(path.resolve(binary), args, { stdio: ['ignore', 'pipe', 'pipe'] });
  }

  const output = [];
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  const stop = async () => {
    child.kill();
    if (containerName) {
      await new Promise((resolve) => {
        const removal = spawn('docker', ['rm', '-f', containerName], { stdio: 'ignore' });
        removal.on('exit', resolve);
        removal.on('error', resolve);
      });
    }
    fs.rmSync(dataDir, { recursive: true, force: true });
  };

  const base = `http://127.0.0.1:${port}/`;
  try {
    await waitForServer(base);
  } catch (error) {
    await stop();
    throw new Error(`${error.message}\n--- output ---\n${output.join('')}`);
  }

  return { base, output, stop };
}

function gzipProbe(url) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const outgoing = http.request(
      { host: target.hostname, port: target.port, path: target.pathname, headers: { 'Accept-Encoding': 'gzip' } },
      (response) => {
        response.resume();
        resolve({ status: response.statusCode, encoding: response.headers['content-encoding'] });
      },
    );
    outgoing.on('error', reject);
    outgoing.end();
  });
}

const checks = [];
function check(name, condition, detail = '') {
  checks.push({ name, ok: Boolean(condition), detail });
  console.log(`${condition ? '  ok  ' : ' FAIL '} ${name}${condition || !detail ? '' : ` – ${detail}`}`);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: { docker: { type: 'boolean' }, script: { type: 'string' } },
  });
  const binary = positionals[0];
  if (!binary) {
    throw new Error('usage: node scripts/smoke-standalone.mjs <binary> [--script <bundle.cjs>] [--docker]');
  }

  const server = await launch({
    binary,
    docker: values.docker === true,
    script: values.script ?? null,
  });
  try {
    const shell = await fetch(server.base);
    const html = await shell.text();
    check('GET / serves the SPA shell', shell.status === 200 && html.includes('id="root"'), `status ${shell.status}`);
    check('shell is html', (shell.headers.get('content-type') ?? '').includes('text/html'));
    check('shell sets nosniff', shell.headers.get('x-content-type-options') === 'nosniff');
    check('shell sets a CSP', (shell.headers.get('content-security-policy') ?? '').includes("default-src 'self'"));
    check('shell is not cached', (shell.headers.get('cache-control') ?? '').includes('no-cache'));

    const asset = html.match(/\/assets\/[^"']+\.js/)?.[0];
    check('shell references a hashed bundle', Boolean(asset), asset ?? 'no /assets/*.js in index.html');

    if (asset) {
      const bundle = await fetch(new URL(asset, server.base));
      const body = await bundle.text();
      check('bundle is served', bundle.status === 200 && body.length > 1000, `status ${bundle.status}`);
      check('bundle sets an immutable cache', (bundle.headers.get('cache-control') ?? '').includes('immutable'));
      const etag = bundle.headers.get('etag');
      check('bundle has an ETag', Boolean(etag));
      if (etag) {
        const revalidated = await fetch(new URL(asset, server.base), { headers: { 'If-None-Match': etag } });
        check('ETag revalidation returns 304', revalidated.status === 304, `status ${revalidated.status}`);
      }
      const compressed = await gzipProbe(new URL(asset, server.base).href);
      check('bundle is gzipped when accepted', compressed.encoding === 'gzip', `encoding ${compressed.encoding}`);
    }

    const health = await fetch(`${server.base}healthz`);
    check('/healthz answers', health.status === 200 && (await health.text()).trim() === 'ok');

    const config = await fetch(`${server.base}api/config`);
    const configBody = await config.json().catch(() => null);
    check('/api/config answers', config.status === 200 && configBody !== null, `status ${config.status}`);
    check('accounts stay off by default', configBody?.authEnabled === false);

    const sharedState = await fetch(`${server.base}api/shared`);
    const sharedBody = await sharedState.json().catch(() => null);
    check('/api/shared answers', sharedState.status === 200 && sharedBody !== null, `status ${sharedState.status}`);
    if (sharedBody?.enabled) {
      check(
        'shared mode exposes one diagram',
        typeof sharedBody.revision === 'number' && sharedBody.doc !== undefined,
        JSON.stringify(sharedBody).slice(0, 120),
      );
      check('config advertises shared mode', configBody?.sharedEnabled === true);
    }

    const deepLink = await fetch(`${server.base}scan/some/deep/link`);
    const deepBody = await deepLink.text();
    check('SPA fallback serves the shell', deepLink.status === 200 && deepBody.includes('id="root"'));

    const missing = await fetch(`${server.base}assets/does-not-exist-abc123.js`);
    check('missing bundle is a 404', missing.status === 404, `status ${missing.status}`);

    const head = await fetch(server.base, { method: 'HEAD' });
    check('HEAD works', head.status === 200 && Number(head.headers.get('content-length')) > 0);

    const wrongMethod = await fetch(server.base, { method: 'POST' });
    check('POST is rejected', wrongMethod.status === 405, `status ${wrongMethod.status}`);
  } finally {
    await server.stop();
  }

  const failed = checks.filter((entry) => !entry.ok);
  if (failed.length > 0) {
    throw new Error(`${failed.length} of ${checks.length} checks failed`);
  }
  console.log(`\nAll ${checks.length} checks passed for ${path.basename(binary)}${values.script ? ` + ${path.basename(values.script)}` : ''}`);
}

main().catch((error) => {
  console.error(`\nSmoke test failed: ${error.message}`);
  process.exit(1);
});
