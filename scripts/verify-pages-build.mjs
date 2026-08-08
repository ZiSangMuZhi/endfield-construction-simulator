import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const repositoryPath = "/endfield-construction-simulator";
const outputRoot = new URL("../dist/client/", import.meta.url);
const indexUrl = new URL("index.html", outputRoot);
const html = await readFile(indexUrl, "utf8");

assert.match(html, /<title>终末地 · 工业规划台<\/title>/);
assert.match(html, /\/endfield-construction-simulator\/assets\//);
assert.doesNotMatch(html, /(?:src|href)="\/assets\//);

const localReferences = [
  ...html.matchAll(/(?:src|href)="(\/endfield-construction-simulator\/[^"?#]+)"/g),
].map((match) => match[1]);

assert.ok(localReferences.length > 20, "expected the static page to reference bundled scripts and game assets");
for (const reference of new Set(localReferences)) {
  const relativePath = reference.slice(repositoryPath.length + 1);
  await access(new URL(relativePath, outputRoot));
}

console.log(`Verified GitHub Pages export: ${fileURLToPath(indexUrl)} (${new Set(localReferences).size} local assets)`);
