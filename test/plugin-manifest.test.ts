import { record, records } from "./assertions.js";
import { test } from "node:test";
import * as assert from "node:assert";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.join(__dirname, "..");
const readJson = (p: string) =>
  record(JSON.parse(fs.readFileSync(path.join(root, p), "utf8")));

test("marketplace declares the kanko plugin from the repo root", () => {
  const m = readJson(".claude-plugin/marketplace.json");
  assert.strictEqual(m.name, "kanko");
  const plugin = records(m.plugins).find((p) => p.name === "kanko");
  assert.ok(plugin, "kanko plugin missing from marketplace");
  assert.strictEqual(plugin.source, "./");
});

test("plugin.json name matches the marketplace entry", () => {
  assert.strictEqual(readJson(".claude-plugin/plugin.json").name, "kanko");
});

// Claude Code reads neither the portable mcp.json nor ${PLUGIN_ROOT}.
test("Claude Code manifest registers the MCP server", () => {
  const plugin = readJson(".claude-plugin/plugin.json");
  assert.deepStrictEqual(record(plugin.mcpServers)["kanko"], {
    command: "node",
    args: ["${CLAUDE_PLUGIN_ROOT}/mcp/server.js"],
  });
  assert.ok(
    !fs.existsSync(path.join(root, ".mcp.json")),
    ".mcp.json would also be read by Codex and register the server twice",
  );
});

test("Codex uses a portable manifest and MCP configuration", () => {
  const plugin = readJson("plugin.json");
  const mcp = readJson("mcp.json");
  const compatibility = readJson(".codex-plugin/plugin.json");

  assert.strictEqual(
    plugin.$schema,
    "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  );
  assert.strictEqual(plugin.name, "kanko");
  assert.strictEqual(compatibility.name, plugin.name);
  assert.strictEqual(compatibility.skills, "./skills/");

  assert.strictEqual(
    mcp.$schema,
    "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  );
  assert.deepStrictEqual(record(mcp.mcpServers)["kanko"], {
    type: "stdio",
    command: "node",
    args: ["${PLUGIN_ROOT}/mcp/server.js"],
  });
});

test("skill lives in a directory matching its frontmatter name", () => {
  const body = fs.readFileSync(
    path.join(root, "skills/kanko-tour/SKILL.md"),
    "utf8",
  );
  assert.match(body, /^name: kanko-tour$/m);
  const development = fs.readFileSync(
    path.join(root, "skills/kanko-build/SKILL.md"),
    "utf8",
  );
  assert.match(development, /^name: kanko-build$/m);
});

test("skill is generalized: no personal name, no sibling-skill slash references", () => {
  const body = fs.readFileSync(
    path.join(root, "skills/kanko-tour/SKILL.md"),
    "utf8",
  );
  assert.doesNotMatch(body, /\bEric\b/);
  assert.doesNotMatch(body, /\/code-review|address-coderabbit/);
});

test("the old root-level SKILL.md is gone", () => {
  assert.strictEqual(fs.existsSync(path.join(root, "SKILL.md")), false);
});
