import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const types = {
  '.css': 'text/css; charset=utf-8',
  '.geojson': 'application/geo+json',
  '.gif': 'image/gif',
  '.gpx': 'application/gpx+xml',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.kml': 'application/vnd.google-earth.kml+xml',
  '.map': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.tcx': 'application/vnd.garmin.tcx+xml',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
  '.xml': 'text/xml; charset=utf-8',
};

const escapeHtml = value => value.replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);

export function startServer(port = 8080) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }

    try {
      const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
      if (pathname.includes('\0')) {
        response.writeHead(400).end('Bad request');
        return;
      }
      const file = resolve(root, `.${pathname}`);
      if (file !== root && !file.startsWith(root + sep)) {
        response.writeHead(403).end();
        return;
      }

      const info = await stat(file);
      const target = info.isDirectory() ? resolve(file, 'index.html') : file;
      let content;
      try {
        content = await stat(target);
      } catch (error) {
        if (!info.isDirectory() || error.code !== 'ENOENT') throw error;
        const entries = await readdir(file, { withFileTypes: true });
        const base = new URL(request.url, 'http://localhost').pathname.replace(/\/?$/, '/');
        const links = entries.map(entry => {
          const suffix = entry.isDirectory() ? '/' : '';
          const href = `${base}${encodeURIComponent(entry.name)}${suffix}`;
          return `<li><a href="${escapeHtml(href)}">${escapeHtml(entry.name)}${suffix}</a></li>`;
        }).join('');
        response.writeHead(200, { 'Content-Type': types['.html'] });
        response.end(request.method === 'HEAD' ? undefined : `<ul>${links}</ul>`);
        return;
      }
      if (!content.isFile()) {
        response.writeHead(404).end();
        return;
      }
      response.writeHead(200, {
        'Content-Type': types[extname(target).toLowerCase()] ?? 'application/octet-stream',
      });
      if (request.method === 'HEAD') response.end();
      else createReadStream(target).on('error', error => {
        console.error(error);
        response.destroy(error);
      }).pipe(response);
    } catch (error) {
      if (error instanceof URIError || error.code === 'ERR_INVALID_URL') {
        response.writeHead(400).end('Bad request');
        return;
      }
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR' || error.code === 'EISDIR') {
        response.writeHead(404).end('Not found');
        return;
      }
      console.error(error);
      response.writeHead(500).end('Internal server error');
    }
  });

  return new Promise((resolveServer, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolveServer(server);
    });
  });
}
