# @draftwork/ai

The configurator's AI layer. **The model suggests; the rules engine decides.** Nothing the model says sets a price,
passes a check or changes a product by itself.

| Feature | Where | Key |
| --- | --- | --- |
| **Ask AI to write rules**: describe a change in plain words, get a checked proposal | Draftwork › Configure › Product Configurator › Rules | the engineer's own Anthropic API key, kept in their browser |
| **Describe what you need**: a customer's words (and a photo or sketch) fill in the options | web configurator, server version only | `ANTHROPIC_API_KEY` on the server |
| **MCP server**: AI assistants list, describe, price and build your products | `services/mcp` | none: no model runs here |

## Drafting rules

`draftChanges({ request, config, design, llm })` sends the model the design's parameter and feature names, the
product (inputs, tables, variables, rules) and the formula language, and asks for one structured proposal (new
inputs, variables, rules, tables, rules to remove, and questions when a fact is missing). Then
`checkProposal` merges it into a copy of the product and checks it:

- it compiles (names exist, formulas parse, no circular references),
- `param` rules set parameters the design has, `suppress` rules name features it has,
- the default answers raise no errors,
- the product's test cases still pass.

Problems go back to the model to fix, twice at most. The engineer sees the proposal, the check result, and an
**Add to product** button that only works when the check passed.

## Customer intake

`intake({ message, images, project, answers, llm })` asks the model to fill in the form. Only the product's inputs
can be set, a choice must be one of its options, and numbers must be numbers; anything else is listed as not used.
The rules then evaluate the answers as usual, so price and checks come from the rules. The customer's text is
passed as data, inside `<customer>` tags, and the model is told not to take instructions from it.

On the server: set `ANTHROPIC_API_KEY` (and optionally `DRAFTWORK_AI_MODEL`) and start it. The box appears on the
page; requests are limited to 20 per visitor per 10 minutes, pictures to 3 (JPEG, PNG, WebP, GIF). The static
GitHub Pages site has no server, so it never shows the box.

## The model

`createClaude({ apiKey, model })` calls the Anthropic Messages API with one forced tool, so answers are structured
data. The default model is `claude-sonnet-5-5`; change it in the Ask AI box or with `DRAFTWORK_AI_MODEL`. Any object
with an `ask({ system, content, tool })` method can stand in for it, which is how the tests run offline.
