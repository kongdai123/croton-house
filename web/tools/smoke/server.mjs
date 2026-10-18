// Tiny static server for the smoke suite: serves web/ (the built site: index.html, dist/, assets/, data/) on an ephemeral
// port, never cached. usage: const s = await startServer({ root }); ... s.url ...; await s.close();
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

export const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.bin': 'application/octet-stream', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.hdr': 'application/octet-stream', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8', '.map': 'application/json',
};

// url path -> absolute file path inside root, or null when it escapes root or is malformed
export function resolvePath(root, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); } catch { return null; }
  if (p.includes('\0')) return null;
  const abs = resolve(root, '.' + (p.startsWith('/') ? p : '/' + p));
  return abs === root || abs.startsWith(root + sep) ? abs : null;
}

export function startServer({ root, port = 0, host = '127.0.0.1' }) {
  root = resolve(root);
  const server = http.createServer(async (req, res) => {
    const send = (code, body, headers = {}) => { res.writeHead(code, { 'Cache-Control': 'no-store', ...headers }); res.end(body); };
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'method not allowed', { Allow: 'GET, HEAD' });
      let file = resolvePath(root, req.url ?? '/');
      if (!file) return send(403, 'forbidden');
      let st = await stat(file).catch(() => null);
      if (st?.isDirectory()) { file = resolve(file, 'index.html'); st = await stat(file).catch(() => null); }
      if (!st?.isFile()) return send(404, 'not found');
      res.writeHead(200, { 'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-store' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(file).on('error', () => res.destroy()).pipe(res);
    } catch (err) { send(500, String(err)); }
  });
  server.keepAliveTimeout = 5000;
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen({ port, host, backlog: 512 }, () => {   // the page opens ~70 lightmap requests at once
      const { port: p } = server.address();
      ok({ url: `http://${host}:${p}`, port: p, close: () => new Promise(done => { server.close(() => done()); server.closeAllConnections?.(); }) });
    });
  });
}
