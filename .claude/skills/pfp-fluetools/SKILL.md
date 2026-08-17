---
name: pfp-fluetools
description: >
  Build, test, and organize Flue framework tools (defineTool/useTool) for the local Gemma
  agent in this project. Use whenever the user wants to add a new tool/capability to Gemma —
  "tee flue-tooli joka...", "lisää Gemmalle työkalu", "tee tooli [palvelulle]", "anna Gemman
  käyttää [API]" — or wants an existing tool tested, reorganized, or checked that "Gemma osaa
  käyttää sitä". Project-local skill, only relevant inside paikallinen-flue-puristin.
---

Builds a Flue tool end to end and proves it actually works — not just that it type-checks, but
that Gemma calls it correctly and gets a right answer back. Skipping the live-model step is the
single most common way a "working" tool turns out to be dead weight: valibot passes, tsc passes,
and Gemma still never calls it because the description was vague, or calls it with garbage
arguments because the input schema didn't constrain enough.

Canonical worked example — read these before building anything new, they show every convention
below applied for real:
- `src/lib/apple-music.ts` — raw client (auth, fetch wrapper, rate limiting)
- `src/tools/apple-music.ts` — the tools themselves (thin wrappers)
- `tests/apple-music.test.ts` — mocked unit tests
- `src/agents/gemma.ts` — how tools get mounted

## The shape of a tool

Two files, never one:

- **`src/lib/<service>.ts`** — the raw client. Auth/token handling, the fetch wrapper, rate
  limiting, error normalization. No knowledge of "tools" here at all — this file would look the
  same if Flue didn't exist.
- **`src/tools/<service>.ts`** — the Flue tools. Thin wrappers around the client using
  `defineTool` from `@flue/runtime` and `valibot` (`import * as v from 'valibot'`) for schemas.

Keeping the split matters because the client is where bugs actually live (wrong endpoint, wrong
auth header, wrong body shape) and that's exactly what a mocked unit test can pin down without
needing a live model in the loop. The tool layer should be too simple to have its own bugs.

For unfamiliar Flue APIs, don't guess — run `npx flue docs search "<topic>"` then
`npx flue docs read <path>`. `defineTool`/`useTool` basics are stable enough to write from
memory using the pattern below, but check docs for anything unusual (durable tools, harness
tools, conditional tools).

```ts
export const someAction = defineTool({
  name: 'service_verb_noun',              // snake_case, service prefix — avoids collisions
                                            // once there are tools for several services
  description:
    'What it does, in one or two sentences. When to use it. What it returns. Any hard ' +
    'limitation the model needs to know BEFORE calling it (not discovered by trial and error).',
  input: v.object({ /* valibot schema */ }),
  output: v.object({ /* valibot schema — always declare this, not just input */ }),
  async run({ data }) {
    const result = await serviceClient.doThing(data.whatever);
    return { output: result };            // never a bare return unless output has no schema
  },
});
```

### One tool per action, not one tool with an action enum

