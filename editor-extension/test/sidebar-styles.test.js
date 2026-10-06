"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path");
const { spawnSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const browser = process.env.KANKO_BROWSER;

test(
  "sidebar chips and fonts survive missing theme values and honor theme overrides",
  { skip: !browser && "Set KANKO_BROWSER to a Chromium executable" },
  () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanko-styles-"));
    try {
      fs.copyFileSync(
        path.join(__dirname, "../media/tour.css"),
        path.join(root, "tour.css"),
      );
      const html = `<!doctype html><html><head>
      <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src file:; script-src 'nonce-check';">
      <link rel="stylesheet" href="tour.css"></head><body>
      <div class="filename">source.js</div><div class="anchor-row current-beat"></div>
      ${Array.from({ length: 6 }, (_, i) => `<button class="chip color-${i + 1}">${i + 1}</button>`).join("")}
      <script nonce="check">
      const result = [];
      for (const theme of ['vscode-dark', 'vscode-light', 'vscode-high-contrast', 'vscode-high-contrast-light']) {
        document.body.className = theme;
        result.push({theme, colors: [...document.querySelectorAll('.chip')].map(e => getComputedStyle(e).backgroundColor),
          foreground: getComputedStyle(document.querySelector('.chip')).color,
          font: getComputedStyle(document.querySelector('.filename')).fontFamily,
          highlight: getComputedStyle(document.querySelector('.current-beat')).backgroundColor});
      }
      document.documentElement.style.setProperty('--vscode-kanko-anchor1', '#123456');
      document.documentElement.style.setProperty('--vscode-editor-font-family', 'CustomEditor');
      result.push({color: getComputedStyle(document.querySelector('.chip')).backgroundColor,
        font: getComputedStyle(document.querySelector('.filename')).fontFamily});
      const output = document.createElement('pre'); output.id = 'results'; output.textContent = JSON.stringify(result); document.body.append(output);
      </script></body></html>`;
      fs.writeFileSync(path.join(root, "index.html"), html);
      const run = spawnSync(
        browser,
        [
          "--headless",
          "--no-sandbox",
          "--disable-gpu",
          `--user-data-dir=${path.join(root, "profile")}`,
          "--allow-file-access-from-files",
          "--dump-dom",
          pathToFileURL(path.join(root, "index.html")).href,
        ],
        { encoding: "utf8", timeout: 30000 },
      );
      assert.equal(run.status, 0, run.stderr);
      const results = JSON.parse(
        run.stdout.match(/<pre id="results">(.*?)<\/pre>/s)?.[1] || "null",
      );
      assert.ok(results, run.stdout);
      const manifest = require("../package.json");
      const rgb = (hex) =>
        `rgb(${hex
          .slice(1)
          .match(/../g)
          .map((n) => parseInt(n, 16))
          .join(", ")})`;
      for (const r of results.slice(0, 4)) {
        const theme = r.theme.includes("light")
          ? "light"
          : r.theme.includes("high-contrast")
            ? "highContrast"
            : "dark";
        assert.deepEqual(
          r.colors,
          Array.from({ length: 6 }, (_, i) =>
            rgb(
              manifest.contributes.colors.find(
                (c) => c.id === `kanko.anchor${i + 1}`,
              ).defaults[theme],
            ),
          ),
        );
        assert.match(r.font, /monospace/);
        assert.equal(
          r.foreground,
          r.theme.includes("light") ? "rgb(255, 255, 255)" : "rgb(24, 24, 24)",
        );
        assert.notEqual(r.highlight, "rgba(0, 0, 0, 0)");
      }
      assert.equal(results[4].color, "rgb(18, 52, 86)");
      assert.match(results[4].font, /CustomEditor.*monospace/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
