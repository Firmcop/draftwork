# Configurator server (`@draftwork/generator`)

One Node process serves the customer-facing web configurator (`apps/configurator`), the product API, and release
files made by a background worker. It has no dependencies beyond Node 20+ and the workspace packages.

```bash
npm start                                             # http://localhost:8080/, the example products
node services/generator/bin/start.mjs --products ./products --storage ./storage --port 8080
```

A product is a folder under `--products` holding `product.config.json`, its design and its CSV tables: the zip the
modeler's **Product Configurator › Export** writes, unpacked. Products reload when their files change.

## How a configuration flows

| Step | Where | Speed |
| --- | --- | --- |
| Form, checks, price, parts list | the browser runs `@draftwork/rules` on every change | instant |
| 3D preview | the browser rebuilds the real model with `@draftwork/core` in a Web Worker | under a second for the example |
| STEP, STL, drawing views, flat DXF | the server's worker thread, one job at a time | about a second for the example |

Files are cached by what decides the geometry (product, version, design, parameter values, suppression, formats), so
a configuration that differs only in quantity or price comes back at once. The server re-evaluates the rules
itself for every quote and job; what the browser sends is only the answers.

## API

| Method and path | Does |
| --- | --- |
| `GET /api/products` | Products with title, version and whether their rules compile |
| `GET /api/products/:id` | What a browser needs: rules config (tables inline, no test cases) and the design |
| `POST /api/products/:id/quote` `{ answers }` | Price, BOM, text and messages from the server's own evaluation |
| `POST /api/products/:id/jobs` `{ answers, formats? }` | Starts a job (`202`); `422` with the product's messages if the checks fail. `formats`: `step`, `stl`, `svg`, `dxf` |
| `GET /api/jobs/:id` | Status (`queued`, `running`, `done`, `failed`), quote, geometry, file links |
| `GET /api/jobs/:id/files/:name` | A finished job's file |

Job ids are random UUIDs, and a job's files are only reachable through its id. Request bodies are limited to 256 KB,
the queue to 50 waiting jobs.

## Not yet

- Accounts, roles and orders: jobs and files are kept as files under `--storage`. A database (Postgres or Supabase)
  comes with sales and engineering roles.
- Several workers: one worker thread builds one job at a time.
- Webhooks and CSV export to ERP or accounting.
