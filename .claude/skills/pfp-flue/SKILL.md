---
name: pfp-flue
description: >
  Update the local Flue framework install and look up official Flue docs/examples for this
  project. Use this skill whenever the user asks to update/upgrade Flue ("päivitä flue",
  "update flue", "onko flue ajan tasalla"), or wants to know how to do something in Flue, or
  wants official docs/examples ("miten flue tekee X", "flue docs", "onko esimerkkiä X:stä",
  "flue framework help", "katso flue dokumentaatiosta"). Project-local skill, pairs with
  pfp-fluetools (building/testing tools) — this one is about the framework itself.
---

Two jobs: keep the local Flue install current, and answer "how do I do X in Flue" from the
framework's own docs rather than guessing from memory — Flue moves fast (2.x, frequent
releases) and guessed APIs go stale quickly.

## Updating Flue

1. Check installed vs latest:
   ```bash
   npm list @flue/cli @flue/runtime --depth=0
   npm view @flue/cli version
   ```
2. `@flue/cli` and `@flue/runtime` ship in lockstep (same version number) — always bump both
   together, never one alone:
   ```bash
   npm install @flue/cli@latest @flue/runtime@latest
   ```
3. If the major version changed, read the migration guide before assuming anything still
   works the same way:
   ```bash
   npx flue docs read guide/migration
   ```
   Summarize what's relevant to this project's agents (`src/agents/*.ts`) before touching code.
4. Sanity check after upgrading — run an existing agent and confirm it still replies:
   ```bash
   npx flue run src/agents/gemma.ts --message "ping"
   ```

## Looking up docs / how-to / examples

The installed `@flue/cli` bundles the full docs site, versioned to match what's actually
installed — prefer this over web search, since it can't drift from the local setup:

```bash
npx flue docs search "<topic, e.g. 'custom provider' or 'tool calling'>"
npx flue docs read <path-from-search-results>
```

`flue docs search` ranks by relevance and returns a `path` per hit — feed that straight into
`flue docs read`. Run search first; don't guess a doc path from memory.

For runnable examples, Flue calls them "blueprints" — implementation guides for common
patterns:

```bash
npx flue add            # lists available blueprints
npx flue add <kind> <name>   # fetches one blueprint's implementation guide
```

If the installed CLI's docs don't cover something (e.g. it's newer than the installed
version, or the question is about something website-only like pricing/hosting), fall back to
WebFetch against `https://flueframework.com/docs/<path>/index.md` — the site serves raw
markdown at that path for any docs page.

## Notes

- This project's llama.cpp/Gemma provider setup lives in `src/agents/gemma.ts` — check it for
  the working example of `setProvider()` / `createProvider()` before re-deriving that pattern
  from docs.
- `flue run` loads only the target agent module, not `app.ts` — keep that in mind when docs
  talk about registering things in `app.ts`.
