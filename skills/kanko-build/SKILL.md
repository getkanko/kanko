---
name: kanko-build
description: Implement a non-trivial code change from a request, issue, or specification. Explicit invocation enables review maps for the session. When automatically loaded for substantial implementation, fix, refactor, or migration work, offer an optional review map connecting requirements, decisions, risks, evidence, and handoff context; maps otherwise default to off. Do not use for read-only review/explanation or trivial edits.
---

# Kankō Build

Implement the requested change. Review maps are **off by default**.

## Offer optional review map capture

When this skill is automatically loaded and the request is non-trivial, briefly
offer to create a review map for a later walkthrough, unless capture is already
enabled for the session or the user has accepted or declined capture for this
task. Continue authorized implementation while waiting for an answer. Silence
leaves review maps off; do not block the coding task or repeat the offer.

Create or maintain a review map only after explicit opt-in. Explicitly invoking
`kanko-build` (for example, "Use $kanko-build to build this feature") is itself
opt-in and enables review maps for that session; proceed without another offer
or confirmation. A request such as "implement this and prepare a review map"
also authorizes capture for that task. Automatic skill loading, task complexity,
and an existing map do not enable capture. Honor earlier session or task opt-in
without asking again, and stop capture if the user opts out.

Until the user opts in, skip all review map tools and the capture, freeze, and
ownership-handoff steps below. Complete the implementation, ordinary
verification, and any required tour QA, then report the changes and results
without review map artifacts.

## Required tour QA

Every non-trivial UX or structural change to the tour process automatically
requires a QA round in a virtual VS Code instance. This requirement applies
even when review maps are off. Execute it yourself or delegate it to another
AI agent; do not ask the user to run the QA round.

- Launch the current extension candidate in an isolated VS Code development
  host with a virtual display and disposable workspace/profile. Use the
  [native tour fixture and integration runner](../../editor-extension/test/integration/runner.js)
  or [interactive fixture host](../../editor-extension/test/integration/manual-host.js)
  as appropriate. Disposable fixture state does not enable review map capture
  for the user's implementation task.
- Load a source-backed tour and exercise the changed interaction and relevant
  transitions through the actual editor UI. For a loading fix, verify the first
  stop and beat immediately after load without workaround clicks. For layout
  or progress changes, cover the affected layouts, stop/beat transitions, and
  readable sidebar states.
- Capture screenshots of the resulting VS Code tour states, then inspect them
  for the intended behavior and visual regressions. Keep the captures in a
  task-specific verification directory, with concise scenario captions and the
  candidate/version tested. Tests, snapshots, mockups, and browser-only webview
  renders do not substitute for screenshots of the running editor.
- Fix QA findings and rerun the affected scenarios on the final candidate.
  Present the screenshots in the completion response using inline images or
  clickable image attachments, with captions explaining what each verifies;
  do not merely mention that screenshots exist.

If the editor or capture tooling cannot run, investigate a workable native
virtual-editor setup. If still blocked, report the concrete blocker and the
missing scenarios and screenshots. Keep visual QA explicitly incomplete and
do not claim the UX or structural change is fully verified.

The remaining workflow applies only when review map capture is enabled. Connect
requirements, code, decisions, and evidence, with change notes explaining the
choices. Keep the map selective; it is not a transcript, a replacement for
tests, or permission to expand scope.

## Start the task

Read the request, specification, repository instructions, and relevant source
before proposing durable review map content. Resolve the absolute Git repository
root and inspect the current status so pre-existing user changes remain visible
and untouched.

After explicit opt-in, open a working-tree review map with `kanko_map_open`:

- Use baseline `HEAD` and explicitly include staged, unstaged, and untracked
  content unless the user's requested scope says otherwise.
- Give it a short task-oriented title and identify the coding agent as the
  actor.
- Reuse a matching review map only when its title, thesis, and requirements belong
  to this task. If an exact or related review map belongs to another task, call
  `kanko_map_open` again with `forceNew: true`; never merge unrelated task history
  for convenience.
- Keep the returned review map ID and latest aggregate revision. Every mutation
  must use the latest `expectedRevision`; on conflict, query current state and
  reconsider the semantic command rather than retrying blindly.

If review map tools are unavailable, continue the implementation and state at
handoff that durable capture was unavailable. Do not block ordinary coding on
the editor extension; review map tools do not require it.

## Seed durable context

Record the useful source material early through typed `kanko_map_apply` commands:

- `SetThesis` for the problem, intended behavior, approach as currently
  understood, important non-goals, and highest uncertainty. Revise it later as
  understanding changes.
- `AddRequirement` for requirements, acceptance criteria, compatibility rules,
  constraints, and explicit non-goals. Keep separate requirements separate
  when they will map to different claims or evidence.
- `AddAssumption`, `AddInvariant`, and `AddRisk` only when they can affect the
  implementation, verification, rollout, or future maintenance.

Every durable statement needs structured provenance:

- Use `user-stated` for the request and later user direction.
- Use `source-document` with a file, issue, or design-document locator for
  sourced requirements.
- Use `session-recorded` for a decision or assumption explicitly recorded while
  implementing.
- Use `repository-observed` for facts directly visible in code, tests, config,
  or history.
- Use `execution-observed` for test, build, diagnostic, benchmark, or runtime
  results.
