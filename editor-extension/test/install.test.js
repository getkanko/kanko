"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const repo = path.resolve(__dirname, "../..");

test("setup installs development tooling under production npm settings", () => {
  assert.match(
    fs.readFileSync(path.join(repo, "Makefile"), "utf8"),
    /npm --prefix editor-extension ci --include=dev/,
  );
});

for (const stale of [false, true])
  test(`installer rebuilds current assets ${stale ? "over an existing VSIX" : "on first install"}`, () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanko-install-"));
    try {
      const bin = path.join(root, "bin"),
        ext = path.join(root, "editor-extension");
      fs.mkdirSync(bin);
      fs.mkdirSync(ext);
      fs.copyFileSync(
        path.join(repo, "install.sh"),
        path.join(root, "install.sh"),
      );
      fs.cpSync(path.join(repo, "scripts"), path.join(root, "scripts"), {
        recursive: true,
      });
      fs.copyFileSync(
        path.join(repo, "editor-extension/package.json"),
        path.join(ext, "package.json"),
      );
      const manifest = require("../package.json"),
        vsix = path.join(ext, `${manifest.name}-${manifest.version}.vsix`);
      if (stale) fs.writeFileSync(vsix, "stale archive");
      const record =
        '#!/usr/bin/env bash\nprintf "%s\\n" "$*" >> "$INSTALL_LOG"\n';
      fs.writeFileSync(path.join(bin, "make"), record, { mode: 0o755 });
      fs.writeFileSync(path.join(bin, "code"), record, { mode: 0o755 });
      const log = path.join(root, "install.log");
      const result = spawnSync("bash", [path.join(root, "install.sh")], {
        cwd: os.tmpdir(),
        env: {
          ...process.env,
          PATH: `${bin}:${process.env.PATH}`,
          INSTALL_LOG: log,
          NODE_ENV: "production",
        },
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.deepEqual(fs.readFileSync(log, "utf8").trim().split("\n"), [
        `-C ${root} rebuild`,
        `--install-extension ${vsix} --force`,
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
