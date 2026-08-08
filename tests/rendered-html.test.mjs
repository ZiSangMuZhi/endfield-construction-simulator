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
  assert.match(html, /拆解机/);
  assert.match(html, /反应池/);
  assert.match(html, /提纯机/);
  assert.match(html, /废水处理机/);
  assert.match(html, /待补图/);
  assert.match(html, /水泵/);
  assert.match(html, /游戏设备分类/);
  assert.match(html, /仓储存取/);
  assert.match(html, /合成制造/);
  assert.match(html, /重置模拟/);
  assert.match(html, /产销统计/);
  assert.match(html, /产出/);
  assert.match(html, /消耗/);
  assert.match(html, /og:image/);
  assert.match(html, /endfield-construction-planner\.zisangmuzhi\.chatgpt\.site\/og\.png/);
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

test("keeps each logistics bridge axis strictly opposite and independent", async () => {
  const routing=await import(new URL("../lib/bridge-routing.ts",import.meta.url));
  const incoming={id:"incoming",targetPort:{entityId:"bridge-a",entityKind:"logisticsBridge",index:0,side:2}};
  const adjacent={id:"adjacent",sourcePort:{entityId:"bridge-a",entityKind:"logisticsBridge",index:0,side:1}};
  const wrongAxis={id:"wrong-axis",sourcePort:{entityId:"bridge-a",entityKind:"logisticsBridge",index:1,side:0}};
  const otherBridge={id:"other-bridge",sourcePort:{entityId:"bridge-b",entityKind:"logisticsBridge",index:0,side:0}};
  const opposite={id:"opposite",sourcePort:{entityId:"bridge-a",entityKind:"logisticsBridge",index:0,side:0}};
  assert.equal(routing.pairedBridgeOutput(incoming,[adjacent,wrongAxis,otherBridge,opposite]),opposite);
  assert.equal(routing.bridgePortsPair(incoming.targetPort,adjacent.sourcePort),false);
  assert.equal(routing.bridgePortsPair(incoming.targetPort,wrongAxis.sourcePort),false);
  assert.equal(routing.bridgePortsPair(incoming.targetPort,opposite.sourcePort),true);
  const pipeIncoming={id:"pipe-in",targetPort:{entityId:"pipe-a",entityKind:"pipeBridge",index:1,side:3}};
  const pipeOpposite={id:"pipe-out",sourcePort:{entityId:"pipe-a",entityKind:"pipeBridge",index:1,side:1}};
  assert.equal(routing.pairedBridgeOutput(pipeIncoming,[pipeOpposite]),pipeOpposite);
});

