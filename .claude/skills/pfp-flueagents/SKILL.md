---
name: pfp-flueagents
description: >
  Test, debug, and tune Flue agents' system-prompt/tool-orchestration reliability for this
  project — not building new tools (pfp-fluetools) and not framework docs/updates (pfp-flue).
  Use when the user wants to check if Gemma can do a task reliably, debug why a multi-step
  agent flow fails or gives inconsistent results, or scale up an agent's task complexity
  ("testaa gemma", "toimiiko agentti", "jumpataan gemman kanssa kuntoon", "skaalataan
  isommaksi", "miksi tää ei toimi luotettavasti", "aja live-testi"). Project-local skill —
  owns the escalating-complexity test loop and the accumulated LEARNINGS.md knowledge base.
---

# pfp-flueagents

Owns agent-level reliability: does the system prompt actually make Gemma pick the right tools,
in the right order, with sensible arguments, consistently — not once, but every time. Tests
this itself (Claude runs the live checks, doesn't just ask the user to try it and report back),
starts small, escalates deliberately, and writes down what it learns so the next session
doesn't rediscover the same failure from scratch.

## Scope — what this owns vs. the other pfp-* skills

- **pfp-flueagents** (this skill): does the agent's system prompt + tool set reliably complete
  a multi-step task? Debugging flakiness, tuning instructions, deciding how much complexity an
  agent can handle in one go.
- **pfp-fluetools**: does a single tool work correctly against its real API? New tools, tool
  bugs, mocked tests, live API checks for one tool in isolation.
- **pfp-flue**: what does the Flue framework itself do/support (compaction, `usePersistentState`,
  `useModel` options, docs lookup)? Consult this whenever a failure might be a framework
  mechanic rather than a prompt or tool bug — don't guess Flue API behavior from memory, it
  moves fast (see that skill's own notes).

If a failure turns out to be a tool bug (wrong endpoint, missing pagination, bad error
handling), that fix belongs to pfp-fluetools even if pfp-flueagents is the one that found it —
say so and either hand off or fix it directly with that skill's conventions (two-file
lib/tools split, mocked tests, live check) since it's the same codebase either way.

## Read LEARNINGS.md first

Before designing a new test or explaining a failure, check `LEARNINGS.md` (repo root) for
whether this exact shape of problem already happened. It records, per debugging round: what was
tested, what broke, the root cause, the fix, and whether it was confirmed stable afterward. A
memory that's already been written down should be reused, not re-derived — if the file says
"search without an artist name silently returns the wrong track," don't rediscover that by
watching it happen again.

## The escalating-complexity test loop

Don't jump straight to the full task. Prove the small case, then grow one dimension at a time:

1. **Smallest possible slice.** One tool, one input, no chaining. If the task is "build a
   weekly playlist from N albums," first prove a single album's review-fetch-and-pick works in
   isolation before any Apple Music tool is even mounted or invoked.
2. **One dimension of complexity at a time.** Add one axis — more items (1→3→N albums), one
   more chained tool (fetch → also search), a real write (search → also create/add) — and
   re-test. Never add two axes in the same run; if it breaks, you won't know which one did it.
3. **On failure, diagnose before fixing.** Turn on `PFP_DEBUG=1` (see `src/lib/*.ts` — both
   clients log every request/response on stderr when this is set) and read the actual
   transcript, not just the final answer. Classify the failure:
   - **Tool/code bug** (wrong endpoint, silent truncation, no retry on a transient error) →
     pfp-fluetools territory, fix there.
   - **Prompt/instruction-clarity issue** (the model guessed wrong because the rule was vague
     or the tool description didn't say enough) → tighten the agent's returned instructions or
     the tool's `description`, in this codebase, using this skill.
   - **Framework mechanic** (context compaction losing detail, state not being used where it
     should) → consult pfp-flue before assuming; check the actual docs/behavior rather than
     guessing, and confirm with a live test whether it's really the cause (a plausible-sounding
     theory is not a diagnosis — the Death Cab "failed to fetch" case in this project's history
     was blamed on context limits at first, and turned out to be a missing retry instead).
4. **Fix at the smallest scope that explains the failure.** Don't rewrite the whole prompt for
   one bad edge case.
5. **Re-run at the SAME complexity level until it's stable** (aim for a few clean runs in a
   row, not just one) before moving back up to the level that broke. Small local models are
   not fully deterministic — one clean run doesn't prove a fix, and one bad run after a fix
   doesn't disprove it either. Watch for the pattern, not a single sample.
6. **Only then scale back up** to the level that originally failed, and continue climbing from
   there.

Live checks always go through the real stack — `npx flue run src/agents/gemma.ts --message
"..."` against the real isomankeli/Gemma and, when the task needs it, the real Sputnikmusic
site and Apple Music account. Before any live run, confirm Gemma is reachable
(`curl -m 5 http://192.168.1.26:8080/v1/models`) and use the `wake-isomankeli` skill if not.

**Real external writes need a confirm.** A step that creates/modifies a real Apple Music
playlist is not reversible via the API (no delete/rename — see AGENTS.md). Read-only escalation
(fetch reviews, search tracks) doesn't need per-step confirmation; the moment a test would
create or add to a real playlist, check with the user first, same as any other hard-to-reverse
action.

## Recording learnings

After a debugging round — whether it ended in success or you're stopping partway — append a
section to `LEARNINGS.md`. Don't overwrite prior sections; this file accumulates. Each entry
should be concrete enough that a future session can act on it without re-running the test:

- What was being tested (the task, the complexity level).
- What broke, verbatim symptom (not just "it failed" — the actual wrong output or error).
- Root cause, once actually diagnosed (not the first plausible guess — note when an initial
  theory turned out wrong, that's useful too).
- The fix, and where it lives (file/tool/prompt section).
- Confirmed stable? (how many clean re-runs, at what complexity level.)

If the same failure mode shows up again in a later session, that's a signal the fix didn't
generalize — note that explicitly rather than quietly re-fixing the same spot again.

## Self-trigger

"testaa gemma", "toimiiko agentti", "jumpataan gemman kanssa kuntoon", "skaalataan isommaksi",
"miksi tää ei toimi luotettavasti", a request to run a live check on an agent, or a report that
an agent's output was wrong/inconsistent for this project.
