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
  assert.match(html, /流体 · 120\/min/);
  assert.match(html, /供电桩/);
  assert.match(html, /供电范围 12×12/);
  assert.match(html, /精炼炉/);
  assert.match(html, /配件机/);
  assert.match(html, /塑形机/);
  assert.match(html, /灌装机/);
  assert.match(html, /反应池/);
  assert.match(html, /水泵/);
  assert.match(html, /游戏设备分类/);
  assert.match(html, /仓储存取/);
  assert.match(html, /合成制造/);
  assert.doesNotMatch(html, /⚡|☼|◐|▶|■/u);
});

test("computes belt headway and route travel time independently", async () => {
  const timing = await import(new URL("../lib/belt-timing.ts", import.meta.url));
  assert.equal(timing.BELT_ITEMS_PER_MINUTE, 30);
  assert.equal(timing.SIM_TICK_MS, 250);
  assert.equal(timing.BELT_HEADWAY_TICKS, 8);
  assert.equal(timing.PIPE_ITEMS_PER_MINUTE, 120);
  assert.equal(timing.PIPE_HEADWAY_TICKS, 2);
  assert.equal(timing.beltTravelTicks(1), 8);
  assert.equal(timing.beltTravelTicks(4), 32);
  assert.equal(timing.beltTravelSeconds(4), 8);
  assert.equal(timing.nextLaneReadyTick(7), 15);
  assert.equal(timing.transitProgress(10, 80, 50), 0.5);
  assert.throws(() => timing.beltTravelTicks(0), RangeError);
});

test("fills an open-ended belt one item per cell and releases after downstream recovery", async () => {
  const timing = await import(new URL("../lib/belt-timing.ts", import.meta.url));
  let lane=[];
  let nextDispatch=0;
  for(let tick=0;tick<96;tick++){
    lane=timing.advanceBeltLane(lane,4,false).active;
    if(tick>=nextDispatch&&timing.beltLaneCanAccept(lane,4)){
      lane.push({id:`cargo-${tick}`,position:0,previousPosition:0});
      nextDispatch=tick+timing.BELT_HEADWAY_TICKS;
    }
  }
  assert.equal(lane.length,4);
  assert.equal(timing.beltLaneIsFull(lane,4),true);
  assert.deepEqual(lane.map((item)=>item.position).sort((a,b)=>a-b),[0.5,1.5,2.5,3.5]);
  let delivered=0;
  for(let tick=0;tick<4;tick++){
    const result=timing.advanceBeltLane(lane,4,true);
    lane=result.active;delivered+=result.delivered.length;
  }
  assert.equal(delivered,1);
  assert.equal(lane.length,3);
});

test("separates transport throughput from visual packing distance", async () => {
  const timing = await import(new URL("../lib/belt-timing.ts", import.meta.url));
  let lane=[];
  for(let tick=0;tick<8;tick++)lane=timing.advanceBeltLane(lane,8,true).active;
  assert.equal(timing.beltLaneCanAccept(lane,8),true);
  let pipe=[];
  for(let tick=0;tick<64;tick++){
    pipe=timing.advancePipeLane(pipe,2,false).active;
    if(tick%timing.PIPE_HEADWAY_TICKS===0&&timing.pipeLaneCanAccept(pipe,2))pipe.push({position:0,previousPosition:0});
  }
  assert.equal(pipe.length,8);
  assert.equal(timing.pipeLaneIsFull(pipe,2),true);
});

test("maps the long-press radial gesture to stable directional actions", async () => {
  const radial = await import(new URL("../lib/radial-menu.ts", import.meta.url));
  assert.equal(radial.RADIAL_HOLD_DELAY_MS, 420);
  assert.equal(radial.RADIAL_CONFIRM_DELAY_MS, 210);
  assert.equal(radial.radialSelection(0, -50).action, "rotate");
  assert.equal(radial.radialSelection(50, 0).action, "move");
  assert.equal(radial.radialSelection(0, 50).action, "copy");
  assert.equal(radial.radialSelection(-50, 0).action, "delete");
  assert.equal(radial.radialSelection(8, 8).action, null);
});

