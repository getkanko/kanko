# Reviewer-adapted tour prototype

The objective is to help a reviewer accurately reason about a change with less
unnecessary explanation. This prototype changes tour authoring and narration
within the existing v2 contract. It does not add a questionnaire UI, profile
storage, new MCP commands, or schema fields. Learning effectiveness remains
an empirical question; native editor QA verifies presentation compatibility,
not human learning.

## Calibrate before planning the final route

Inspect the change first so the questionnaire names its actual problem,
subsystem, and up to three relevant concepts. Offer the four questions together
and aim for about a minute of effort. Free-text and partial answers are valid.

| Dimension | Prompt | Choices |
| --- | --- | --- |
| Problem | How familiar are you with **[problem]**? | Need an introduction / understand the problem / know its constraints and edge cases |
| Concepts | How much explanation would help for **[concepts]**? | For each: new to me / know the idea / have applied it |
| Repository | How familiar are you with **[subsystem]**? | New to this code / know the main flow / have worked on it |
| Goal | What should this tour help you do? | Evaluate correctness / evaluate design / learn the implementation; combinations welcome |

Explain what the answers change. Do not infer familiarity from job title or
years of experience. Reuse explicit session context instead of asking again.
If the reviewer asks to start or skips questions, proceed with a concise
orientation and offer more explanation where prerequisites may be unfamiliar.
Silence and an unanswered dimension mean unknown, not expert or novice.

## Route each dimension independently

| Answer | Adaptation |
| --- | --- |
| Problem unfamiliar | Explain the triggering scenario, desired outcome, and relevant constraints. |
| Problem familiar | Briefly confirm the change's specific outcome and constraints; shorten the domain lesson. |
| Concept new | Work through a concrete case, explain the general rule, and connect it to the code. |
| Concept recognized | Give a brief reminder tied to this change; offer an example. |
| Concept applied | Compress the concept lesson; explain this implementation's choices and exceptions. |
| Repository unfamiliar | Map the relevant entry point, state owner, callers, and control/data flow with source anchors. |
| Repository familiar | Orient to the changed boundary and any surprising connections. |
| Correctness goal | Emphasize invariants, failure paths, evidence, and evidence limits. |
| Design goal | Emphasize boundaries, tradeoffs, alternatives, and consequences. |
| Learning goal | Offer additional examples and optional reasoning prompts. |

Goal changes emphasis, not which material concerns are disclosed. A concept
expert can still need repository orientation; a repository maintainer can still
need an explanation of a new concept. Update the explanation when the reviewer
corrects a familiarity assumption or asks for more or less depth.

Use answers only in the session. A future saved profile would need topic and
repository scope, the basis and date of each entry, and easy correction. Such
storage is deferred until the prototype demonstrates value. Do not put personal
familiarity ratings into shared review-map entities or receipts.

## Plan by review question

For each stop, identify:

- **Review question:** the judgment this stop enables.
- **Expected understanding:** what the reviewer should be able to explain or
  predict afterward.
- **Prerequisites:** relevant concepts and local code relationships, considered
  separately against the questionnaire answers.
- **Context justification:** why each unchanged-code anchor helps answer the
  question; omit background that serves no current understanding need.
- **Coverage:** the claims, risks, evidence, and limitations that must remain
  inspectable whatever the reviewer already knows.

These are authoring responsibilities, not new JSON fields. Put the review
question and intended understanding in ordinary beat narration. Use the v2
anchors and `{{a:N}}` citations for code, and normal entity links for coverage.
Keep operational anchor limits; they are not experimentally established limits
on human working memory.

Start with a small map of the relevant behavior. Order subsequent stops by the
reviewer's understanding prerequisites. A failure scenario can motivate a new
type before the type's details are explained. Each stop should answer one
coherent question; it may span files. Avoid sweeping unrelated changes into a
stop simply to make its title sound conceptual.

Build-authored plans are provisional until the reviewer is calibrated. Adapt
them before starting a review session, retaining ids for unchanged questions
and coverage. Within an active or resumed tour, adjust explanatory depth in
the current plan rather than replacing it just to personalize narration.
Follow the ordinary freshness and refresh procedure if the code changes.