test("supports layered belt and pipe planning with draggable facilities", async () => {
  const [page, css, timing, worksheet] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../lib/belt-timing.ts", import.meta.url), "utf8"),
    readFile(new URL("../docs/EQUIPMENT_RECIPE_REQUIREMENTS_WORKSHEET.md", import.meta.url), "utf8"),
  ]);

  assert.match(page, /kind: "powerPole"[\s\S]*?2×2 · 供电范围 12×12/);
  assert.match(page, /gearAssembler:\{width:4,height:6,inputs:edgePorts\(6,2,0\),outputs:edgePorts\(6,0,3\)\}/);
  assert.match(page, /gearAssembler:\{name:"装备原件机"[\s\S]*?recipe\("amethyst-component"[\s\S]*?,10\)/);
  assert.match(page, /gearAssembler:\{name:"装备原件机"[\s\S]*?recipe\("ferrium-component","蓝铁装备原件"[\s\S]*?,10\)/);
  assert.match(page, /gearAssembler:\{name:"装备原件机"[\s\S]*?recipe\("high-crystal-component","高晶装备原件"[\s\S]*?,10\)/);
  assert.match(page, /gearAssembler:\{name:"装备原件机"[\s\S]*?recipe\("xiranite-component","息壤装备原件"[\s\S]*?,10\)/);
  assert.match(page, /gearAssembler:\{name:"装备原件机"[\s\S]*?recipe\("cuprium-component","赤铜装备原件"[\s\S]*?,10\)/);
  assert.match(page, /gearAssembler:\{name:"装备原件机"[\s\S]*?recipe\("hetonite-component","赫铜装备原件"[\s\S]*?,10\)/);
  assert.match(page, /const recipeRateText=/);
  assert.match(page, /额定流量 · \{recipeRateText\(selectedRecipe\)\}/);
  assert.match(page, /refiner:\{name:"精炼炉"[\s\S]*?recipe\("ferrium-block"[\s\S]*?,2\)/);
  assert.match(page, /fitter:\{name:"配件机"[\s\S]*?recipe\("ferrium-part"[\s\S]*?,2\)/);
  assert.match(page, /status:[\s\S]*?"unpowered"/);
  assert.match(page, /getFlowRoutes\(grid, "belt"\)/);
  assert.match(page, /\{ kind: "pipe", label: "管道"/);
  assert.doesNotMatch(page, /\{ kind: "tank", label:/);
  assert.match(page, /const EQUIPMENT_LAYOUTS/);
  assert.match(page, /layout\.inputs\.filter[\s\S]*?\.forEach/);
  assert.match(page, /layout\.outputs\.filter[\s\S]*?\.forEach/);
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
  assert.doesNotMatch(page, /draggable className/);
  assert.match(page, /beginCatalogPointer/);
  assert.match(page, /setPointerCapture/);
  assert.match(page, /finishCatalogPointer/);
  assert.match(page, /ref=\{gridRef\}/);
  assert.match(page, /const \[pipeGrid,setPipeGrid\]/);
  assert.match(page, /pipeSplitter/);
  assert.match(page, /pipeMerger/);
  assert.match(page, /pipeBridge/);
  assert.match(page, /logisticsBridge/);
  assert.match(page, /molder:\{name:"塑形机"[\s\S]*?recipe\("ferrium-bottle"[\s\S]*?,2\)/);
  assert.match(page, /filler:\{name:"灌装机"[\s\S]*?recipe\("water-bottled"[\s\S]*?,2\)/);
  assert.match(page, /filler:\{name:"灌装机"[\s\S]*?recipe\("amethyst-jincao-bottled"[\s\S]*?,2\)/);
  assert.match(page, /dismantler:\{name:"拆解机",width:4,height:6,powerUsage:20[\s\S]*?recipe\("dismantle-amethyst-water"[\s\S]*?,2\)/);
  assert.match(page, /reactor:\{name:"反应池"[\s\S]*?recipe\("liquid-xiranite"[\s\S]*?,2\)/);
  assert.match(page, /reactor:\{name:"反应池"[\s\S]*?recipe\("xircon-effluents"[\s\S]*?,2\)/);
  assert.match(page, /purifier:\{name:"提纯机",width:5,height:5,powerUsage:50[\s\S]*?recipe\("purify-cuprium-solution"[\s\S]*?,2\)/);
  assert.match(page, /purifier:\{width:5,height:5[\s\S]*?outputIndex:1[\s\S]*?outputIndex:0/);
  assert.match(page, /waterTreatment:\{name:"废水处理机",width:3,height:3,powerUsage:50[\s\S]*?recipe\("treat-sewage","污水无害化处理","fluid",\[\{itemId:"sewage",amount:1\}\],\[\],2\)/);
  assert.match(page, /waterTreatment:\{width:3,height:3,inputs:\[\{x:0,y:1,side:2,transport:"pipe"\}\],outputs:\[\]\}/);
  assert.match(page, /current\.outputs\.length[\s\S]*?"无害化处理"/);
  assert.doesNotMatch(page, /waterTreatment:\{name:"废水处理机"[^\n]*image:/);
  assert.match(page, /outputIndex:spec\.outputIndex/);
  assert.match(page, /const indexedOutput=sourcePort\?\.outputIndex==null\?undefined:sourceRecipe\?\.outputs\[sourcePort\.outputIndex\]/);
  assert.match(page, /waterPump:\{name:"水泵"[\s\S]*?recipe\("clean-water"[\s\S]*?,1\)/);
  assert.match(page, /waterPump:\{width:2,height:2,inputs:\[\],outputs:\[\{x:1,y:1,side:0,transport:"pipe"\}\]\}/);
  assert.match(page, /SOLID_INPUT_CAPACITY=50/);
  assert.match(page, /FLUID_INPUT_CAPACITY=50/);
  assert.match(page, /inputTotalFor\(target\.input,route\.kind\)/);
  assert.match(page, /selectedSolidInputTotal/);
  assert.match(page, /selectedFluidInputTotal/);
  assert.match(page, /type BeltJoin/);
  assert.match(page, /affectedRouteIds/);
  assert.match(page, /function analyzeDraftRoute/);
  assert.match(page, /bridgeKind:draft\.kind==="pipe"\?"pipeBridge":"logisticsBridge"/);
  assert.match(page, /路径有 \$\{analysis\.conflicts\.size\} 处占位或方向冲突/);
  assert.doesNotMatch(page, /重叠线路将被覆盖/);
  assert.match(page, /pipeFillRatio/);
  assert.match(page, /className="pipe-fluid-segment"/);
  assert.match(page, /if\(route\.direct\|\|route\.kind==="pipe"\|\|!transits\.length/);
  assert.match(page, /设备只能从底部目录拖到画布上添加/);
  assert.match(page, /aria-label=\{`拖动添加\$\{tool\.label\}`\}/);
  assert.doesNotMatch(page, /P-IN|P-OUT/);
  assert.match(page, /INDUSTRIAL_ITEMS/);
  assert.match(page, /className="transport-tooltip"/);
  assert.match(page, /type ItemStatSample/);
  assert.match(page, /producedThisTick/);
  assert.match(page, /consumedThisTick/);
  assert.match(page, /if\(sourceKind==="depot"\)addQuantity\(producedThisTick/);
  assert.match(page, /Storage-port delivery is inventory transfer, not consumption/);
  assert.match(page, /className="stat-line produced"/);
  assert.match(page, /className="stat-line consumed"/);
  assert.match(page, /STATS_HISTORY_SECONDS=300/);
  assert.match(page, /STATS_SMOOTHING_SECONDS=30/);
  assert.match(page, /STATS_SAMPLE_INTERVAL_SECONDS=5/);
  assert.match(page, /involvedStatsItems\.map\(\(item\)=>/);
  assert.match(page, /className="stat-item"/);
  assert.match(page, /30 秒平滑 · 5 秒采样/);
  assert.doesNotMatch(page, /stat-selector|selectedStatsItemId/);
  assert.match(page, /itemStats:savedSimulation\.itemStats\?\?\[\]/);
  assert.match(page, /function resetSimulation\(\)/);
  assert.match(page, /setSimulation\(emptySimulationState\(\)\)/);
  assert.match(page, /function clearCanvas\(\)/);
  assert.match(page, /window\.confirm\("清空画布会移除所有设备、传送带、管道和当前模拟数据/);
  assert.match(page, /className="clear-action" onClick=\{clearCanvas\}>清空画布/);
  assert.match(page, /const prioritizedProductionStates=productionStates\.map/);
  assert.match(page, /Number\(b\.state\.status==="blocked"\)-Number\(a\.state\.status==="blocked"\)/);
  assert.match(page, /prioritizedProductionStates\.map\(\(\{state,sequence\}\)=>/);
  assert.match(page, /type MachineRecipe =/);
  assert.match(page, /function setMachineRecipe\(entityId:string,recipeId:string\)/);
  assert.match(page, /className="mode-switch"/);
  assert.match(page, /aria-label="当前处理配方"/);
  assert.match(page, /modes:\["fluid"\]/);
  assert.match(page, /crusher:\{name:"粉碎机"[\s\S]*?recipe\("originium-powder"/);
  assert.match(page, /sealer:\{name:"封装机"[\s\S]*?recipe\("lc-valley-battery"/);
  assert.match(page, /grinder:\{name:"研磨机"[\s\S]*?recipe\("dense-ferrium-powder"/);
  assert.match(page, /seedPicker:\{name:"采种机"[\s\S]*?recipe\("buck-seed"/);
  assert.match(page, /seedPicker:\{name:"采种机"[\s\S]*?recipe\("jincao-seed","锦草种子","solid"[\s\S]*?,2\)/);
  assert.match(page, /seedPicker:\{name:"采种机"[\s\S]*?recipe\("yazhen-seed","芽针种子","solid"[\s\S]*?,2\)/);
  assert.match(page, /seedPicker:\{width:5,height:5,inputs:edgePorts\(5,2,0\),outputs:edgePorts\(5,0,4\)\}/);
  assert.match(page, /recipe\("sandleaf-powder","砂叶粉末","solid",\[\{itemId:"sand-leaf",amount:1\}\],\[\{itemId:"sand-leaf-powder",amount:3\}\],2\)/);
  assert.match(page, /const automaticRecipe=/);
  assert.match(page, /nextRecipe=automaticRecipe\(definition,cell\.recipeId,input\)/);
  assert.match(page, /planter:\{name:"种植机"[\s\S]*?recipe\("jincao-fluid"/);
  assert.match(page, /forge:\{name:"天有洪炉"[\s\S]*?recipe\("xiranite"/);
  assert.match(page, /function AssetThumb/);
  assert.match(page, /className="machine-icon"><AssetThumb src=\{definition\.image\} label=\{definition\.name\}/);
  assert.match(page, /aria-label=\{`\$\{label\}图像待补`\}/);
  assert.match(page, /className="flow-placeholder"/);
  assert.match(page, /gearAssembler:\{name:"装备原件机"[\s\S]*?image:"\/assets\/machines\/gear-assembler\.webp"/);
  assert.match(page, /molder:\{name:"塑形机"[\s\S]*?image:"\/assets\/machines\/molder\.webp"/);
  assert.match(page, /id:"purple-equipment-component"[\s\S]*?image:"\/assets\/items\/purple-equipment-component\.webp"/);
  assert.match(page, /id:"liquid-xiranite"[\s\S]*?image:"\/assets\/items\/liquid-xiranite\.webp"/);
  assert.doesNotMatch(page, /data-theme=|setTheme\(|切换主题|深色/);
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
  assert.match(css, /scrollbar-color:#777873 #252624/);
  assert.match(css, /\.port-icon/);
  assert.match(css, /\.pipe-fluid-segment/);
  assert.match(css, /\.grid-wrap\{[^}]*background:var\(--paper\)/);
  assert.doesNotMatch(css, /\.grid-wrap\{[^}]*background-image/);
  assert.match(css, /\.production-stats/);
  assert.match(css, /\.stat-line\.produced/);
  assert.match(css, /\.stat-line\.consumed/);
  assert.match(css, /\.stat-item\{/);
  assert.match(css, /\.stat-chart\{[^}]*height:32px/);
  assert.match(css, /\.machine-card \.machine-icon img/);
  assert.match(page, /className=\{processProgress===0\?"cycle-reset":""\}/);
  assert.match(css, /\.machine-progress>i>b\{[^}]*transition:width \.25s linear/);
  assert.match(css, /\.machine-progress>i>b\.cycle-reset\{transition:none\}/);
  assert.match(css, /\.content-placeholder\{/);
  assert.match(css, /\.flow-placeholder\{/);
  assert.match(css, /\.recipe-control>\.recipe-rate\{/);
  assert.match(css, /\.top-actions \.clear-action/);
  assert.match(page, /function toggleMarqueeMode\(\)/);
  assert.match(page, /function prepareGroupPlacement/);
  assert.match(page, /function rotateGroupSelection/);
  assert.match(page, /function deleteGroupSelection/);
  assert.match(page, /onPointerDown=\{startMarquee\}/);
  assert.match(page, /function resolveDirectPortConnections\(ports:ResolvedPort\[\]\)/);
  assert.match(page, /directPortConnections\.forEach\(\(\{sourcePort,targetPort\}\)=>\{/);
  assert.match(page, /cells:\[\{x:targetPort\.cellX,y:targetPort\.cellY/);
  assert.match(page, /const propagationQueue=routes\.filter/);
  assert.match(page, /outgoingByEntity\.get\(targetPort\.entityId\)/);
  assert.match(page, /kind==="logisticsBridge"\|\|kind==="pipeBridge"\?0/);
  assert.match(page, /const bridgeForwardRoutes=useMemo/);
  assert.match(page, /const outgoing=pairedBridgeOutput\(incoming,connectedFlowRoutes\)/);
  assert.match(page, /route\.targetPort&&!isBridge\(route\.targetPort\.entityKind\)\?ensureInventory/);
  assert.match(page, /isBridge\(route\.sourcePort\.entityKind\)\)return/);
  assert.match(page, /activeByRoute\.set\(outgoing\.id,\[\.\.\.outgoingLane,\{\.\.\.leader,routeId:outgoing\.id,position:0,previousPosition:0\}\]\)/);
  assert.match(page, /!isBridge\(selectedEntity\.kind\)/);
  assert.match(page, /if\(route\.direct\)return/);
  assert.match(page, /cellPorts\.filter\(\(port\)=>!hiddenDirectPortKeys\.has\(port\.key\)\)/);
  assert.match(page, /isPortConnected\(grid,pipeGrid,port,directlyConnectedPortKeys\)/);
  assert.match(css, /\.marquee-box/);
  assert.match(css, /\.cell\.logisticsBridge \.port-marker/);
  assert.match(page, /const \[canvasView,setCanvasView\]=useState<CanvasView>\("blueprint"\)/);
  assert.match(page, /className="flow-diagram"/);
  assert.match(page, /物流桥已折叠 · 分流器与汇流器保留为节点/);
  assert.match(page, /const visibleKinds=new Set<Kind>/);
  assert.match(page, /route=bridgeForwardRoutes\.get\(route\.id\)/);
  assert.match(page, /className="port-overlay"/);
  assert.match(page, /className=\{`port-marker global-port/);
  assert.match(css, /\.cell>\.port-marker\{display:none!important\}/);
  assert.match(css, /\.port-overlay\{[^}]*z-index:36/);
  assert.match(css, /\.flow-node\{/);
  assert.match(css, /\.flow-link\.pipe path/);
  assert.match(css, /\.route-track\.draft-route\.invalid/);
  assert.doesNotMatch(css, /data-theme="dark"/);
  assert.match(timing, /BELT_ITEMS_PER_MINUTE = 30/);
  assert.match(timing, /PIPE_ITEMS_PER_MINUTE = 120/);
  assert.match(timing, /BELT_CELL_TRAVEL_TICKS = BELT_HEADWAY_TICKS/);
  for (const kind of ["refiner","crusher","fitter","molder","seedPicker","planter","waterTreatment","filler","dismantler","sealer","grinder","reactor","purifier","forge","gearAssembler","waterPump","depot","storagePort","splitter","merger","logisticsBridge","pipeSplitter","pipeMerger","pipeBridge","powerPole"]) {
    assert.ok(worksheet.includes("`"+kind+"`"));
  }
  assert.match(worksheet, /全局生产规则待确认/);
  assert.match(timing, /return cellCount \* BELT_CELL_TRAVEL_TICKS/);
  await access(new URL("../public/assets/machines/supply-pole.webp", import.meta.url));
  await access(new URL("../public/assets/machines/gear-assembler.webp", import.meta.url));
  await access(new URL("../public/assets/machines/storage-port.webp", import.meta.url));
  await access(new URL("../public/assets/machines/splitter.webp", import.meta.url));
  await access(new URL("../public/assets/machines/merger.webp", import.meta.url));
  await access(new URL("../public/assets/items/crystal-shell.webp", import.meta.url));
  await access(new URL("../public/assets/items/purple-equipment-component.webp", import.meta.url));
  await access(new URL("../public/assets/items/purple-crystal-ore.webp", import.meta.url));
  await access(new URL("../public/assets/items/liquid-xiranite.webp", import.meta.url));
  await access(new URL("../public/assets/items/red-copper-ore.svg", import.meta.url));
  await access(new URL("../public/assets/machines/molder.webp", import.meta.url));
  await access(new URL("../public/assets/machines/filler.webp", import.meta.url));
  await access(new URL("../public/assets/machines/reactor.webp", import.meta.url));
  await access(new URL("../public/assets/machines/crusher.webp", import.meta.url));
  await access(new URL("../public/assets/machines/sealer.webp", import.meta.url));
  await access(new URL("../public/assets/machines/grinder.webp", import.meta.url));
  await access(new URL("../public/assets/machines/seed-picker.webp", import.meta.url));
  await access(new URL("../public/assets/machines/planter.webp", import.meta.url));
  await access(new URL("../public/assets/machines/forge-of-the-sky.webp", import.meta.url));
  await access(new URL("../public/assets/machines/water-pump.svg", import.meta.url));
  await access(new URL("../public/assets/machines/logistics-bridge.webp", import.meta.url));
  await access(new URL("../public/assets/machines/pipe-bridge.svg", import.meta.url));
  await access(new URL("../public/assets/items/clean-water.svg", import.meta.url));
  await access(new URL("../public/assets/items/source-ore.webp", import.meta.url));
  await access(new URL("../public/assets/items/qiao-flower.webp", import.meta.url));
  await access(new URL("../public/assets/items/qiao-capsule-generated.webp", import.meta.url));
  await access(new URL("../public/assets/items/red-copper-block-generated.webp", import.meta.url));
  await access(new URL("../public/assets/items/industrial-explosive.webp", import.meta.url));
  await access(new URL("../public/assets/items/low-capacity-valley-battery.webp", import.meta.url));
  await access(new URL("../public/assets/items/sewage.svg", import.meta.url));
  await access(new URL("../public/og.png", import.meta.url));
});
