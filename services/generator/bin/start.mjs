#!/usr/bin/env node
// Start the configurator server.
//   node services/generator/bin/start.mjs [--products folder] [--storage folder] [--port 8080]
// Each product is a folder under --products holding product.config.json, its design and tables
// (the zip the modeler's Product Configurator exports, unpacked).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/server.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), opt = {};
for (let i = 0; i < args.length; i += 2) opt[args[i].replace(/^--/, '')] = args[i + 1];
const productsDir = opt.products || process.env.PRODUCTS_DIR || path.join(here, '../../../packages/rules/examples');
const storageDir = opt.storage || process.env.STORAGE_DIR || path.join(here, '../storage');
const port = +(opt.port || process.env.PORT || 8080);

const server = createServer({ productsDir, storageDir });
server.listen(port, () => {
  console.log(`Draftwork configurator: http://localhost:${port}/`);
  console.log(`  products ${path.resolve(productsDir)}`);
  console.log(`  storage  ${path.resolve(storageDir)}`);
});