For unfamiliar concepts, a useful sequence is a concrete case, the general
rule it illustrates, then the code and evidence. Compare cases when the shared
relationship helps explain an abstraction, and state the comparison's limits.
For familiar concepts, compress that sequence. Avoid turning these planning
responsibilities into a fixed recital for every stop.

Offer a prediction or reasoning prompt at a significant conceptual boundary,
not every beat. An unexpected answer is a reason to revisit a prerequisite.
Prompts are optional and are not a prerequisite for navigation or review.
No answer is implementation evidence. Familiarity, comprehension, presentation,
review acknowledgement, and approval are distinct; follow the existing review
state rules rather than deriving outcomes from a prompt or navigation action.

## Worked example: preserve a review on invalid load

This example uses the existing source-backed native-editor fixture at
`editor-extension/test/tour-fixture/create.js`. Its changed `service.js` retains
the current tour when validation fails; `service.test.js` checks the retained
object and rejection result. The fixture is illustrative, not production code.

Questionnaire topics: replacing a live tour safely (problem), validation before
mutation and preserving state on failure (concepts), the tour-loading subsystem
(repository), and the review goal.

The stop's review question is: **Does a rejected candidate preserve the current
tour?** Expected understanding: trace both the rejected and accepted paths and
identify what the test proves about the retained state.

| Reviewer | Route |
| --- | --- |
| Concept unfamiliar; code unfamiliar | Explain candidate/current state, trace an invalid candidate, extract the rule "validate before replacement," locate the guard, and inspect the regression. |
| Concept applied; code unfamiliar | Briefly connect to validation before mutation, map the loader's input/output and state ownership, then inspect the guard and regression. |
| Concept applied; code familiar | Confirm the changed rejection boundary, inspect its assertion and accepted path, and discuss evidence limits. |

All routes preserve the same claim and evidence coverage. A concept lesson can
be shortened without treating that claim as reviewed.

An authored v2 stop can use these beats (anchor 1: changed loader; anchor 2:
regression test with the claim in `claimRefs`):

```json
[
  {
    "id": "question",
    "narration": "**Does rejection preserve the current tour?** Trace the rejected and accepted paths in {{a:1}} so you can explain when replacement is allowed.",
    "active": [1]
  },
  {
    "id": "case",
    "narration": "**Concrete case.** A candidate has a missing anchor while a tour is already active. {{a:1}} returns the current tour on the error path. The rule is to validate before replacement.",
    "active": [1]
  },
  {
    "id": "evidence",
    "narration": "**Check the claim.** {{a:2}} asserts rejection and the identity of the retained object; it also exercises acceptance. This fixture does not establish that every production editor side effect is preserved. Optional: what should be returned if validation finds an error?",
    "active": [2, 1]
  }
]
```

For a concept-familiar reviewer, compress the `case` explanation before the
session starts. Keep the evidence and its limitation. The example is a beat
array, not a complete loadable plan: the fixture supplies verified source
revisions, hashes, ranges, anchors, and claim coverage.

## Research basis and uncertainty

These findings inform the prototype; they do not prove an optimal professional
review sequence. The sources below are papers or author/publisher copies.