- Reserve `model-inferred` for reconstruction, include why it was inferred, and
  never narrate it later as author-stated rationale.

Do not persist private reasoning, credentials, environment dumps, unrestricted
terminal logs, or unrelated workspace activity. Prefer concise metadata and
bounded observations over raw output.

## Capture while implementing

Update the review map at meaningful decision points, not after every command or
edit:

- `AddDecision` when choosing among materially different approaches. Record
  the problem, chosen approach, relevant alternatives, reasons/tradeoffs,
  consequences, and conditions for revisiting it.
- `AddAssumption` or `AddRisk` when implementation reveals a dependency,
  uncertainty, failure mode, maintenance trap, or deferred concern.
- `AddEvidence` after a meaningful check. Record the command or procedure,
  observation, result, environment identity when relevant, limitations, and
  which claim it will support or contradict. Attach bounded raw output only
  when it materially improves reproducibility.
- Preserve useful failed approaches as a rejected alternative, contradictory
  evidence, or risk. Do not preserve routine syntax mistakes and exploration
  noise.

The initial working-tree identity will become stale as source changes. That is
expected. Continue recording preparation context, but do not create final code
references, claim support, tour coverage, or review state against stale code.
Do not refresh after every edit; change revisions are reviewable checkpoints,
not an edit log.

## Freeze the implementation candidate

When the implementation is stable:

1. Call `kanko_map_refresh` with the final working-tree selection. Treat earlier
   evidence marked stale as historical, not current proof.
2. Run the verification appropriate to the change and record current evidence.
3. If verification itself changes tracked or generated content, refresh again,
   then rerun and record the checks whose applicability changed.
4. Add final `AddCodeReference` entries. Let the service bind paths, sides, line
   ranges, content digests, and the current change revision.
5. Add reviewable `AddClaim` entries for observable behavior, compatibility,
   security, reliability, performance, operability, or maintainability. Link
   requirements, code, decisions, risks, and current evidence using stable IDs.
6. Represent missing verification explicitly as evidence with `freshness:
   "missing"` or as an open risk; do not omit it and imply support.

Query created entities to obtain their service-assigned IDs before linking
them. Use explicit relationships when they clarify motivation,
implementation, support, contradiction, mitigation, dependency, or coverage.

## Prepare the ownership handoff

Create a provisional semantic tour plan with `CreateTourPlan`. Each stop should
answer one coherent review question about a behavior, invariant, or design
decision and cover at least one review map entity unless it is explicitly a
context stop. Name it by its purpose, not its filenames. Include the question
and intended understanding in the existing beat narration, with source-backed
context for the relevant entry point, state owner, and behavioral flow.

Use [the learning model](../../docs/tour-learning-model.md) to distinguish
conceptual prerequisites from repository context. Prepare a concise default
route when the reviewer's knowledge is unknown; do not invent familiarity
ratings or interview the implementer as a substitute for the later reviewer.
The `kanko-tour` workflow calibrates the explanation before review begins.
Order prerequisites needed to understand each behavior before its details,
and put real risk or weak evidence where the reviewer will encounter it.
Keep material claim/evidence coverage independent of optional concept lessons.

Use `presentationVersion: 2` and the required
[stop, anchor, and beat contract](../../docs/kanko-v2-tour-model.md). Every stop
needs an id, risk, numbered source-backed anchors, and beats with `{{a:N}}`
narration references and prioritized `active` numbers. Resolve validation
findings; do not substitute unversioned or metadata-only stops.


When authoring each stop:

- Put the change at anchor 1, then list every file the reviewer needs in explanation order.
- Use a role from `change`, `evidence`, `callee`, `caller`, `config`, `schema`, or `context`. Give each anchor a label of at most five words explaining why it is present.
- Include the test or trace supporting a claim as an `evidence` anchor. Link the demonstrated claim with `claimRefs`; a path in prose or an unrelated evidence anchor is not coverage.
- Refer to files in beat narration only with `{{a:N}}`, never raw paths or bare filenames. The editor and terminal render these into numbered file identities.
- Keep each beat focused on one point, with at most three `active` anchors in priority order. Keep all of the stop's anchors in its inventory across beats, with stable numbers.
- Aim for seven or fewer anchors. If more are needed, consider splitting by behavior or separating the change from its callers. The default hard limit is 24, configurable to at most 99; a higher limit is not a reason to make an unfocused stop.
- Use `head` for added or unchanged files, `diff` for modified files, and `base` for deleted code. For renames use the destination path and the exact source pair. Keep context and focus ranges on their declared revision side.
- Resolve validation errors before loading. Address warnings about broad stops, large active sets, and observed claims lacking their own evidence anchor; do not hide weak evidence by changing its truth status.

Issue `MarkPrepared` only after the current review map has:

- a truthful final thesis;
- at least one reviewable claim;
- final code references for the important implementation;
- current or explicitly missing evidence;
- a coherent tour plan.

Then run `kanko_map_check`. If the candidate is stale, refresh and repair the
affected references, evidence, claims, and stops before handoff.

Do not start or complete a review session, mark stops reviewed, accept risk on
the human's behalf, select an approval outcome, or emit a receipt. Those actions
belong to the later `kanko-tour` walkthrough.

In the implementation handoff, report the review map ID, final change identity,
important decisions and remaining risks, verification performed, missing or
stale evidence, and that the change is prepared for an ownership walkthrough.
