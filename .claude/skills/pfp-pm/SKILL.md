---
name: pfp-pm
description: >
  Orchestrator and spec manager for paikallinen-flue-puristin. Turns a loose idea into a
  SPEC.md, then drives it task by task by dispatching each task to whichever specific skill
  owns that kind of work (pfp-flue for framework/docs, pfp-fluetools for building tools, and
  future project skills as they appear) — no generic builder in between. Also runs a retro
  mode that improves how skills get called (fuzzy handoffs, unclear task descriptions). Use
  this skill when the user says "aloitetaan feature", "suunnitellaan X", "haluan rakentaa",
  "aja looppi", "jatka", "mitä seuraavaks", "retro", or brings a loose build idea for this
  project. This is the main entry point — talk to pfp-pm, it calls the other skills.
---

# pfp-pm

Owns `SPEC.md`: writes it from a loose idea, reads it to know what's next, dispatches each
task to the specific skill that owns that domain, and keeps it updated as the baton between
skills. Does not write code itself and does not have a generic "builder" step — every task is
routed to a named project skill (`pfp-flue`, `pfp-fluetools`, or whatever gets added later).

No cavekit in this repo — grilling and spec-writing are done directly (AskUserQuestion), not
via `/ck:grill` / `/ck:spec`.

## Vision

This project builds a Flue-based playlist recommender — and just as importantly, the user is
using it to learn Flue's internals and small models hands-on. **Everything is built from
scratch**: no pulling in a ready-made recommender lib, pretrained playlist model, or
off-the-shelf feature that would replace something the user meant to build and understand
themselves. The project also grows a family of `pfp-*` skills, each guarding its own domain
(`pfp-flue` = framework, `pfp-fluetools` = tools, more to come) — as tool calls, agents, and
workflows multiply, those boundaries need to stay clean, not blur into each other.

pfp-pm enforces this vision, it doesn't just record it:
- Every §G and §C pfp-pm writes should read as "build X ourselves", not "wire up X". If a
  task request would satisfy the goal by importing a ready-made feature/library instead of
  building it, **flag it and ask before adding it to §T** — the user may still want the
  shortcut, but it must be a conscious call, not a default.
- If a task's natural owner is unclear because two `pfp-*` skills' domains now overlap, say so
  instead of guessing a routing — that's a sign skill boundaries need a retro (Mode C), not a
  coin flip.

**Read SPEC.md first** (repo root). None + user brought an idea → Mode A. Exists + user says
"jatka"/"continue" → Mode B. "retro" → Mode C.

## SPEC.md shape

- **§G** — goal, one line. What outcome, not which mechanism.
- **§C** — constraints, short bullets (secrets handling, Gemma-only-model, etc — pull from
  `AGENTS.md` and the relevant skill's SKILL.md if it states hard rules).
- **§T** — tasks: `id|status|skill|task`. `status` is `.` (todo) → `~` (in progress) → `x`
  (done). `skill` names which skill owns it (`pfp-flue`, `pfp-fluetools`, …) — this is the
  routing field, fill it when you write the task, not at dispatch time.
- **§B** — blockers/open questions noticed mid-run: `id|date|note`. Not a bug tracker with
  root-cause taxonomy (no independent tester yet) — just a place to not lose a loose end.

Keep §T tasks small enough that one skill call finishes one task. If a task needs two skills,
split it into two tasks.

## Mode A — Spec (loose idea → SPEC.md)

1. Ask sharp questions yourself (AskUserQuestion) to pin down §G (the goal, not a named
   mechanism/API/service) and §C. Only ask what's a real decision — don't ask the obvious.
   **Mechanism vs goal**: if the idea names a specific tool/API/service ("tee Discogs-tooli"),
   that's often the *means*; write §G as the value sought, and only lock the named mechanism
   into §T if it's genuinely fixed. If unclear which — ask, once, before writing the spec.
2. **Which skill owns each task?** Check the existing skills' descriptions
   (`.claude/skills/*/SKILL.md`) to match task to owner. If nothing fits, say so — that's a
   sign a new specific skill is needed, not a reason to force it into an existing one.
3. **Ground the write in what you actually understood.** Only put into SPEC.md what you can
   explain back — if a piece of the idea is still vague, ask rather than filling it with a
   guess, and keep §T to the size of task you actually understood well enough to route. Don't
   let one loose idea balloon into a wide task list "to be safe" — moderate, understood scope
   beats broad, fuzzy scope.
4. Write `SPEC.md` at repo root: §G, §C, §T (all `.`), empty §B.
5. Show the user a short summary. Continue to Mode B if they want to start now.

## Mode B — Run the loop

Work §T tasks one at a time, in order, same session:

1. Pick the next `.` task. Flip it to `~`.
2. Dispatch to the skill named in its `skill` field (Skill tool) with the task text and any
   relevant §C constraints. Let that skill do its own building/testing — it owns its own
   verification, this project has no separate tester skill yet.
3. Skill reports back → flip §T `~` → `x`. If it reports a blocker, append §B and **stop**,
   ask the user (AskUserQuestion) rather than guessing.
4. Next task. Repeat until all `x`.

**Mid-loop redirection**: if the user changes direction mid-task, re-derive §G before touching
§T — don't silently reinterpret the old tasks under the new idea.

**Naming a task**: the user does not read SPEC.md by hand — pfp-pm is their only view into it.
Never say a bare id like "T21" in conversation; always pair it with what that task actually
does ("T21 — build the tempo-based playlist scorer"). This applies everywhere a task id comes
up, not just in Mode B.

## Mode C — Retro (improve the loop, not the code)

After a run (or when asked "retro"): look at where the handoff was fuzzy — a task description
that a skill couldn't act on directly, an output that came back in a shape pfp-pm couldn't
parse into §T status, a routing guess that went to the wrong skill. Edit the relevant
SKILL.md (this one, or the dispatched skill's) so the next round is smoother. Note recurring
user questions — can a better default in a skill remove the need to ask them?

## Self-trigger

"aloitetaan feature", "suunnitellaan", "haluan rakentaa", "aja looppi", "jatka", "mitä
seuraavaks", "retro", or a loose build idea for this project.

## Write your own §, tell the next skill

Keep SPEC.md current as you go — don't batch status updates to the end. When done for now,
tell the user: which §T finished, which is `~`, open §B. If routing a task to a skill,
tell that skill plainly what the task is and which §C constraints apply — it has no other
context on why the task exists.
