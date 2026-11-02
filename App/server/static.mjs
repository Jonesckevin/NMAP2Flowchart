import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'",
};

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

const COMPRESSIBLE = /^(?:text\/|application\/(?:javascript|json|manifest\+json)|image\/svg\+xml)/;
const GZIP_MIN_BYTES = 1024;

export function contentTypeFor(filePath) {
  const dot = filePath.lastIndexOf('.');
  const extension = dot >= 0 ? filePath.slice(dot).toLowerCase() : '';
  return MIME_TYPES[extension] ?? 'application/octet-stream';
}

function normalizeKey(filePath) {
  const withSlash = filePath.startsWith('/') ? filePath : `/${filePath}`;
  return withSlash.replace(/\/{2,}/g, '/');
}

export function createAssetStore(files) {
  const assets = new Map();
  for (const [filePath, contents] of Object.entries(files)) {
    const key = normalizeKey(filePath);
    const body = Buffer.isBuffer(contents) ? contents : Buffer.from(contents, 'utf8');
    const contentType = contentTypeFor(key);
    assets.set(key, {
      body,
      contentType,
      etag: `"${createHash('sha1').update(body).digest('base64url')}"`,
      compressible: COMPRESSIBLE.test(contentType),
      immutable: key.startsWith('/assets/'),
      gzip: null,
    });
  }
  return assets;
}

export function decodeEmbeddedAssets(embedded) {
  const files = {};
  for (const [filePath, base64] of Object.entries(embedded)) {
    files[filePath] = Buffer.from(base64, 'base64');
  }
  return files;
}

function requestPath(rawUrl) {
  try {
    const { pathname } = new URL(rawUrl || '/', 'http://localhost');
    const collapsed = pathname.replace(/\/{2,}/g, '/');
    return collapsed.length > 1 ? collapsed.replace(/\/+$/, '') : '/';
  } catch {
    return '/';
  }
}

function acceptsGzip(request) {
  return /\bgzip\b/.test(String(request.headers['accept-encoding'] ?? ''));
}

function sameEtag(header, etag) {
  if (typeof header !== 'string') return false;
  return header.split(',').some((candidate) => {
    const value = candidate.trim();
    return value === etag || value === `W/${etag}` || value === '*';
  });
}

export function createStaticHandler({ assets, healthPath = '/healthz' }) {
  const index = assets.get('/index.html');
  if (!index) throw new Error('The embedded app is missing /index.html');

  function send(request, response, status, headers, body) {
    response.writeHead(status, headers);
    if (request.method === 'HEAD' || status === 304 || !body) {
      response.end();
      return;
    }
    response.end(body);
  }

  return function handleStatic(request, response) {
    const method = request.method ?? 'GET';
    if (method !== 'GET' && method !== 'HEAD') {
      send(request, response, 405, { ...SECURITY_HEADERS, Allow: 'GET, HEAD', 'Cache-Control': 'no-store' });
      return;
    }

    const pathname = requestPath(request.url);

    if (pathname === healthPath) {
      const body = Buffer.from('ok\n', 'utf8');
      send(request, response, 200, {
        ...SECURITY_HEADERS,
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': body.length,
        'Cache-Control': 'no-store',
      }, body);
      return;
    }

    let entry = assets.get(pathname === '/' ? '/index.html' : pathname);
    if (!entry) {
      if (pathname.startsWith('/assets/')) {
        send(request, response, 404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }, Buffer.from('Not found\n'));
        return;
      }
      entry = index;
    }

    const cacheControl = entry.immutable ? 'public, max-age=31536000, immutable' : 'no-cache';
    const headers = {
      ...SECURITY_HEADERS,
      'Content-Type': entry.contentType,
      'Cache-Control': cacheControl,
      ETag: entry.etag,
      Vary: 'Accept-Encoding',
    };

    if (sameEtag(request.headers['if-none-match'], entry.etag)) {
      send(request, response, 304, headers);
      return;
    }

    const useGzip = entry.compressible && entry.body.length >= GZIP_MIN_BYTES && acceptsGzip(request);
    const body = useGzip ? (entry.gzip ??= gzipSync(entry.body)) : entry.body;
    if (useGzip) headers['Content-Encoding'] = 'gzip';
    headers['Content-Length'] = body.length;
    if (!entry.compressible) delete headers.Vary;

    send(request, response, 200, headers, body);
  };
}
