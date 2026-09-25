# Changelog

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
