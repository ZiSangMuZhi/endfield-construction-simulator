import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the belt-first blueprint planner", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>终末地 · 工业规划台<\/title>/);
  assert.match(html, /传送带/);
  assert.match(html, /固体 · 30\/min/);
  assert.match(html, /供电桩/);
  assert.match(html, /供电范围 12×12/);
  assert.match(html, /精炼炉/);
  assert.match(html, /配件机/);
  assert.doesNotMatch(html, /⚡|☼|◐|▶|■/u);
});

test("keeps the current pass belt-only and equipment surfaces unified", async () => {
  const [page, css] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  assert.match(page, /kind: "powerPole"[\s\S]*?2×2 · 供电范围 12×12/);
  assert.match(page, /const width = selected[\s\S]*?selected === "powerPole" \? 2/);
  assert.match(page, /status:[\s\S]*?"unpowered"/);
  assert.match(page, /getFlowRoutes\(grid, "belt"\)/);
  assert.doesNotMatch(page, /\{ kind: "pipe", label:/);
  assert.doesNotMatch(page, /\{ kind: "tank", label:/);
  assert.match(page, /sideHasCell\(inputSide\)&&sideCenterCell\(inputSide\)/);
  assert.match(page, /className="transport-tooltip"/);
  assert.match(css, /border-color:transparent/);
  assert.match(css, /\.cell\.belt:hover \.transport-tooltip/);
  await access(new URL("../public/assets/machines/supply-pole.webp", import.meta.url));
});
