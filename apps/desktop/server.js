// Serves the Draftwork app files to the window from 127.0.0.1, like a website: the browser engine then keeps the
// compiled geometry engine between launches (it only does that for http(s) pages), and the offline cache works.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function startServer(root) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      let url = decodeURIComponent((req.url || '/').split('?')[0]);
      if (url.endsWith('/')) url += 'index.html';
      const file = path.normalize(path.join(root, url));
      if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
      fs.stat(file, (err, st) => {
        if (err || !st.isFile()) { res.writeHead(404); return res.end('Not found'); }
        const tag = '"' + st.size.toString(36) + '-' + Math.floor(st.mtimeMs).toString(36) + '"';
        const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', etag: tag, 'cache-control': /\.(wasm|png)$/.test(file) ? 'max-age=31536000' : 'no-cache' };
        if (req.headers['if-none-match'] === tag) { res.writeHead(304, headers); return res.end(); }
        res.writeHead(200, { ...headers, 'content-length': st.size });
        fs.createReadStream(file).pipe(res);
      });
    });
    srv.on('error', reject);
    // a fixed port keeps the page's origin, and with it the user's saved designs, the same on every launch
    srv.listen(+process.env.DRAFTWORK_PORT || 47613, '127.0.0.1', () => resolve(srv));
  });
}
module.exports = { startServer };
