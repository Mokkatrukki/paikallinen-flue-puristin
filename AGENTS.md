# AGENTS.md

This is a [Flue](https://flueframework.com) project: agents are TypeScript functions.

## Layout

- `src/agents/` — agent modules. A module whose first line is the `'use agent'` directive exports agents: every exported capitalized function is one, and the function name is its durable identity.
- `src/db.ts` — the persistence adapter for durable conversations.

## Commands

- `npx flue run src/agents/gemma.ts --message "Hi"` — run an agent locally, no server.
- `npm run check:types` — typecheck.
- `npx flue docs search <query>` — search the Flue docs from the terminal (then `flue docs read <path>`).
- `npx flue add` — list blueprints for adding channels, sandboxes, and databases.

## Model

Only provider in this project: local llama.cpp (Gemma 4 26B) on isomankeli, `192.168.1.26:8080`.
Registered via `setProvider()` in `src/agents/gemma.ts` — no cloud API keys, no other providers.

## Tools

- `src/lib/apple-music.ts` — raw Apple Music API client (developer-token JWT signing, Music User Token storage, rate-limited fetch). No business logic.
- `src/tools/apple-music.ts` — Flue tools built on it: search, list/get playlists, create playlist, add tracks. Mounted on `Gemma()`.
- Renaming/deleting playlists and removing individual tracks are not exposed — Apple's API returns 401 for PATCH/PUT/DELETE on library playlists for any third-party developer token (verified live, not a bug here). Only create + append are possible.
- One-time setup: `bun scripts/apple-music-auth.ts` opens a local login page to authorize a listener account before the playlist tools will work.
- `src/lib/sputnik.ts` — raw Sputnikmusic client: fetch + hand-written regex HTML extraction (no HTML parser dependency, no cheerio/jsdom).
- `src/tools/sputnik.ts` — `sputnik_list_best_new_music`: lists the current Best New Music page (artist, album, review URL). `sputnik_get_album_review`: fetches one album's full review (rating 0-100, review text, mentioned tracks, listener comments). Both mounted on `Gemma()`.
- `mentionedTracks` from `sputnik_get_album_review` is a raw, unfiltered list of every quoted song title in the review text (deduped) — it is not "the good songs", it's everything the reviewer named, including comparisons to other albums. Picking the actual standouts/bangers is left to the model reading the review text at conversation time, not baked into the tool — a small local model reliably does this filtering when it can see the prose, and hardcoding it in the tool would need real NLU the tool layer doesn't have.