test("supports layered belt and pipe planning with draggable facilities", async () => {
  const [page, css, timing] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/belt-timing.ts", import.meta.url), "utf8"),
  ]);

  assert.match(page, /kind: "powerPole"[\s\S]*?2×2 · 供电范围 12×12/);
  assert.match(page, /gearAssembler:\{width:4,height:6,inputs:edgePorts\(6,2,0\),outputs:edgePorts\(6,0,3\)\}/);
  assert.match(page, /gearAssembler:\{name:"装备原件机"[\s\S]*?durationTicks:secondsToTicks\(10\)\}/);
  assert.match(page, /refiner:\{name:"精炼炉"[\s\S]*?durationTicks:secondsToTicks\(2\)\}/);
  assert.match(page, /fitter:\{name:"配件机"[\s\S]*?durationTicks:secondsToTicks\(2\)\}/);
  assert.match(page, /status:[\s\S]*?"unpowered"/);
  assert.match(page, /getFlowRoutes\(grid, "belt"\)/);
  assert.match(page, /\{ kind: "pipe", label: "管道"/);
  assert.doesNotMatch(page, /\{ kind: "tank", label:/);
  assert.match(page, /const EQUIPMENT_LAYOUTS/);
  assert.match(page, /layout\.inputs\.forEach/);
  assert.match(page, /layout\.outputs\.forEach/);
  assert.match(page, /className="transport-tooltip"/);
  assert.match(page, /供电范围 12×12 · 规划参考/);
  assert.match(page, /findAutoPath\(start,point,cols,rows,blocked\)/);
  assert.match(page, /按 E 或 Esc 完成/);
  assert.match(page, /routeCursor\[sourceId\]/);
  assert.match(page, /laneReadyAt\[route\.id\]=nextLaneReadyTick\(tick,route\.kind==="pipe"\?PIPE_HEADWAY_TICKS:BELT_HEADWAY_TICKS\)/);
  assert.match(page, /advanceBeltLane\(lane,route\.cells\.length,canExit\)/);
  assert.match(page, /valid:Boolean\(sourcePort\)/);
  assert.match(page, /beltLaneCanAccept\(activeByRoute\.get\(route\.id\)\?\?\[\],route\.cells\.length\)/);
  assert.match(page, /const available=\{\.\.\.sourceBucket\}/);
  assert.match(page, /available\[itemId\]=stock-1/);
  assert.match(page, /previous\.transits\.filter/);
  assert.match(page, /stalledRouteIds/);
  assert.match(page, /sourceType:"route"/);
  assert.match(page, /setSelectedTransportKey\(key\)/);
  assert.match(page, /onWheel=\{e=>\{e\.preventDefault\(\)/);
  assert.match(page, /aria-label="放入数量"/);
  assert.match(page, /放入输入库存/);
  assert.match(page, /className="delete-action"/);
  assert.match(page, /startDeviceRadial/);
  assert.match(page, /setPointerCapture/);
  assert.match(page, /phase:"confirming"/);
  assert.match(page, /liveDraftRoute/);
  assert.match(page, /startBeltReplan/);
  assert.match(page, /replaceKeys:route\.cells\.slice\(index\+1\)/);
  assert.match(page, /findAutoPath\(start,target,cols,rows,blocked\)/);
  assert.match(page, /requestAnimationFrame\(animate\)/);
  assert.match(page, /function CargoRouteSprites/);
  assert.match(page, /data-position=\{transit\.position\.toFixed\("?3"?\)\}/);
  assert.doesNotMatch(page, /animateMotion/);
  assert.match(page, /key === "delete"\|\|key === "backspace"/);
  assert.match(page, /DEVICE_CATEGORIES:DeviceCategory\[\]=\["全部","资源开采","仓储存取","基础生产","合成制造","电力供应","功能设备","战斗辅助","种植调配"\]/);
  assert.match(page, /仓库取货口输出物品/);
  assert.match(page, /draggable className/);
  assert.match(page, /onDragOver=/);
  assert.match(page, /onDrop=/);
  assert.match(page, /const \[pipeGrid,setPipeGrid\]/);
  assert.match(page, /pipeSplitter/);
  assert.match(page, /pipeMerger/);
  assert.match(page, /pipeBridge/);
  assert.match(page, /logisticsBridge/);
  assert.match(page, /molder:\{name:"塑形机"[\s\S]*?durationTicks:secondsToTicks\(2\)\}/);
  assert.match(page, /filler:\{name:"灌装机"[\s\S]*?durationTicks:secondsToTicks\(2\)\}/);
  assert.match(page, /reactor:\{name:"反应池"[\s\S]*?durationTicks:secondsToTicks\(2\)\}/);
  assert.match(page, /waterPump:\{name:"水泵"[\s\S]*?durationTicks:secondsToTicks\(1\)\}/);
  assert.match(page, /INDUSTRIAL_ITEMS/);
  assert.match(page, /className="transport-tooltip"/);
  assert.match(css, /border-color:transparent/);
  assert.match(css, /\.cell\.belt:hover \.transport-tooltip/);
  assert.match(css, /\.draft-waypoint/);
  assert.match(css, /\.port-marker\.snap-target/);
  assert.match(css, /\.placement-snap/);
  assert.match(css, /\.radial-menu/);
  assert.match(css, /@keyframes radialConfirm/);
  assert.match(css, /\.draft-cursor/);
  assert.match(css, /\.device-menu/);
  assert.match(css, /\.cell-glyph\.root\.inventory-full/);
  assert.match(css, /\.editor-tools/);
  assert.match(css, /\.device-tabs/);
  assert.match(timing, /BELT_ITEMS_PER_MINUTE = 30/);
  assert.match(timing, /PIPE_ITEMS_PER_MINUTE = 120/);
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
  await access(new URL("../public/assets/machines/molder.svg", import.meta.url));
  await access(new URL("../public/assets/machines/filler.svg", import.meta.url));
  await access(new URL("../public/assets/machines/reactor.svg", import.meta.url));
  await access(new URL("../public/assets/machines/water-pump.svg", import.meta.url));
  await access(new URL("../public/assets/machines/logistics-bridge.svg", import.meta.url));
  await access(new URL("../public/assets/machines/pipe-bridge.svg", import.meta.url));
  await access(new URL("../public/assets/items/clean-water.svg", import.meta.url));
});
