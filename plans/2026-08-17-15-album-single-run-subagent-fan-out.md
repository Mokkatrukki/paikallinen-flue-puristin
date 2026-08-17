# 15-album single-run playlist flow: subagent fan-out

## Observed problem

Goal: process 15 albums in ONE Gemma run, all tracks landing in ONE new numbered playlist,
without the context-budget problems of stuffing 15 full review texts into one agent's
65536-token window.

First attempt (before this plan): added an `album_picker` subagent (`useSubagent` in
`src/agents/gemma.ts`) that handles one album end-to-end (fetch review, pick tracks, search
Apple Music, add to playlist) — verified working correctly on a 3-album run (3 separate `task`
tool calls seen in the transcript, one per album, running in parallel).

At 15 albums, live run produced only **13 tracks from 10 albums**, missing August Burns Red
(album 15) entirely, plus 4 albums that got 0 legitimately. Debug log showed only **ONE** `tool
task` call in the whole transcript, not 15 — the parent collapsed all 15 albums into a single
task prompt, and that one subagent instance processed them serially inside its own context,
running out of room right after fetching August Burns Red's review but before searching/adding
its track.

## Hypothesis

Root cause: the parent instruction said "dispatch every album's task together in one batch" —
ambiguous at 15 albums. At 3 albums the model correctly read this as "3 separate task calls,
issued in the same turn." At 15 it instead read it as "one task call describing everything,
batched" — a plausible misreading of "batch" that the 3-album test never exercised because 3
items doesn't tempt collapsing them into one description.

Fix: make the instruction unambiguous in two places —
- Parent prompt: "For every album... dispatch a SEPARATE task tool call... ONE call per
  album... N separate task calls... Never combine more than one album's info into a single
  task call."
- Subagent's own prompt gets a defensive backstop: "You process EXACTLY ONE album... If the
  task prompt describes more than one album, process only the first one it names and say so."
  This means even if the parent still messes up the dispatch, the failure mode changes from
  "silently truncates at album 15" to "subagent visibly reports it was given more than one
  album" — an easier failure to spot and impossible to mistake for success.

**Prediction (Claude-as-Gemma walkthrough):** reading the new parent prompt the way Gemma
will — "For every album to process, dispatch a SEPARATE task tool call... ONE call per
album... N separate task calls" is now three separate restatements of the same constraint in a
row, which is harder to satisfy with a single collapsed call than the original one-line
mention. I predict: the transcript will show 15 separate `tool task` lines (not 1), covering
all 15 albums including August Burns Red, and the resulting playlist will have tracks from all
albums that legitimately qualify (i.e. no album silently missing because it was 15th in line —
though some may still legitimately get 0 tracks if their review doesn't praise anything by
name, same as every prior run).

## The change

`src/agents/gemma.ts`:
- `AlbumPicker`'s returned instructions: added "You process EXACTLY ONE album... never more,
  even if the task prompt lists several... process only the first one it names."
- `album_picker` subagent `description`: added "Give it exactly ONE album... it will refuse to
  process more than one... For N albums, make N separate task tool calls... never describe
  multiple albums inside a single task call."
- `Gemma()`'s flow step 4: "dispatch a SEPARATE task tool call to the album_picker subagent,
  ONE call per album... N separate task calls, all issued in this same turn."

## Actual vs. predicted

(fill in after the next live 15-album run)