Given `create_playlist`, `delete_playlist`, `add_tracks` as three small tools vs. one
`playlist_action` tool with an `action: 'create' | 'delete' | 'add_tracks'` param — always
prefer the three small tools here. Gemma 4 26B (this project's only model) is small and local;
it reliably picks a specific, well-named tool from a list far more often than it correctly
selects the right enum value buried inside one tool's arguments. The `description` field is
also strictly more useful split three ways — each tool's description can be exactly about that
one action instead of a shared paragraph trying to cover all of them. This isn't a Flue rule,
it's a small-model rule — revisit it if this project ever moves to a bigger model.

### The description is the only documentation the model gets

It never sees your code, comments, or this skill. If a capability doesn't exist or a platform
won't support something (see the Apple Music example: no delete/rename endpoint at all), say so
in the description of the *nearest tool that could tempt the model to try it* — that's cheaper
than letting the model fail a real call and hoping it recovers gracefully.

### Errors surface to the model — use that

Throwing inside `run` becomes a tool-call error the model can see and react to (retry, try
another approach, tell the user). Never swallow an error and return a fake success — that's how
a tool silently does nothing while claiming it worked.

## Mounting

Tools get mounted with `useTool(...)` inside the agent's `'use agent'` module
(`src/agents/gemma.ts`), never defined inline there — import from `src/tools/<service>.ts`. If a
capability should only be available conditionally (e.g. only once some setup step is done),
that's what `useTool` inside an `if` is for — see `npx flue docs read guide/tools` for the
conditional-tools pattern.

## Secrets and local state

- Credentials go in `.env` (gitignored) with a matching `.env.example` documenting every var —
  no real values in the example.
- Key files (`.p8`, etc.) get an explicit gitignore entry (`*.p8`) — `.env` alone isn't enough.
- Any token cache, auth state, or other local file the client needs to persist goes under
  `data/` (already gitignored), not the user's home directory. A file scattered in `~` outlives
  the project and nothing in the project reveals it's there — keep everything self-contained.
- One-off interactive setup (an OAuth-style login flow, etc.) belongs in `scripts/`, run with
  `bun scripts/<name>.ts` — it's dev tooling, not part of the agent runtime, so Bun-only APIs
  (`Bun.serve`, etc.) are fine there even though `flue.config.ts` targets `node` for the
  actual agent code.

## Testing — the four steps, in order, don't skip the last one

**1. Type-check.** `npm run check:types` after every change. Catches nothing interesting on its
own but catches everything trivial, fast.

**2. Mocked unit tests** in `tests/<service>.test.ts` using `bun:test`. Stub `globalThis.fetch`
with `mock(...)` — no real network calls in this suite, it should run offline and in CI. Test
two layers:
- the client (`src/lib/<service>.ts`): token/auth signing, request shape, error handling,
  retry logic — anything that would be expensive to get wrong silently.
- the tools themselves: call `tool.run({ data, signal, log, toolCallId })` directly (see
  `tests/apple-music.test.ts` for the `ctx` object shape to reuse) and assert on `result.output`
  and on what got sent to the stubbed fetch (method, path, body).

**3. One manual live check against the real API**, in a throwaway `scripts/live-*.ts` — not
part of the committed test suite, just a script you run once. This exists because API docs and
forum answers lie or go stale, and the mocked tests only prove your code does what *you*
assumed the API does. This session's concrete example: Apple's docs and community threads
implied playlist tracks could be removed or replaced; live testing showed PATCH/PUT/DELETE
return a bare 401 for any third-party token, full stop — a real platform limitation that no
amount of mocked testing or doc-reading would have caught. Delete or don't ship tools for
capabilities that fail this check; don't guess.

Before running a live check or the acceptance test below, confirm isomankeli
(`192.168.1.26:8080`, the local llama.cpp/Gemma server) is actually up:
```bash
curl -m 5 http://192.168.1.26:8080/v1/models
```
If it doesn't respond, use the `wake-isomankeli` skill (WoL + SSH readiness poll) before
continuing — don't just retry blindly.

**4. The acceptance test — this is the one that actually matters.** Run the real agent with a
prompt designed to trigger the new tool:
```bash
npx flue run src/agents/gemma.ts --message "<realistic request that needs the new tool>"
```
Read the transcript. Confirm Gemma: picked the right tool (not a different one, not none at
all), passed sensible arguments (not something technically valid but wrong — e.g. the wrong
track from a search result), and gave a correct final answer. Type-checking and mocked tests
prove the code is internally consistent; only this step proves a small local model can actually
find and use the tool the way it was designed to be used. If Gemma picks the wrong tool or
mis-reads a result, that's a signal to sharpen the `description` or tighten the `input` schema,
not a Gemma problem to shrug off — the tool exists to be used by exactly this model.

If a live check or the acceptance test performs real writes against an external account
(creating a playlist, sending a message, etc.) and the API offers no way to undo it
programmatically, say so plainly to the user afterward rather than silently leaving orphaned
state — see how the Apple Music work reported the leftover test playlists it couldn't delete.

## Keep AGENTS.md current

After a tool is built and proven, add or update a short "Tools" section in `AGENTS.md`: what
each `src/tools/<service>.ts` provides, and any hard external-platform limitation discovered
during testing (so nobody — human or a future Claude session — re-discovers the same 401 from
scratch). This is the only piece of documentation this skill asks for; don't create anything
else unless asked.
