"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), os = require("node:os"), path = require("node:path");
const { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, "../..");

for (const stale of [false, true]) test(`installer builds and validates current assets ${stale ? "over an existing VSIX" : "on first install"}`, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanko-install-"));
  try {
    const bin = path.join(root, "bin"), ext = path.join(root, "editor-extension");
    fs.mkdirSync(bin); fs.mkdirSync(ext);
    fs.copyFileSync(path.join(repo, "install.sh"), path.join(root, "install.sh"));
    fs.cpSync(path.join(repo, "scripts"), path.join(root, "scripts"), {recursive: true});
    for (const file of ["package.json", "package-lock.json", "CHANGELOG.md", "LICENSE", "README.md", "extension.js", "media/tour.css", "assets/kanko-icon-256.png", "assets/kanko-sidebar.svg"]) {
      fs.mkdirSync(path.dirname(path.join(ext, file)), {recursive: true});
      fs.copyFileSync(path.join(repo, "editor-extension", file), path.join(ext, file));
    }
    fs.copyFileSync(path.join(repo, "LICENSE"), path.join(root, "LICENSE"));
    const manifest = require("../package.json"), vsix = path.join(ext, `${manifest.name}-${manifest.version}.vsix`);
    if (stale) fs.writeFileSync(vsix, "stale archive");
    // Replace network/package tooling, but run the real release and archive validators.
    fs.writeFileSync(path.join(bin, "npm"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$INSTALL_LOG"
if [ "$1" = ci ]; then
  [ "$2" = --include=dev ]
elif [ "$*" = 'run package' ]; then
  python3 - <<'PY'
import json, pathlib, zipfile
p = json.loads(pathlib.Path('package.json').read_text())
with zipfile.ZipFile(p['name'] + '-' + p['version'] + '.vsix', 'w') as z:
    for f in pathlib.Path('.').rglob('*'):
        if f.is_file() and f.suffix != '.vsix':
            name = {'README.md':'readme.md', 'CHANGELOG.md':'changelog.md', 'LICENSE':'LICENSE.txt'}.get(str(f), str(f))
            if name != 'package-lock.json': z.write(f, 'extension/' + name)
    z.writestr('[Content_Types].xml', '')
    z.writestr('extension.vsixmanifest', '')
PY
else
  exit 1
fi
`, {mode: 0o755});
    fs.writeFileSync(path.join(bin, "code"), '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$INSTALL_LOG"\n', {mode: 0o755});
    const log = path.join(root, "install.log");
    const result = spawnSync("bash", [path.join(root, "install.sh")], {cwd: os.tmpdir(), env: {...process.env, PATH: `${bin}:${process.env.PATH}`, INSTALL_LOG: log, NODE_ENV: "production"}, encoding: "utf8"});
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, /Validated .*\.vsix/);
    assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), ["ci --include=dev", "run package", `--install-extension ${vsix} --force`]);
  } finally { fs.rmSync(root, {recursive: true, force: true}); }
});
