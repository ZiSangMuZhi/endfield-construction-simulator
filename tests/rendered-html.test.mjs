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
  assert.match(html, /游戏设备分类/);
  assert.match(html, /仓储存取/);
  assert.match(html, /合成制造/);
  assert.doesNotMatch(html, /⚡|☼|◐|▶|■/u);
});

test("computes belt headway and route travel time independently", async () => {
  const timing = await import(new URL("../lib/belt-timing.ts", import.meta.url));
  assert.equal(timing.BELT_ITEMS_PER_MINUTE, 30);
  assert.equal(timing.BELT_HEADWAY_TICKS, 20);
  assert.equal(timing.beltTravelTicks(1), 20);
  assert.equal(timing.beltTravelTicks(4), 80);
  assert.equal(timing.beltTravelSeconds(4), 8);
  assert.equal(timing.nextLaneReadyTick(7), 27);
  assert.equal(timing.transitProgress(10, 80, 50), 0.5);
  assert.throws(() => timing.beltTravelTicks(0), RangeError);
});

test("keeps the current pass belt-only with editable routes and real inventory flow", async () => {
  const [page, css, timing] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/belt-timing.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /kind: "powerPole"[\s\S]*?2×2 · 供电范围 12×12/);
  assert.match(page, /gearAssembler:\{width:4,height:6,inputs:edgePorts\(6,2,0\),outputs:edgePorts\(6,0,3\)\}/);
  assert.match(page, /gearAssembler:\{name:"装备原件机"[\s\S]*?durationTicks:100\}/);
  assert.match(page, /refiner:\{name:"精炼炉"[\s\S]*?durationTicks:20\}/);
  assert.match(page, /status:[\s\S]*?"unpowered"/);
  assert.match(page, /getFlowRoutes\(grid, "belt"\)/);
  assert.doesNotMatch(page, /\{ kind: "pipe", label:/);
  assert.doesNotMatch(page, /\{ kind: "tank", label:/);
  assert.match(page, /const EQUIPMENT_LAYOUTS/);
  assert.match(page, /layout\.inputs\.forEach/);
  assert.match(page, /layout\.outputs\.forEach/);
  assert.match(page, /className="transport-tooltip"/);
  assert.match(page, /供电范围 12×12 · 规划参考/);
  assert.match(page, /findAutoPath\(start,point,cols,rows,blocked\)/);
  assert.match(page, /按 E 或 Esc 完成/);
  assert.match(page, /routeCursor\[sourceId\]/);
  assert.match(page, /laneReadyAt\[route\.id\]=nextLaneReadyTick\(tick\)/);
  assert.match(page, /travelTicks=beltTravelTicks\(route\.cells\.length\)/);
  assert.match(page, /Math\.min\(stock,ordered\.length\)/);
  assert.match(page, /simulation\.transits\.filter/);
  assert.match(page, /stalledRouteIds/);
  assert.match(page, /sourceType:"route"/);
  assert.match(page, /setSelectedTransportKey\(keyOf\(x,y\)\)/);
  assert.match(page, /onWheel=\{e=>\{e\.preventDefault\(\)/);
  assert.match(page, /aria-label="放入数量"/);
  assert.match(page, /放入输入库存/);
  assert.match(page, /className="delete-action"/);
  assert.match(page, /key === "delete"\|\|key === "backspace"/);
  assert.match(page, /DEVICE_CATEGORIES:DeviceCategory\[\]=\["全部","资源开采","仓储存取","基础生产","合成制造","电力供应","功能设备","战斗辅助","种植调配"\]/);
  assert.match(page, /仓库取货口输出物品/);
  assert.match(page, /INDUSTRIAL_ITEMS/);
  assert.match(page, /className="transport-tooltip"/);
  assert.match(css, /border-color:transparent/);
  assert.match(css, /\.cell\.belt:hover \.transport-tooltip/);
  assert.match(css, /\.draft-waypoint/);
  assert.match(css, /\.port-marker\.snap-target/);
  assert.match(css, /\.placement-snap/);
  assert.match(css, /\.device-menu/);
  assert.match(css, /\.cell-glyph\.root\.inventory-full/);
  assert.match(css, /\.editor-tools/);
  assert.match(css, /\.device-tabs/);
  assert.match(timing, /BELT_ITEMS_PER_MINUTE = 30/);
  assert.match(timing, /BELT_CELL_TRAVEL_TICKS = BELT_HEADWAY_TICKS/);
  assert.match(timing, /return cellCount \* BELT_CELL_TRAVEL_TICKS/);
  await access(new URL("../public/assets/machines/supply-pole.webp", import.meta.url));
  await access(new URL("../public/assets/machines/gear-assembler.svg", import.meta.url));
  await access(new URL("../public/assets/machines/storage-port.svg", import.meta.url));
  await access(new URL("../public/assets/machines/splitter.svg", import.meta.url));
  await access(new URL("../public/assets/machines/merger.svg", import.meta.url));
  await access(new URL("../public/assets/items/crystal-shell.svg", import.meta.url));
  await access(new URL("../public/assets/items/purple-equipment-component.svg", import.meta.url));
  await access(new URL("../public/assets/items/purple-crystal-ore.svg", import.meta.url));
  await access(new URL("../public/assets/items/red-copper-ore.svg", import.meta.url));
});
