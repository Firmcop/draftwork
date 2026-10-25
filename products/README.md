# Products

Each folder here is one product on the web configurator: unpack the zip from the modeler's
**Configure › Product Configurator › Export…** into a folder named after the product (letters, digits, `-` and `_`).

```
products/
  gate/
    product.config.json
    gate.design.json
    tables/hinges.csv
```

On every push to `main`, the GitHub Pages workflow publishes every product whose rules compile at
`https://<owner>.github.io/<repo>/configurator/?product=<folder name>`. The examples in
`packages/rules/examples` are published too. Locally: `npm run build:configurator`, or `npm start` for the server version.
