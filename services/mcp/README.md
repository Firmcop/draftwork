# Draftwork configurator MCP server

Lets AI assistants (Claude Desktop, Claude Code and other MCP clients) work with your configurable products. The
assistant only supplies answers: the rules engine checks them and sets the price, and the kernel makes the files,
exactly as on the web configurator.

| Tool | Does |
| --- | --- |
| `list_products` | Product ids and titles |
| `describe_product` | The questions: type, unit, options, limits, defaults, help |
| `quote` | Checks a configuration and prices it: messages, price lines, total, parts, part number |
| `make_files` | Builds the part and writes STEP, STL, drawing views (SVG) and flat DXF to a folder on this computer; refused if the checks fail |

## Use it

```bash
npm install && npm run build:core
node services/mcp/server.mjs --products ./products --out ~/Draftwork-out
```

Claude Desktop, in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "draftwork": {
      "command": "node",
      "args": ["/path/to/draftwork/services/mcp/server.mjs", "--products", "/path/to/draftwork/products", "--out", "/path/to/output"]
    }
  }
}
```

Without `--products` it serves `products/` and the examples in `packages/rules/examples`. Files go to `--out`
(default `./draftwork-out`), one folder per part number.

Then ask, for example: *"Price twelve heavy-duty bearing brackets for a 20 mm shaft, and make the STEP file."*
