# Changelog

## 0.1.2

- Show agent-drawn diagrams (flow, sequence, state, data flow, timeline) under
  the beat narration, highlighted by beat and linked node by node to code.
- Open a diagram beside the code with Before, After, and Diff views, Follow
  tour, and a beat strip.
- Stream requested diagrams into a detour; pin them to a stop for future
  reviewers.
- Mark diagrams derived, inferred, or stale; describe any diagram as text.
- Add `kanko.diagrams.mode`, `maxPerStop`, `derivedOnly`, and `openBeside`,
  and the `kanko.attention` color.
- Bridge protocol 4 adds diagram and reviewer-event endpoints.
- Restrict release tags by channel: candidate versions from `dev`, stable versions from `main`.
- Accept SemVer prerelease versions in version checks and bumps.

## 0.1.1

- Compile the extension and MCP runtime from TypeScript, with a React tour sidebar.
- Share one release version across the extension, plugins, and MCP runtime.
- Add a synchronized version bump command and `vX.Y.Z` release tags.

## 0.1.1-rc1

- Keep sidebar anchor chips and fonts visible when host theme values are missing.
- Rebuild and validate current extension assets on every local install, including
  development packaging tools under production npm settings.

## 0.1.0

- Initial Kankō extension release under the `getkankodev.kanko` identity.
- Guided code tours with file navigation, range highlighting, and editor citations.
- Native multi-file diffs with presenter controls and removed-code companions.
- Kankō branding with settings, colors, commands, and revision URIs in the
  `kanko` namespace.
- Authenticated local connection through `~/.kanko/tour` using bridge protocol 3.
- Paired `kanko-build` and `kanko-tour` skills with `kanko_tour_*` and
  `kanko_map_*` agent tools.