| Study | Finding | Design implication and limit |
| --- | --- | --- |
| [Tetzlaff et al., 2025, expertise reversal meta-analysis](https://www.sciencedirect.com/science/article/pii/S0959475225000660) | Across 60 experiments and 5,924 participants, high assistance benefited low-prior-knowledge learners (d = 0.505); low assistance benefited high-prior-knowledge learners (high-assistance contrast d = -0.428). Results varied across domains. | Calibrate topic knowledge and vary assistance. These effect sizes are learning outcomes, not expected reductions in review time. |
| [Gentner, Loewenstein & Thompson, 2003](https://groups.psych.northwestern.edu/gentner/papers/GentnerLoewensteinThompson03.pdf) | Comparing cases supported schema abstraction and transfer in three negotiation-learning experiments. | Explicitly compare relationships when explaining abstractions. Transfer to code review is a hypothesis. |
| [Margulieux & Catrambone, 2016](https://bpb-us-e1.wpmucdn.com/sites.gatech.edu/dist/b/1555/files/2020/09/MargulieuxandCatrambone2016.pdf) | Subgoal labels in text and worked examples helped novice programming learners solve novel problems. | Label stops by functional purpose. The experiments concern programming education, not professional diff tours. |
| [Margulieux, Morrison & Decker, 2020](https://link.springer.com/article/10.1186/s40594-020-00222-7) | In a study of 265 introductory programming students, subgoal instruction improved quizzes and reduced withdrawal/failure, but did not significantly improve mean exam performance. | Supports trying purpose-based organization while limiting claims about lasting learning. |
| [Bielaczyc, Pirolli & Brown, 1995](https://www.tandfonline.com/doi/abs/10.1207/s1532690xci1302_3) | Training in self-explanation and self-regulation improved performance gains among 24 students with no programming experience. | Offer reasoning prompts. The combined intervention does not isolate the effect of a single tour question. |
| [Sillito, Murphy & De Volder, 2006](https://www.cs.ubc.ca/~murphy/papers/other/asking-answering-fse06.pdf) | Two observational studies cataloged 44 kinds of questions programmers asked during software changes, including relationships across code locations. | Include unchanged context needed for the review question. This is observational evidence, not a tour-format experiment. |
| [Bacchelli & Bird, 2013](https://www.microsoft.com/en-us/research/publication/expectations-outcomes-and-challenges-of-modern-code-review/) | Industrial code-review research identified code/change understanding as a central challenge. | Evaluate accurate understanding alongside elapsed time; the study does not test this prototype. |

## Pilot procedure

Before adding permanent profile or learning-plan fields, compare the previous
tour workflow with the adapted workflow on representative changes: one local
behavior fix, one change crossing components, and one unfamiliar abstraction.
Use real reviewers with different domain and repository familiarity. An agent
can check routing and editor compatibility, but cannot establish human learning
benefits by simulating both reviewers.

For each diff, prepare equivalent claims, risks, evidence, and limitations for
both conditions. Use different changes for a reviewer's repeated sessions and
counterbalance condition order so prior exposure and fatigue do not consistently
favor one route. Record the questionnaire cost in total session time.

Predefine a short answer rubric for each change: triggering behavior, changed
mechanism, relevant invariant, one unseen edge case, and the scope/limits of
evidence. Ask the same outcome questions in both conditions. Score correctness
against that rubric, ideally without the scorer knowing the tour condition.

Record time to an accurate explanation, edge-case prediction accuracy, ability
to locate the mechanism and evidence limits, requests for missing context,
unnecessary explanations reported by the reviewer, and missed material concerns.
If sustained learning matters, also use a later transfer question rather than
inferring retention from immediate performance.

Treat initial sessions as formative: identify routing failures and revise the
questionnaire before drawing effectiveness conclusions. Faster completion only
counts as an improvement when understanding and material review coverage are
maintained. Publish neither an effect-size claim nor a fixed time-saving target
from an unpowered convenience pilot. Human pilot results are pending.

## Prototype verification (2026-10-04)

Both revised skills pass the skill frontmatter/scaffold validator. The targeted
plugin-manifest, tour-contract, and tour-view suites pass all 50 tests. Local
documentation links resolve and `git diff --check` passes.

Two routes built from the native fixture pass source-backed v2 validation with
no findings: three beats for an unfamiliar concept, and two for a familiar
concept with unfamiliar code. Both retain the same claim coverage and
claim-specific evidence anchor. This checks contract compatibility, not whether
an agent reliably chooses the right route or whether a human learns faster.

Native visual QA is incomplete. The cached VS Code 1.140.0 candidate repeatedly
exited with SIGSEGV (139) before extension registration on this WSL2 host.
A virtual display was verified with `xdpyinfo`; alternate launches with
`--no-sandbox`, explicit X11, and disabled shared-memory/crash-reporter options
also failed. No screenshots or UI transition checks were obtained. The missing
scenarios are initial orientation, the unfamiliar-concept example, the shorter
familiar-concept route, and navigation to their shared evidence beat. Rerun
those scenarios in a working isolated native editor before claiming full
presentation verification.
