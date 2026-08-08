"use client";
/* eslint-disable @next/next/no-img-element -- local game icons are rendered at native blueprint scale */

import { useEffect, useMemo, useRef, useState } from "react";
import { BELT_HEADWAY_TICKS, BELT_ITEMS_PER_MINUTE, PIPE_HEADWAY_TICKS, PIPE_ITEMS_PER_MINUTE, PIPE_LANE_PROFILE, SIM_TICK_MS, SIM_TICKS_PER_SECOND, advanceBeltLane, advancePipeLane, beltLaneCanAccept, beltLaneIsFull, beltTravelSeconds, nextLaneReadyTick, pipeLaneCanAccept, pipeLaneIsFull } from "../lib/belt-timing";
import { bridgePortsPair, pairedBridgeOutput } from "../lib/bridge-routing";
import { RADIAL_CONFIRM_DELAY_MS, RADIAL_HOLD_DELAY_MS, RADIAL_PREOPEN_TOLERANCE_PX, RadialAction, radialSelection } from "../lib/radial-menu";
import { occupiedSharedSlots, sharedBufferAfterRecipe, sharedBufferCanAccept, sharedBufferWithOutputs } from "../lib/machine-buffer.mjs";
import { selectSnapPort } from "../lib/port-snapping.mjs";
import { PROTOCOL_STASH_SLOT_CAPACITY, PROTOCOL_STASH_SLOTS, PROTOCOL_STASH_TRANSFER_SECONDS, advanceProtocolStash, protocolStashCanAccept } from "../lib/protocol-stash.mjs";
import { advanceUndergroundSourceCredit, clampUndergroundSourceRate } from "../lib/underground-source.mjs";

type TransportKind = "belt" | "pipe";
type Kind = TransportKind | "refiner" | "crusher" | "fitter" | "molder" | "filler" | "dismantler" | "sealer" | "grinder" | "seedPicker" | "planter" | "reactor" | "expandedReactor" | "purifier" | "waterTreatment" | "forge" | "gearAssembler" | "waterPump" | "acidWaterPump" | "gasDisperser" | "liquidGasConverter" | "solidGasConverter" | "gasReactor" | "splitter" | "merger" | "logisticsBridge" | "itemLimiter" | "pipeSplitter" | "pipeMerger" | "pipeBridge" | "pipeLimiter" | "undergroundPipeInlet" | "undergroundPipeOutlet" | "multiUndergroundPipeInlet" | "multiUndergroundPipeOutlet" | "storagePort" | "protocolStash" | "tank" | "depot" | "powerPole";
type ProductionKind = "refiner" | "crusher" | "fitter" | "molder" | "filler" | "dismantler" | "sealer" | "grinder" | "seedPicker" | "planter" | "reactor" | "expandedReactor" | "purifier" | "waterTreatment" | "forge" | "gearAssembler" | "waterPump" | "acidWaterPump" | "gasDisperser" | "liquidGasConverter" | "solidGasConverter" | "gasReactor";
type MachineMode = "solid" | "fluid" | "gas";
type ProtocolStashMode = "wireless" | "storage";
type DeviceCategory = "全部" | "资源开采" | "仓储存取" | "基础生产" | "合成制造" | "电力供应" | "功能设备" | "战斗辅助" | "种植调配";
type Direction = 0 | 1 | 2 | 3;
type PipeContent = "clean-water" | "liquid-xiranite" | "sewage";
type OutputFilters = { solid?:string; pipe0?:string; pipe1?:string };
type Cell = { kind: Kind; rotation: Direction; entry?: Direction; id: string; root?: boolean; partX?: number; partY?: number; size?: number; width?: number; height?: number; content?: PipeContent; itemId?: string; sourceRatePerMinute?:number; recipeId?:string; pairedEntityId?:string; outputFilters?:OutputFilters; autoMultiRecipeUnblock?:boolean; protocolStashMode?:ProtocolStashMode };
type Grid = Record<string, Cell>;

const DEFAULT_COLS = 32;
const DEFAULT_ROWS = 32;
const MAX_CANVAS_SIZE = 48;
const PUBLIC_BASE_PATH=process.env.NEXT_PUBLIC_BASE_PATH??"";
const publicAssetPath=(src:string)=>src.startsWith("/")?`${PUBLIC_BASE_PATH}${src}`:src;
const keyOf = (x: number, y: number) => `${x},${y}`;
const DELTAS: Record<Direction, [number, number]> = { 0:[1,0], 1:[0,1], 2:[-1,0], 3:[0,-1] };
const opposite = (direction: Direction) => ((direction + 2) % 4) as Direction;
const directionBetween = (fromX: number, fromY: number, toX: number, toY: number): Direction | null => {
  if (toX === fromX + 1 && toY === fromY) return 0;
  if (toX === fromX && toY === fromY + 1) return 1;
  if (toX === fromX - 1 && toY === fromY) return 2;
  if (toX === fromX && toY === fromY - 1) return 3;
  return null;
};

type FlowRoute = { id: string; kind: TransportKind; cells: { x:number; y:number; cell:Cell }[]; path: string };
type PickedEntity = { id:string; mode:"move" | "copy"; sourceType:"entity"|"route"; sourceKeys:string[]; cells:{ dx:number; dy:number; cell:Cell }[]; label:string; image?:string };
type GroupCell = { layer:"grid"|"pipe"; sourceKey:string; dx:number; dy:number; cell:Cell };
type GroupSelection = { entityIds:string[]; gridKeys:string[]; pipeKeys:string[]; minX:number; minY:number; maxX:number; maxY:number };
type PickedGroup = { mode:"move"|"copy"; sourceGridKeys:string[]; sourcePipeKeys:string[]; cells:GroupCell[]; label:string };
type MarqueeState = { pointerId:number; start:Point; current:Point };
type MachineState = { id:string; kind:ProductionKind; recipeId:string; status:"idle"|"running"|"waiting"|"starved"|"blocked"|"unpowered"|"environment"; progress:number; remaining:string; hasInput:boolean; hasOutput:boolean; powered:boolean; inventoryFull:boolean };
type PowerZone = { id:string; x:number; y:number; size:number };
type GasZone = PowerZone & { itemId?:string };
type Point = { x:number; y:number };
type PortType = "input" | "output";
type PortSpec = { x:number; y:number; side:Direction; transport?:TransportKind; modes?:MachineMode[]; outputIndex?:number };
type EquipmentLayout = { width:number; height:number; inputs:PortSpec[]; outputs:PortSpec[] };
type ResolvedPort = { key:string; entityId:string; entityKind:Kind; type:PortType; index:number; side:Direction; transport:TransportKind; cellX:number; cellY:number; externalX:number; externalY:number; outputIndex?:number };
type BeltReplan = { routeId:string; replaceKeys:string[]; anchorEntry?:Direction };
type BeltJoin = { key:string; rotation:Direction };
type BeltDraft = { kind:TransportKind; cells:Point[]; waypoints:Point[]; sourcePort?:ResolvedPort; targetPort?:ResolvedPort; join?:BeltJoin; replan?:BeltReplan };
type DraftCrossing = { key:string; x:number; y:number; bridgeKind:"logisticsBridge"|"pipeBridge"; rotation:Direction };
type DraftAnalysis = { valid:boolean; conflicts:Set<string>; crossings:DraftCrossing[] };
type RadialMenuState = { entityId:string; x:number; y:number; pointerId:number; active:RadialAction|null; phase:"open"|"confirming"; angle:number; distance:number };
type RadialGesture = { entityId:string; pointerId:number; startX:number; startY:number; currentX:number; currentY:number; opened:boolean };
type ConnectedFlowRoute = FlowRoute & { direct?:boolean; sourcePort?:ResolvedPort; targetPort?:ResolvedPort; sourceConnected:boolean; targetConnected:boolean; valid:boolean; itemId?:string; itemName:string; itemImage:string };
type DirectPortConnection = { sourcePort:ResolvedPort; targetPort:ResolvedPort };
type IndustrialItem = { id:string; name:string; category:"矿物"|"工业产物"|"流体"; image?:string; color?:string };
type DeviceInventory = { input:Record<string,number>; output:Record<string,number> };
type RecipeQuantity = {itemId:string;amount:number};
type MachineRecipe = {id:string;name:string;mode:MachineMode;inputs:RecipeQuantity[];outputs:RecipeQuantity[];durationTicks:number};
type MachineDefinition = { name:string; width:number; height:number; image?:string; modeImages?:Partial<Record<MachineMode,string>>; powerUsage:number; requiresPower?:boolean; parallelSlots?:number; bufferSlots?:number; autoSchedule?:"parallel"|"roundRobin"; recipes:MachineRecipe[] };
type TransitItem = { id:string; routeId:string; itemId:string; position:number; previousPosition:number };
type ItemStatSample = { second:number; produced:Record<string,number>; consumed:Record<string,number> };
type ItemStatsChart = { produced:number[]; consumed:number[]; producedPath:string; consumedPath:string; producedTotal:number; consumedTotal:number };
type SimulationState = { tick:number; inventories:Record<string,DeviceInventory>; processes:Record<string,number>; transits:TransitItem[]; routeCursor:Record<string,number>; recipeCursor:Record<string,number>; laneReadyAt:Record<string,number>; routeTransfers:Record<string,number[]>; itemStats:ItemStatSample[] };
type CanvasView = "blueprint" | "flow";
type FlowGraphNode = { id:string; kind:Kind; label:string; image?:string; detail:string; status:string; sourceX:number; sourceY:number; x:number; y:number };
type FlowGraphEdge = { id:string; from:string; to:string; kind:TransportKind; itemName:string };
const SOLID_INPUT_CAPACITY=50;
const FLUID_INPUT_CAPACITY=50;
const OUTPUT_CAPACITY=50;
const STATS_HISTORY_SECONDS=300;
const STATS_SMOOTHING_SECONDS=30;
const STATS_SAMPLE_INTERVAL_SECONDS=5;
const STATS_CHART_POINTS=Math.floor(STATS_HISTORY_SECONDS/STATS_SAMPLE_INTERVAL_SECONDS);
const STATS_RETENTION_SECONDS=STATS_HISTORY_SECONDS+STATS_SMOOTHING_SECONDS;
const PROTOCOL_STASH_POWER_USAGE=5;
const totalInventory=(bucket:Record<string,number>)=>Object.values(bucket).reduce((sum,quantity)=>sum+quantity,0);
const inputCapacityFor=(kind:Kind|undefined,transport:TransportKind)=>kind==="storagePort"?240:kind==="protocolStash"?PROTOCOL_STASH_SLOTS*PROTOCOL_STASH_SLOT_CAPACITY:kind==="reactor"?200:kind==="expandedReactor"?400:["undergroundPipeInlet","undergroundPipeOutlet","multiUndergroundPipeInlet","multiUndergroundPipeOutlet"].includes(kind??"")?500:kind==="logisticsBridge"||kind==="pipeBridge"?0:["splitter","merger","itemLimiter","pipeSplitter","pipeMerger","pipeLimiter"].includes(kind??"")?30:transport==="pipe"?FLUID_INPUT_CAPACITY:SOLID_INPUT_CAPACITY;
const outputCapacityFor=(kind:Kind|undefined)=>kind==="reactor"||kind==="expandedReactor"||kind==="protocolStash"?0:OUTPUT_CAPACITY;
const secondsToTicks=(seconds:number)=>Math.round(seconds*SIM_TICKS_PER_SECOND);
const protocolStashProcessKey=(entityId:string)=>`protocol-stash:${entityId}`;
const undergroundSourceProcessKey=(entityId:string)=>`underground-source:${entityId}`;
const addQuantity=(bucket:Record<string,number>,itemId:string,amount:number)=>{bucket[itemId]=(bucket[itemId]??0)+amount};
const modeLabel=(mode:MachineMode)=>mode==="fluid"?"液体模式":mode==="gas"?"气体模式":"固体模式";
const chartPath=(values:number[],maximum:number,width=240,height=82)=>values.map((value,index)=>`${index?"L":"M"} ${(index/Math.max(1,values.length-1)*width).toFixed(2)} ${(height-value/Math.max(1,maximum)*height).toFixed(2)}`).join(" ");
const emptySimulationState=():SimulationState=>({tick:0,inventories:{},processes:{},transits:[],routeCursor:{},recipeCursor:{},laneReadyAt:{},routeTransfers:{},itemStats:[]});

const INDUSTRIAL_ITEMS:IndustrialItem[] = [
  {id:"blue-iron-ore",name:"蓝铁矿",category:"矿物",image:"/assets/items/blue-iron-ore.webp"},
  {id:"purple-crystal-ore",name:"紫晶矿",category:"矿物",image:"/assets/items/purple-crystal-ore.webp"},
  {id:"source-ore",name:"源矿",category:"矿物",image:"/assets/items/source-ore.webp"},
  {id:"red-copper-ore",name:"赤铜矿",category:"矿物",image:"/assets/items/red-copper-ore.svg"},
  {id:"blue-iron-block",name:"蓝铁块",category:"工业产物",image:"/assets/items/blue-iron-block.webp"},
  {id:"red-copper-block",name:"赤铜块",category:"工业产物",image:"/assets/items/red-copper-block-generated.webp"},
  {id:"iron-parts",name:"铁制零件",category:"工业产物",image:"/assets/items/iron-parts.webp"},
  {id:"blue-iron-powder",name:"蓝铁粉末",category:"工业产物",image:"/assets/items/blue-iron-powder.webp"},
  {id:"dense-blue-iron-powder",name:"致密蓝铁粉末",category:"工业产物",image:"/assets/items/dense-blue-iron-powder.webp"},
  {id:"source-powder",name:"源石粉末",category:"工业产物",image:"/assets/items/source-powder.webp"},
  {id:"dense-source-powder",name:"致密源石粉末",category:"工业产物",image:"/assets/items/dense-source-powder.webp"},
  {id:"purple-crystal-fiber",name:"紫晶纤维",category:"工业产物",image:"/assets/items/purple-crystal-fiber.webp"},
  {id:"purple-crystal-powder",name:"紫晶粉末",category:"工业产物",image:"/assets/items/purple-crystal-powder.webp"},
  {id:"purple-crystal-parts",name:"紫晶零件",category:"工业产物",image:"/assets/items/purple-crystal-parts.webp"},
  {id:"steel-block",name:"钢块",category:"工业产物",image:"/assets/items/steel-block.webp"},
  {id:"crystal-shell",name:"晶体外壳",category:"工业产物",image:"/assets/items/crystal-shell.webp"},
  {id:"purple-equipment-component",name:"紫晶装备原件",category:"工业产物",image:"/assets/items/purple-equipment-component.webp"},
  {id:"blue-iron-equipment-component",name:"蓝铁装备原件",category:"工业产物"},
  {id:"dense-crystal",name:"密制晶体",category:"工业产物"},
  {id:"high-crystal-fiber",name:"高晶纤维",category:"工业产物"},
  {id:"high-crystal-equipment-component",name:"高晶装备原件",category:"工业产物"},
  {id:"xiranite-equipment-component",name:"息壤装备原件",category:"工业产物"},
  {id:"red-copper-parts",name:"赤铜零件",category:"工业产物"},
  {id:"red-copper-equipment-component",name:"赤铜装备原件",category:"工业产物"},
  {id:"hetonite-parts",name:"赫铜零件",category:"工业产物"},
  {id:"heavy-xiranite",name:"重息壤",category:"工业产物"},
  {id:"hetonite-equipment-component",name:"赫铜装备原件",category:"工业产物"},
  {id:"seared-copper-equipment-component",name:"灼铜装备原件",category:"工业产物"},
  {id:"blue-iron-bottle",name:"蓝铁瓶",category:"工业产物",image:"/assets/items/blue-iron-bottle.webp"},
  {id:"purple-crystal-bottle",name:"紫晶质瓶",category:"工业产物",image:"/assets/items/purple-crystal-bottle.webp"},
  {id:"water-filled-blue-iron-bottle",name:"蓝铁瓶（清水）",category:"工业产物",image:"/assets/items/water-filled-blue-iron-bottle.webp"},
  {id:"purple-water-bottle",name:"紫晶质瓶（清水）",category:"工业产物"},
  {id:"purple-sewage-bottle",name:"紫晶质瓶（污水）",category:"工业产物"},
  {id:"purple-jincao-bottle",name:"紫晶质瓶（锦草溶液）",category:"工业产物"},
  {id:"qiao-flower",name:"荞花",category:"工业产物",image:"/assets/items/qiao-flower.webp"},
  {id:"qiao-flower-powder",name:"荞花粉末",category:"工业产物",image:"/assets/items/qiao-flower-powder.webp"},
  {id:"fine-qiao-flower-powder",name:"细磨荞花粉末",category:"工业产物"},
  {id:"qiao-flower-seed",name:"荞花种子",category:"工业产物",image:"/assets/items/qiao-flower-seed.webp"},
  {id:"qiao-capsule",name:"荞愈胶囊",category:"工业产物",image:"/assets/items/qiao-capsule-generated.webp"},
  {id:"sand-leaf",name:"砂叶",category:"工业产物",image:"/assets/items/sand-leaf.webp"},
  {id:"sand-leaf-powder",name:"砂叶粉末",category:"工业产物",image:"/assets/items/sand-leaf-powder.webp"},
  {id:"sand-leaf-seed",name:"砂叶种子",category:"工业产物",image:"/assets/items/sand-leaf-seed.webp"},
  {id:"jincao",name:"锦草",category:"工业产物",image:"/assets/items/jincao.webp"},
  {id:"jincao-powder",name:"锦草粉末",category:"工业产物",image:"/assets/items/jincao-powder.webp"},
  {id:"jincao-seed",name:"锦草种子",category:"工业产物",image:"/assets/items/jincao-seed.webp"},
  {id:"yazhen",name:"芽针",category:"工业产物"},
  {id:"yazhen-seed",name:"芽针种子",category:"工业产物"},
  {id:"ketonized-shrub-powder",name:"酮化灌木粉末",category:"工业产物",image:"/assets/items/ketonized-shrub-powder.webp"},
  {id:"ketonized-shrub",name:"酮化灌木",category:"工业产物"},
  {id:"crystal-shell-powder",name:"晶体外壳粉末",category:"工业产物"},
  {id:"dense-crystal-powder",name:"致密晶体粉末",category:"工业产物"},
  {id:"high-crystal-powder",name:"高晶粉末",category:"工业产物"},
  {id:"stable-carbon",name:"稳定碳块",category:"工业产物",image:"/assets/items/stable-carbon.webp"},
  {id:"low-capacity-valley-battery",name:"低容谷地电池",category:"工业产物",image:"/assets/items/low-capacity-valley-battery.webp"},
  {id:"industrial-explosive",name:"工业爆炸物",category:"工业产物",image:"/assets/items/industrial-explosive.webp"},
  {id:"xiranite",name:"息壤",category:"工业产物",image:"/assets/items/xiranite.webp"},
  {id:"cuprium-powder",name:"赤铜粉末",category:"工业产物"},
  {id:"xircon",name:"壤晶",category:"工业产物"},
  {id:"hetonite",name:"赫铜块",category:"工业产物"},
  {id:"carbon-block",name:"碳块",category:"工业产物",image:"/assets/items/item_carbon_mtl.webp"},
  {id:"carbon-powder",name:"碳粉末",category:"工业产物",image:"/assets/items/item_carbon_powder.webp"},
  {id:"dense-carbon-powder",name:"致密碳粉末",category:"工业产物",image:"/assets/items/item_carbon_enr_powder.webp"},
  {id:"steel-parts",name:"钢制零件",category:"工业产物",image:"/assets/items/item_iron_enr_cmpt.webp"},
  {id:"high-crystal-parts",name:"高晶零件",category:"工业产物"},
  {id:"seared-copper",name:"灼铜块",category:"工业产物",image:"/assets/items/item_copper_enr2.webp"},
  {id:"seared-copper-parts",name:"灼铜零件",category:"工业产物",image:"/assets/items/item_copper_enr2_cmpt.webp"},
  {id:"gan-fruit",name:"柑实",category:"工业产物",image:"/assets/items/item_plant_moss_2.webp"},
  {id:"gan-fruit-powder",name:"柑实粉末",category:"工业产物",image:"/assets/items/item_plant_moss_powder_2.webp"},
  {id:"fine-gan-fruit-powder",name:"细磨柑实粉末",category:"工业产物",image:"/assets/items/item_plant_moss_enr_powder_2.webp"},
  {id:"gan-fruit-seed",name:"柑实种子",category:"工业产物",image:"/assets/items/item_plant_moss_seed_2.webp"},
  {id:"yazhen-powder",name:"芽针粉末",category:"工业产物"},
  {id:"ketonized-shrub-seed",name:"酮化树种",category:"工业产物"},
  {id:"steel-bottle",name:"钢质瓶",category:"工业产物"},
  {id:"high-crystal-bottle",name:"高晶质瓶",category:"工业产物"},
  {id:"red-copper-bottle",name:"赤铜瓶",category:"工业产物"},
  {id:"hetonite-bottle",name:"赫铜瓶",category:"工业产物"},
  {id:"pressure-canister",name:"赤铜耐压罐",category:"工业产物",image:"/assets/items/item_copper_jar.webp"},
  {id:"pressure-canister-steam",name:"赤铜耐压罐（水蒸气）",category:"工业产物",image:"/assets/items/item_gasjar_copper_gas_water.webp"},
  {id:"pressure-canister-acid",name:"赤铜耐压罐（酸气）",category:"工业产物",image:"/assets/items/item_gasjar_copper_gas_acid.webp"},
  {id:"pressure-canister-xiranite",name:"赤铜耐压罐（息壤气）",category:"工业产物",image:"/assets/items/item_gasjar_copper_gas_xiranite.webp"},
  {id:"pressure-canister-heavy-xiranite",name:"赤铜耐压罐（重息壤气）",category:"工业产物",image:"/assets/items/item_gasjar_copper_gas_xiranite_enr.webp"},
  {id:"pressure-canister-inert",name:"赤铜耐压罐（惰气）",category:"工业产物",image:"/assets/items/item_gasjar_copper_gas_inert.webp"},
  {id:"pressure-canister-cuprium",name:"赤铜耐压罐（气态赤铜）",category:"工业产物",image:"/assets/items/item_gasjar_copper_gas_copper.webp"},
  {id:"pressure-canister-hetonite",name:"赤铜耐压罐（气态赫铜）",category:"工业产物",image:"/assets/items/item_gasjar_copper_gas_copper_enr.webp"},
  {id:"pressure-canister-seared-copper",name:"赤铜耐压罐（气态灼铜）",category:"工业产物",image:"/assets/items/item_gasjar_copper_gas_copper_enr2.webp"},
  {id:"clean-water",name:"清水",category:"流体",image:"/assets/items/clean-water.svg",color:"#a9dbea"},
  {id:"sewage",name:"污水",category:"流体",image:"/assets/items/sewage.svg",color:"#b7c9aa"},
  {id:"jincao-solution",name:"锦草溶液",category:"流体",image:"/assets/items/jincao-solution.webp",color:"#c9e0cf"},
  {id:"liquid-xiranite",name:"液化息壤",category:"流体",image:"/assets/items/liquid-xiranite.webp",color:"#b8dfcf"},
  {id:"inert-xircon-effluent",name:"惰性壤晶废液",category:"流体",color:"#d8d2bd"},
  {id:"xircon-effluent",name:"壤晶废液",category:"流体",color:"#c7d7ba"},
  {id:"precipitation-acid",name:"沉积酸",category:"流体",color:"#ead9aa"},
  {id:"cuprium-solution",name:"赤铜溶液",category:"流体",color:"#e4b9a9"},
  {id:"hetonite-solution",name:"赫铜溶液",category:"流体",color:"#d7c0d2"},
  {id:"yazhen-solution",name:"芽针溶液",category:"流体",image:"/assets/items/item_liquid_plant_grass_2.webp",color:"#d6dfc9"},
  {id:"liquid-heavy-xiranite",name:"液化重息壤",category:"流体",image:"/assets/items/item_liquid_xiranite_enr.webp",color:"#d8c8de"},
  {id:"steam",name:"水蒸气",category:"流体",image:"/assets/items/item_gas_water.webp",color:"#d7edf1"},
  {id:"acid-gas",name:"酸气",category:"流体",image:"/assets/items/item_gas_acid.webp",color:"#eee1aa"},
  {id:"xiranite-gas",name:"息壤气",category:"流体",image:"/assets/items/item_gas_xiranite.webp",color:"#bfe3d4"},
  {id:"heavy-xiranite-gas",name:"重息壤气",category:"流体",image:"/assets/items/item_gas_xiranite_enr.webp",color:"#d6c2dc"},
  {id:"inert-gas",name:"惰气",category:"流体",image:"/assets/items/item_gas_inert.webp",color:"#d8dadd"},
  {id:"gaseous-cuprium",name:"气态赤铜",category:"流体",image:"/assets/items/item_gas_copper.webp",color:"#e8b6a2"},
  {id:"gaseous-hetonite",name:"气态赫铜",category:"流体",image:"/assets/items/item_gas_copper_enr.webp",color:"#c9b6d8"},
  {id:"gaseous-seared-copper",name:"气态灼铜",category:"流体",image:"/assets/items/item_gas_copper_enr2.webp",color:"#f2c79a"},
];

const itemTransport=(itemId:string):TransportKind=>INDUSTRIAL_ITEMS.find((item)=>item.id===itemId)?.category==="流体"?"pipe":"belt";
const inputTotalFor=(bucket:Record<string,number>,transport:TransportKind)=>Object.entries(bucket).reduce((sum,[itemId,quantity])=>sum+(itemTransport(itemId)===transport?quantity:0),0);
const isSharedBufferMachine=(kind:Kind|undefined)=>kind==="reactor"||kind==="expandedReactor";
const isSlotInventory=(kind:Kind|undefined)=>isSharedBufferMachine(kind)||kind==="protocolStash";
const bufferSlotsFor=(kind:Kind|undefined)=>kind==="expandedReactor"?8:kind==="reactor"?4:kind==="protocolStash"?PROTOCOL_STASH_SLOTS:0;
const occupiedBufferSlots=(bucket:Record<string,number>)=>occupiedSharedSlots(bucket);
const bufferCanAccept=(kind:Kind|undefined,bucket:Record<string,number>,itemId:string,amount=1)=>{
  if(kind==="protocolStash")return protocolStashCanAccept(bucket,itemId,amount);
  if(!isSharedBufferMachine(kind))return inputTotalFor(bucket,itemTransport(itemId))+amount<=inputCapacityFor(kind,itemTransport(itemId));
  return sharedBufferCanAccept(bucket,itemId,bufferSlotsFor(kind),amount);
};
const bufferWithOutputs=(kind:Kind,bucket:Record<string,number>,outputs:RecipeQuantity[])=>sharedBufferWithOutputs(bucket,outputs,bufferSlotsFor(kind));
const bufferAfterRecipe=(kind:Kind,bucket:Record<string,number>,current:MachineRecipe)=>sharedBufferAfterRecipe(bucket,current,bufferSlotsFor(kind));

const recipe=(id:string,name:string,mode:MachineMode,inputs:RecipeQuantity[],outputs:RecipeQuantity[],seconds:number):MachineRecipe=>({id,name,mode,inputs,outputs,durationTicks:secondsToTicks(seconds)});
const MACHINE_DEFINITIONS:Record<ProductionKind,MachineDefinition> = {
  refiner:{name:"精炼炉",width:3,height:3,image:"/assets/machines/refinery.webp",powerUsage:5,recipes:[
    recipe("ferrium-block","蓝铁块","solid",[{itemId:"blue-iron-ore",amount:1}],[{itemId:"blue-iron-block",amount:1}],2),
    recipe("amethyst-fiber","紫晶纤维","solid",[{itemId:"purple-crystal-ore",amount:1}],[{itemId:"purple-crystal-fiber",amount:1}],2),
    recipe("origocrust","晶体外壳","solid",[{itemId:"source-ore",amount:1}],[{itemId:"crystal-shell",amount:1}],2),
    recipe("cuprium-fluid","赤铜块与污水","fluid",[{itemId:"red-copper-ore",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"red-copper-block",amount:1},{itemId:"sewage",amount:1}],2),
    recipe("dense-crystal","密制晶体","solid",[{itemId:"dense-crystal-powder",amount:1}],[{itemId:"dense-crystal",amount:1}],2),
    recipe("steel-block","钢块","solid",[{itemId:"dense-blue-iron-powder",amount:1}],[{itemId:"steel-block",amount:1}],2),
    recipe("high-crystal-fiber","高晶纤维","solid",[{itemId:"high-crystal-powder",amount:1}],[{itemId:"high-crystal-fiber",amount:1}],2),
    recipe("stable-carbon","稳定碳块","solid",[{itemId:"dense-carbon-powder",amount:1}],[{itemId:"stable-carbon",amount:1}],2),
    recipe("dense-crystal-powder-refine","致密晶体粉末","solid",[{itemId:"dense-source-powder",amount:1}],[{itemId:"dense-crystal-powder",amount:1}],2),
    recipe("carbon-from-qiao","碳块（荞花）","solid",[{itemId:"qiao-flower",amount:1}],[{itemId:"carbon-block",amount:1}],2),
    recipe("carbon-from-sandleaf","碳块（砂叶）","solid",[{itemId:"sand-leaf",amount:1}],[{itemId:"carbon-block",amount:1}],2),
    recipe("carbon-from-jincao","碳块（锦草）","solid",[{itemId:"jincao",amount:1}],[{itemId:"carbon-block",amount:2}],2),
    recipe("carbon-from-yazhen","碳块（芽针）","solid",[{itemId:"yazhen",amount:1}],[{itemId:"carbon-block",amount:2}],2),
  ]},
  crusher:{name:"粉碎机",width:3,height:3,image:"/assets/machines/crusher.webp",powerUsage:5,recipes:[
    recipe("originium-powder","源石粉末","solid",[{itemId:"source-ore",amount:1}],[{itemId:"source-powder",amount:1}],2),
    recipe("cuprium-powder","赤铜粉末","solid",[{itemId:"red-copper-block",amount:1}],[{itemId:"cuprium-powder",amount:1}],2),
    recipe("ferrium-powder","蓝铁粉末","solid",[{itemId:"blue-iron-block",amount:1}],[{itemId:"blue-iron-powder",amount:1}],2),
    recipe("amethyst-powder","紫晶粉末","solid",[{itemId:"purple-crystal-fiber",amount:1}],[{itemId:"purple-crystal-powder",amount:1}],2),
    recipe("origocrust-powder","晶体外壳粉末","solid",[{itemId:"crystal-shell",amount:1}],[{itemId:"crystal-shell-powder",amount:1}],2),
    recipe("buck-powder","荞花粉末","solid",[{itemId:"qiao-flower",amount:1}],[{itemId:"qiao-flower-powder",amount:2}],2),
    recipe("sandleaf-powder","砂叶粉末","solid",[{itemId:"sand-leaf",amount:1}],[{itemId:"sand-leaf-powder",amount:3}],2),
    recipe("ketonized-shrub-powder","酮化灌木粉末","solid",[{itemId:"ketonized-shrub",amount:1}],[{itemId:"ketonized-shrub-powder",amount:2}],2),
    recipe("carbon-powder","碳粉末","solid",[{itemId:"carbon-block",amount:1}],[{itemId:"carbon-powder",amount:2}],2),
    recipe("gan-fruit-powder","柑实粉末","solid",[{itemId:"gan-fruit",amount:1}],[{itemId:"gan-fruit-powder",amount:2}],2),
    recipe("jincao-powder","锦草粉末","solid",[{itemId:"jincao",amount:1}],[{itemId:"jincao-powder",amount:2}],2),
    recipe("yazhen-powder","芽针粉末","solid",[{itemId:"yazhen",amount:1}],[{itemId:"yazhen-powder",amount:2}],2),
  ]},
  fitter:{name:"配件机",width:3,height:3,image:"/assets/machines/assembler.webp",powerUsage:20,recipes:[
    recipe("ferrium-part","铁制零件","solid",[{itemId:"blue-iron-block",amount:1}],[{itemId:"iron-parts",amount:1}],2),
    recipe("amethyst-part","紫晶零件","solid",[{itemId:"purple-crystal-fiber",amount:1}],[{itemId:"purple-crystal-parts",amount:1}],2),
    recipe("steel-part","钢制零件","solid",[{itemId:"steel-block",amount:1}],[{itemId:"steel-parts",amount:1}],2),
    recipe("high-crystal-part","高晶零件","solid",[{itemId:"high-crystal-fiber",amount:1}],[{itemId:"high-crystal-parts",amount:1}],2),
    recipe("cuprium-part","赤铜零件","solid",[{itemId:"red-copper-block",amount:1}],[{itemId:"red-copper-parts",amount:1}],2),
    recipe("hetonite-part","赫铜零件","solid",[{itemId:"hetonite",amount:5}],[{itemId:"hetonite-parts",amount:1}],10),
    recipe("seared-copper-part","灼铜零件","solid",[{itemId:"seared-copper",amount:5}],[{itemId:"seared-copper-parts",amount:1}],10),
  ]},
  molder:{name:"塑形机",width:3,height:3,image:"/assets/machines/molder.webp",modeImages:{gas:"/assets/machines/molder-gas.webp"},powerUsage:20,recipes:[
    recipe("ferrium-bottle","蓝铁瓶","solid",[{itemId:"blue-iron-block",amount:2}],[{itemId:"blue-iron-bottle",amount:1}],2),
    recipe("amethyst-bottle","紫晶质瓶","solid",[{itemId:"purple-crystal-fiber",amount:2}],[{itemId:"purple-crystal-bottle",amount:1}],2),
    recipe("steel-bottle","钢质瓶","solid",[{itemId:"steel-block",amount:2}],[{itemId:"steel-bottle",amount:1}],2),
    recipe("high-crystal-bottle","高晶质瓶","solid",[{itemId:"high-crystal-fiber",amount:2}],[{itemId:"high-crystal-bottle",amount:1}],2),
    recipe("cuprium-bottle","赤铜瓶","solid",[{itemId:"red-copper-block",amount:2}],[{itemId:"red-copper-bottle",amount:1}],2),
    recipe("hetonite-bottle","赫铜瓶","solid",[{itemId:"hetonite",amount:2}],[{itemId:"hetonite-bottle",amount:1}],2),
    recipe("pressure-canister","赤铜耐压罐","gas",[{itemId:"red-copper-block",amount:2},{itemId:"steam",amount:1}],[{itemId:"pressure-canister",amount:1}],2),
  ]},
  filler:{name:"灌装机",width:4,height:6,image:"/assets/machines/filler.webp",powerUsage:20,recipes:[
    recipe("buck-capsule","荞愈胶囊","solid",[{itemId:"purple-crystal-bottle",amount:5},{itemId:"qiao-flower-powder",amount:5}],[{itemId:"qiao-capsule",amount:1}],10),
    recipe("water-bottled","蓝铁瓶（清水）","fluid",[{itemId:"blue-iron-bottle",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"water-filled-blue-iron-bottle",amount:1}],2),
    recipe("amethyst-water-bottled","紫晶质瓶（清水）","fluid",[{itemId:"purple-crystal-bottle",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"purple-water-bottle",amount:1}],2),
    recipe("amethyst-sewage-bottled","紫晶质瓶（污水）","fluid",[{itemId:"purple-crystal-bottle",amount:1},{itemId:"sewage",amount:1}],[{itemId:"purple-sewage-bottle",amount:1}],2),
    recipe("amethyst-jincao-bottled","紫晶质瓶（锦草溶液）","fluid",[{itemId:"purple-crystal-bottle",amount:1},{itemId:"jincao-solution",amount:1}],[{itemId:"purple-jincao-bottle",amount:1}],2),
    recipe("pressure-canister-steam","灌装水蒸气","gas",[{itemId:"pressure-canister",amount:1},{itemId:"steam",amount:1}],[{itemId:"pressure-canister-steam",amount:1}],2),
    recipe("pressure-canister-acid","灌装酸气","gas",[{itemId:"pressure-canister",amount:1},{itemId:"acid-gas",amount:1}],[{itemId:"pressure-canister-acid",amount:1}],2),
    recipe("pressure-canister-xiranite","灌装息壤气","gas",[{itemId:"pressure-canister",amount:1},{itemId:"xiranite-gas",amount:1}],[{itemId:"pressure-canister-xiranite",amount:1}],2),
    recipe("pressure-canister-heavy-xiranite","灌装重息壤气","gas",[{itemId:"pressure-canister",amount:1},{itemId:"heavy-xiranite-gas",amount:1}],[{itemId:"pressure-canister-heavy-xiranite",amount:1}],2),
    recipe("pressure-canister-inert","灌装惰气","gas",[{itemId:"pressure-canister",amount:1},{itemId:"inert-gas",amount:1}],[{itemId:"pressure-canister-inert",amount:1}],2),
    recipe("pressure-canister-cuprium","灌装气态赤铜","gas",[{itemId:"pressure-canister",amount:1},{itemId:"gaseous-cuprium",amount:1}],[{itemId:"pressure-canister-cuprium",amount:1}],2),
    recipe("pressure-canister-hetonite","灌装气态赫铜","gas",[{itemId:"pressure-canister",amount:1},{itemId:"gaseous-hetonite",amount:1}],[{itemId:"pressure-canister-hetonite",amount:1}],2),
    recipe("pressure-canister-seared-copper","灌装气态灼铜","gas",[{itemId:"pressure-canister",amount:1},{itemId:"gaseous-seared-copper",amount:1}],[{itemId:"pressure-canister-seared-copper",amount:1}],2),
  ]},
  dismantler:{name:"拆解机",width:4,height:6,powerUsage:20,recipes:[
    recipe("dismantle-amethyst-water","拆解紫晶质瓶（清水）","fluid",[{itemId:"purple-water-bottle",amount:1}],[{itemId:"purple-crystal-bottle",amount:1},{itemId:"clean-water",amount:1}],2),
    recipe("dismantle-amethyst-sewage","拆解紫晶质瓶（污水）","fluid",[{itemId:"purple-sewage-bottle",amount:1}],[{itemId:"purple-crystal-bottle",amount:1},{itemId:"sewage",amount:1}],2),
    recipe("dismantle-amethyst-jincao","拆解紫晶质瓶（锦草溶液）","fluid",[{itemId:"purple-jincao-bottle",amount:1}],[{itemId:"purple-crystal-bottle",amount:1},{itemId:"jincao-solution",amount:1}],2),
    recipe("dismantle-ferrium-water","拆解蓝铁瓶（清水）","fluid",[{itemId:"water-filled-blue-iron-bottle",amount:1}],[{itemId:"blue-iron-bottle",amount:1},{itemId:"clean-water",amount:1}],2),
    recipe("dismantle-steam-canister","拆解赤铜耐压罐（水蒸气）","gas",[{itemId:"pressure-canister-steam",amount:1}],[{itemId:"pressure-canister",amount:1},{itemId:"steam",amount:1}],2),
    recipe("dismantle-acid-canister","拆解赤铜耐压罐（酸气）","gas",[{itemId:"pressure-canister-acid",amount:1}],[{itemId:"pressure-canister",amount:1},{itemId:"acid-gas",amount:1}],2),
    recipe("dismantle-xiranite-canister","拆解赤铜耐压罐（息壤气）","gas",[{itemId:"pressure-canister-xiranite",amount:1}],[{itemId:"pressure-canister",amount:1},{itemId:"xiranite-gas",amount:1}],2),
    recipe("dismantle-heavy-xiranite-canister","拆解赤铜耐压罐（重息壤气）","gas",[{itemId:"pressure-canister-heavy-xiranite",amount:1}],[{itemId:"pressure-canister",amount:1},{itemId:"heavy-xiranite-gas",amount:1}],2),
    recipe("dismantle-inert-canister","拆解赤铜耐压罐（惰气）","gas",[{itemId:"pressure-canister-inert",amount:1}],[{itemId:"pressure-canister",amount:1},{itemId:"inert-gas",amount:1}],2),
    recipe("dismantle-cuprium-canister","拆解赤铜耐压罐（气态赤铜）","gas",[{itemId:"pressure-canister-cuprium",amount:1}],[{itemId:"pressure-canister",amount:1},{itemId:"gaseous-cuprium",amount:1}],2),
    recipe("dismantle-hetonite-canister","拆解赤铜耐压罐（气态赫铜）","gas",[{itemId:"pressure-canister-hetonite",amount:1}],[{itemId:"pressure-canister",amount:1},{itemId:"gaseous-hetonite",amount:1}],2),
    recipe("dismantle-seared-copper-canister","拆解赤铜耐压罐（气态灼铜）","gas",[{itemId:"pressure-canister-seared-copper",amount:1}],[{itemId:"pressure-canister",amount:1},{itemId:"gaseous-seared-copper",amount:1}],2),
  ]},
  sealer:{name:"封装机",width:4,height:6,image:"/assets/machines/sealer.webp",powerUsage:20,recipes:[
    recipe("lc-valley-battery","低容谷地电池","solid",[{itemId:"purple-crystal-parts",amount:5},{itemId:"source-powder",amount:10}],[{itemId:"low-capacity-valley-battery",amount:1}],10),
    recipe("industrial-explosive","工业爆炸物","solid",[{itemId:"purple-crystal-parts",amount:5},{itemId:"ketonized-shrub-powder",amount:1}],[{itemId:"industrial-explosive",amount:1}],10),
  ]},
  grinder:{name:"研磨机",width:4,height:6,image:"/assets/machines/grinder.webp",powerUsage:20,recipes:[
    recipe("dense-ferrium-powder","致密蓝铁粉末","solid",[{itemId:"blue-iron-powder",amount:2},{itemId:"sand-leaf-powder",amount:1}],[{itemId:"dense-blue-iron-powder",amount:1}],2),
    recipe("dense-originium-powder","致密源石粉末","solid",[{itemId:"source-powder",amount:2},{itemId:"sand-leaf-powder",amount:1}],[{itemId:"dense-source-powder",amount:1}],2),
    recipe("dense-crystal-powder","致密晶体粉末","solid",[{itemId:"crystal-shell-powder",amount:2},{itemId:"sand-leaf-powder",amount:1}],[{itemId:"dense-crystal-powder",amount:1}],2),
    recipe("high-crystal-powder","高晶粉末","solid",[{itemId:"purple-crystal-powder",amount:2},{itemId:"sand-leaf-powder",amount:1}],[{itemId:"high-crystal-powder",amount:1}],2),
    recipe("fine-buck-powder","细磨荞花粉末","solid",[{itemId:"qiao-flower-powder",amount:2},{itemId:"sand-leaf-powder",amount:1}],[{itemId:"fine-qiao-flower-powder",amount:1}],2),
    recipe("dense-carbon-powder","致密碳粉末","solid",[{itemId:"carbon-powder",amount:2},{itemId:"sand-leaf-powder",amount:1}],[{itemId:"dense-carbon-powder",amount:1}],2),
    recipe("fine-gan-fruit-powder","细磨柑实粉末","solid",[{itemId:"gan-fruit-powder",amount:2},{itemId:"sand-leaf-powder",amount:1}],[{itemId:"fine-gan-fruit-powder",amount:1}],2),
  ]},
  seedPicker:{name:"采种机",width:5,height:5,image:"/assets/machines/seed-picker.webp",powerUsage:10,recipes:[
    recipe("buck-seed","荞花种子","solid",[{itemId:"qiao-flower",amount:1}],[{itemId:"qiao-flower-seed",amount:2}],2),
    recipe("sandleaf-seed","砂叶种子","solid",[{itemId:"sand-leaf",amount:1}],[{itemId:"sand-leaf-seed",amount:2}],2),
    recipe("gan-fruit-seed","柑实种子","solid",[{itemId:"gan-fruit",amount:1}],[{itemId:"gan-fruit-seed",amount:2}],2),
    recipe("ketonized-shrub-seed","酮化树种","solid",[{itemId:"ketonized-shrub",amount:1}],[{itemId:"ketonized-shrub-seed",amount:2}],2),
    recipe("jincao-seed","锦草种子","solid",[{itemId:"jincao",amount:1}],[{itemId:"jincao-seed",amount:1}],2),
    recipe("yazhen-seed","芽针种子","solid",[{itemId:"yazhen",amount:1}],[{itemId:"yazhen-seed",amount:1}],2),
  ]},
  planter:{name:"种植机",width:5,height:5,image:"/assets/machines/planter.webp",powerUsage:20,recipes:[
    recipe("buckflower","荞花","solid",[{itemId:"qiao-flower-seed",amount:1}],[{itemId:"qiao-flower",amount:1}],2),
    recipe("sandleaf","砂叶","solid",[{itemId:"sand-leaf-seed",amount:1}],[{itemId:"sand-leaf",amount:1}],2),
    recipe("gan-fruit","柑实","solid",[{itemId:"gan-fruit-seed",amount:1}],[{itemId:"gan-fruit",amount:1}],2),
    recipe("ketonized-shrub","酮化灌木","solid",[{itemId:"ketonized-shrub-seed",amount:1}],[{itemId:"ketonized-shrub",amount:1}],2),
    recipe("jincao-fluid","锦草","fluid",[{itemId:"jincao-seed",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"jincao",amount:2}],2),
    recipe("yazhen-fluid","芽针","fluid",[{itemId:"yazhen-seed",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"yazhen",amount:2}],2),
  ]},
  reactor:{name:"反应池",width:5,height:5,image:"/assets/machines/reactor.webp",powerUsage:20,bufferSlots:4,autoSchedule:"roundRobin",recipes:[
    recipe("liquid-xiranite","液化息壤","fluid",[{itemId:"xiranite",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"liquid-xiranite",amount:1}],2),
    recipe("jincao-solution","锦草溶液","fluid",[{itemId:"jincao-powder",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"jincao-solution",amount:1}],2),
    recipe("yazhen-solution","芽针溶液","fluid",[{itemId:"yazhen-powder",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"yazhen-solution",amount:1}],2),
    recipe("liquid-heavy-xiranite","液化重息壤","fluid",[{itemId:"heavy-xiranite",amount:1},{itemId:"precipitation-acid",amount:1}],[{itemId:"liquid-heavy-xiranite",amount:1}],2),
    recipe("cuprium-solution","赤铜溶液","fluid",[{itemId:"cuprium-powder",amount:1},{itemId:"precipitation-acid",amount:1}],[{itemId:"cuprium-solution",amount:1}],2),
    recipe("xircon-effluents","壤晶废液与惰性壤晶废液","fluid",[{itemId:"liquid-xiranite",amount:1},{itemId:"sewage",amount:1}],[{itemId:"xircon-effluent",amount:1},{itemId:"inert-xircon-effluent",amount:1}],2),
    recipe("xircon","壤晶","fluid",[{itemId:"xircon-effluent",amount:2},{itemId:"blue-iron-powder",amount:1}],[{itemId:"xircon",amount:1},{itemId:"sewage",amount:1}],2),
    recipe("hetonite","赫铜块","fluid",[{itemId:"hetonite-solution",amount:2},{itemId:"blue-iron-powder",amount:1}],[{itemId:"hetonite",amount:1},{itemId:"sewage",amount:1}],2),
  ]},
  expandedReactor:{name:"扩容反应池",width:6,height:5,image:"/assets/machines/expanded-reactor.webp",powerUsage:100,parallelSlots:8,bufferSlots:8,autoSchedule:"parallel",recipes:[
    recipe("expanded-jincao-solution","锦草溶液","fluid",[{itemId:"jincao-powder",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"jincao-solution",amount:1}],2),
    recipe("expanded-yazhen-solution","芽针溶液","fluid",[{itemId:"yazhen-powder",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"yazhen-solution",amount:1}],2),
    recipe("expanded-liquid-xiranite","液化息壤","fluid",[{itemId:"xiranite",amount:1},{itemId:"clean-water",amount:1}],[{itemId:"liquid-xiranite",amount:1}],2),
    recipe("expanded-liquid-heavy-xiranite","液化重息壤","fluid",[{itemId:"heavy-xiranite",amount:1},{itemId:"precipitation-acid",amount:1}],[{itemId:"liquid-heavy-xiranite",amount:1}],2),
    recipe("expanded-cuprium-solution","赤铜溶液","fluid",[{itemId:"cuprium-powder",amount:1},{itemId:"precipitation-acid",amount:1}],[{itemId:"cuprium-solution",amount:1}],2),
    recipe("expanded-xircon-effluents","壤晶废液与惰性壤晶废液","fluid",[{itemId:"liquid-xiranite",amount:1},{itemId:"sewage",amount:1}],[{itemId:"xircon-effluent",amount:1},{itemId:"inert-xircon-effluent",amount:1}],2),
    recipe("expanded-xircon","壤晶","fluid",[{itemId:"xircon-effluent",amount:2},{itemId:"blue-iron-powder",amount:1}],[{itemId:"xircon",amount:1},{itemId:"sewage",amount:1}],2),
    recipe("expanded-hetonite","赫铜块","fluid",[{itemId:"hetonite-solution",amount:2},{itemId:"blue-iron-powder",amount:1}],[{itemId:"hetonite",amount:1},{itemId:"sewage",amount:1}],2),
  ]},
  purifier:{name:"提纯机",width:5,height:5,image:"/assets/machines/purifier.webp",modeImages:{gas:"/assets/machines/purifier-gas.webp"},powerUsage:50,recipes:[
    recipe("purify-xircon-effluent","提纯壤晶废液","fluid",[{itemId:"inert-xircon-effluent",amount:4}],[{itemId:"xircon-effluent",amount:1},{itemId:"clean-water",amount:1}],2),
    recipe("purify-cuprium-solution","赫铜溶液","fluid",[{itemId:"cuprium-solution",amount:4}],[{itemId:"hetonite-solution",amount:1},{itemId:"precipitation-acid",amount:1}],2),
    recipe("purify-heavy-xiranite-gas","重息壤气","gas",[{itemId:"xiranite-gas",amount:2}],[{itemId:"heavy-xiranite-gas",amount:1}],2),
    recipe("purify-gaseous-hetonite","气态赫铜","gas",[{itemId:"gaseous-cuprium",amount:2}],[{itemId:"gaseous-hetonite",amount:2}],2),
  ]},
  waterTreatment:{name:"废水处理机",width:3,height:3,image:"/assets/machines/water-treatment.webp",powerUsage:50,recipes:[
    recipe("treat-sewage","污水无害化处理","fluid",[{itemId:"sewage",amount:1}],[],2),
    recipe("treat-xircon-effluent","壤晶废液无害化处理","fluid",[{itemId:"xircon-effluent",amount:1}],[],2),
    recipe("treat-inert-xircon-effluent","惰性壤晶废液无害化处理","fluid",[{itemId:"inert-xircon-effluent",amount:1}],[],2),
  ]},
  forge:{name:"天有洪炉",width:5,height:5,image:"/assets/machines/forge-of-the-sky.webp",powerUsage:50,recipes:[
    recipe("xiranite","息壤","fluid",[{itemId:"stable-carbon",amount:2},{itemId:"clean-water",amount:1}],[{itemId:"xiranite",amount:1}],2),
    recipe("heavy-xiranite","重息壤","fluid",[{itemId:"xiranite",amount:10},{itemId:"xircon-effluent",amount:5}],[{itemId:"heavy-xiranite",amount:1}],10),
  ]},
  gearAssembler:{name:"装备原件机",width:4,height:6,image:"/assets/machines/gear-assembler.webp",powerUsage:10,recipes:[
    recipe("amethyst-component","紫晶装备原件","solid",[{itemId:"crystal-shell",amount:5},{itemId:"purple-crystal-fiber",amount:5}],[{itemId:"purple-equipment-component",amount:1}],10),
    recipe("ferrium-component","蓝铁装备原件","solid",[{itemId:"crystal-shell",amount:10},{itemId:"blue-iron-block",amount:10}],[{itemId:"blue-iron-equipment-component",amount:1}],10),
    recipe("high-crystal-component","高晶装备原件","solid",[{itemId:"dense-crystal",amount:10},{itemId:"high-crystal-fiber",amount:10}],[{itemId:"high-crystal-equipment-component",amount:1}],10),
    recipe("xiranite-component","息壤装备原件","solid",[{itemId:"dense-crystal",amount:10},{itemId:"xiranite",amount:10}],[{itemId:"xiranite-equipment-component",amount:1}],10),
    recipe("cuprium-component","赤铜装备原件","solid",[{itemId:"red-copper-parts",amount:10},{itemId:"xiranite",amount:10}],[{itemId:"red-copper-equipment-component",amount:1}],10),
    recipe("hetonite-component","赫铜装备原件","solid",[{itemId:"hetonite-parts",amount:2},{itemId:"heavy-xiranite",amount:2}],[{itemId:"hetonite-equipment-component",amount:1}],10),
    recipe("seared-copper-component","灼铜装备原件","solid",[{itemId:"seared-copper-parts",amount:1},{itemId:"heavy-xiranite",amount:2}],[{itemId:"seared-copper-equipment-component",amount:1}],10),
  ]},
  waterPump:{name:"水泵",width:2,height:2,image:"/assets/machines/water-pump.svg",powerUsage:5,recipes:[
    recipe("clean-water","清水","fluid",[],[{itemId:"clean-water",amount:1}],1),
  ]},
  acidWaterPump:{name:"二型耐酸水泵",width:2,height:2,image:"/assets/machines/water-pump.svg",powerUsage:5,recipes:[
    recipe("acid-pump-water","清水","fluid",[],[{itemId:"clean-water",amount:1}],1),
    recipe("acid-pump-acid","沉积酸","fluid",[],[{itemId:"precipitation-acid",amount:1}],1),
  ]},
  gasDisperser:{name:"气体散布机",width:3,height:3,image:"/assets/machines/gas-disperser.webp",powerUsage:0,requiresPower:false,recipes:[
    recipe("diffuse-steam","水蒸气扩散","gas",[{itemId:"steam",amount:1}],[],10),
    recipe("diffuse-acid","酸气扩散","gas",[{itemId:"acid-gas",amount:1}],[],10),
    recipe("diffuse-xiranite","息壤气扩散","gas",[{itemId:"xiranite-gas",amount:1}],[],10),
    recipe("diffuse-inert","惰气扩散","gas",[{itemId:"inert-gas",amount:1}],[],10),
  ]},
  liquidGasConverter:{name:"液气转化机",width:5,height:5,image:"/assets/machines/liquid-gas-converter.webp",modeImages:{gas:"/assets/machines/liquid-gas-converter-gas.webp"},powerUsage:50,recipes:[
    recipe("gas-to-water","水蒸气转清水","fluid",[{itemId:"steam",amount:1}],[{itemId:"clean-water",amount:1}],2),
    recipe("gas-to-acid","酸气转沉积酸","fluid",[{itemId:"acid-gas",amount:1}],[{itemId:"precipitation-acid",amount:1}],2),
    recipe("gas-to-xiranite","息壤气转液化息壤","fluid",[{itemId:"xiranite-gas",amount:1}],[{itemId:"liquid-xiranite",amount:1}],2),
    recipe("gas-to-heavy-xiranite","重息壤气转液化重息壤","fluid",[{itemId:"heavy-xiranite-gas",amount:5}],[{itemId:"liquid-heavy-xiranite",amount:2}],10),
    recipe("gas-to-cuprium","气态赤铜转赤铜溶液","fluid",[{itemId:"gaseous-cuprium",amount:1}],[{itemId:"cuprium-solution",amount:2}],2),
    recipe("gas-to-hetonite","气态赫铜转赫铜溶液","fluid",[{itemId:"gaseous-hetonite",amount:1}],[{itemId:"hetonite-solution",amount:1}],2),
    recipe("water-to-gas","清水转水蒸气","gas",[{itemId:"clean-water",amount:1}],[{itemId:"steam",amount:1}],2),
    recipe("acid-to-gas","沉积酸转酸气","gas",[{itemId:"precipitation-acid",amount:1}],[{itemId:"acid-gas",amount:1}],2),
    recipe("xiranite-to-gas","液化息壤转息壤气","gas",[{itemId:"liquid-xiranite",amount:1}],[{itemId:"xiranite-gas",amount:1}],2),
    recipe("heavy-xiranite-to-gas","液化重息壤转重息壤气","gas",[{itemId:"liquid-heavy-xiranite",amount:2}],[{itemId:"heavy-xiranite-gas",amount:5}],10),
    recipe("cuprium-to-gas","赤铜溶液转气态赤铜","gas",[{itemId:"cuprium-solution",amount:2}],[{itemId:"gaseous-cuprium",amount:1}],2),
    recipe("hetonite-to-gas","赫铜溶液转气态赫铜","gas",[{itemId:"hetonite-solution",amount:1}],[{itemId:"gaseous-hetonite",amount:1}],2),
  ]},
  solidGasConverter:{name:"固气转化机",width:5,height:5,image:"/assets/machines/solid-gas-converter.webp",modeImages:{gas:"/assets/machines/solid-gas-converter-gas.webp"},powerUsage:50,recipes:[
    recipe("solid-xiranite-to-gas","息壤转息壤气","gas",[{itemId:"xiranite",amount:1}],[{itemId:"xiranite-gas",amount:1}],2),
    recipe("solid-heavy-xiranite-to-gas","重息壤转重息壤气","gas",[{itemId:"heavy-xiranite",amount:2}],[{itemId:"heavy-xiranite-gas",amount:5}],10),
    recipe("solid-cuprium-to-gas","赤铜块转气态赤铜","gas",[{itemId:"red-copper-block",amount:2}],[{itemId:"gaseous-cuprium",amount:1}],2),
    recipe("solid-hetonite-to-gas","赫铜块转气态赫铜","gas",[{itemId:"hetonite",amount:1}],[{itemId:"gaseous-hetonite",amount:2}],2),
    recipe("solid-seared-copper-to-gas","灼铜块转气态灼铜","gas",[{itemId:"seared-copper",amount:1}],[{itemId:"gaseous-seared-copper",amount:1}],2),
    recipe("gas-xiranite-to-solid","息壤气转息壤","solid",[{itemId:"xiranite-gas",amount:1}],[{itemId:"xiranite",amount:1}],2),
    recipe("gas-heavy-xiranite-to-solid","重息壤气转重息壤","solid",[{itemId:"heavy-xiranite-gas",amount:5}],[{itemId:"heavy-xiranite",amount:2}],10),
    recipe("gas-cuprium-to-solid","气态赤铜转赤铜块","solid",[{itemId:"gaseous-cuprium",amount:1}],[{itemId:"red-copper-block",amount:2}],2),
    recipe("gas-hetonite-to-solid","气态赫铜转赫铜块","solid",[{itemId:"gaseous-hetonite",amount:2}],[{itemId:"hetonite",amount:1}],2),
    recipe("gas-seared-copper-to-solid","气态灼铜转灼铜块","solid",[{itemId:"gaseous-seared-copper",amount:1}],[{itemId:"seared-copper",amount:1}],2),
  ]},
  gasReactor:{name:"气体反应炉",width:5,height:5,image:"/assets/machines/gas-reactor.webp",powerUsage:50,recipes:[
    recipe("gaseous-seared-copper","气态灼铜","gas",[{itemId:"gaseous-hetonite",amount:2},{itemId:"xiranite-gas",amount:1}],[{itemId:"gaseous-seared-copper",amount:1}],2),
  ]},
};

const activeRecipe=(definition:MachineDefinition,recipeId?:string)=>definition.recipes.find((candidate)=>candidate.id===recipeId)??definition.recipes[0];
const machineImageFor=(definition:MachineDefinition,recipe:MachineRecipe)=>definition.modeImages?.[recipe.mode]??definition.image;
const automaticRecipe=(definition:MachineDefinition,currentRecipeId:string|undefined,input:Record<string,number>)=>{
  const stocked=Object.entries(input).filter(([,amount])=>amount>0);
  if(!stocked.length)return activeRecipe(definition,currentRecipeId);
  const ranked=definition.recipes.map((candidate,index)=>{
    const requirements=new Map(candidate.inputs.map((requirement)=>[requirement.itemId,requirement.amount]));
    const matched=stocked.filter(([itemId])=>requirements.has(itemId));
    const ready=candidate.inputs.length>0&&candidate.inputs.every((requirement)=>(input[requirement.itemId]??0)>=requirement.amount);
    const coverage=candidate.inputs.reduce((sum,requirement)=>sum+Math.min(1,(input[requirement.itemId]??0)/requirement.amount),0);
    return {candidate,index,matched:matched.length,score:(ready?10000:0)+matched.length*100+coverage*10+(candidate.id===currentRecipeId?1:0)};
  }).filter((entry)=>entry.matched>0).sort((a,b)=>b.score-a.score||a.index-b.index);
  return ranked[0]?.candidate??activeRecipe(definition,currentRecipeId);
};
const defaultOutputFilters=(definition:MachineDefinition):OutputFilters=>{
  const outputs=[...new Set(definition.recipes.flatMap((candidate)=>candidate.outputs.map((output)=>output.itemId)))];
  const solid=outputs.find((itemId)=>itemTransport(itemId)==="belt"),pipes=outputs.filter((itemId)=>itemTransport(itemId)==="pipe");
  return {solid,pipe0:pipes[0],pipe1:pipes[1]??pipes[0]};
};
const outputFilterKey=(port:ResolvedPort,kind:TransportKind):keyof OutputFilters=>kind==="belt"?"solid":port.outputIndex===1?"pipe1":"pipe0";
const itemName=(itemId:string)=>INDUSTRIAL_ITEMS.find((item)=>item.id===itemId)?.name??itemId;
const recipeText=(current:MachineRecipe)=>`${current.inputs.length?current.inputs.map((input)=>`${itemName(input.itemId)} ×${input.amount}`).join(" + "):"环境输入"} → ${current.outputs.length?current.outputs.map((output)=>`${itemName(output.itemId)} ×${output.amount}`).join(" + "):"无害化处理"}`;
const formatRate=(rate:number)=>Number.isInteger(rate)?String(rate):rate.toFixed(1).replace(/\.0$/,"");
const recipeRateText=(current:MachineRecipe)=>{
  const cyclesPerMinute=60/(current.durationTicks/SIM_TICKS_PER_SECOND);
  const side=(quantities:RecipeQuantity[],fallback:string)=>quantities.length?quantities.map((quantity)=>`${itemName(quantity.itemId)} ${formatRate(quantity.amount*cyclesPerMinute)}/min`).join(" + "):fallback;
  return `${side(current.inputs,"环境输入")} → ${side(current.outputs,"无返还物")}`;
};

const edgePorts=(height:number,side:Direction,x:number):PortSpec[]=>Array.from({length:height},(_,y)=>({x,y,side}));

const EQUIPMENT_LAYOUTS: Partial<Record<Kind,EquipmentLayout>> = {
  depot:{width:1,height:3,inputs:[],outputs:[{x:0,y:1,side:0}]},
  storagePort:{width:1,height:3,inputs:[{x:0,y:1,side:2}],outputs:[]},
  protocolStash:{width:3,height:3,inputs:edgePorts(3,2,0),outputs:edgePorts(3,0,2)},
  refiner:{width:3,height:3,inputs:[...edgePorts(3,2,0),{x:1,y:2,side:1,transport:"pipe",modes:["fluid"]}],outputs:[...edgePorts(3,0,2),{x:1,y:0,side:3,transport:"pipe",modes:["fluid"]}]},
  crusher:{width:3,height:3,inputs:edgePorts(3,2,0),outputs:edgePorts(3,0,2)},
  fitter:{width:3,height:3,inputs:edgePorts(3,2,0),outputs:edgePorts(3,0,2)},
  molder:{width:3,height:3,inputs:[...edgePorts(3,2,0),{x:1,y:1,side:0,transport:"pipe",modes:["gas"]}],outputs:edgePorts(3,0,2)},
  filler:{width:4,height:6,inputs:[...edgePorts(6,2,0),{x:1,y:5,side:1,transport:"pipe",modes:["fluid","gas"]}],outputs:edgePorts(6,0,3)},
  dismantler:{width:4,height:6,inputs:[{x:0,y:2,side:2}],outputs:[{x:3,y:1,side:0,outputIndex:0},{x:3,y:4,side:0,transport:"pipe",outputIndex:1}]},
  sealer:{width:4,height:6,inputs:edgePorts(6,2,0),outputs:edgePorts(6,0,3)},
  grinder:{width:4,height:6,inputs:edgePorts(6,2,0),outputs:edgePorts(6,0,3)},
  seedPicker:{width:5,height:5,inputs:edgePorts(5,2,0),outputs:edgePorts(5,0,4)},
  planter:{width:5,height:5,inputs:[...edgePorts(5,2,0),{x:2,y:4,side:1,transport:"pipe",modes:["fluid"]}],outputs:edgePorts(5,0,4)},
  reactor:{width:5,height:5,inputs:[{x:0,y:1,side:2},{x:0,y:3,side:2,transport:"pipe"}],outputs:[{x:2,y:0,side:3},{x:4,y:1,side:0,transport:"pipe",outputIndex:1},{x:4,y:3,side:0,transport:"pipe",outputIndex:0}]},
  expandedReactor:{width:6,height:5,inputs:[{x:1,y:4,side:1},{x:2,y:4,side:1},{x:3,y:4,side:1},{x:4,y:4,side:1},{x:5,y:1,side:0,transport:"pipe"},{x:5,y:3,side:0,transport:"pipe"}],outputs:[{x:1,y:0,side:3},{x:2,y:0,side:3},{x:3,y:0,side:3},{x:4,y:0,side:3},{x:0,y:1,side:2,transport:"pipe",outputIndex:0},{x:0,y:3,side:2,transport:"pipe",outputIndex:1}]},
  purifier:{width:5,height:5,inputs:[{x:0,y:2,side:2,transport:"pipe"},{x:2,y:4,side:1,modes:["gas"]}],outputs:[{x:4,y:1,side:0,transport:"pipe",outputIndex:1},{x:4,y:3,side:0,transport:"pipe",outputIndex:0}]},
  waterTreatment:{width:3,height:3,inputs:[{x:0,y:1,side:2,transport:"pipe"}],outputs:[]},
  forge:{width:5,height:5,inputs:[...edgePorts(5,2,0),{x:2,y:4,side:1,transport:"pipe"}],outputs:edgePorts(5,0,4)},
  gearAssembler:{width:4,height:6,inputs:edgePorts(6,2,0),outputs:edgePorts(6,0,3)},
  waterPump:{width:2,height:2,inputs:[],outputs:[{x:1,y:1,side:0,transport:"pipe"}]},
  acidWaterPump:{width:2,height:2,inputs:[],outputs:[{x:1,y:1,side:0,transport:"pipe"}]},
  gasDisperser:{width:3,height:3,inputs:[{x:0,y:1,side:2,transport:"pipe"}],outputs:[]},
  liquidGasConverter:{width:5,height:5,inputs:[{x:4,y:1,side:0,transport:"pipe"},{x:4,y:3,side:0,transport:"pipe"},{x:2,y:4,side:1,transport:"pipe"}],outputs:[{x:0,y:1,side:2,transport:"pipe"},{x:0,y:3,side:2,transport:"pipe"}]},
  solidGasConverter:{width:5,height:5,inputs:[{x:1,y:4,side:1,modes:["gas"]},{x:3,y:4,side:1,modes:["gas"]},{x:4,y:1,side:0,transport:"pipe",modes:["solid"]},{x:4,y:3,side:0,transport:"pipe",modes:["solid"]},{x:2,y:4,side:1,transport:"pipe"}],outputs:[{x:0,y:1,side:2,transport:"pipe",modes:["gas"]},{x:0,y:3,side:2,transport:"pipe",modes:["gas"]},{x:1,y:0,side:3,modes:["solid"]},{x:3,y:0,side:3,modes:["solid"]}]},
  gasReactor:{width:5,height:5,inputs:[{x:0,y:1,side:2,transport:"pipe"},{x:0,y:3,side:2,transport:"pipe"}],outputs:[{x:4,y:1,side:0,transport:"pipe"},{x:4,y:3,side:0,transport:"pipe"}]},
  splitter:{width:1,height:1,inputs:[{x:0,y:0,side:2}],outputs:[{x:0,y:0,side:0},{x:0,y:0,side:1},{x:0,y:0,side:3}]},
  merger:{width:1,height:1,inputs:[{x:0,y:0,side:2},{x:0,y:0,side:1},{x:0,y:0,side:3}],outputs:[{x:0,y:0,side:0}]},
  logisticsBridge:{width:1,height:1,inputs:[{x:0,y:0,side:2},{x:0,y:0,side:3}],outputs:[{x:0,y:0,side:0},{x:0,y:0,side:1}]},
  pipeSplitter:{width:1,height:1,inputs:[{x:0,y:0,side:2,transport:"pipe"}],outputs:[{x:0,y:0,side:0,transport:"pipe"},{x:0,y:0,side:1,transport:"pipe"},{x:0,y:0,side:3,transport:"pipe"}]},
  pipeMerger:{width:1,height:1,inputs:[{x:0,y:0,side:2,transport:"pipe"},{x:0,y:0,side:1,transport:"pipe"},{x:0,y:0,side:3,transport:"pipe"}],outputs:[{x:0,y:0,side:0,transport:"pipe"}]},
  pipeBridge:{width:1,height:1,inputs:[{x:0,y:0,side:2,transport:"pipe"},{x:0,y:0,side:3,transport:"pipe"}],outputs:[{x:0,y:0,side:0,transport:"pipe"},{x:0,y:0,side:1,transport:"pipe"}]},
  itemLimiter:{width:1,height:1,inputs:[{x:0,y:0,side:2}],outputs:[{x:0,y:0,side:0}]},
  pipeLimiter:{width:1,height:1,inputs:[{x:0,y:0,side:2,transport:"pipe"}],outputs:[{x:0,y:0,side:0,transport:"pipe"}]},
  undergroundPipeInlet:{width:3,height:3,inputs:[{x:0,y:1,side:2,transport:"pipe"}],outputs:[]},
  undergroundPipeOutlet:{width:3,height:3,inputs:[],outputs:[{x:2,y:1,side:0,transport:"pipe"}]},
  multiUndergroundPipeInlet:{width:3,height:5,inputs:[{x:0,y:1,side:2,transport:"pipe"},{x:0,y:3,side:2,transport:"pipe"}],outputs:[]},
  multiUndergroundPipeOutlet:{width:3,height:5,inputs:[],outputs:[{x:2,y:1,side:0,transport:"pipe"},{x:2,y:3,side:0,transport:"pipe"}]},
};

function rotatePort(port:PortSpec,width:number,height:number,rotation:Direction) {
  let x=port.x,y=port.y,w=width,h=height;
  for(let turn=0;turn<rotation;turn++){
    [x,y]=[h-1-y,x];
    [w,h]=[h,w];
  }
  return {x,y,side:((port.side+rotation)%4) as Direction};
}

function resolvePorts(grid:Grid):ResolvedPort[] {
  const entities=new Map<string,{kind:Kind;rotation:Direction;recipeId?:string;positions:Point[]}>();
  Object.entries(grid).forEach(([key,cell])=>{
    if(!EQUIPMENT_LAYOUTS[cell.kind])return;
    const [x,y]=key.split(",").map(Number);
    const entity=entities.get(cell.id)??{kind:cell.kind,rotation:cell.rotation,recipeId:cell.recipeId,positions:[]};
    if(cell.root&&cell.recipeId)entity.recipeId=cell.recipeId;
    entity.positions.push({x,y}); entities.set(cell.id,entity);
  });
  const ports:ResolvedPort[]=[];
  entities.forEach((entity,entityId)=>{
    const layout=EQUIPMENT_LAYOUTS[entity.kind];
    if(!layout)return;
    const definition=entity.kind in MACHINE_DEFINITIONS?MACHINE_DEFINITIONS[entity.kind as ProductionKind]:undefined;
    const mode=definition?activeRecipe(definition,entity.recipeId).mode:undefined;
    const minX=Math.min(...entity.positions.map(({x})=>x)),minY=Math.min(...entity.positions.map(({y})=>y));
    const append=(spec:PortSpec,type:PortType,index:number)=>{
      const rotated=rotatePort(spec,layout.width,layout.height,entity.rotation);
      const [dx,dy]=DELTAS[rotated.side];
      const cellX=minX+rotated.x,cellY=minY+rotated.y;
      ports.push({key:`${entityId}:${type}:${index}`,entityId,entityKind:entity.kind,type,index,side:rotated.side,transport:spec.transport??"belt",cellX,cellY,externalX:cellX+dx,externalY:cellY+dy,outputIndex:spec.outputIndex});
    };
    layout.inputs.filter((port)=>!port.modes||Boolean(mode&&port.modes.includes(mode))).forEach((port,index)=>append(port,"input",index));
    layout.outputs.filter((port)=>!port.modes||Boolean(mode&&port.modes.includes(mode))).forEach((port,index)=>append(port,"output",index));
  });
  return ports;
}

function portsConnectDirectly(sourcePort:ResolvedPort,targetPort:ResolvedPort) {
  return sourcePort.type==="output"&&targetPort.type==="input"&&
    sourcePort.entityId!==targetPort.entityId&&sourcePort.transport===targetPort.transport&&
    sourcePort.side===opposite(targetPort.side)&&
    sourcePort.externalX===targetPort.cellX&&sourcePort.externalY===targetPort.cellY&&
    targetPort.externalX===sourcePort.cellX&&targetPort.externalY===sourcePort.cellY&&
    (isLogistics(sourcePort.entityKind)||isLogistics(targetPort.entityKind));
}

function resolveDirectPortConnections(ports:ResolvedPort[]):DirectPortConnection[] {
  const inputs=ports.filter((port)=>port.type==="input");
  return ports.filter((port)=>port.type==="output").flatMap((sourcePort)=>{
    const targetPort=inputs.find((candidate)=>portsConnectDirectly(sourcePort,candidate));
    return targetPort?[{sourcePort,targetPort}]:[];
  });
}

function isPortConnected(grid:Grid,pipeGrid:Grid,port:ResolvedPort,directPortKeys:ReadonlySet<string>) {
  if(directPortKeys.has(port.key))return true;
  const flow=(port.transport==="pipe"?pipeGrid:grid)[keyOf(port.externalX,port.externalY)];
  if(flow?.kind!==port.transport)return false;
  return port.type==="output" ? flow.entry===opposite(port.side) : flow.rotation===opposite(port.side);
}

function findAutoPath(start:Point,end:Point,cols:number,rows:number,blocked:Set<string>):Point[]|null {
  if(start.x===end.x&&start.y===end.y)return [start];
  type Node={x:number;y:number;direction:Direction|null;g:number;h:number;f:number;parent:Node|null};
  const open:Node[]=[{...start,direction:null,g:0,h:Math.abs(start.x-end.x)+Math.abs(start.y-end.y),f:0,parent:null}];
  const best=new Map<string,number>();
  const closed=new Set<string>();
  const nodeKey=(x:number,y:number,direction:Direction|null)=>`${x},${y},${direction??"s"}`;
  for(let iterations=0;open.length&&iterations<5000;iterations++){
    open.sort((a,b)=>a.f-b.f||a.h-b.h);
    const current=open.shift()!;
    const currentKey=nodeKey(current.x,current.y,current.direction);
    if(closed.has(currentKey))continue;
    closed.add(currentKey);
    if(current.x===end.x&&current.y===end.y){
      const path:Point[]=[]; let node:Node|null=current;
      while(node){path.push({x:node.x,y:node.y});node=node.parent}
      return path.reverse();
    }
    const directions=([0,1,2,3] as Direction[]).sort((a,b)=>{
      const [adx,ady]=DELTAS[a],[bdx,bdy]=DELTAS[b];
      return Math.abs(current.x+adx-end.x)+Math.abs(current.y+ady-end.y)-Math.abs(current.x+bdx-end.x)-Math.abs(current.y+bdy-end.y);
    });
    for(const direction of directions){
      const [dx,dy]=DELTAS[direction],x=current.x+dx,y=current.y+dy;
      if(x<0||y<0||x>=cols||y>=rows)continue;
      const positionKey=keyOf(x,y);
      if(blocked.has(positionKey)&&!(x===end.x&&y===end.y))continue;
      const turnCost=current.direction!=null&&current.direction!==direction ? .18 : 0;
      const g=current.g+1+turnCost,h=Math.abs(x-end.x)+Math.abs(y-end.y),key=nodeKey(x,y,direction);
      if(g>=(best.get(key)??Infinity))continue;
      best.set(key,g); open.push({x,y,direction,g,h,f:g+h,parent:current});
    }
  }
  return null;
}

function makeDraftRoute(draft:BeltDraft):FlowRoute|null {
  if(!draft.cells.length)return null;
  const cells=draft.cells.map((point,index,array)=>{
    const previous=array[index-1],next=array[index+1];
    const entry=previous?directionBetween(point.x,point.y,previous.x,previous.y)??undefined:draft.replan?.anchorEntry??(draft.sourcePort?opposite(draft.sourcePort.side):undefined);
    const rotation=next?directionBetween(point.x,point.y,next.x,next.y)!:draft.targetPort?opposite(draft.targetPort.side):draft.join?.rotation??(previous?directionBetween(previous.x,previous.y,point.x,point.y)!:draft.sourcePort?.side??0);
    return {x:point.x,y:point.y,cell:{kind:draft.kind,rotation,entry,id:`draft-${index}`,root:true}};
  });
  return {id:`${draft.kind}-draft`,kind:draft.kind,cells,path:roundedPath(cells)};
}

function arrowAngle(cell: Cell) {
  if (cell.entry == null) return cell.rotation * 90;
  const incoming = DELTAS[opposite(cell.entry)], outgoing = DELTAS[cell.rotation];
  const x = incoming[0] + outgoing[0], y = incoming[1] + outgoing[1];
  return x === 0 && y === 0 ? cell.rotation * 90 : Math.atan2(y,x) * 180 / Math.PI;
}

function arrowAnchor(x: number, y: number, cell: Cell) {
  if (cell.entry == null || cell.entry === opposite(cell.rotation)) return { x:x+.5, y:y+.5 };
  const entry = DELTAS[cell.entry], exit = DELTAS[cell.rotation];
  return { x:x+.5+(entry[0]+exit[0])*.125, y:y+.5+(entry[1]+exit[1])*.125 };
}

function pipeFillRatio(transits:TransitItem[],cellIndex:number,cellCount:number) {
  const units=transits.filter((transit)=>Math.min(cellCount-1,Math.max(0,Math.floor(transit.position)))===cellIndex).length;
  return Math.min(1,units/PIPE_LANE_PROFILE.unitsPerCell);
}

function AssetThumb({src,label,className=""}:{src?:string;label:string;className?:string}) {
  if(src)return <img className={className||undefined} src={publicAssetPath(src)} alt={label}/>;
  return <span className={`content-placeholder ${className}`.trim()} role="img" aria-label={`${label}图像待补`}><strong>{Array.from(label).slice(0,2).join("")}</strong><small>待补图</small></span>;
}

function pointOnRoute(route:FlowRoute,progress:number) {
  const routeDistance=Math.max(0,Math.min(route.cells.length-.0001,progress*route.cells.length));
  const index=Math.floor(routeDistance),local=routeDistance-index,{x,y,cell}=route.cells[index];
  const center={x:x+.5,y:y+.5},entryDelta=cell.entry==null?[0,0]:DELTAS[cell.entry],exitDelta=DELTAS[cell.rotation];
  const start={x:center.x+entryDelta[0]*.5,y:center.y+entryDelta[1]*.5},end={x:center.x+exitDelta[0]*.5,y:center.y+exitDelta[1]*.5};
  if(cell.entry==null||cell.entry===opposite(cell.rotation))return{x:start.x+(end.x-start.x)*local,y:start.y+(end.y-start.y)*local};
  const inverse=1-local;
  return{x:inverse*inverse*start.x+2*inverse*local*center.x+local*local*end.x,y:inverse*inverse*start.y+2*inverse*local*center.y+local*local*end.y};
}

function CargoRouteSprites({transits,route,running,stalled}:{transits:TransitItem[];route:FlowRoute;running:boolean;stalled:boolean}) {
  const routeRef=useRef<SVGGElement>(null);
  useEffect(()=>{
    const node=routeRef.current;if(!node)return;
    const sprites=new Map([...node.querySelectorAll<SVGGElement>("[data-transit-id]")].map((sprite)=>[sprite.dataset.transitId!,sprite]));
    const place=(ratio:number)=>transits.forEach((transit)=>{const sprite=sprites.get(transit.id);if(!sprite)return;const from=running?transit.previousPosition:transit.position,position=from+(transit.position-from)*ratio,point=pointOnRoute(route,position/route.cells.length);sprite.setAttribute("transform",`translate(${point.x} ${point.y})`)});
    if(!running){place(1);return}
    const started=performance.now();let frame=0;
    const animate=(now:number)=>{
      const ratio=Math.min(1,(now-started)/SIM_TICK_MS);place(ratio);
      if(ratio<1)frame=requestAnimationFrame(animate);
    };
    frame=requestAnimationFrame(animate);
    return()=>cancelAnimationFrame(frame);
  },[route,running,transits]);
  return <g ref={routeRef} className={`route-cargo-sprites ${running?"moving":"paused"} ${stalled?"stalled":""}`}>{transits.map((transit)=>{const renderPosition=running?transit.previousPosition:transit.position,initial=pointOnRoute(route,renderPosition/route.cells.length),item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===transit.itemId);return <g key={transit.id} className="flow-cargo" transform={`translate(${initial.x} ${initial.y})`} data-transit-id={transit.id} data-position={transit.position.toFixed(3)}><rect x="-.3" y="-.3" width=".6" height=".6" rx=".05"/>{item?.image?<image href={publicAssetPath(item.image)} x="-.25" y="-.25" width=".5" height=".5" preserveAspectRatio="xMidYMid meet"/>:<text className="flow-placeholder" x="0" y=".075" textAnchor="middle">{Array.from(item?.name??"物")[0]}</text>}</g>})}</g>;
}

function roundedPath(points: { x:number; y:number; cell:Cell }[]) {
  if (!points.length) return "";
  const centers = points.map((point) => ({ x:point.x + .5, y:point.y + .5 }));
  const first = points[0], last = points[points.length-1];
  const startDelta = first.cell.entry == null ? [0,0] : DELTAS[first.cell.entry];
  const endDelta = DELTAS[last.cell.rotation];
  const expanded = [
    {x:centers[0].x+startDelta[0]*.5,y:centers[0].y+startDelta[1]*.5},
    ...centers,
    {x:centers[centers.length-1].x+endDelta[0]*.5,y:centers[centers.length-1].y+endDelta[1]*.5},
  ].filter((point,index,array)=>index===0 || point.x!==array[index-1].x || point.y!==array[index-1].y);
  if (expanded.length === 1) return `M ${expanded[0].x-.18} ${expanded[0].y} L ${expanded[0].x+.18} ${expanded[0].y}`;
  let path = `M ${expanded[0].x} ${expanded[0].y}`;
  for (let i = 1; i < expanded.length - 1; i++) {
    const previous = expanded[i - 1], current = expanded[i], next = expanded[i + 1];
    const before = { x:current.x - (current.x - previous.x) * .28, y:current.y - (current.y - previous.y) * .28 };
    const after = { x:current.x + (next.x - current.x) * .28, y:current.y + (next.y - current.y) * .28 };
    path += ` L ${before.x} ${before.y} Q ${current.x} ${current.y} ${after.x} ${after.y}`;
  }
  const end = expanded[expanded.length - 1];
  return `${path} L ${end.x} ${end.y}`;
}

function getFlowRoutes(grid: Grid, kind: TransportKind): FlowRoute[] {
  const entries = Object.entries(grid).filter(([, cell]) => cell.kind === kind);
  const byKey = new Map(entries);
  const nextKey = (key: string, cell: Cell) => {
    const [x, y] = key.split(",").map(Number);
    const [dx, dy] = DELTAS[cell.rotation];
    const targetKey = keyOf(x + dx, y + dy);
    const target = byKey.get(targetKey);
    return target?.entry === opposite(cell.rotation) ? targetKey : null;
  };
  const incoming = new Set<string>();
  entries.forEach(([key, cell]) => { const next = nextKey(key, cell); if (next) incoming.add(next); });
  const visited = new Set<string>();
  const routes: FlowRoute[] = [];
  const walk = (start: string) => {
    const cells: FlowRoute["cells"] = [];
    let current: string | null = start;
    while (current && !visited.has(current)) {
      visited.add(current);
      const cell = byKey.get(current);
      if (!cell) break;
      const [x, y] = current.split(",").map(Number);
      cells.push({ x, y, cell });
      current = nextKey(current, cell);
    }
    if (cells.length) routes.push({ id:`${kind}-${start}`, kind, cells, path:roundedPath(cells) });
  };
  entries.filter(([key]) => !incoming.has(key)).forEach(([key]) => walk(key));
  entries.forEach(([key]) => { if (!visited.has(key)) walk(key); });
  return routes;
}

const DEVICE_CATEGORIES:DeviceCategory[]=["全部","资源开采","仓储存取","基础生产","合成制造","电力供应","功能设备","战斗辅助","种植调配"];
const tools: { kind: Kind; label: string; type:"tool"|"device"; category?:DeviceCategory; glyph: string; desc: string; image?: string }[] = [
  { kind: "belt", label: "传送带", type:"tool", glyph: "BELT", desc: "固体 · 30/min", image:"/assets/ui/belt-tool.svg" },
  { kind: "pipe", label: "管道", type:"tool", glyph: "PIPE", desc: "流体 · 120/min", image:"/assets/ui/pipe-tool.svg" },
  { kind: "depot", label: "仓库取货口", type:"device", category:"仓储存取", glyph: "D", desc: "1×3 · 指定物品输出", image:"/assets/machines/warehouse-pickup-port.webp" },
  { kind: "storagePort", label: "仓库存货口", type:"device", category:"仓储存取", glyph: "ST", desc: "1×3 · 回收入库", image:"/assets/machines/storage-port.webp" },
  { kind: "protocolStash", label: "协议储存箱", type:"device", category:"仓储存取", glyph: "PSH", desc: "3×3 · 6 槽 · 无线回仓" },
  { kind: "splitter", label: "分流器", type:"device", category:"仓储存取", glyph: "S", desc: "1 入 · 3 出", image:"/assets/machines/splitter.webp" },
  { kind: "merger", label: "汇流器", type:"device", category:"仓储存取", glyph: "M", desc: "3 入 · 1 出", image:"/assets/machines/merger.webp" },
  { kind: "logisticsBridge", label: "物流桥", type:"device", category:"仓储存取", glyph: "BR", desc: "两轴独立直通 · 无库存", image:"/assets/machines/logistics-bridge.webp" },
  { kind: "itemLimiter", label: "物品准入口", type:"device", category:"仓储存取", glyph: "IL", desc: "1×1 · 物品与流速限制", image:"/assets/machines/item-limiter.webp" },
  { kind: "pipeSplitter", label: "管道分流器", type:"device", category:"仓储存取", glyph: "PS", desc: "1 入 · 至多 3 出", image:"/assets/machines/pipe-splitter.svg" },
  { kind: "pipeMerger", label: "管道汇流器", type:"device", category:"仓储存取", glyph: "PM", desc: "至多 3 入 · 1 出", image:"/assets/machines/pipe-merger.svg" },
  { kind: "pipeBridge", label: "管道桥", type:"device", category:"仓储存取", glyph: "PB", desc: "两轴独立直通 · 无库存", image:"/assets/machines/pipe-bridge.svg" },
  { kind: "pipeLimiter", label: "管道准入口", type:"device", category:"仓储存取", glyph: "PLM", desc: "1×1 · 介质与流速限制", image:"/assets/machines/pipe-limiter.webp" },
  { kind: "undergroundPipeInlet", label: "暗管入口", type:"device", category:"仓储存取", glyph: "UI", desc: "3×3 · 单管道输入", image:"/assets/machines/underground-pipe-inlet.webp" },
  { kind: "undergroundPipeOutlet", label: "暗管出口", type:"device", category:"仓储存取", glyph: "UO", desc: "3×3 · 单管道输出", image:"/assets/machines/underground-pipe-outlet.webp" },
  { kind: "multiUndergroundPipeInlet", label: "多口暗管入口", type:"device", category:"仓储存取", glyph: "MUI", desc: "3×5 · 双管道输入", image:"/assets/machines/multi-underground-pipe-inlet.webp" },
  { kind: "multiUndergroundPipeOutlet", label: "多口暗管出口", type:"device", category:"仓储存取", glyph: "MUO", desc: "3×5 · 双管道输出", image:"/assets/machines/multi-underground-pipe-outlet.webp" },
  { kind: "refiner", label: "精炼炉", type:"device", category:"基础生产", glyph: "R", desc: "矿石 → 金属块", image:"/assets/machines/refinery.webp" },
  { kind: "crusher", label: "粉碎机", type:"device", category:"基础生产", glyph: "CR", desc: "3×3 · 固体粉碎", image:"/assets/machines/crusher.webp" },
  { kind: "fitter", label: "配件机", type:"device", category:"基础生产", glyph: "F", desc: "金属块 → 零件", image:"/assets/machines/assembler.webp" },
  { kind: "molder", label: "塑形机", type:"device", category:"基础生产", glyph: "MO", desc: "3×3 · 固体/气体模式", image:"/assets/machines/molder.webp" },
  { kind: "seedPicker", label: "采种机", type:"device", category:"种植调配", glyph: "SP", desc: "5×5 · 植物采种", image:"/assets/machines/seed-picker.webp" },
  { kind: "planter", label: "种植机", type:"device", category:"种植调配", glyph: "PL", desc: "5×5 · 固体/液体模式", image:"/assets/machines/planter.webp" },
  { kind: "gearAssembler", label: "装备原件机", type:"device", category:"合成制造", glyph: "GA", desc: "6×4 · 双物料合成", image:"/assets/machines/gear-assembler.webp" },
  { kind: "filler", label: "灌装机", type:"device", category:"合成制造", glyph: "FI", desc: "4×6 · 固体与流体输入", image:"/assets/machines/filler.webp" },
  { kind: "dismantler", label: "拆解机", type:"device", category:"合成制造", glyph: "DM", desc: "4×6 · 容器与介质拆解", image:"/assets/machines/dismantler.webp" },
  { kind: "sealer", label: "封装机", type:"device", category:"合成制造", glyph: "PK", desc: "6×4 · 电池与爆炸物", image:"/assets/machines/sealer.webp" },
  { kind: "grinder", label: "研磨机", type:"device", category:"合成制造", glyph: "GR", desc: "6×4 · 粉末精细研磨", image:"/assets/machines/grinder.webp" },
  { kind: "reactor", label: "反应池", type:"device", category:"合成制造", glyph: "RC", desc: "5×5 · 固液反应", image:"/assets/machines/reactor.webp" },
  { kind: "expandedReactor", label: "扩容反应池", type:"device", category:"合成制造", glyph: "ERC", desc: "6×5 · 8 槽并行配方", image:"/assets/machines/expanded-reactor.webp" },
  { kind: "purifier", label: "提纯机", type:"device", category:"合成制造", glyph: "PU", desc: "5×5 · 气体/液体提纯", image:"/assets/machines/purifier.webp" },
  { kind: "waterTreatment", label: "废水处理机", type:"device", category:"基础生产", glyph: "WT", desc: "3×3 · 废液无害化", image:"/assets/machines/water-treatment.webp" },
  { kind: "forge", label: "天有洪炉", type:"device", category:"合成制造", glyph: "FS", desc: "5×5 · 息壤合成", image:"/assets/machines/forge-of-the-sky.webp" },
  { kind: "waterPump", label: "水泵", type:"device", category:"资源开采", glyph: "WP", desc: "2×2 · 清水 60/min", image:"/assets/machines/water-pump.svg" },
  { kind: "acidWaterPump", label: "二型耐酸水泵", type:"device", category:"资源开采", glyph: "AWP", desc: "2×2 · 清水/沉积酸", image:"/assets/machines/water-pump.svg" },
  { kind: "gasDisperser", label: "气体散布机", type:"device", category:"功能设备", glyph: "GD", desc: "3×3 · 14×14 环境", image:"/assets/machines/gas-disperser.webp" },
  { kind: "liquidGasConverter", label: "液气转化机", type:"device", category:"合成制造", glyph: "LGC", desc: "5×5 · 液体/气体互转", image:"/assets/machines/liquid-gas-converter.webp" },
  { kind: "solidGasConverter", label: "固气转化机", type:"device", category:"合成制造", glyph: "SGC", desc: "5×5 · 固体/气体互转", image:"/assets/machines/solid-gas-converter.webp" },
  { kind: "gasReactor", label: "气体反应炉", type:"device", category:"合成制造", glyph: "GRX", desc: "5×5 · 气体反应", image:"/assets/machines/gas-reactor.webp" },
  { kind: "powerPole", label: "供电桩", type:"device", category:"电力供应", glyph: "PWR", desc: "2×2 · 供电范围 12×12", image:"/assets/machines/supply-pole.webp" },
];

const baseInitial: Grid = {
  "2,4": { kind: "depot", rotation: 0, id: "a", partX:0, partY:0, width:1, height:3, itemId:"blue-iron-ore" },
  "2,5": { kind: "depot", rotation: 0, id: "a", root:true, partX:0, partY:1, width:1, height:3, itemId:"blue-iron-ore" },
  "2,6": { kind: "depot", rotation: 0, id: "a", partX:0, partY:2, width:1, height:3, itemId:"blue-iron-ore" },
  "3,5": { kind: "belt", rotation: 0, entry:2, id: "b" },
  "4,5": { kind: "belt", rotation: 3, entry:2, id: "c" },
  "4,4": { kind: "belt", rotation: 3, entry:1, id: "c2" },
  "4,3": { kind: "belt", rotation: 0, entry:1, id: "c3" },
  "8,3": { kind: "belt", rotation: 0, entry:2, id: "f" },
};

const initial = (() => {
  const next = { ...baseInitial };
  const seed = (kind: "refiner" | "fitter", sx: number, sy: number, id: string) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++)
      next[keyOf(sx + dx, sy + dy)] = { kind, rotation: 0, id, root: dx === 1 && dy === 1, partX:dx, partY:dy, size:3, width:3, height:3 };
  };
  seed("refiner", 5, 2, "d"); seed("fitter", 9, 2, "g");
  for (let dy=0;dy<2;dy++) for (let dx=0;dx<2;dx++)
    next[keyOf(7+dx,7+dy)]={kind:"powerPole",rotation:0,id:"power-a",root:dx===1&&dy===1,partX:dx,partY:dy,width:2,height:2};
  return next;
})();

const isTransport = (kind?: Kind) => kind === "belt" || kind === "pipe";
const BELT_LOGISTICS = new Set<Kind>(["splitter","merger","logisticsBridge","itemLimiter"]);
const PIPE_LOGISTICS = new Set<Kind>(["pipeSplitter","pipeMerger","pipeBridge","pipeLimiter"]);
const PIPE_TRANSFER_DEVICES = new Set<Kind>(["undergroundPipeInlet","undergroundPipeOutlet","multiUndergroundPipeInlet","multiUndergroundPipeOutlet"]);
const isLogistics=(kind:Kind)=>BELT_LOGISTICS.has(kind)||PIPE_LOGISTICS.has(kind)||PIPE_TRANSFER_DEVICES.has(kind);
const UNDERGROUND_INLETS=new Set<Kind>(["undergroundPipeInlet","multiUndergroundPipeInlet"]);
const UNDERGROUND_OUTLETS=new Set<Kind>(["undergroundPipeOutlet","multiUndergroundPipeOutlet"]);
const undergroundPairCompatible=(source:Kind,target:Kind)=>(source==="undergroundPipeInlet"&&target==="undergroundPipeOutlet")||(source==="undergroundPipeOutlet"&&target==="undergroundPipeInlet")||(source==="multiUndergroundPipeInlet"&&target==="multiUndergroundPipeOutlet")||(source==="multiUndergroundPipeOutlet"&&target==="multiUndergroundPipeInlet");
const isBridge=(kind:Kind|undefined)=>kind==="logisticsBridge"||kind==="pipeBridge";
const logisticsTransport=(kind:Kind):TransportKind|null=>BELT_LOGISTICS.has(kind)?"belt":PIPE_LOGISTICS.has(kind)?"pipe":null;
const straightDirection=(cell?:Cell):Direction|null=>cell&&isTransport(cell.kind)&&cell.entry===opposite(cell.rotation)?cell.rotation:null;
const bridgeRotationFor=(first:Direction,second:Direction):Direction|null=>{
  if(first%2===second%2)return null;
  return ([0,1,2,3] as Direction[]).find((rotation)=>new Set<Direction>([rotation,((rotation+1)%4) as Direction]).has(first)&&new Set<Direction>([rotation,((rotation+1)%4) as Direction]).has(second))??null;
};
const catalogCellValid=(kind:Kind,key:string,grid:Grid,pipeGrid:Grid)=>{
  const transport=logisticsTransport(kind);
  if(transport==="belt")return (!grid[key]||straightDirection(grid[key])!==null);
  if(transport==="pipe")return !grid[key]&&(!pipeGrid[key]||straightDirection(pipeGrid[key])!==null);
  return !grid[key]&&!pipeGrid[key];
};

function analyzeDraftRoute(route:FlowRoute,draft:BeltDraft,grid:Grid,pipeGrid:Grid):DraftAnalysis {
  const conflicts=new Set<string>(),crossings:DraftCrossing[]=[];
  const transportGrid=draft.kind==="pipe"?pipeGrid:grid;
  const replaceable=new Set(draft.replan?.replaceKeys??[]);
  const anchorKey=draft.replan?keyOf(draft.cells[0].x,draft.cells[0].y):null;
  const finalIndex=route.cells.length-1;
  route.cells.forEach(({x,y,cell},index)=>{
    const key=keyOf(x,y),existing=transportGrid[key],base=grid[key];
    if(key===anchorKey||replaceable.has(key))return;
    if(draft.join?.key===key&&index===finalIndex){
      const incoming=Object.entries(transportGrid).some(([sourceKey,source])=>{
        if(sourceKey===key||replaceable.has(sourceKey)||source.kind!==draft.kind)return false;
        const [sx,sy]=sourceKey.split(",").map(Number),[dx,dy]=DELTAS[source.rotation];
        return sx+dx===x&&sy+dy===y&&existing?.entry===opposite(source.rotation);
      });
      if(existing?.kind!==draft.kind||existing.entry!==cell.entry||incoming)conflicts.add(key);
      return;
    }
    if(existing){
      const existingDirection=straightDirection(existing),draftDirection=straightDirection(cell);
      const bridgeRotation=existingDirection!==null&&draftDirection!==null?bridgeRotationFor(existingDirection,draftDirection):null;
      if(bridgeRotation!==null&&!(draft.kind==="pipe"&&base))crossings.push({key,x,y,bridgeKind:draft.kind==="pipe"?"pipeBridge":"logisticsBridge",rotation:bridgeRotation});
      else conflicts.add(key);
      return;
    }
    if(base&&!isTransport(base.kind))conflicts.add(key);
  });
  return {valid:conflicts.size===0,conflicts,crossings};
}
const RADIAL_ACTIONS:{id:RadialAction;label:string;keyLabel:string;position:"top"|"right"|"bottom"|"left"}[] = [
  {id:"rotate",label:"旋转",keyLabel:"R",position:"top"},
  {id:"move",label:"移动",keyLabel:"M",position:"right"},
  {id:"copy",label:"复制",keyLabel:"C",position:"bottom"},
  {id:"delete",label:"拆除",keyLabel:"DEL",position:"left"},
];

export default function Home() {
  const [grid, setGrid] = useState<Grid>(initial);
  const [pipeGrid,setPipeGrid]=useState<Grid>({});
  const [selected, setSelected] = useState<Kind>("belt");
  const [deviceCategory,setDeviceCategory]=useState<DeviceCategory>("全部");
  const [selectionMode, setSelectionMode] = useState(false);
  const [marqueeMode,setMarqueeMode]=useState(false);
  const [marquee,setMarquee]=useState<MarqueeState|null>(null);
  const [groupSelection,setGroupSelection]=useState<GroupSelection|null>(null);
  const [pickedGroup,setPickedGroup]=useState<PickedGroup|null>(null);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedTransportKey,setSelectedTransportKey]=useState<string|null>(null);
  const [selectedTransportKind,setSelectedTransportKind]=useState<TransportKind>("belt");
  const [pickedEntity, setPickedEntity] = useState<PickedEntity | null>(null);
  const [placementPreview,setPlacementPreview]=useState<{x:number;y:number}|null>(null);
  const [beltBuildMode,setBeltBuildMode]=useState<TransportKind|null>(null);
  const [beltDraft,setBeltDraft]=useState<BeltDraft|null>(null);
  const [beltPreviewPoint,setBeltPreviewPoint]=useState<Point|null>(null);
  const [hoveredEntity,setHoveredEntity]=useState<{id:string;x:number;y:number}|null>(null);
  const [running, setRunning] = useState(false);
  const [simulation,setSimulation]=useState<SimulationState>(emptySimulationState);
  const simulationSnapshotRef=useRef(simulation);
  const [inventoryItemId,setInventoryItemId]=useState("blue-iron-ore");
  const [inventoryAmount,setInventoryAmount]=useState(10);
  const [notice, setNotice] = useState("演示蓝图已载入 · 按 E 规划传送带");
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [gridOpacity, setGridOpacity] = useState(0.1);
  const [canvasView,setCanvasView]=useState<CanvasView>("blueprint");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState<{ x:number; y:number; ox:number; oy:number } | null>(null);
  const [radialMenu,setRadialMenu]=useState<RadialMenuState|null>(null);
  const [catalogDrag,setCatalogDrag]=useState<Kind|null>(null);
  const [catalogPreview,setCatalogPreview]=useState<Point|null>(null);
  const catalogDragKindRef=useRef<Kind|null>(null);
  const catalogPointerRef=useRef<{pointerId:number;startX:number;startY:number;dragged:boolean}|null>(null);
  const catalogDropRef=useRef<(x:number,y:number,kind:Kind)=>void>(()=>{});
  const gridRef=useRef<HTMLDivElement>(null);
  const radialHoldTimer=useRef<number|null>(null);
  const radialConfirmTimer=useRef<number|null>(null);
  const radialGestureRef=useRef<RadialGesture|null>(null);

  useEffect(() => () => {
    if(radialHoldTimer.current!==null)window.clearTimeout(radialHoldTimer.current);
    if(radialConfirmTimer.current!==null)window.clearTimeout(radialConfirmTimer.current);
  },[]);

  useEffect(()=>{catalogDropRef.current=placeTool});
  useEffect(()=>{simulationSnapshotRef.current=simulation},[simulation]);

  useEffect(()=>{
    const pointAt=(clientX:number,clientY:number,kind:Kind)=>{
      const element=gridRef.current;if(!element)return null;
      const layout=EQUIPMENT_LAYOUTS[kind],width=layout?.width??(kind==="powerPole"?2:1),height=layout?.height??(kind==="powerPole"?2:1),rect=element.getBoundingClientRect();
      if(clientX<rect.left||clientY<rect.top||clientX>rect.right||clientY>rect.bottom)return null;
      const hit=document.elementFromPoint(clientX,clientY);if(!hit||!element.contains(hit))return null;
      const x=Math.max(0,Math.min(cols-width,Math.floor((clientX-rect.left)/rect.width*cols))),y=Math.max(0,Math.min(rows-height,Math.floor((clientY-rect.top)/rect.height*rows)));
      const valid=Array.from({length:width*height},(_,index)=>keyOf(x+index%width,y+Math.floor(index/width))).every((key)=>catalogCellValid(kind,key,grid,pipeGrid));
      return{x,y,valid};
    };
    const move=(event:MouseEvent|PointerEvent)=>{const kind=catalogDragKindRef.current,gesture=catalogPointerRef.current;if(!kind||!gesture)return;if(!gesture.dragged&&Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)<6)return;gesture.dragged=true;const point=pointAt(event.clientX,event.clientY,kind);setCatalogPreview(point?{x:point.x,y:point.y}:null)};
    const finish=(event:MouseEvent|PointerEvent)=>{const kind=catalogDragKindRef.current,gesture=catalogPointerRef.current;if(!kind)return;const point=gesture?.dragged?pointAt(event.clientX,event.clientY,kind):null;catalogDragKindRef.current=null;catalogPointerRef.current=null;setCatalogDrag(null);setCatalogPreview(null);if(point?.valid)catalogDropRef.current(point.x,point.y,kind);else{setSelected("belt");setNotice(gesture?.dragged?(point?"目标占地与现有设备或物流线路冲突":"拖动已取消 · 请在可见画布网格内释放"):"设备仅支持拖动添加")}};
    const cancel=()=>{if(catalogDragKindRef.current===null)return;catalogDragKindRef.current=null;catalogPointerRef.current=null;setCatalogDrag(null);setCatalogPreview(null);setSelected("belt")};
    window.addEventListener("pointermove",move);window.addEventListener("mousemove",move);window.addEventListener("pointerup",finish);window.addEventListener("mouseup",finish);window.addEventListener("pointercancel",cancel);
    return()=>{window.removeEventListener("pointermove",move);window.removeEventListener("mousemove",move);window.removeEventListener("pointerup",finish);window.removeEventListener("mouseup",finish);window.removeEventListener("pointercancel",cancel)};
  },[cols,grid,pipeGrid,rows]);

  const counts = useMemo(() => {
    const values = Object.values(grid);
    return {
      devices: new Set(values.filter((c) => !isTransport(c.kind)).map((c) => c.id)).size,
      belts: values.filter((c) => c.kind === "belt").length,
      pipes: Object.keys(pipeGrid).length,
    };
  }, [grid,pipeGrid]);
  const beltRoutes = useMemo(() => getFlowRoutes(grid, "belt"), [grid]);
  const pipeRoutes = useMemo(() => getFlowRoutes(pipeGrid, "pipe"), [pipeGrid]);
  const flowRoutes = useMemo(()=>[...beltRoutes,...pipeRoutes],[beltRoutes,pipeRoutes]);
  const resolvedPorts=useMemo(()=>resolvePorts(grid),[grid]);
  const directPortConnections=useMemo(()=>resolveDirectPortConnections(resolvedPorts),[resolvedPorts]);
  const directlyConnectedPortKeys=useMemo(()=>new Set(directPortConnections.flatMap(({sourcePort,targetPort})=>[sourcePort.key,targetPort.key])),[directPortConnections]);
  const hiddenDirectPortKeys=useMemo(()=>{
    const hidden=new Set<string>();
    directPortConnections.forEach(({sourcePort,targetPort})=>{
      const sourceIsLogistics=isLogistics(sourcePort.entityKind),targetIsLogistics=isLogistics(targetPort.entityKind);
      if(sourceIsLogistics!==targetIsLogistics)hidden.add(sourceIsLogistics?sourcePort.key:targetPort.key);
      else hidden.add(targetPort.key);
    });
    return hidden;
  },[directPortConnections]);
  const portsByCell=useMemo(()=>{
    const index=new Map<string,ResolvedPort[]>();
    resolvedPorts.forEach((port)=>{const key=keyOf(port.cellX,port.cellY),ports=index.get(key)??[];ports.push(port);index.set(key,ports)});
    return index;
  },[resolvedPorts]);
  const connectedFlowRoutes=useMemo<ConnectedFlowRoute[]>(()=>{
    const sourceItemFor=(sourcePort:ResolvedPort|undefined,kind:TransportKind)=>{
      const depotCell=sourcePort?.entityKind==="depot"?Object.values(grid).find((cell)=>cell.id===sourcePort.entityId):undefined;
      const sourceDefinition=sourcePort&&sourcePort.entityKind in MACHINE_DEFINITIONS?MACHINE_DEFINITIONS[sourcePort.entityKind as ProductionKind]:undefined;
      const sourceCell=sourcePort?Object.values(grid).find((cell)=>cell.id===sourcePort.entityId):undefined;
      if(sourcePort&&UNDERGROUND_OUTLETS.has(sourcePort.entityKind)&&!sourceCell?.pairedEntityId){
        return INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===sourceCell?.itemId&&candidate.category==="流体");
      }
      if(sourcePort&&sourceCell&&isSharedBufferMachine(sourcePort.entityKind)){
        const selectedItemId=(sourceCell.outputFilters??defaultOutputFilters(sourceDefinition!))[outputFilterKey(sourcePort,kind)];
        return INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===selectedItemId&&itemTransport(candidate.id)===kind);
      }
      const sourceRecipe=sourceDefinition?activeRecipe(sourceDefinition,sourceCell?.recipeId):undefined;
      const indexedOutput=sourcePort?.outputIndex==null?undefined:sourceRecipe?.outputs[sourcePort.outputIndex];
      const sourceOutput=indexedOutput&&itemTransport(indexedOutput.itemId)===kind?indexedOutput:sourceRecipe?.outputs.find((output)=>itemTransport(output.itemId)===kind);
      return sourcePort?.entityKind==="depot"?INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===depotCell?.itemId):INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===sourceOutput?.itemId);
    };
    const routes:ConnectedFlowRoute[]=flowRoutes.map((route)=>{
      const first=route.cells[0],last=route.cells[route.cells.length-1];
      const sourcePort=resolvedPorts.find((port)=>port.transport===route.kind&&port.type==="output"&&port.externalX===first.x&&port.externalY===first.y&&first.cell.entry===opposite(port.side));
      const targetPort=resolvedPorts.find((port)=>port.transport===route.kind&&port.type==="input"&&port.externalX===last.x&&port.externalY===last.y&&last.cell.rotation===opposite(port.side));
      const item=sourceItemFor(sourcePort,route.kind);
      return {...route,sourcePort,targetPort,sourceConnected:Boolean(sourcePort),targetConnected:Boolean(targetPort),valid:Boolean(sourcePort),itemId:item?.id,itemName:item?.name??(sourcePort?.entityKind==="depot"?"取货口未选择物品":sourcePort?.entityKind==="protocolStash"?"协议储存箱库存":"未接入输出口"),itemImage:item?.image??""};
    });
    directPortConnections.forEach(({sourcePort,targetPort})=>{
      const kind=sourcePort.transport,item=sourceItemFor(sourcePort,kind);
      routes.push({
        id:`direct-${sourcePort.key}-${targetPort.key}`,kind,direct:true,path:"",
        cells:[{x:targetPort.cellX,y:targetPort.cellY,cell:{id:`direct-${sourcePort.key}-${targetPort.key}`,kind,rotation:sourcePort.side,entry:opposite(sourcePort.side)}}],
        sourcePort,targetPort,sourceConnected:true,targetConnected:true,valid:true,
        itemId:item?.id,itemName:item?.name??(sourcePort.entityKind==="depot"?"取货口未选择物品":sourcePort.entityKind==="protocolStash"?"协议储存箱库存":"未接入输出口"),itemImage:item?.image??"",
      });
    });
    const outgoingByEntity=new Map<string,ConnectedFlowRoute[]>();
    routes.forEach((route)=>{if(!route.sourcePort)return;const outgoing=outgoingByEntity.get(route.sourcePort.entityId)??[];outgoing.push(route);outgoingByEntity.set(route.sourcePort.entityId,outgoing)});
    const propagationQueue=routes.filter((route)=>route.valid&&route.itemId);
    for(let cursor=0;cursor<propagationQueue.length;cursor++){
      const upstream=propagationQueue[cursor],targetPort=upstream.targetPort;
      if(!targetPort||!isLogistics(targetPort.entityKind))continue;
      const targetIsBridge=targetPort.entityKind==="logisticsBridge"||targetPort.entityKind==="pipeBridge";
      (outgoingByEntity.get(targetPort.entityId)??[]).forEach((route)=>{
        if(route.itemId||(targetIsBridge&&!bridgePortsPair(targetPort,route.sourcePort)))return;
        route.itemId=upstream.itemId;route.itemName=upstream.itemName;route.itemImage=upstream.itemImage;propagationQueue.push(route);
      });
    }
    return routes;
  },[flowRoutes,resolvedPorts,directPortConnections,grid]);
  const connectedRouteById=useMemo(()=>new Map(connectedFlowRoutes.map((route)=>[route.id,route])),[connectedFlowRoutes]);
  const bridgeForwardRoutes=useMemo(()=>{
    const forwards=new Map<string,ConnectedFlowRoute>();
    connectedFlowRoutes.forEach((incoming)=>{
      const inputPort=incoming.targetPort;
      if(!inputPort||!isBridge(inputPort.entityKind))return;
      const outgoing=pairedBridgeOutput(incoming,connectedFlowRoutes);
      if(outgoing)forwards.set(incoming.id,outgoing);
    });
    return forwards;
  },[connectedFlowRoutes]);
  const connectedRouteByCell=useMemo(()=>{
    const index=new Map<string,ConnectedFlowRoute>();
    connectedFlowRoutes.forEach((route)=>{if(!route.direct)route.cells.forEach(({x,y})=>index.set(`${route.kind}:${keyOf(x,y)}`,route))});
    return index;
  },[connectedFlowRoutes]);
  const powerZones = useMemo<PowerZone[]>(()=>{
    const poles=new Map<string,{x:number;y:number}[]>();
    Object.entries(grid).forEach(([key,cell])=>{
      if(cell.kind!=="powerPole")return;
      const [x,y]=key.split(",").map(Number);
      const positions=poles.get(cell.id)??[]; positions.push({x,y}); poles.set(cell.id,positions);
    });
    return [...poles.entries()].map(([id,positions])=>{
      const minX=Math.min(...positions.map(({x})=>x)),minY=Math.min(...positions.map(({y})=>y));
      return {id,x:minX-5,y:minY-5,size:12};
    });
  },[grid]);
  const gasZones = useMemo<GasZone[]>(()=>{
    const devices=new Map<string,{x:number;y:number}[]>();
    Object.entries(grid).forEach(([key,cell])=>{
      if(cell.kind!=="gasDisperser")return;
      const [x,y]=key.split(",").map(Number),positions=devices.get(cell.id)??[];
      positions.push({x,y});devices.set(cell.id,positions);
    });
    return [...devices.entries()].map(([id,positions])=>{
      const minX=Math.min(...positions.map(({x})=>x)),minY=Math.min(...positions.map(({y})=>y)),input=simulation.inventories[id]?.input??{},cell=Object.values(grid).find((candidate)=>candidate.id===id),definition=MACHINE_DEFINITIONS.gasDisperser,currentRecipe=activeRecipe(definition,cell?.recipeId);
      const itemId=Object.keys(input).find((candidate)=>(input[candidate]??0)>0)??((simulation.processes[id]??0)>0?currentRecipe.inputs[0]?.itemId:undefined);
      return {id,x:minX-5,y:minY-5,size:14,itemId};
    });
  },[grid,simulation.inventories,simulation.processes]);
  useEffect(()=>{
    if(!running)return;
    const timer=window.setInterval(()=>{
      const snapshot=simulationSnapshotRef.current;
      setGrid((old)=>{
        const choices=new Map<string,string>();
        Object.values(old).forEach((cell)=>{
          if(choices.has(cell.id)||!(cell.kind in MACHINE_DEFINITIONS))return;
          const definition=MACHINE_DEFINITIONS[cell.kind as ProductionKind];
          if(definition.autoSchedule||(snapshot.processes[cell.id]??0)>0)return;
          const input=snapshot.inventories[cell.id]?.input??{},nextRecipe=automaticRecipe(definition,cell.recipeId,input);
          if(nextRecipe.id!==activeRecipe(definition,cell.recipeId).id)choices.set(cell.id,nextRecipe.id);
        });
        return choices.size?Object.fromEntries(Object.entries(old).map(([key,cell])=>[key,choices.has(cell.id)?{...cell,recipeId:choices.get(cell.id)}:cell])):old;
      });
      setSimulation((previous)=>{
      const tick=previous.tick+1;
      const inventories=Object.fromEntries(Object.entries(previous.inventories).map(([id,inventory])=>[id,{input:{...inventory.input},output:{...inventory.output}}]));
      const processes={...previous.processes};
      const routeCursor={...previous.routeCursor};
      const recipeCursor={...previous.recipeCursor};
      const laneReadyAt={...previous.laneReadyAt};
      const routeTransfers=Object.fromEntries(Object.entries(previous.routeTransfers).map(([routeId,ticks])=>[routeId,ticks.filter((transferTick)=>tick-transferTick<=60*SIM_TICKS_PER_SECOND)]));
      const producedThisTick:Record<string,number>={};
      const consumedThisTick:Record<string,number>={};
      const ensureInventory=(id:string)=>inventories[id]??(inventories[id]={input:{},output:{}});
      const entityKinds=new Map<string,Kind>();
      const entityCells=new Map<string,Cell>();
      const productionEntities=new Map<string,{kind:ProductionKind;positions:Point[];cell:Cell}>();
      const protocolStashEntities=new Map<string,{positions:Point[];cell:Cell}>();
      Object.entries(grid).forEach(([key,cell])=>{
        entityKinds.set(cell.id,cell.kind);
        if(!entityCells.has(cell.id))entityCells.set(cell.id,cell);
        if(cell.kind==="protocolStash"){
          const [x,y]=key.split(",").map(Number),entity=protocolStashEntities.get(cell.id)??{positions:[],cell};
          entity.positions.push({x,y});protocolStashEntities.set(cell.id,entity);
        }
        if(!(cell.kind in MACHINE_DEFINITIONS))return;
        const [x,y]=key.split(",").map(Number),kind=cell.kind as ProductionKind;
        const entity=productionEntities.get(cell.id)??{kind,positions:[],cell};entity.positions.push({x,y});productionEntities.set(cell.id,entity);
      });
      const acidEnvironmentZones:PowerZone[]=[];
      productionEntities.forEach((entity,id)=>{
        if(entity.kind!=="gasDisperser")return;
        const recipe=activeRecipe(MACHINE_DEFINITIONS.gasDisperser,entity.cell.recipeId),inventory=inventories[id]?.input??{},activeAcid=(inventory["acid-gas"]??0)>0||((processes[id]??0)>0&&recipe.inputs[0]?.itemId==="acid-gas");
        if(!activeAcid)return;
        const minX=Math.min(...entity.positions.map(({x})=>x)),minY=Math.min(...entity.positions.map(({y})=>y));acidEnvironmentZones.push({id,x:minX-5,y:minY-5,size:14});
      });
      entityKinds.forEach((kind,id)=>{if(isBridge(kind))delete inventories[id]});
      entityKinds.forEach((kind,id)=>{
        if(!PIPE_TRANSFER_DEVICES.has(kind)||!inventories[id])return;
        inventories[id]={input:Object.fromEntries(Object.entries(inventories[id].input).filter(([itemId,quantity])=>quantity>0&&itemTransport(itemId)==="pipe")),output:{}};
      });
      protocolStashEntities.forEach((entity,id)=>{
        const inventory=ensureInventory(id),minX=Math.min(...entity.positions.map(({x})=>x)),minY=Math.min(...entity.positions.map(({y})=>y));
        const powered=powerZones.some((zone)=>zone.x<minX+3&&zone.x+zone.size>minX&&zone.y<minY+3&&zone.y+zone.size>minY),processKey=protocolStashProcessKey(id);
        const advanced=advanceProtocolStash(inventory.input,processes[processKey]??0,{wireless:(entity.cell.protocolStashMode??"wireless")==="wireless",powered,transferTicks:secondsToTicks(PROTOCOL_STASH_TRANSFER_SECONDS)});
        inventory.input=advanced.bucket;processes[processKey]=advanced.elapsedTicks;
      });
      productionEntities.forEach((entity,id)=>{
        const definition=MACHINE_DEFINITIONS[entity.kind],inventory=ensureInventory(id);
        const minX=Math.min(...entity.positions.map(({x})=>x)),minY=Math.min(...entity.positions.map(({y})=>y));
        const powered=definition.requiresPower===false||powerZones.some((zone)=>zone.x<minX+(entity.cell.width??definition.width)&&zone.x+zone.size>minX&&zone.y<minY+(entity.cell.height??definition.height)&&zone.y+zone.size>minY);
        const environmentReady=entity.kind!=="gasReactor"||acidEnvironmentZones.some((zone)=>zone.x<minX+(entity.cell.width??definition.width)&&zone.x+zone.size>minX&&zone.y<minY+(entity.cell.height??definition.height)&&zone.y+zone.size>minY);
        if(!powered||!environmentReady)return;
        let candidates:MachineRecipe[];
        if(definition.autoSchedule==="parallel"){
          const active=definition.recipes.filter((candidate)=>(processes[`${id}::${candidate.id}`]??0)>0),working={...inventory.input},starters:MachineRecipe[]=[];let projected={...inventory.input},capacityBlocked=false;
          active.forEach((candidate)=>{const next=bufferWithOutputs(entity.kind,projected,candidate.outputs);if(next)projected=next;else capacityBlocked=true});
          definition.recipes.forEach((candidate)=>{
            if(capacityBlocked||active.includes(candidate)||active.length+starters.length>=(definition.parallelSlots??definition.recipes.length))return;
            const nextProjected=bufferAfterRecipe(entity.kind,projected,candidate);
            if(!candidate.inputs.every((requirement)=>(working[requirement.itemId]??0)>=requirement.amount)||!nextProjected)return;
            candidate.inputs.forEach((requirement)=>{working[requirement.itemId]=Math.max(0,(working[requirement.itemId]??0)-requirement.amount)});projected=nextProjected;starters.push(candidate);
          });
          candidates=[...active,...starters];
        }else if(definition.autoSchedule==="roundRobin"){
          const active=definition.recipes.find((candidate)=>(processes[`${id}::${candidate.id}`]??0)>0);
          if(active)candidates=[active];
          else{const cursor=(recipeCursor[id]??0)%definition.recipes.length,ordered=definition.recipes.map((_,index)=>definition.recipes[(cursor+index)%definition.recipes.length]),ready=ordered.find((candidate)=>candidate.inputs.every((requirement)=>(inventory.input[requirement.itemId]??0)>=requirement.amount)&&Boolean(bufferAfterRecipe(entity.kind,inventory.input,candidate)));candidates=ready?[ready]:[]}
        }else candidates=[activeRecipe(definition,entity.cell.recipeId)];
        candidates.forEach((currentRecipe)=>{
          const sharedBuffer=Boolean(definition.autoSchedule),processKey=sharedBuffer?`${id}::${currentRecipe.id}`:id;
          const inputsReady=currentRecipe.inputs.every((requirement)=>(inventory.input[requirement.itemId]??0)>=requirement.amount);
          if(sharedBuffer){
            const existingProgress=processes[processKey]??0;
            if(existingProgress===0){
              if(!inputsReady||!bufferAfterRecipe(entity.kind,inventory.input,currentRecipe))return;
              currentRecipe.inputs.forEach((requirement)=>{inventory.input[requirement.itemId]=Math.max(0,(inventory.input[requirement.itemId]??0)-requirement.amount);addQuantity(consumedThisTick,requirement.itemId,requirement.amount)});
            }
            const nextProgress=Math.min(currentRecipe.durationTicks,existingProgress+1);
            if(nextProgress<currentRecipe.durationTicks){processes[processKey]=nextProgress;return}
            const completedBuffer=bufferWithOutputs(entity.kind,inventory.input,currentRecipe.outputs);
            if(!completedBuffer){processes[processKey]=currentRecipe.durationTicks;return}
            inventory.input=completedBuffer;currentRecipe.outputs.forEach((output)=>addQuantity(producedThisTick,output.itemId,output.amount));processes[processKey]=0;
            if(definition.autoSchedule==="roundRobin")recipeCursor[id]=(definition.recipes.indexOf(currentRecipe)+1)%definition.recipes.length;
            return;
          }
          const outputTotal=totalInventory(inventory.output),outputAmount=currentRecipe.outputs.reduce((sum,output)=>sum+output.amount,0);
          if(!inputsReady||outputTotal+outputAmount>outputCapacityFor(entity.kind))return;
          const nextProgress=(processes[processKey]??0)+1;
          if(nextProgress<currentRecipe.durationTicks){processes[processKey]=nextProgress;return}
          currentRecipe.inputs.forEach((requirement)=>{inventory.input[requirement.itemId]=Math.max(0,(inventory.input[requirement.itemId]??0)-requirement.amount);addQuantity(consumedThisTick,requirement.itemId,requirement.amount)});
          currentRecipe.outputs.forEach((output)=>{inventory.output[output.itemId]=(inventory.output[output.itemId]??0)+output.amount;addQuantity(producedThisTick,output.itemId,output.amount)});processes[processKey]=0;
        });
      });
      const previousByRoute=new Map<string,TransitItem[]>();
      previous.transits.forEach((transit)=>{const lane=previousByRoute.get(transit.routeId)??[];lane.push(transit);previousByRoute.set(transit.routeId,lane)});
      const activeByRoute=new Map<string,TransitItem[]>();
      connectedFlowRoutes.forEach((route)=>{
        const lane=previousByRoute.get(route.id)??[];
        const target=route.targetPort&&!isBridge(route.targetPort.entityKind)?ensureInventory(route.targetPort.entityId):null;
        const leading=lane.length?lane.reduce((front,candidate)=>candidate.position>front.position?candidate:front):null,targetKind=route.targetPort?entityKinds.get(route.targetPort.entityId):undefined;
        const canExit=Boolean(target&&(!leading||bufferCanAccept(targetKind,target.input,leading.itemId,1)));
         const advanced=route.kind==="pipe"?advancePipeLane(lane,route.cells.length,canExit):advanceBeltLane(lane,route.cells.length,canExit);
        activeByRoute.set(route.id,advanced.active);
        if(target)advanced.delivered.forEach((transit)=>{target.input[transit.itemId]=(target.input[transit.itemId]??0)+1});
      });
      bridgeForwardRoutes.forEach((outgoing,incomingId)=>{
        const incoming=connectedRouteById.get(incomingId),incomingLane=activeByRoute.get(incomingId)??[],outgoingLane=activeByRoute.get(outgoing.id)??[];
        if(!incoming||!incomingLane.length||(laneReadyAt[outgoing.id]??0)>tick)return;
        const pitch=incoming.kind==="pipe"?PIPE_LANE_PROFILE.itemPitch:1;
        const leader=incomingLane.reduce((front,candidate)=>candidate.position>front.position?candidate:front);
        if(leader.position<incoming.cells.length-pitch/2-1e-9)return;
        const canAccept=outgoing.kind==="pipe"?pipeLaneCanAccept(outgoingLane,outgoing.cells.length):beltLaneCanAccept(outgoingLane,outgoing.cells.length);
        if(!canAccept)return;
        activeByRoute.set(incomingId,incomingLane.filter((transit)=>transit.id!==leader.id));
        activeByRoute.set(outgoing.id,[...outgoingLane,{...leader,routeId:outgoing.id,position:0,previousPosition:0}]);
        laneReadyAt[outgoing.id]=nextLaneReadyTick(tick,outgoing.kind==="pipe"?PIPE_HEADWAY_TICKS:BELT_HEADWAY_TICKS);
        routeTransfers[outgoing.id]=[...(routeTransfers[outgoing.id]??[]),tick];
      });
      const transferredUnderground=new Set<string>();
      Object.values(grid).forEach((cell)=>{
        if(!UNDERGROUND_INLETS.has(cell.kind)||!cell.pairedEntityId||transferredUnderground.has(cell.id))return;
        const targetKind=entityKinds.get(cell.pairedEntityId);
        if(!targetKind||!undergroundPairCompatible(cell.kind,targetKind))return;
        const targetCell=Object.values(grid).find((candidate)=>candidate.id===cell.pairedEntityId);
        if(targetCell?.pairedEntityId!==cell.id)return;
        const tunnelKey=`underground:${cell.id}:${cell.pairedEntityId}`;
        if((laneReadyAt[tunnelKey]??0)>tick)return;
        const source=ensureInventory(cell.id),target=ensureInventory(cell.pairedEntityId),itemId=Object.keys(source.input).find((candidate)=>(source.input[candidate]??0)>0&&itemTransport(candidate)==="pipe");
        if(!itemId||inputTotalFor(target.input,"pipe")>=inputCapacityFor(targetKind,"pipe"))return;
        source.input[itemId]=Math.max(0,(source.input[itemId]??0)-1);addQuantity(target.input,itemId,1);
        laneReadyAt[tunnelKey]=nextLaneReadyTick(tick,PIPE_HEADWAY_TICKS);transferredUnderground.add(cell.id);
      });
      const groups=new Map<string,ConnectedFlowRoute[]>();
      connectedFlowRoutes.forEach((route)=>{if(!route.valid||!route.sourcePort||isBridge(route.sourcePort.entityKind)||(!route.itemId&&route.sourcePort.entityKind==="depot"))return;const list=groups.get(route.sourcePort.entityId)??[];list.push(route);groups.set(route.sourcePort.entityId,list)});
      groups.forEach((routes,sourceId)=>{
        const sourceKind=entityKinds.get(sourceId),sourceCell=entityCells.get(sourceId),sourceInventory=ensureInventory(sourceId);
        const undergroundSourceItem=sourceKind&&UNDERGROUND_OUTLETS.has(sourceKind)&&!sourceCell?.pairedEntityId?INDUSTRIAL_ITEMS.find((item)=>item.id===sourceCell?.itemId&&item.category==="流体"):undefined;
        const undergroundSourceRate=clampUndergroundSourceRate(sourceCell?.sourceRatePerMinute??60,PIPE_ITEMS_PER_MINUTE);
        const infiniteUndergroundSource=Boolean(undergroundSourceItem&&undergroundSourceRate>0);
        const sourceCreditKey=undergroundSourceProcessKey(sourceId);
        let sourceCredit=processes[sourceCreditKey]??0;
        const ready=new Set(routes.filter((route)=>{
          if((laneReadyAt[route.id]??0)>tick)return false;
           return route.kind==="pipe"?pipeLaneCanAccept(activeByRoute.get(route.id)??[],route.cells.length):beltLaneCanAccept(activeByRoute.get(route.id)??[],route.cells.length);
        }).map((route)=>route.id));
        if(infiniteUndergroundSource){sourceCredit=advanceUndergroundSourceCredit(sourceCredit,undergroundSourceRate,SIM_TICKS_PER_SECOND,PIPE_ITEMS_PER_MINUTE);if(!ready.size)sourceCredit=Math.min(1,sourceCredit);processes[sourceCreditKey]=sourceCredit}
        if(!ready.size||(infiniteUndergroundSource&&sourceCredit<1))return;
        const sourceBucket=isSharedBufferMachine(sourceKind)?sourceInventory.input:sourceKind&&sourceKind in MACHINE_DEFINITIONS?sourceInventory.output:sourceInventory.input;
        const cursor=(routeCursor[sourceId]??0)%routes.length;
        const ordered=routes.map((_,index)=>routes[(cursor+index)%routes.length]).filter((route)=>ready.has(route.id));
        const available={...sourceBucket};
        const dispatched=(infiniteUndergroundSource?ordered.slice(0,1):ordered).flatMap((route)=>{
          if(infiniteUndergroundSource)return [{route,itemId:undergroundSourceItem!.id}];
          if(sourceKind==="depot")return route.itemId?[{route,itemId:route.itemId}]:[];
          const itemId=isSharedBufferMachine(sourceKind)?((available[route.itemId??""]??0)>0?route.itemId:undefined):(available[route.itemId??""]??0)>0?route.itemId:Object.keys(available).find((candidate)=>itemTransport(candidate)===route.kind&&(available[candidate]??0)>0);
          if(!itemId)return [];
          available[itemId]=(available[itemId]??0)-1;return [{route,itemId}];
        });
        dispatched.forEach(({route,itemId})=>{
          const transit={id:crypto.randomUUID(),routeId:route.id,itemId,position:0,previousPosition:0};
          activeByRoute.set(route.id,[...(activeByRoute.get(route.id)??[]),transit]);
          laneReadyAt[route.id]=nextLaneReadyTick(tick,route.kind==="pipe"?PIPE_HEADWAY_TICKS:BELT_HEADWAY_TICKS);
          routeTransfers[route.id]=[...(routeTransfers[route.id]??[]),tick];
          if(sourceKind==="depot"||infiniteUndergroundSource)addQuantity(producedThisTick,itemId,1);
        });
        if(sourceKind!=="depot"&&!infiniteUndergroundSource)dispatched.forEach(({itemId})=>{sourceBucket[itemId]=Math.max(0,(sourceBucket[itemId]??0)-1)});
        if(infiniteUndergroundSource&&dispatched.length)processes[sourceCreditKey]=Math.max(0,sourceCredit-1);
        if(dispatched.length)routeCursor[sourceId]=(routes.indexOf(dispatched[dispatched.length-1].route)+1)%routes.length;
      });
      const second=Math.floor(tick/SIM_TICKS_PER_SECOND);
      let itemStats=previous.itemStats??[];
      if(Object.keys(producedThisTick).length||Object.keys(consumedThisTick).length){
        const sample=itemStats[itemStats.length-1];
        if(sample?.second===second){const produced={...sample.produced},consumed={...sample.consumed};Object.entries(producedThisTick).forEach(([itemId,amount])=>addQuantity(produced,itemId,amount));Object.entries(consumedThisTick).forEach(([itemId,amount])=>addQuantity(consumed,itemId,amount));itemStats=[...itemStats.slice(0,-1),{second,produced,consumed}]}
        else itemStats=[...itemStats,{second,produced:producedThisTick,consumed:consumedThisTick}];
      }
      if(itemStats[0]?.second<second-STATS_RETENTION_SECONDS)itemStats=itemStats.filter((sample)=>sample.second>=second-STATS_RETENTION_SECONDS);
      // Storage-port delivery is inventory transfer, not consumption; recipe removal is the only consumption event.
      const activeTransits=[...activeByRoute.values()].flat();
      return {tick,inventories,processes,transits:activeTransits,routeCursor,recipeCursor,laneReadyAt,routeTransfers,itemStats};
      });
    },SIM_TICK_MS);
    return ()=>window.clearInterval(timer);
  },[running,grid,connectedFlowRoutes,connectedRouteById,bridgeForwardRoutes,powerZones]);
  const machineStates = useMemo<Record<string,MachineState>>(()=>{
    const entities = new Map<string,{cell:Cell;positions:{x:number;y:number;cell:Cell}[]}>();
    Object.entries(grid).forEach(([key,cell])=>{
      if (!(cell.kind in MACHINE_DEFINITIONS)) return;
      const [x,y]=key.split(",").map(Number);
      const existing=entities.get(cell.id)??{cell,positions:[]};
      existing.positions.push({x,y,cell}); entities.set(cell.id,existing);
    });
    const states:Record<string,MachineState>={};
    entities.forEach(({cell,positions},id)=>{
      const kind=cell.kind as ProductionKind,definition=MACHINE_DEFINITIONS[kind];
      const width=cell.width??definition.width, height=cell.height??definition.height;
      const inventory=simulation.inventories[id]??{input:{},output:{}};
      const solidInputTotal=inputTotalFor(inventory.input,"belt"),fluidInputTotal=inputTotalFor(inventory.input,"pipe"),outputTotal=Object.values(inventory.output).reduce((sum,quantity)=>sum+quantity,0);
      const scheduled=Boolean(definition.autoSchedule),activeScheduled=scheduled?definition.recipes.filter((candidate)=>(simulation.processes[`${id}::${candidate.id}`]??0)>0):[];
      const readyRecipes=scheduled?definition.recipes.filter((candidate)=>candidate.inputs.every((requirement)=>(inventory.input[requirement.itemId]??0)>=requirement.amount)&&Boolean(bufferAfterRecipe(kind,inventory.input,candidate))):[];
      const currentRecipe=activeScheduled[0]??readyRecipes[0]??activeRecipe(definition,cell.recipeId);
      const hasInput=scheduled?activeScheduled.length>0||readyRecipes.length>0:currentRecipe.inputs.every((requirement)=>(inventory.input[requirement.itemId]??0)>=requirement.amount);
      const blockedScheduled=scheduled&&activeScheduled.some((candidate)=>(simulation.processes[`${id}::${candidate.id}`]??0)>=candidate.durationTicks&&!bufferWithOutputs(kind,inventory.input,candidate.outputs));
      const deadlockedSlots=scheduled&&!activeScheduled.length&&!readyRecipes.length&&occupiedBufferSlots(inventory.input)>=bufferSlotsFor(kind);
      const hasOutput=scheduled?!blockedScheduled:outputTotal+currentRecipe.outputs.reduce((sum,output)=>sum+output.amount,0)<=outputCapacityFor(kind);
      const minX=Math.min(...positions.map(({x})=>x)),minY=Math.min(...positions.map(({y})=>y));
      const powered=definition.requiresPower===false||powerZones.some((zone)=>zone.x<minX+width&&zone.x+zone.size>minX&&zone.y<minY+height&&zone.y+zone.size>minY);
      const environmentReady=kind!=="gasReactor"||gasZones.some((zone)=>zone.itemId==="acid-gas"&&zone.x<minX+width&&zone.x+zone.size>minX&&zone.y<minY+height&&zone.y+zone.size>minY);
      const progressTicks=scheduled?Math.max(0,...definition.recipes.map((candidate)=>simulation.processes[`${id}::${candidate.id}`]??0)):simulation.processes[id]??0;
      const incompatibleInputFull=!scheduled&&!hasInput&&(solidInputTotal>=inputCapacityFor(kind,"belt")||fluidInputTotal>=inputCapacityFor(kind,"pipe"));
      const status:MachineState["status"]=!powered?"unpowered":!environmentReady?"environment":!running?"idle":deadlockedSlots||incompatibleInputFull||!hasOutput?"blocked":!hasInput?"starved":"running";
      const progress=Math.min(100,Math.round(progressTicks/currentRecipe.durationTicks*100));
      states[id]={id,kind,recipeId:currentRecipe.id,status,progress,remaining:status==="running"?Math.max(0,(currentRecipe.durationTicks-progressTicks)/SIM_TICKS_PER_SECOND).toFixed(1):"--",hasInput,hasOutput,powered,inventoryFull:scheduled?(totalInventory(inventory.input)>=bufferSlotsFor(kind)*50||deadlockedSlots):solidInputTotal>=inputCapacityFor(kind,"belt")||fluidInputTotal>=inputCapacityFor(kind,"pipe")||outputTotal>=outputCapacityFor(kind)};
    });
    return states;
  },[gasZones,grid,powerZones,simulation.inventories,simulation.processes,running]);
  const flowGraph=useMemo(()=>{
    const visibleKinds=new Set<Kind>([...Object.keys(MACHINE_DEFINITIONS) as ProductionKind[],"depot","storagePort","protocolStash","splitter","merger","pipeSplitter","pipeMerger"]);
    const entities=new Map<string,{kind:Kind;cell:Cell;positions:Point[]}>();
    Object.entries(grid).forEach(([key,cell])=>{
      if(!visibleKinds.has(cell.kind))return;
      const [x,y]=key.split(",").map(Number),entity=entities.get(cell.id)??{kind:cell.kind,cell,positions:[]};
      if(cell.root)entity.cell=cell;entity.positions.push({x,y});entities.set(cell.id,entity);
    });
    const baseNodes=[...entities.entries()].map(([id,entity])=>{
      const definition=entity.kind in MACHINE_DEFINITIONS?MACHINE_DEFINITIONS[entity.kind as ProductionKind]:undefined;
      const currentRecipe=definition?activeRecipe(definition,entity.cell.recipeId):undefined;
      const tool=tools.find((candidate)=>candidate.kind===entity.kind);
      const status=entity.kind==="depot"?"外部供给":entity.kind==="storagePort"?"仓库存货":definition?"工业设备":"物流节点";
      return {id,kind:entity.kind,label:definition?.name??tool?.label??"设备",image:definition&&currentRecipe?machineImageFor(definition,currentRecipe):tool?.image,detail:currentRecipe?.name??tool?.desc??"",status,sourceX:Math.min(...entity.positions.map((point)=>point.x)),sourceY:Math.min(...entity.positions.map((point)=>point.y)),x:0,y:0};
    });
    const visibleIds=new Set(baseNodes.map((node)=>node.id)),edgeKeys=new Set<string>();
    const edges:FlowGraphEdge[]=[];
    const visibleTargetFor=(start:ConnectedFlowRoute)=>{
      let route:ConnectedFlowRoute|undefined=start;
      const visited=new Set<string>();
      while(route?.targetPort&&!visited.has(route.id)){
        visited.add(route.id);
        if(visibleIds.has(route.targetPort.entityId))return route.targetPort.entityId;
        if(!isBridge(route.targetPort.entityKind))return null;
        route=bridgeForwardRoutes.get(route.id);
      }
      return null;
    };
    connectedFlowRoutes.forEach((route)=>{
      const from=route.sourcePort?.entityId;
      if(!from||!visibleIds.has(from)||isBridge(route.sourcePort?.entityKind))return;
      const to=visibleTargetFor(route);
      if(!to||to===from)return;
      const key=`${from}:${to}:${route.kind}`;
      if(edgeKeys.has(key))return;edgeKeys.add(key);
      edges.push({id:key,from,to,kind:route.kind,itemName:route.itemName});
    });
    const indegree=new Map(baseNodes.map((node)=>[node.id,0])),adjacency=new Map<string,Set<string>>(),rank=new Map(baseNodes.map((node)=>[node.id,0]));
    edges.forEach((edge)=>{const targets=adjacency.get(edge.from)??new Set<string>();if(!targets.has(edge.to)){targets.add(edge.to);adjacency.set(edge.from,targets);indegree.set(edge.to,(indegree.get(edge.to)??0)+1)}});
    const queue=baseNodes.filter((node)=>(indegree.get(node.id)??0)===0).sort((a,b)=>a.sourceY-b.sourceY||a.sourceX-b.sourceX).map((node)=>node.id);
    for(let cursor=0;cursor<queue.length;cursor++){
      const id=queue[cursor];
      (adjacency.get(id)??[]).forEach((target)=>{rank.set(target,Math.max(rank.get(target)??0,(rank.get(id)??0)+1));indegree.set(target,(indegree.get(target)??1)-1);if(indegree.get(target)===0)queue.push(target)});
    }
    const groups=new Map<number,typeof baseNodes>();
    baseNodes.forEach((node)=>{const column=rank.get(node.id)??0,list=groups.get(column)??[];list.push(node);groups.set(column,list)});
    groups.forEach((nodes)=>nodes.sort((a,b)=>a.sourceY-b.sourceY||a.sourceX-b.sourceX));
    const nodeWidth=164,nodeHeight=72,columnGap=92,rowGap=34,padding=40;
    const nodes:FlowGraphNode[]=baseNodes.map((node)=>{
      const column=rank.get(node.id)??0,row=(groups.get(column)??[]).findIndex((candidate)=>candidate.id===node.id);
      return {...node,x:padding+column*(nodeWidth+columnGap),y:padding+row*(nodeHeight+rowGap)};
    });
    const maxColumn=Math.max(0,...nodes.map((node)=>rank.get(node.id)??0)),maxRows=Math.max(1,...[...groups.values()].map((nodes)=>nodes.length));
    return {nodes,edges,width:Math.max(720,padding*2+(maxColumn+1)*nodeWidth+maxColumn*columnGap),height:Math.max(420,padding*2+maxRows*nodeHeight+(maxRows-1)*rowGap),nodeWidth,nodeHeight};
  },[bridgeForwardRoutes,connectedFlowRoutes,grid]);
  const tick=simulation.tick;
  const elapsedSeconds=Math.floor(tick/SIM_TICKS_PER_SECOND);
  const productionStates = Object.values(machineStates);
  const prioritizedProductionStates=productionStates.map((state,index)=>({state,sequence:index+1})).sort((a,b)=>Number(b.state.status==="blocked")-Number(a.state.status==="blocked")||a.sequence-b.sequence);
  const selectedEntity = selectedEntityId ? Object.values(grid).find((cell)=>cell.id===selectedEntityId) : null;
  const radialEntity = radialMenu ? Object.values(grid).find((cell)=>cell.id===radialMenu.entityId) : null;
  const radialEntityLabel=radialEntity?tools.find((tool)=>tool.kind===radialEntity.kind)?.label??"设备":"设备";
  const selectedRoute=selectedTransportKey?flowRoutes.find((route)=>route.kind===selectedTransportKind&&route.cells.some(({x,y})=>keyOf(x,y)===selectedTransportKey))??null:null;
  const selectedRouteKeys=useMemo(()=>new Set(selectedRoute?.cells.map(({x,y})=>keyOf(x,y))??[]),[selectedRoute]);
  const groupGridKeySet=useMemo(()=>new Set(groupSelection?.gridKeys??[]),[groupSelection]);
  const groupPipeKeySet=useMemo(()=>new Set(groupSelection?.pipeKeys??[]),[groupSelection]);
  const marqueeBounds=useMemo(()=>marquee?{minX:Math.min(marquee.start.x,marquee.current.x),minY:Math.min(marquee.start.y,marquee.current.y),maxX:Math.max(marquee.start.x,marquee.current.x),maxY:Math.max(marquee.start.y,marquee.current.y)}:null,[marquee]);
  const selectedDepotItem=selectedEntity?.kind==="depot"?INDUSTRIAL_ITEMS.find((item)=>item.id===selectedEntity.itemId):null;
  const showPowerZones=selected==="powerPole"||selectedEntity?.kind==="powerPole";
  const showGasZones=selected==="gasDisperser"||selectedEntity?.kind==="gasDisperser";
  const entityKinds=useMemo(()=>new Map(Object.values(grid).map((cell)=>[cell.id,cell.kind])),[grid]);
  const inventoryFullIds=useMemo(()=>{
    const ids=new Set<string>();
    Object.entries(simulation.inventories).forEach(([id,inventory])=>{
      const kind=entityKinds.get(id);
      if(isBridge(kind))return;
      if(isSlotInventory(kind)){const state=machineStates[id];if(totalInventory(inventory.input)>=bufferSlotsFor(kind)*PROTOCOL_STASH_SLOT_CAPACITY||occupiedBufferSlots(inventory.input)>=bufferSlotsFor(kind)&&(kind==="protocolStash"||state?.status==="blocked"))ids.add(id);return}
      if(inputTotalFor(inventory.input,"belt")>=inputCapacityFor(kind,"belt")||inputTotalFor(inventory.input,"pipe")>=inputCapacityFor(kind,"pipe")||totalInventory(inventory.output)>=outputCapacityFor(kind))ids.add(id);
    });
    return ids;
  },[entityKinds,machineStates,simulation.inventories]);
  const transitsByRoute=useMemo(()=>{
    const lanes=new Map<string,TransitItem[]>();
    simulation.transits.forEach((transit)=>{const lane=lanes.get(transit.routeId)??[];lane.push(transit);lanes.set(transit.routeId,lane)});
    return lanes;
  },[simulation.transits]);
  const stalledRouteIds=useMemo(()=>new Set(connectedFlowRoutes.filter((route)=>{
    if(!running||!route.valid)return false;
    const bridgeOutput=bridgeForwardRoutes.get(route.id),outputLane=bridgeOutput?transitsByRoute.get(bridgeOutput.id)??[]:[];
    const bridgeBlocked=Boolean(route.targetPort&&isBridge(route.targetPort.entityKind)&&(!bridgeOutput||(simulation.laneReadyAt[bridgeOutput.id]??0)>simulation.tick||(bridgeOutput.kind==="pipe"?!pipeLaneCanAccept(outputLane,bridgeOutput.cells.length):!beltLaneCanAccept(outputLane,bridgeOutput.cells.length))));
    const targetInventory=route.targetPort?(simulation.inventories[route.targetPort.entityId]??{input:{},output:{}}).input:{},targetKind=route.targetPort?entityKinds.get(route.targetPort.entityId):undefined,lane=transitsByRoute.get(route.id)??[],incomingItem=lane.length?lane.reduce((front,candidate)=>candidate.position>front.position?candidate:front).itemId:route.itemId;
    const targetBlocked=!route.targetPort||bridgeBlocked||(!isBridge(route.targetPort.entityKind)&&Boolean(incomingItem)&&!bufferCanAccept(targetKind,targetInventory,incomingItem!,1));
     return targetBlocked&&(route.kind==="pipe"?pipeLaneIsFull(transitsByRoute.get(route.id)??[],route.cells.length):beltLaneIsFull(transitsByRoute.get(route.id)??[],route.cells.length));
  }).map((route)=>route.id)),[bridgeForwardRoutes,connectedFlowRoutes,entityKinds,running,simulation.inventories,simulation.laneReadyAt,simulation.tick,transitsByRoute]);
  const transportMeta=useMemo(()=>{
    const meta=new Map<string,{kind:TransportKind;name:string;image:string;rate:number;connected:boolean;targetConnected:boolean;travelSeconds:number;cargoCount:number;capacity:number;full:boolean;color?:string}>();
    const observedSeconds=Math.max(5,Math.min(60,simulation.tick/SIM_TICKS_PER_SECOND));
    connectedFlowRoutes.forEach((route)=>{if(route.direct)return;const lane=transitsByRoute.get(route.id)??[],cargoCount=lane.length,isPipe=route.kind==="pipe",capacity=route.cells.length*(isPipe?PIPE_LANE_PROFILE.unitsPerCell:1),full=isPipe?pipeLaneIsFull(lane,route.cells.length):beltLaneIsFull(lane,route.cells.length),item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===(lane[0]?.itemId??route.itemId)),rate=Math.round((simulation.routeTransfers[route.id]?.length??0)*60/observedSeconds);route.cells.forEach(({x,y})=>meta.set(`${route.kind}:${keyOf(x,y)}`,{kind:route.kind,name:item?.name??route.itemName,image:item?.image??route.itemImage,rate,connected:route.sourceConnected,targetConnected:route.targetConnected,travelSeconds:isPipe?route.cells.length/(PIPE_LANE_PROFILE.cellsPerTick*SIM_TICKS_PER_SECOND):beltTravelSeconds(route.cells.length),cargoCount,capacity,full,color:item?.color}))});
    return meta;
  },[connectedFlowRoutes,simulation.routeTransfers,simulation.tick,transitsByRoute]);
  const involvedStatsItems=INDUSTRIAL_ITEMS;
  const statsCharts=useMemo(()=>{
    const charts=new Map<string,ItemStatsChart>(),currentSecond=elapsedSeconds,samples=new Map(simulation.itemStats.map((sample)=>[sample.second,sample]));
    const earliestSecond=currentSecond-(STATS_CHART_POINTS-1)*STATS_SAMPLE_INTERVAL_SECONDS-STATS_SMOOTHING_SECONDS+1;
    const secondCount=currentSecond-earliestSecond+1;
    involvedStatsItems.forEach((item)=>{
      const producedAmounts=Array.from({length:secondCount},(_,index)=>samples.get(earliestSecond+index)?.produced[item.id]??0);
      const consumedAmounts=Array.from({length:secondCount},(_,index)=>samples.get(earliestSecond+index)?.consumed[item.id]??0);
      const prefix=(amounts:number[])=>{const values=[0];amounts.forEach((amount)=>values.push(values[values.length-1]+amount));return values};
      const producedPrefix=prefix(producedAmounts),consumedPrefix=prefix(consumedAmounts);
      const sumRange=(values:number[],fromSecond:number,toSecond:number)=>{const start=Math.max(0,fromSecond-earliestSecond),end=Math.min(secondCount,toSecond-earliestSecond+1);return end<=start?0:values[end]-values[start]};
      const pointSeconds=Array.from({length:STATS_CHART_POINTS},(_,index)=>currentSecond-(STATS_CHART_POINTS-1-index)*STATS_SAMPLE_INTERVAL_SECONDS);
      const rate=(values:number[])=>pointSeconds.map((pointSecond)=>sumRange(values,pointSecond-STATS_SMOOTHING_SECONDS+1,pointSecond)*60/STATS_SMOOTHING_SECONDS);
      const produced=rate(producedPrefix),consumed=rate(consumedPrefix),maximum=Math.max(1,...produced,...consumed);
      charts.set(item.id,{produced,consumed,producedPath:chartPath(produced,maximum,240,38),consumedPath:chartPath(consumed,maximum,240,38),producedTotal:sumRange(producedPrefix,currentSecond-STATS_HISTORY_SECONDS+1,currentSecond),consumedTotal:sumRange(consumedPrefix,currentSecond-STATS_HISTORY_SECONDS+1,currentSecond)});
    });
    return charts;
  },[elapsedSeconds,involvedStatsItems,simulation.itemStats]);
  const snapCandidate=useMemo(()=>{
    if(!beltBuildMode)return null;
    const type:PortType=beltDraft?"input":"output";
    const point=hoveredEntity??beltPreviewPoint;
    if(!point)return null;
    const last=beltDraft?.cells[beltDraft.cells.length-1];
    const draftKeys=new Set(beltDraft?.cells.map((point)=>keyOf(point.x,point.y))??[]);
    const replaceable=new Set(beltDraft?.replan?.replaceKeys??[]);
    const transportGrid=beltBuildMode==="pipe"?pipeGrid:grid;
    return selectSnapPort(resolvedPorts,{transport:beltBuildMode,type,x:point.x,y:point.y,entityId:hoveredEntity?.id,cols,rows,occupiedKeys:new Set(Object.keys(transportGrid)),draftKeys,replaceableKeys:replaceable,lastPoint:last});
  },[beltBuildMode,beltDraft,beltPreviewPoint,cols,grid,hoveredEntity,pipeGrid,resolvedPorts,rows]);
  const committedDraftRoute=useMemo(()=>beltDraft?makeDraftRoute(beltDraft):null,[beltDraft]);
  const liveDraftRoute=useMemo(()=>{
    if(!beltBuildMode||!beltDraft||!beltPreviewPoint||beltDraft.targetPort)return null;
    if(hoveredEntity&&!snapCandidate)return null;
    const target=snapCandidate?{x:snapCandidate.externalX,y:snapCandidate.externalY}:beltPreviewPoint;
    const start=beltDraft.cells[beltDraft.cells.length-1];
    if(start.x===target.x&&start.y===target.y)return null;
    const transportGrid=beltDraft.kind==="pipe"?pipeGrid:grid;
    const targetKey=keyOf(target.x,target.y),targetFlow=transportGrid[targetKey];
    const deviceBlocked=Object.entries(grid).filter(([,cell])=>!isTransport(cell.kind)).map(([key])=>key);
    if((deviceBlocked.includes(targetKey)&&!snapCandidate)||beltDraft.cells.slice(0,-1).some((cell)=>cell.x===target.x&&cell.y===target.y))return null;
    const blocked=new Set(deviceBlocked);
    beltDraft.cells.slice(0,-1).forEach((cell)=>blocked.add(keyOf(cell.x,cell.y)));
    blocked.delete(keyOf(start.x,start.y));blocked.delete(keyOf(target.x,target.y));
    const segment=findAutoPath(start,target,cols,rows,blocked);
    if(!segment)return null;
    return makeDraftRoute({...beltDraft,cells:[...beltDraft.cells,...segment.slice(1)],targetPort:snapCandidate?.type==="input"?snapCandidate:undefined,join:targetFlow?.kind===beltDraft.kind?{key:targetKey,rotation:targetFlow.rotation}:undefined});
  },[beltBuildMode,beltDraft,beltPreviewPoint,cols,grid,hoveredEntity,pipeGrid,rows,snapCandidate]);
  const draftRoute=liveDraftRoute??committedDraftRoute;
  const draftAnalysis=useMemo<DraftAnalysis|null>(()=>{
    if(!draftRoute||!beltDraft)return null;
    if(!liveDraftRoute)return analyzeDraftRoute(draftRoute,beltDraft,grid,pipeGrid);
    const last=draftRoute.cells[draftRoute.cells.length-1],transportGrid=beltDraft.kind==="pipe"?pipeGrid:grid,existing=transportGrid[keyOf(last.x,last.y)];
    const previewDraft:BeltDraft={...beltDraft,cells:draftRoute.cells.map(({x,y})=>({x,y})),targetPort:snapCandidate?.type==="input"?snapCandidate:undefined,join:existing?.kind===beltDraft.kind?{key:keyOf(last.x,last.y),rotation:existing.rotation}:undefined};
    return analyzeDraftRoute(draftRoute,previewDraft,grid,pipeGrid);
  },[beltDraft,draftRoute,grid,liveDraftRoute,pipeGrid,snapCandidate]);
  const displayFlowRoutes=useMemo(()=>{
    if(!beltDraft?.replan)return flowRoutes;
    const anchor=beltDraft.cells[0];
    return flowRoutes.map((route)=>{
      if(route.id!==beltDraft.replan!.routeId)return route;
      const anchorIndex=route.cells.findIndex((cell)=>cell.x===anchor.x&&cell.y===anchor.y);
      const cells=anchorIndex>=0?route.cells.slice(0,anchorIndex+1):route.cells;
      return {...route,cells,path:roundedPath(cells)};
    });
  },[beltDraft,flowRoutes]);
  const selectedDefinition=selectedEntity&&selectedEntity.kind in MACHINE_DEFINITIONS?MACHINE_DEFINITIONS[selectedEntity.kind as ProductionKind]:null;
  const selectedRecipe=selectedDefinition?activeRecipe(selectedDefinition,selectedEntity?.recipeId):null;
  const selectedModes=selectedDefinition?[...new Set(selectedDefinition.recipes.map((candidate)=>candidate.mode))]:[];
  const inventoryMenuVisible=Boolean(selectedEntity&&selectedEntity.kind!=="depot"&&selectedEntity.kind!=="powerPole"&&!isBridge(selectedEntity.kind));
  const selectedSharedBuffer=Boolean(selectedEntity&&isSharedBufferMachine(selectedEntity.kind));
  const selectedProtocolStash=Boolean(selectedEntity?.kind==="protocolStash");
  const selectedPipeTransfer=Boolean(selectedEntity&&PIPE_TRANSFER_DEVICES.has(selectedEntity.kind));
  const rawSelectedInventory=selectedEntityId?simulation.inventories[selectedEntityId]??{input:{},output:{}}:{input:{},output:{}};
  const selectedInventory=selectedPipeTransfer?{input:Object.fromEntries(Object.entries(rawSelectedInventory.input).filter(([itemId,quantity])=>quantity>0&&itemTransport(itemId)==="pipe")),output:{}}:rawSelectedInventory;
  const selectedUndergroundOutlet=Boolean(selectedEntity&&UNDERGROUND_OUTLETS.has(selectedEntity.kind));
  const selectedUndergroundSourceItem=selectedUndergroundOutlet?INDUSTRIAL_ITEMS.find((item)=>item.id===selectedEntity?.itemId&&item.category==="流体"):undefined;
  const selectedUndergroundSourceRate=clampUndergroundSourceRate(selectedEntity?.sourceRatePerMinute??60,PIPE_ITEMS_PER_MINUTE);
  const selectedSlotInventory=selectedSharedBuffer||selectedProtocolStash;
  const selectedProtocolStashMode:ProtocolStashMode=selectedEntity?.protocolStashMode??"wireless";
  const selectedProtocolStashPositions=selectedEntityId?Object.entries(grid).filter(([,cell])=>cell.id===selectedEntityId).map(([key])=>{const [x,y]=key.split(",").map(Number);return{x,y}}):[];
  const selectedProtocolStashPowered=selectedProtocolStash&&selectedProtocolStashPositions.length>0&&powerZones.some((zone)=>{const minX=Math.min(...selectedProtocolStashPositions.map(({x})=>x)),minY=Math.min(...selectedProtocolStashPositions.map(({y})=>y));return zone.x<minX+3&&zone.x+zone.size>minX&&zone.y<minY+3&&zone.y+zone.size>minY});
  const selectedProtocolStashTicks=selectedEntityId?simulation.processes[protocolStashProcessKey(selectedEntityId)]??0:0;
  const selectedProtocolStashProgress=Math.min(100,selectedProtocolStashTicks/secondsToTicks(PROTOCOL_STASH_TRANSFER_SECONDS)*100);
  const selectedProtocolStashRemaining=Math.max(0,(secondsToTicks(PROTOCOL_STASH_TRANSFER_SECONDS)-selectedProtocolStashTicks)/SIM_TICKS_PER_SECOND).toFixed(1);
  const selectedRelevantRecipes=selectedDefinition?.autoSchedule?selectedDefinition.recipes:selectedRecipe?[selectedRecipe]:[];
  const selectedInputItemIds=[...new Set([...selectedRelevantRecipes.flatMap((candidate)=>candidate.inputs.map((item)=>item.itemId)),...Object.keys(selectedInventory.input)])];
  const selectedSolidInputItemIds=selectedInputItemIds.filter((itemId)=>itemTransport(itemId)==="belt");
  const selectedFluidInputItemIds=selectedInputItemIds.filter((itemId)=>itemTransport(itemId)==="pipe");
  const selectedSolidInputTotal=inputTotalFor(selectedInventory.input,"belt");
  const selectedFluidInputTotal=inputTotalFor(selectedInventory.input,"pipe");
  const selectedHasFluidInput=Boolean(selectedEntityId&&resolvedPorts.some((port)=>port.entityId===selectedEntityId&&port.type==="input"&&port.transport==="pipe"));
  const selectedOutputItemIds=[...new Set([...selectedRelevantRecipes.flatMap((candidate)=>candidate.outputs.map((item)=>item.itemId)),...Object.keys(selectedInventory.output)])];
  const selectedOutputCapacity=outputCapacityFor(selectedEntity?.kind);
  const selectedBufferItemIds=[...new Set([...Object.keys(selectedInventory.input),...selectedRelevantRecipes.flatMap((candidate)=>[...candidate.inputs,...candidate.outputs].map((item)=>item.itemId))])];
  const selectedSolidOutputOptions=selectedBufferItemIds.filter((itemId)=>itemTransport(itemId)==="belt"),selectedPipeOutputOptions=selectedBufferItemIds.filter((itemId)=>itemTransport(itemId)==="pipe");
  const selectedPipeOutputPorts=selectedEntityId?[...new Map(resolvedPorts.filter((port)=>port.entityId===selectedEntityId&&port.type==="output"&&port.transport==="pipe").map((port)=>[port.outputIndex??port.index,port])).values()].sort((a,b)=>(a.outputIndex??a.index)-(b.outputIndex??b.index)):[];
  const selectedHasSolidOutput=Boolean(selectedEntityId&&resolvedPorts.some((port)=>port.entityId===selectedEntityId&&port.type==="output"&&port.transport==="belt"));
  const selectedInventoryItems=selectedPipeTransfer?INDUSTRIAL_ITEMS.filter((item)=>item.category==="流体"):INDUSTRIAL_ITEMS;
  const selectedInventoryItemId=selectedInventoryItems.some((item)=>item.id===inventoryItemId)?inventoryItemId:selectedInventoryItems[0]?.id??"";
  const undergroundCandidates=useMemo(()=>{
    if(!selectedEntity||!PIPE_TRANSFER_DEVICES.has(selectedEntity.kind))return [];
    const unique=new Map<string,Cell>();Object.values(grid).forEach((cell)=>{if(!unique.has(cell.id))unique.set(cell.id,cell)});
    return [...unique.values()].filter((candidate)=>candidate.id!==selectedEntity.id&&undergroundPairCompatible(selectedEntity.kind,candidate.kind));
  },[grid,selectedEntity]);
  const pickedWidth=pickedEntity?Math.max(...pickedEntity.cells.map((cell)=>cell.dx))+1:pickedGroup?Math.max(...pickedGroup.cells.map((cell)=>cell.dx))+1:0;
  const pickedHeight=pickedEntity?Math.max(...pickedEntity.cells.map((cell)=>cell.dy))+1:pickedGroup?Math.max(...pickedGroup.cells.map((cell)=>cell.dy))+1:0;
  const catalogLayout=catalogDrag?EQUIPMENT_LAYOUTS[catalogDrag]:undefined;
  const catalogWidth=catalogLayout?.width??(catalogDrag==="powerPole"?2:1),catalogHeight=catalogLayout?.height??(catalogDrag==="powerPole"?2:1);
  const catalogPlacementValid=Boolean(catalogDrag&&catalogPreview&&!isTransport(catalogDrag))&&Array.from({length:catalogWidth*catalogHeight},(_,index)=>keyOf(catalogPreview!.x+index%catalogWidth,catalogPreview!.y+Math.floor(index/catalogWidth))).every((key)=>catalogCellValid(catalogDrag!,key,grid,pipeGrid));
  const placementTargets=useMemo(()=>pickedEntity&&placementPreview?pickedEntity.cells.map((item)=>({x:placementPreview.x+item.dx,y:placementPreview.y+item.dy,item})):[],[pickedEntity,placementPreview]);
  const placementValid=useMemo(()=>Boolean(pickedEntity&&placementPreview)&&placementTargets.every(({x,y})=>{
    if(x<0||y<0||x>=cols||y>=rows)return false;
    const key=keyOf(x,y),movingOwn=Boolean(pickedEntity?.mode==="move"&&pickedEntity.sourceKeys.includes(key));
    if(pickedEntity?.sourceType==="entity")return (!grid[key]||movingOwn)&&!pipeGrid[key];
    const kind=pickedEntity?.cells[0]?.cell.kind;
    return kind==="pipe"?(!pipeGrid[key]||movingOwn)&&!Boolean(grid[key]&&!isTransport(grid[key].kind)):!grid[key]||movingOwn;
  }),[cols,grid,pickedEntity,pipeGrid,placementPreview,placementTargets,rows]);
  const groupPlacementValid=Boolean(pickedGroup&&placementPreview)&&groupTargetsValid(pickedGroup!.cells,placementPreview!.x,placementPreview!.y,pickedGroup!.mode,pickedGroup!.sourceGridKeys,pickedGroup!.sourcePipeKeys);
  const placementRoute=useMemo<FlowRoute|null>(()=>{
    if(!pickedEntity||pickedEntity.sourceType!=="route"||!placementTargets.length)return null;
    const cells=placementTargets.map(({x,y,item})=>({x,y,cell:item.cell}));
    return {id:"placement-route",kind:cells[0]?.cell.kind==="pipe"?"pipe":"belt",cells,path:roundedPath(cells)};
  },[pickedEntity,placementTargets]);

  function selectionAt(start:Point,current:Point) {
    const minX=Math.min(start.x,current.x),minY=Math.min(start.y,current.y),maxX=Math.max(start.x,current.x),maxY=Math.max(start.y,current.y);
    const inside=(key:string)=>{const [x,y]=key.split(",").map(Number);return x>=minX&&x<=maxX&&y>=minY&&y<=maxY};
    const touchedEntityIds=new Set(Object.entries(grid).filter(([key,cell])=>inside(key)&&!isTransport(cell.kind)).map(([,cell])=>cell.id));
    const gridKeys=Object.entries(grid).filter(([key,cell])=>inside(key)&&isTransport(cell.kind)||touchedEntityIds.has(cell.id)).map(([key])=>key);
    const pipeKeys=Object.keys(pipeGrid).filter(inside);
    if(!gridKeys.length&&!pipeKeys.length){setGroupSelection(null);setNotice("框选区域内没有可编辑对象");return}
    const positions=[...gridKeys,...pipeKeys].map((key)=>key.split(",").map(Number) as [number,number]);
    const selection:GroupSelection={entityIds:[...touchedEntityIds],gridKeys,pipeKeys,minX:Math.min(...positions.map(([x])=>x)),minY:Math.min(...positions.map(([,y])=>y)),maxX:Math.max(...positions.map(([x])=>x)),maxY:Math.max(...positions.map(([,y])=>y))};
    setGroupSelection(selection);setSelectedEntityId(null);setSelectedTransportKey(null);setPickedEntity(null);setPickedGroup(null);setPlacementPreview(null);
    setNotice(`已框选 ${selection.entityIds.length} 个设备/部件、${gridKeys.filter((key)=>grid[key]?.kind==="belt").length} 格传送带、${pipeKeys.length} 格管道`);
  }

  function startMarquee(event:React.PointerEvent<HTMLDivElement>) {
    if(!marqueeMode||event.button!==0||beltBuildMode||pickedEntity||pickedGroup)return;
    const rect=event.currentTarget.getBoundingClientRect(),point={x:Math.max(0,Math.min(cols-1,Math.floor((event.clientX-rect.left)/rect.width*cols))),y:Math.max(0,Math.min(rows-1,Math.floor((event.clientY-rect.top)/rect.height*rows)))};
    event.preventDefault();try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
    setMarquee({pointerId:event.pointerId,start:point,current:point});setGroupSelection(null);setSelectedEntityId(null);setSelectedTransportKey(null);
  }

  function updateMarquee(event:React.PointerEvent<HTMLDivElement>) {
    if(!marquee||marquee.pointerId!==event.pointerId)return;
    const rect=event.currentTarget.getBoundingClientRect(),current={x:Math.max(0,Math.min(cols-1,Math.floor((event.clientX-rect.left)/rect.width*cols))),y:Math.max(0,Math.min(rows-1,Math.floor((event.clientY-rect.top)/rect.height*rows)))};
    setMarquee((state)=>state&&state.pointerId===event.pointerId?{...state,current}:state);
  }

  function finishMarquee(event:React.PointerEvent<HTMLDivElement>) {
    if(!marquee||marquee.pointerId!==event.pointerId)return;
    event.preventDefault();try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}catch{}
    selectionAt(marquee.start,marquee.current);setMarquee(null);
  }

  function toggleMarqueeMode() {
    if(beltBuildMode)finishBeltBuild();
    const next=!marqueeMode;setMarqueeMode(next);setMarquee(null);setPickedEntity(null);setPickedGroup(null);setPlacementPreview(null);
    if(next){setSelectedEntityId(null);setSelectedTransportKey(null);setGroupSelection(null);setNotice("X · 框选已开启，按住左键拖出选择区域")}
    else setNotice(groupSelection?"框选已关闭 · 当前整组选择仍可复制、旋转、移动或删除":"框选已关闭 · 单击可直接选择单个对象");
  }

  function prepareGroupPlacement(mode:"move"|"copy") {
    if(!groupSelection)return;
    const cells:GroupCell[]=[...groupSelection.gridKeys.map((sourceKey)=>{const [x,y]=sourceKey.split(",").map(Number);return{layer:"grid" as const,sourceKey,dx:x-groupSelection.minX,dy:y-groupSelection.minY,cell:grid[sourceKey]}}),...groupSelection.pipeKeys.map((sourceKey)=>{const [x,y]=sourceKey.split(",").map(Number);return{layer:"pipe" as const,sourceKey,dx:x-groupSelection.minX,dy:y-groupSelection.minY,cell:pipeGrid[sourceKey]}})].filter((entry)=>Boolean(entry.cell));
    if(!cells.length)return;
    setPickedGroup({mode,sourceGridKeys:groupSelection.gridKeys,sourcePipeKeys:groupSelection.pipeKeys,cells,label:`${groupSelection.entityIds.length} 个设备/部件 · ${cells.length} 个网格对象`});
    setPlacementPreview({x:groupSelection.minX,y:groupSelection.minY});setPickedEntity(null);setMarqueeMode(false);setMarquee(null);
    setNotice(mode==="move"?"整组移动 · 选择内容随鼠标吸附，单击放下":"整组复制 · 副本的库存和处理进度独立清空");
  }

  function groupTargetsValid(cells:GroupCell[],x:number,y:number,mode:"move"|"copy",sourceGridKeys:string[],sourcePipeKeys:string[]) {
    const sourceGrid=new Set(sourceGridKeys),sourcePipe=new Set(sourcePipeKeys),projectedGrid=new Map<string,Cell>();
    cells.filter((entry)=>entry.layer==="grid").forEach((entry)=>projectedGrid.set(keyOf(x+entry.dx,y+entry.dy),entry.cell));
    return cells.every((entry)=>{
      const tx=x+entry.dx,ty=y+entry.dy,key=keyOf(tx,ty);if(tx<0||ty<0||tx>=cols||ty>=rows)return false;
      if(entry.layer==="grid"){
        if(grid[key]&&!(mode==="move"&&sourceGrid.has(key)))return false;
        const pipeOccupied=pipeGrid[key]&&!(mode==="move"&&sourcePipe.has(key));
        return !pipeOccupied||entry.cell.kind==="belt"||BELT_LOGISTICS.has(entry.cell.kind);
      }
      if(pipeGrid[key]&&!(mode==="move"&&sourcePipe.has(key)))return false;
      const base=projectedGrid.get(key)??(grid[key]&&!(mode==="move"&&sourceGrid.has(key))?grid[key]:undefined);
      return !base||base.kind==="belt";
    });
  }

  function placePickedGroup(x:number,y:number,groupOverride?:PickedGroup) {
    const group=groupOverride??pickedGroup;
    if(!group)return false;
    if(!groupTargetsValid(group.cells,x,y,group.mode,group.sourceGridKeys,group.sourcePipeKeys)){setNotice("整组目标位置越界或与现有设施、物流层级冲突");return true}
    const idMap=new Map<string,string>();
    if(group.mode==="copy")group.cells.filter((entry)=>entry.layer==="grid"&&!isTransport(entry.cell.kind)).forEach((entry)=>{if(!idMap.has(entry.cell.id))idMap.set(entry.cell.id,crypto.randomUUID())});
    const placed=group.cells.map((entry)=>({entry,key:keyOf(x+entry.dx,y+entry.dy),cell:{...entry.cell,id:group.mode==="copy"?(idMap.get(entry.cell.id)??crypto.randomUUID()):entry.cell.id,pairedEntityId:group.mode==="copy"?undefined:entry.cell.pairedEntityId}}));
    setGrid((old)=>{const next={...old};if(group.mode==="move")group.sourceGridKeys.forEach((key)=>delete next[key]);placed.filter(({entry})=>entry.layer==="grid").forEach(({key,cell})=>{next[key]=cell});return next});
    setPipeGrid((old)=>{const next={...old};if(group.mode==="move")group.sourcePipeKeys.forEach((key)=>delete next[key]);placed.filter(({entry})=>entry.layer==="pipe").forEach(({key,cell})=>{next[key]=cell});return next});
    setSimulation((previous)=>{const inventories={...previous.inventories},processes={...previous.processes};idMap.forEach((nextId)=>{inventories[nextId]={input:{},output:{}};processes[nextId]=0});return {...previous,inventories,processes,transits:[],laneReadyAt:{},routeTransfers:{}}});
    const gridKeys=placed.filter(({entry})=>entry.layer==="grid").map(({key})=>key),pipeKeys=placed.filter(({entry})=>entry.layer==="pipe").map(({key})=>key),entityIds=[...new Set(placed.filter(({entry})=>entry.layer==="grid"&&!isTransport(entry.cell.kind)).map(({cell})=>cell.id))];
    const width=Math.max(...group.cells.map((cell)=>cell.dx))+1,height=Math.max(...group.cells.map((cell)=>cell.dy))+1;
    setGroupSelection({entityIds,gridKeys,pipeKeys,minX:x,minY:y,maxX:x+width-1,maxY:y+height-1});setPickedGroup(null);setPlacementPreview(null);
    setNotice(group.mode==="copy"?"整组独立副本已放置 · 设备库存与进度从空状态开始":"框选内容已整体移动");return true;
  }

  function deleteGroupSelection() {
    if(!groupSelection)return;
    const removedIds=new Set(groupSelection.entityIds);
    setGrid((old)=>{const next={...old};groupSelection.gridKeys.forEach((key)=>delete next[key]);Object.entries(next).forEach(([key,cell])=>{if(cell.pairedEntityId&&removedIds.has(cell.pairedEntityId))next[key]={...cell,pairedEntityId:undefined}});return next});
    setPipeGrid((old)=>{const next={...old};groupSelection.pipeKeys.forEach((key)=>delete next[key]);return next});
    setSimulation((previous)=>{const inventories={...previous.inventories},processes={...previous.processes},recipeCursor={...previous.recipeCursor};removedIds.forEach((id)=>{delete inventories[id];delete recipeCursor[id];Object.keys(processes).filter((processKey)=>processKey===id||processKey.startsWith(`${id}::`)).forEach((processKey)=>delete processes[processKey])});return {...previous,inventories,processes,recipeCursor,transits:[],laneReadyAt:{},routeTransfers:{}}});
    setGroupSelection(null);setPickedGroup(null);setPlacementPreview(null);setNotice("框选内容已拆除");
  }

  function rotateGroupSelection() {
    if(!groupSelection)return;
    const height=groupSelection.maxY-groupSelection.minY+1;
    const cells:GroupCell[]=[...groupSelection.gridKeys.map((sourceKey)=>({layer:"grid" as const,sourceKey,cell:grid[sourceKey]})),...groupSelection.pipeKeys.map((sourceKey)=>({layer:"pipe" as const,sourceKey,cell:pipeGrid[sourceKey]}))].filter((entry)=>Boolean(entry.cell)).map((entry)=>{const [sx,sy]=entry.sourceKey.split(",").map(Number),cell=entry.cell;return{...entry,dx:height-1-(sy-groupSelection.minY),dy:sx-groupSelection.minX,cell:{...cell,rotation:((cell.rotation+1)%4) as Direction,entry:cell.entry==null?undefined:((cell.entry+1)%4) as Direction,partX:isTransport(cell.kind)?cell.partX:(cell.height??cell.size??1)-1-(cell.partY??0),partY:isTransport(cell.kind)?cell.partY:cell.partX,width:isTransport(cell.kind)?cell.width:cell.height??cell.size,height:isTransport(cell.kind)?cell.height:cell.width??cell.size}}});
    if(!groupTargetsValid(cells,groupSelection.minX,groupSelection.minY,"move",groupSelection.gridKeys,groupSelection.pipeKeys)){setNotice("整组旋转后越界或与现有设施冲突");return}
    const picked:PickedGroup={mode:"move",sourceGridKeys:groupSelection.gridKeys,sourcePipeKeys:groupSelection.pipeKeys,cells,label:"框选内容"};
    placePickedGroup(groupSelection.minX,groupSelection.minY,picked);
  }

  function prepareEntityPlacement(id: string, mode: "move" | "copy") {
    const entries = Object.entries(grid).filter(([, cell]) => cell.id === id);
    if (!entries.length) return;
    const positions = entries.map(([key, cell]) => { const [x,y]=key.split(",").map(Number); return {x,y,cell}; });
    const minX=Math.min(...positions.map((item)=>item.x)), minY=Math.min(...positions.map((item)=>item.y));
    const kind=positions[0].cell.kind;
    setPickedEntity({id,mode,sourceType:"entity",sourceKeys:entries.map(([key])=>key),cells:positions.map(({x,y,cell})=>({dx:x-minX,dy:y-minY,cell})),label:tools.find((tool)=>tool.kind===kind)?.label??"设备",image:tools.find((tool)=>tool.kind===kind)?.image});
    setPlacementPreview({x:minX,y:minY});
    setSelectionMode(true);
    setNotice(mode === "move" ? "移动模式 · 设备随鼠标吸附到网格，单击放下" : "复制模式 · 副本随鼠标吸附到网格，单击放置");
  }

  function prepareRoutePlacement(route:FlowRoute,mode:"move"|"copy") {
    const minX=Math.min(...route.cells.map(({x})=>x)),minY=Math.min(...route.cells.map(({y})=>y));
    setPickedEntity({id:route.id,mode,sourceType:"route",sourceKeys:route.cells.map(({x,y})=>keyOf(x,y)),cells:route.cells.map(({x,y,cell})=>({dx:x-minX,dy:y-minY,cell})),label:`${route.kind==="pipe"?"管道":"传送带"}线路 · ${route.cells.length} 格`});
    setPlacementPreview({x:minX,y:minY});
    setSelectionMode(true);
    setNotice(mode==="move"?"移动传送带 · 线路随鼠标吸附到网格":"复制传送带 · 单击网格放置副本");
  }

  function prepareSelectedPlacement(mode:"move"|"copy") {
    if(selectedEntityId){prepareEntityPlacement(selectedEntityId,mode);return}
    if(selectedRoute)prepareRoutePlacement(selectedRoute,mode);
  }

  function placePicked(x: number, y: number) {
    if (!pickedEntity) return false;
    const targets = pickedEntity.cells.map((item)=>({key:keyOf(x+item.dx,y+item.dy),x:x+item.dx,y:y+item.dy,item}));
    const routeKind=pickedEntity.sourceType==="route"&&pickedEntity.cells[0]?.cell.kind==="pipe"?"pipe":"belt";
    const blocked = targets.some(({key,x:tx,y:ty}) => {
      if(tx<0||ty<0||tx>=cols||ty>=rows)return true;
      const movingOwn=pickedEntity.mode==="move"&&pickedEntity.sourceKeys.includes(key);
      if(pickedEntity.sourceType==="entity")return Boolean((grid[key]&&!movingOwn)||pipeGrid[key]);
      return routeKind==="pipe"?Boolean((pipeGrid[key]&&!movingOwn)||(grid[key]&&!isTransport(grid[key].kind))):Boolean(grid[key]&&!movingOwn);
    });
    if (blocked) { setNotice("目标位置超出画布或与现有设施冲突"); return true; }
    const placedId = pickedEntity.mode === "copy" ? crypto.randomUUID() : pickedEntity.id;
    const write=(old:Grid)=>{const next={...old};if(pickedEntity.mode==="move")pickedEntity.sourceKeys.forEach((key)=>delete next[key]);targets.forEach(({key,item})=>{next[key]={...item.cell,id:placedId,pairedEntityId:pickedEntity.mode==="copy"?undefined:item.cell.pairedEntityId}});return next};
    if(pickedEntity.sourceType==="route"&&routeKind==="pipe")setPipeGrid(write);else setGrid(write);
    if(pickedEntity.sourceType==="entity"){
      if(pickedEntity.mode==="copy")setSimulation((previous)=>({...previous,inventories:{...previous.inventories,[placedId]:{input:{},output:{}}},processes:{...previous.processes,[placedId]:0}}));
      setSelectedEntityId(placedId);setSelectedTransportKey(null);
    }else{
      setSelectedEntityId(null);setSelectedTransportKey(targets[0]?.key??null);
      setSelectedTransportKind(routeKind);
    }
    setPickedEntity(null);setPlacementPreview(null);
    setNotice(pickedEntity.mode === "copy" ? "独立副本已放置 · 处理进度与库存从空状态开始" : `${pickedEntity.label}已移动`);
    return true;
  }

  function rotateEntity(entityId:string) {
    setGrid((old)=>{
      const entries=Object.entries(old).filter(([,cell])=>cell.id===entityId);
      if(!entries.length)return old;
      const first=entries[0][1];
      const next={...old};
      const positioned=entries.map(([key,cell])=>{const [x,y]=key.split(",").map(Number);return{x,y,cell}});
      const minX=Math.min(...positioned.map((item)=>item.x)),minY=Math.min(...positioned.map((item)=>item.y));
      const width=first.width??first.size??1,height=first.height??first.size??1;
      const rotated=positioned.map(({cell})=>{const partX=cell.partX??0,partY=cell.partY??0;return{x:minX+height-1-partY,y:minY+partX,cell,partX:height-1-partY,partY:partX}});
      if(rotated.some(({x,y})=>x<0||y<0||x>=cols||y>=rows||(old[keyOf(x,y)]&&old[keyOf(x,y)].id!==entityId))){setNotice("旋转后将超出画布或与现有设施冲突");return old}
      entries.forEach(([key])=>delete next[key]);
      rotated.forEach(({x,y,cell,partX,partY})=>{next[keyOf(x,y)]={...cell,partX,partY,width:height,height:width,rotation:((cell.rotation+1)%4) as Direction}});
      setNotice("已顺时针旋转 90°");
      return next;
    });
  }

  function rotateSelected() {
    if(!selectedEntityId&&selectedRoute){
      const rotateRoute=(old:Grid)=>{
        const positioned=selectedRoute.cells;
        const minX=Math.min(...positioned.map(({x})=>x)),minY=Math.min(...positioned.map(({y})=>y));
        const height=Math.max(...positioned.map(({y})=>y))-minY+1;
        const sourceKeys=new Set(positioned.map(({x,y})=>keyOf(x,y)));
        const rotated=positioned.map(({x,y,cell})=>({x:minX+height-1-(y-minY),y:minY+(x-minX),cell:{...cell,rotation:((cell.rotation+1)%4) as Direction,entry:cell.entry==null?undefined:((cell.entry+1)%4) as Direction}}));
        if(rotated.some(({x,y})=>x<0||y<0||x>=cols||y>=rows||(old[keyOf(x,y)]&&!sourceKeys.has(keyOf(x,y))))){setNotice("旋转后将超出画布或与现有设施冲突");return old}
        const next={...old};sourceKeys.forEach((key)=>delete next[key]);rotated.forEach(({x,y,cell})=>{next[keyOf(x,y)]={...cell,id:crypto.randomUUID()}});
        setSelectedTransportKey(rotated[0]?keyOf(rotated[0].x,rotated[0].y):null);setNotice("传送带线路已顺时针旋转 90°");return next;
      };
      if(selectedRoute.kind==="pipe")setPipeGrid(rotateRoute);else setGrid(rotateRoute);
      return;
    }
    if (selectedEntityId) rotateEntity(selectedEntityId);
  }

  function cancelRadialMenu(message?:string) {
    if(radialHoldTimer.current!==null){window.clearTimeout(radialHoldTimer.current);radialHoldTimer.current=null}
    if(radialConfirmTimer.current!==null){window.clearTimeout(radialConfirmTimer.current);radialConfirmTimer.current=null}
    radialGestureRef.current=null;
    setRadialMenu(null);
    if(message)setNotice(message);
  }

  function executeRadialAction(action:RadialAction,entityId:string) {
    const exists=Object.values(grid).some((cell)=>cell.id===entityId&&!isTransport(cell.kind));
    if(!exists)return;
    setSelectedEntityId(entityId);setSelectedTransportKey(null);setSelectionMode(true);
    if(action==="rotate"){rotateEntity(entityId);return}
    if(action==="move"){prepareEntityPlacement(entityId,"move");return}
    if(action==="copy"){prepareEntityPlacement(entityId,"copy");return}
    const entry=Object.entries(grid).find(([,cell])=>cell.id===entityId);
    if(entry){const [x,y]=entry[0].split(",").map(Number);deleteAt(x,y)}
  }

  function startDeviceRadial(event:React.PointerEvent<HTMLButtonElement>,entityId:string) {
    if(!event.isPrimary||event.button!==0||beltBuildMode||pickedEntity||panning)return;
    cancelRadialMenu();
    const gesture:RadialGesture={entityId,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,currentX:event.clientX,currentY:event.clientY,opened:false};
    radialGestureRef.current=gesture;
    setSelectedEntityId(entityId);setSelectedTransportKey(null);setSelectionMode(true);
    try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
    radialHoldTimer.current=window.setTimeout(()=>{
      const current=radialGestureRef.current;
      if(!current||current.pointerId!==event.pointerId)return;
      const dx=current.currentX-current.startX,dy=current.currentY-current.startY;
      if(Math.hypot(dx,dy)>RADIAL_PREOPEN_TOLERANCE_PX){radialGestureRef.current=null;return}
      current.opened=true;
      const selection=radialSelection(dx,dy);
      setRadialMenu({entityId,x:current.startX,y:current.startY,pointerId:current.pointerId,active:selection.action,phase:"open",angle:selection.angle,distance:selection.distance});
      setNotice("设备轮盘已打开 · 拖向操作并松开确认，中心松开取消");
      radialHoldTimer.current=null;
    },RADIAL_HOLD_DELAY_MS);
  }

  function updateDeviceRadial(event:React.PointerEvent<HTMLButtonElement>) {
    const gesture=radialGestureRef.current;
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    gesture.currentX=event.clientX;gesture.currentY=event.clientY;
    const dx=event.clientX-gesture.startX,dy=event.clientY-gesture.startY;
    if(!gesture.opened){
      if(Math.hypot(dx,dy)>RADIAL_PREOPEN_TOLERANCE_PX){
        if(radialHoldTimer.current!==null){window.clearTimeout(radialHoldTimer.current);radialHoldTimer.current=null}
        radialGestureRef.current=null;
        try{event.currentTarget.releasePointerCapture(event.pointerId)}catch{}
      }
      return;
    }
    event.preventDefault();
    const selection=radialSelection(dx,dy);
    setRadialMenu((current)=>current&&current.pointerId===event.pointerId?{...current,active:selection.action,angle:selection.angle,distance:selection.distance}:current);
  }

  function finishDeviceRadial(event:React.PointerEvent<HTMLButtonElement>) {
    const gesture=radialGestureRef.current;
    if(!gesture||gesture.pointerId!==event.pointerId)return;
    if(radialHoldTimer.current!==null){window.clearTimeout(radialHoldTimer.current);radialHoldTimer.current=null}
    try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}catch{}
    radialGestureRef.current=null;
    if(!gesture.opened)return;
    event.preventDefault();event.stopPropagation();
    const selection=radialSelection(event.clientX-gesture.startX,event.clientY-gesture.startY);
    if(!selection.action){setRadialMenu(null);setNotice("轮盘操作已取消 · 设备保持选中");return}
    setRadialMenu((current)=>current?{...current,active:selection.action,phase:"confirming",angle:selection.angle,distance:selection.distance}:current);
    radialConfirmTimer.current=window.setTimeout(()=>{
      setRadialMenu(null);radialConfirmTimer.current=null;
      executeRadialAction(selection.action!,gesture.entityId);
    },RADIAL_CONFIRM_DELAY_MS);
  }

  function activateBeltMode(kind:TransportKind="belt") {
    cancelRadialMenu();setRunning(false);setSelected(kind);setSelectionMode(false);setMarqueeMode(false);setMarquee(null);setGroupSelection(null);setPickedEntity(null);setPickedGroup(null);setPlacementPreview(null);setSelectedEntityId(null);setSelectedTransportKey(null);setSelectedTransportKind(kind);setBeltBuildMode(kind);setBeltDraft(null);setBeltPreviewPoint(null);setHoveredEntity(null);
    setNotice(`${kind==="pipe"?"管道":"传送带"}模式 · 点击起点，继续点击添加路径点`);
  }

  function availableSnapPort(entityId:string,type:PortType,x:number,y:number) {
    const last=beltDraft?.cells[beltDraft.cells.length-1];
    const draftKeys=new Set(beltDraft?.cells.map((point)=>keyOf(point.x,point.y))??[]);
    const replaceable=new Set(beltDraft?.replan?.replaceKeys??[]);
    const kind=beltDraft?.kind??beltBuildMode??"belt",transportGrid=kind==="pipe"?pipeGrid:grid;
    return selectSnapPort(resolvedPorts,{transport:kind,type,x,y,entityId,cols,rows,occupiedKeys:new Set(Object.keys(transportGrid)),draftKeys,replaceableKeys:replaceable,lastPoint:last});
  }

  function availableSnapPortAtTransportCell(type:PortType,x:number,y:number) {
    const last=beltDraft?.cells[beltDraft.cells.length-1];
    const draftKeys=new Set(beltDraft?.cells.map((point)=>keyOf(point.x,point.y))??[]);
    const replaceable=new Set(beltDraft?.replan?.replaceKeys??[]);
    const kind=beltDraft?.kind??beltBuildMode??"belt",transportGrid=kind==="pipe"?pipeGrid:grid;
    return selectSnapPort(resolvedPorts,{transport:kind,type,x,y,cols,rows,occupiedKeys:new Set(Object.keys(transportGrid)),draftKeys,replaceableKeys:replaceable,lastPoint:last});
  }

  function startBeltReplan(x:number,y:number) {
    const kind=beltBuildMode??"belt",route=flowRoutes.find((candidate)=>candidate.kind===kind&&candidate.cells.some((point)=>point.x===x&&point.y===y));
    if(!route){setNotice("无法解析该传送带所在的连续线路");return}
    const index=route.cells.findIndex((point)=>point.x===x&&point.y===y),anchor=route.cells[index];
    setBeltDraft({kind,cells:[{x,y}],waypoints:[{x,y}],replan:{routeId:route.id,replaceKeys:route.cells.slice(index+1).map((point)=>keyOf(point.x,point.y)),anchorEntry:anchor.cell.entry}});
    setBeltPreviewPoint({x,y});
    setNotice(`${kind==="pipe"?"管道":"传送带"}中段改线 · 保留此前 ${index+1} 格，移动鼠标规划新的下游线路`);
  }

  function addBeltWaypoint(x:number,y:number,entityId?:string) {
    const portType:PortType=beltDraft?"input":"output";
    const port=entityId?availableSnapPort(entityId,portType,x,y):availableSnapPortAtTransportCell(portType,x,y);
    if(entityId&&!port){setNotice(beltDraft?"该设备没有可用输入口":"该设备没有可用输出口");return}
    const point=port?{x:port.externalX,y:port.externalY}:{x,y};
    if(point.x<0||point.y<0||point.x>=cols||point.y>=rows){setNotice("路径点超出画布");return}
    const kind=beltDraft?.kind??beltBuildMode??"belt",transportGrid=kind==="pipe"?pipeGrid:grid;
    const pointKey=keyOf(point.x,point.y),occupied=transportGrid[pointKey],baseAtPoint=grid[pointKey],deviceOccupied=Boolean(baseAtPoint&&!isTransport(baseAtPoint.kind));
    if(!beltDraft&&occupied?.kind===kind){startBeltReplan(point.x,point.y);return}
    if(!beltDraft&&deviceOccupied){setNotice("起点被设备占用，请从匹配的输入/输出口开始");return}
    if(deviceOccupied&&!port){setNotice("路径点被设备占用，请选择其他位置");return}
    if(!beltDraft){
      setBeltDraft({kind,cells:[point],waypoints:[point],sourcePort:port?.type==="output"?port:undefined});
      setNotice(port?`已吸附到输出口 ${port.index+1} · 点击添加路径点`:`起点已创建 · 点击添加路径点`);
      return;
    }
    const start=beltDraft.cells[beltDraft.cells.length-1];
    if(start.x===point.x&&start.y===point.y){
      if(port?.type==="input"){const nextDraft={...beltDraft,targetPort:port,join:undefined};setBeltDraft(nextDraft);finishBeltBuild(nextDraft);return}
      setNotice("该路径点已经存在");return;
    }
    if(beltDraft.cells.slice(0,-1).some((cell)=>cell.x===point.x&&cell.y===point.y)){setNotice("路径不能回接到当前草稿的既有格");return}
    const deviceBlocked=Object.entries(grid).filter(([,cell])=>!isTransport(cell.kind)).map(([key])=>key);
    const blocked=new Set(deviceBlocked);
    beltDraft.cells.slice(0,-1).forEach((cell)=>blocked.add(keyOf(cell.x,cell.y)));
    blocked.delete(keyOf(start.x,start.y));blocked.delete(keyOf(point.x,point.y));
    const segment=findAutoPath(start,point,cols,rows,blocked);
    if(!segment){setNotice("没有可用路径，请增加一个中间路径点");return}
    const cells=[...beltDraft.cells,...segment.slice(1)];
    const join=occupied?.kind===kind?{key:pointKey,rotation:occupied.rotation}:undefined;
    const nextDraft={...beltDraft,cells,waypoints:[...beltDraft.waypoints,point],targetPort:port?.type==="input"?port:undefined,join};
    setBeltDraft(nextDraft);
    if(port?.type==="input"){finishBeltBuild(nextDraft);return}
    setNotice(join?`末端已按原方向接入现有${kind==="pipe"?"管道":"传送带"} · 按 E 或 Esc 完成`:`路径点 ${beltDraft.waypoints.length+1} 已创建 · 冲突位置会以红色预览`);
  }

  function finishBeltBuild(draftOverride?:BeltDraft) {
    const draft=draftOverride??beltDraft;
    if(!draft){setBeltBuildMode(null);setBeltPreviewPoint(null);setHoveredEntity(null);setNotice("已退出物流绘制模式");return}
    const route=makeDraftRoute(draft);
    if(!route){setBeltBuildMode(null);setBeltDraft(null);return}
    if(draft.replan&&route.cells.length<2){setBeltBuildMode(null);setBeltDraft(null);setBeltPreviewPoint(null);setNotice("未添加新的下游路径 · 原线路保持不变");return}
    const analysis=analyzeDraftRoute(route,draft,grid,pipeGrid);
    if(!analysis.valid){setNotice(`路径有 ${analysis.conflicts.size} 处占位或方向冲突 · 红色预览未提交`);return}
    const overwrittenKeys=new Set(route.cells.map(({x,y})=>keyOf(x,y)));
    const crossingByKey=new Map(analysis.crossings.map((crossing)=>[crossing.key,crossing]));
    const affectedRouteIds=new Set(flowRoutes.filter((candidate)=>candidate.kind===draft.kind&&candidate.cells.some(({x,y})=>overwrittenKeys.has(keyOf(x,y)))).map((candidate)=>candidate.id));
    const isPreservedJoin=(key:string)=>draft.join?.key===key&&key===keyOf(route.cells[route.cells.length-1].x,route.cells[route.cells.length-1].y);
    if(draft.kind==="pipe"){
      setPipeGrid((old)=>{const next={...old};draft.replan?.replaceKeys.forEach((key)=>delete next[key]);route.cells.forEach(({x,y,cell})=>{const key=keyOf(x,y);if(isPreservedJoin(key))return;if(crossingByKey.has(key)){delete next[key];return}next[key]={...cell,id:crypto.randomUUID()}});return next});
      if(analysis.crossings.length)setGrid((old)=>{const next={...old};analysis.crossings.forEach((crossing)=>{next[crossing.key]={kind:"pipeBridge",rotation:crossing.rotation,id:crypto.randomUUID(),root:true,partX:0,partY:0,width:1,height:1}});return next});
    }else setGrid((old)=>{const next={...old};draft.replan?.replaceKeys.forEach((key)=>delete next[key]);route.cells.forEach(({x,y,cell})=>{const key=keyOf(x,y);if(isPreservedJoin(key))return;const crossing=crossingByKey.get(key);next[key]=crossing?{kind:"logisticsBridge",rotation:crossing.rotation,id:crypto.randomUUID(),root:true,partX:0,partY:0,width:1,height:1}:{...cell,id:crypto.randomUUID()}});return next});
    if(affectedRouteIds.size||draft.replan)setSimulation((previous)=>{const laneReadyAt={...previous.laneReadyAt},routeTransfers={...previous.routeTransfers};affectedRouteIds.forEach((routeId)=>{delete laneReadyAt[routeId];delete routeTransfers[routeId]});if(draft.replan){delete laneReadyAt[draft.replan.routeId];delete routeTransfers[draft.replan.routeId]}return {...previous,laneReadyAt,routeTransfers,transits:previous.transits.filter((transit)=>!affectedRouteIds.has(transit.routeId)&&transit.routeId!==draft.replan?.routeId)}});
    setBeltBuildMode(null);setBeltDraft(null);setBeltPreviewPoint(null);setHoveredEntity(null);
    const label=draft.kind==="pipe"?"管道":"传送带",bridgeText=analysis.crossings.length?` · 自动生成 ${analysis.crossings.length} 个${draft.kind==="pipe"?"管道桥":"物流桥"}`:"";
    setNotice(draft.join?`${label}已按方向接入现有线路${bridgeText}`:draft.replan?`${label}中段改线已提交 · 上游连接保持不变${bridgeText}`:draft.sourcePort?draft.targetPort?`${label}已完成并连接输入/输出口${bridgeText}`:`${label}已接输出口 · 末端未卸货时会逐格堆满并阻塞${bridgeText}`:`${label}已完成 · 未连接设备输出口时不会生成物品${bridgeText}`);
  }

  function cancelBeltDraft() {
    setBeltDraft(null);setBeltPreviewPoint(null);setHoveredEntity(null);setNotice(`当前${beltBuildMode==="pipe"?"管道":"传送带"}路径已取消 · 仍处于绘制模式`);
  }

  function setDepotItem(entityId:string,itemId:string) {
    const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);
    if(!item)return;
    setGrid((old)=>Object.fromEntries(Object.entries(old).map(([key,cell])=>[key,cell.id===entityId&&cell.kind==="depot"?{...cell,itemId}:cell])));
    setNotice(`仓库取货口已设为 ${item.name} · 有效连接后按 30/min 输出`);
  }

  function setUndergroundPair(entityId:string,targetId:string) {
    const source=Object.values(grid).find((cell)=>cell.id===entityId),target=targetId?Object.values(grid).find((cell)=>cell.id===targetId):undefined;
    if(!source||!PIPE_TRANSFER_DEVICES.has(source.kind)||(target&&!undergroundPairCompatible(source.kind,target.kind)))return;
    const previousSource=source.pairedEntityId,previousTarget=target?.pairedEntityId;
    setGrid((old)=>Object.fromEntries(Object.entries(old).map(([key,cell])=>{
      if(cell.id===entityId)return [key,{...cell,pairedEntityId:target?.id}];
      if(target&&cell.id===target.id)return [key,{...cell,pairedEntityId:entityId}];
      if(cell.id===previousSource||cell.id===previousTarget||cell.pairedEntityId===entityId||cell.pairedEntityId===target?.id)return [key,{...cell,pairedEntityId:undefined}];
      return [key,cell];
    })));
    const resetIds=new Set([entityId,target?.id,previousSource,previousTarget].filter(Boolean) as string[]);
    setSimulation((previous)=>{const processes={...previous.processes};resetIds.forEach((id)=>delete processes[undergroundSourceProcessKey(id)]);return{...previous,processes}});
    setNotice(target?`${tools.find((tool)=>tool.kind===source.kind)?.label}已与${tools.find((tool)=>tool.kind===target.kind)?.label}配对 · 地下按管道带宽直通`:`${tools.find((tool)=>tool.kind===source.kind)?.label}已解除暗管配对`);
  }

  function setUndergroundSource(entityId:string,patch:{itemId?:string;ratePerMinute?:number}) {
    const entity=Object.values(grid).find((cell)=>cell.id===entityId);
    if(!entity||!UNDERGROUND_OUTLETS.has(entity.kind)||entity.pairedEntityId)return;
    const currentItemId=patch.itemId??entity.itemId??"",item=currentItemId?INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===currentItemId&&candidate.category==="流体"):undefined;
    if(currentItemId&&!item)return;
    const rate=clampUndergroundSourceRate(patch.ratePerMinute??entity.sourceRatePerMinute??60,PIPE_ITEMS_PER_MINUTE);
    setGrid((old)=>Object.fromEntries(Object.entries(old).map(([key,cell])=>[key,cell.id===entityId?{...cell,itemId:item?.id,sourceRatePerMinute:rate}:cell])));
    setSimulation((previous)=>{const processes={...previous.processes};delete processes[undergroundSourceProcessKey(entityId)];return{...previous,processes}});
    setNotice(item?`未配对暗管出口源 · ${item.name} · ${rate}/min`:`未配对暗管出口源已关闭 · 请选择液体或气体`);
  }

  function setMachineRecipe(entityId:string,recipeId:string) {
    const entity=Object.values(grid).find((cell)=>cell.id===entityId);
    if(!entity||!(entity.kind in MACHINE_DEFINITIONS))return;
    const definition=MACHINE_DEFINITIONS[entity.kind as ProductionKind],nextRecipe=definition.recipes.find((candidate)=>candidate.id===recipeId);
    if(!nextRecipe)return;
    setGrid((old)=>Object.fromEntries(Object.entries(old).map(([key,cell])=>[key,cell.id===entityId?{...cell,recipeId}:cell])));
    setSimulation((previous)=>{const processes={...previous.processes};delete processes[entityId];return {...previous,processes}});
    setNotice(`${definition.name}已切换为${modeLabel(nextRecipe.mode)} · ${nextRecipe.name} · 当前加工周期已清零`);
  }

  function setMachineOutputFilter(entityId:string,key:keyof OutputFilters,itemId:string) {
    const entity=Object.values(grid).find((cell)=>cell.id===entityId);if(!entity||!isSharedBufferMachine(entity.kind))return;
    const item=itemId?INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId):undefined;
    setGrid((old)=>Object.fromEntries(Object.entries(old).map(([cellKey,cell])=>[cellKey,cell.id===entityId?{...cell,outputFilters:{...cell.outputFilters,[key]:itemId||undefined}}:cell])));
    setNotice(`${tools.find((tool)=>tool.kind===entity.kind)?.label} · ${key==="solid"?"物品输出":key==="pipe0"?"管道输出 1":"管道输出 2"}已设为 ${item?.name??"关闭"}`);
  }

  function setExpandedReactorAutoUnblock(entityId:string,enabled:boolean) {
    const entity=Object.values(grid).find((cell)=>cell.id===entityId);
    if(entity?.kind!=="expandedReactor")return;
    setGrid((old)=>Object.fromEntries(Object.entries(old).map(([cellKey,cell])=>[cellKey,cell.id===entityId?{...cell,autoMultiRecipeUnblock:enabled}:cell])));
    setNotice(`扩容反应池 · 自动处理多配方阻塞${enabled?"已开启":"已关闭"}（占位设置，处理规则待补充）`);
  }

  function setProtocolStashMode(entityId:string,mode:ProtocolStashMode) {
    const entity=Object.values(grid).find((cell)=>cell.id===entityId);
    if(entity?.kind!=="protocolStash")return;
    setGrid((old)=>Object.fromEntries(Object.entries(old).map(([cellKey,cell])=>[cellKey,cell.id===entityId?{...cell,protocolStashMode:mode}:cell])));
    setSimulation((previous)=>{const processes={...previous.processes};delete processes[protocolStashProcessKey(entityId)];return{...previous,processes}});
    setNotice(`协议储存箱已切换为${mode==="wireless"?"无线传输模式 · 通电后每 5 秒回传全部库存":"仓储模式 · 保留库存并可由传送带输出"}`);
  }

  function addInventory(entityId:string,side:"input"|"output",itemId:string,amount:number) {
    const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);
    if(!item||!Number.isFinite(amount)||amount<=0)return;
    const kind=entityKinds.get(entityId);
    if(kind&&UNDERGROUND_OUTLETS.has(kind)){setNotice("暗管出口不支持直接放入库存 · 未配对时请配置液体/气体源与流速");return}
    if(kind&&PIPE_TRANSFER_DEVICES.has(kind)&&(side==="output"||itemTransport(itemId)!=="pipe")){setNotice("暗管只存储液体或气体，且没有独立产出库存");return}
    if(side==="input"&&!resolvedPorts.some((port)=>port.entityId===entityId&&port.type==="input"&&port.transport===itemTransport(itemId))){setNotice(`${tools.find((tool)=>tool.kind===kind)?.label??"该设备"}没有匹配的${itemTransport(itemId)==="pipe"?"液体":"固体"}输入口`);return}
    const slotInventory=isSlotInventory(kind),sharedBuffer=isSharedBufferMachine(kind),capacity=side==="input"?inputCapacityFor(kind,itemTransport(itemId)):outputCapacityFor(kind);
    if(slotInventory&&side==="output"){setNotice(kind==="protocolStash"?"协议储存箱使用统一存储槽 · 请直接放入存储槽":"反应池没有独立产出库存 · 请放入内部暂存槽");return}
    setSimulation((previous)=>{
      const current=previous.inventories[entityId]??{input:{},output:{}};
      const bucket={...current[side]},space=slotInventory?((bucket[itemId]??0)>0||occupiedBufferSlots(bucket)<bufferSlotsFor(kind)?Math.max(0,PROTOCOL_STASH_SLOT_CAPACITY-(bucket[itemId]??0)):0):Math.max(0,capacity-(side==="input"?inputTotalFor(bucket,itemTransport(itemId)):totalInventory(bucket)));
      const inserted=Math.min(Math.floor(amount),space);
      bucket[itemId]=(bucket[itemId]??0)+inserted;
      return {...previous,inventories:{...previous.inventories,[entityId]:{...current,[side]:bucket}}};
    });
    if(side==="input"&&!sharedBuffer&&(simulation.processes[entityId]??0)===0){
      const entity=Object.values(grid).find((cell)=>cell.id===entityId&&cell.kind in MACHINE_DEFINITIONS),current=simulation.inventories[entityId]?.input??{};
      if(entity){const space=Math.max(0,capacity-inputTotalFor(current,itemTransport(itemId))),projected={...current,[itemId]:(current[itemId]??0)+Math.min(Math.floor(amount),space)},definition=MACHINE_DEFINITIONS[entity.kind as ProductionKind],nextRecipe=automaticRecipe(definition,entity.recipeId,projected);setGrid((old)=>Object.fromEntries(Object.entries(old).map(([key,cell])=>[key,cell.id===entityId?{...cell,recipeId:nextRecipe.id}:cell])))}
    }
    setNotice(`${item.name}已放入${sharedBuffer?"内部暂存槽":kind==="protocolStash"?"存储槽":side==="input"?"输入":"产出"} · 超出容量或槽位上限的数量不会写入`);
  }

  function collectAllInventory(entityId:string) {
    const current=simulation.inventories[entityId]??{input:{},output:{}},amount=totalInventory(current.input)+totalInventory(current.output);
    setSimulation((previous)=>({...previous,inventories:{...previous.inventories,[entityId]:{input:{},output:{}}}}));
    const label=tools.find((tool)=>tool.kind===entityKinds.get(entityId))?.label??"设备";
    setNotice(amount>0?`${label}已全部收取 · 清空 ${amount} 单位库存`:`${label}当前没有可收取库存`);
  }

  function deleteAt(x:number,y:number,preferredKind?:TransportKind) {
    const key=keyOf(x,y),target=preferredKind==="pipe"?pipeGrid[key]:preferredKind==="belt"?grid[key]:grid[key]??pipeGrid[key];if(!target)return;
    const route=isTransport(target.kind)?flowRoutes.find((candidate)=>candidate.kind===target.kind&&candidate.cells.some((point)=>point.x===x&&point.y===y)):undefined;
    const keys=route?route.cells.map((point)=>keyOf(point.x,point.y)):isTransport(target.kind)?[keyOf(x,y)]:Object.entries(grid).filter(([,cell])=>cell.id===target.id).map(([key])=>key);
    const remove=(old:Grid)=>{const next={...old};keys.forEach((key)=>delete next[key]);Object.entries(next).forEach(([cellKey,cell])=>{if(cell.pairedEntityId===target.id)next[cellKey]={...cell,pairedEntityId:undefined}});return next};
    if(target.kind==="pipe")setPipeGrid(remove);else setGrid(remove);
    if(route)setSimulation((previous)=>{const laneReadyAt={...previous.laneReadyAt},routeTransfers={...previous.routeTransfers};delete laneReadyAt[route.id];delete routeTransfers[route.id];return {...previous,transits:previous.transits.filter((transit)=>transit.routeId!==route.id),laneReadyAt,routeTransfers}});
    else if(!isTransport(target.kind))setSimulation((previous)=>{const inventories={...previous.inventories},processes={...previous.processes},recipeCursor={...previous.recipeCursor},laneReadyAt={...previous.laneReadyAt},routeTransfers={...previous.routeTransfers};delete inventories[target.id];delete recipeCursor[target.id];Object.keys(processes).filter((processKey)=>processKey===target.id||processKey.startsWith(`${target.id}::`)||processKey===protocolStashProcessKey(target.id)).forEach((processKey)=>delete processes[processKey]);Object.keys(laneReadyAt).filter((laneKey)=>laneKey.includes(target.id)).forEach((laneKey)=>delete laneReadyAt[laneKey]);const affected=new Set(connectedFlowRoutes.filter((candidate)=>candidate.sourcePort?.entityId===target.id||candidate.targetPort?.entityId===target.id).map((candidate)=>candidate.id));affected.forEach((routeId)=>{delete laneReadyAt[routeId];delete routeTransfers[routeId]});return {...previous,inventories,processes,recipeCursor,laneReadyAt,routeTransfers,transits:previous.transits.filter((transit)=>!affected.has(transit.routeId))}});
    setSelectedEntityId(null);setSelectedTransportKey(null);setPickedEntity(null);setPlacementPreview(null);setNotice(isTransport(target.kind)?`整条${target.kind==="pipe"?"管道":"传送带"}线路已拆除`:"设备及其独立库存已拆除");
  }

  function deleteSelected() {
    if(selectedEntityId){const entry=Object.entries(grid).find(([,cell])=>cell.id===selectedEntityId);if(entry){const [x,y]=entry[0].split(",").map(Number);deleteAt(x,y)}return}
    if(selectedRoute?.cells[0])deleteAt(selectedRoute.cells[0].x,selectedRoute.cells[0].y,selectedRoute.kind);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if(key==="escape"&&radialMenu){event.preventDefault();cancelRadialMenu("轮盘操作已取消 · 设备保持选中");return}
      if (key === "e") { event.preventDefault(); if(beltBuildMode)finishBeltBuild();else activateBeltMode("belt");return; }
      if (key === "q") { event.preventDefault(); if(beltBuildMode)finishBeltBuild();else activateBeltMode("pipe");return; }
      if (key === "x"&&!event.repeat) {event.preventDefault();toggleMarqueeMode();return}
      if (key === "r" && (groupSelection||selectedEntityId||selectedRoute)) { event.preventDefault(); if(groupSelection)rotateGroupSelection();else rotateSelected(); }
      if (key === "c" && (groupSelection||selectedEntityId||selectedRoute)) { event.preventDefault(); if(groupSelection)prepareGroupPlacement("copy");else prepareSelectedPlacement("copy"); }
      if (key === "m" && (groupSelection||selectedEntityId||selectedRoute)) { event.preventDefault(); if(groupSelection)prepareGroupPlacement("move");else prepareSelectedPlacement("move"); }
      if ((key === "delete"||key === "backspace") && (groupSelection||selectedEntityId||selectedRoute)) { event.preventDefault();if(groupSelection)deleteGroupSelection();else deleteSelected();return; }
      if (key === "escape"&&beltBuildMode) { event.preventDefault();finishBeltBuild();return; }
      if (key === "escape") { setPickedEntity(null);setPickedGroup(null);setPlacementPreview(null);setSelectedEntityId(null);setSelectedTransportKey(null);setGroupSelection(null);setMarquee(null);setMarqueeMode(false);setSelectionMode(false);setNotice("已取消选择"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // The keyboard listener is intentionally rebound to the current editor snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntityId, selectedRoute, groupSelection, grid, pipeGrid, beltBuildMode, beltDraft, resolvedPorts, radialMenu, marqueeMode]);

  function placeTool(x: number, y: number,kind:Kind=selected) {
    if(isTransport(kind)){setNotice(`请先按 ${kind==="pipe"?"Q":"E"} 进入${kind==="pipe"?"管道":"传送带"}模式`);return}
    const layout=EQUIPMENT_LAYOUTS[kind],width=layout?.width??(kind==="powerPole"?2:1),height=layout?.height??(kind==="powerPole"?2:1);
    if(x+width>cols||y+height>rows)return;
    const cells=Array.from({length:width*height},(_,index)=>keyOf(x+index%width,y+Math.floor(index/width)));
    if(cells.some((key)=>!catalogCellValid(kind,key,grid,pipeGrid))){setNotice("设备占地与现有设施或物流层级冲突");return}
    const transport=logisticsTransport(kind),underlying=transport==="pipe"?pipeGrid[cells[0]]:transport==="belt"?grid[cells[0]]:undefined;
    const rotation=straightDirection(underlying)??0,id=crypto.randomUUID(),rootIndex=Math.floor(height/2)*width+Math.floor(width/2);
    const definition=kind in MACHINE_DEFINITIONS?MACHINE_DEFINITIONS[kind as ProductionKind]:undefined,recipeId=definition?.recipes[0].id,outputFilters=definition?.autoSchedule?defaultOutputFilters(definition):undefined;
    setGrid((old)=>{const next={...old};cells.forEach((key,index)=>next[key]={kind,rotation,id,root:index===rootIndex,partX:index%width,partY:Math.floor(index/width),size:Math.max(width,height),width,height,recipeId,outputFilters,protocolStashMode:kind==="protocolStash"?"wireless":undefined,sourceRatePerMinute:UNDERGROUND_OUTLETS.has(kind)?60:undefined});return next});
    if(transport==="pipe")setPipeGrid((old)=>{const next={...old};cells.forEach((key)=>delete next[key]);return next});
    if(transport&&underlying)setSimulation((previous)=>({...previous,transits:[],laneReadyAt:{},routeTransfers:{}}));
    setSelected("belt");setSelectionMode(true);setMarqueeMode(false);setGroupSelection(null);setSelectedEntityId(id);setSelectedTransportKey(null);
    setNotice(`${tools.find((tool)=>tool.kind===kind)?.label??"设备"}已放置${transport&&underlying?` · 已嵌入现有${transport==="pipe"?"管道":"传送带"}`:""}`);
  }

  function beginCatalogPointer(event:React.PointerEvent<HTMLButtonElement>,kind:Kind) {
    if(!event.isPrimary||event.button!==0||isTransport(kind))return;
    event.preventDefault();
    if(beltBuildMode)finishBeltBuild();
    try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
    catalogDragKindRef.current=kind;catalogPointerRef.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,dragged:false};setCatalogDrag(kind);setSelected(kind);setCatalogPreview(null);setSelectionMode(false);setMarqueeMode(false);setGroupSelection(null);setPickedEntity(null);setPickedGroup(null);setPlacementPreview(null);
    setNotice(`${tools.find((tool)=>tool.kind===kind)?.label??"设备"} · 拖到画布网格放置`);
  }

  function catalogPointAt(clientX:number,clientY:number,kind:Kind) {
    const gridElement=gridRef.current;if(!gridElement)return null;
    const layout=EQUIPMENT_LAYOUTS[kind],width=layout?.width??(kind==="powerPole"?2:1),height=layout?.height??(kind==="powerPole"?2:1);
    const rect=gridElement.getBoundingClientRect();if(clientX<rect.left||clientY<rect.top||clientX>rect.right||clientY>rect.bottom)return null;
    const hit=document.elementFromPoint(clientX,clientY);if(!hit||!gridElement.contains(hit))return null;
    const x=Math.max(0,Math.min(cols-width,Math.floor((clientX-rect.left)/rect.width*cols))),y=Math.max(0,Math.min(rows-height,Math.floor((clientY-rect.top)/rect.height*rows)));
    const valid=Array.from({length:width*height},(_,index)=>keyOf(x+index%width,y+Math.floor(index/width))).every((key)=>catalogCellValid(kind,key,grid,pipeGrid));
    return{x,y,valid};
  }

  function updateCatalogPointer(event:React.PointerEvent<HTMLButtonElement>) {
    const kind=catalogDragKindRef.current,gesture=catalogPointerRef.current;if(!kind||!gesture)return;
    if(!gesture.dragged&&Math.hypot(event.clientX-gesture.startX,event.clientY-gesture.startY)<6)return;gesture.dragged=true;
    const point=catalogPointAt(event.clientX,event.clientY,kind);if(!point){setCatalogPreview(null);return}const{x,y}=point;setCatalogPreview((current)=>current?.x===x&&current?.y===y?current:{x,y});
  }

  function finishCatalogPointer(event:React.PointerEvent<HTMLButtonElement>) {
    const kind=catalogDragKindRef.current;if(!kind)return;
    event.preventDefault();event.stopPropagation();
    try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}catch{}
    const gesture=catalogPointerRef.current,point=gesture?.dragged?catalogPointAt(event.clientX,event.clientY,kind):null;
    catalogDragKindRef.current=null;catalogPointerRef.current=null;setCatalogDrag(null);setCatalogPreview(null);
    if(point?.valid)placeTool(point.x,point.y,kind);else{setSelected("belt");setNotice(gesture?.dragged?(point?"目标占地与现有设备或物流线路冲突":"拖动已取消 · 请在可见画布网格内释放"):"设备仅支持拖动添加")}
  }

  function cancelCatalogPointer() {
    if(catalogDragKindRef.current===null)return;
    catalogDragKindRef.current=null;catalogPointerRef.current=null;setCatalogDrag(null);setCatalogPreview(null);setSelected("belt");
  }

  function save() {
    localStorage.setItem("endfield-blueprint-v3", JSON.stringify({cols,rows,grid,pipeGrid,simulation:{...simulation,transits:[],laneReadyAt:{}}}));
    setNotice("蓝图已保存到本机");
  }

  function resetSimulation() {
    setRunning(false);
    setSimulation(emptySimulationState());
    setNotice("模拟已重置 · 蓝图、设备配方与仓库取货口配置已保留");
  }

  function clearCanvas() {
    if(!window.confirm("清空画布会移除所有设备、传送带、管道和当前模拟数据。已保存的本机蓝图不会被删除。是否继续？"))return;
    cancelRadialMenu();catalogDragKindRef.current=null;catalogPointerRef.current=null;
    setRunning(false);setGrid({});setPipeGrid({});setSimulation(emptySimulationState());
    setSelected("belt");setSelectionMode(false);setMarqueeMode(false);setMarquee(null);setGroupSelection(null);setPickedEntity(null);setPickedGroup(null);setPlacementPreview(null);
    setSelectedEntityId(null);setSelectedTransportKey(null);setBeltBuildMode(null);setBeltDraft(null);setBeltPreviewPoint(null);setHoveredEntity(null);setCatalogDrag(null);setCatalogPreview(null);
    setNotice("画布已清空 · 本机已保存蓝图仍可通过“载入”恢复");
  }

  function load() {
    const saved = localStorage.getItem("endfield-blueprint-v3")??localStorage.getItem("endfield-blueprint-v2")??localStorage.getItem("endfield-blueprint-v1");
    if (saved) {
      const parsed=JSON.parse(saved);
      if(parsed.grid){const savedSimulation=parsed.simulation??{};if(Number.isFinite(parsed.cols))setCols(Math.max(12,Math.min(MAX_CANVAS_SIZE,parsed.cols)));if(Number.isFinite(parsed.rows))setRows(Math.max(8,Math.min(MAX_CANVAS_SIZE,parsed.rows)));setGrid(parsed.grid);setPipeGrid(parsed.pipeGrid??{});setSimulation({tick:savedSimulation.tick??0,inventories:savedSimulation.inventories??{},processes:savedSimulation.processes??{},transits:[],routeCursor:savedSimulation.routeCursor??{},recipeCursor:savedSimulation.recipeCursor??{},laneReadyAt:{},routeTransfers:savedSimulation.routeTransfers??{},itemStats:savedSimulation.itemStats??[]})}else setGrid(parsed);
    }
    setNotice(saved ? "已恢复本机蓝图" : "没有找到已保存蓝图");
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark">ECS</div>
        <div className="brand-copy"><strong>编辑蓝图</strong><span>ENDFIELD INDUSTRIES / AIC BLUEPRINT</span></div>
        <div className="top-actions">
          <button onClick={load}>载入</button><button onClick={save}>保存蓝图</button>
          <button className="clear-action" onClick={clearCanvas}>清空画布</button>
          <button className="reset-action" onClick={resetSimulation}>重置模拟</button>
          <button className={running ? "primary danger" : "primary"} onClick={() => setRunning(!running)}>{running ? "停止模拟" : "开始模拟"}</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="library panel">
          <div className="editor-tools">
            <p>工具</p>
            {tools.filter((tool)=>tool.type==="tool").map((tool)=><button key={tool.kind} className={`tool ${selected===tool.kind&&!selectionMode&&beltBuildMode===tool.kind?"active":""}`} onClick={()=>{const kind=tool.kind as TransportKind;if(beltBuildMode)finishBeltBuild();else activateBeltMode(kind)}}><span className={`tool-glyph ${tool.kind}`}><AssetThumb src={tool.image} label={tool.label}/></span><span><strong>{tool.label}</strong><small>{tool.desc}</small></span><kbd className="tool-key">{tool.kind==="pipe"?"Q":"E"}</kbd></button>)}
            <button className={`tool selection-tool ${marqueeMode ? "active" : ""}`} onClick={toggleMarqueeMode}>
              <span className="tool-glyph">SEL</span><span><strong>框选 / 编辑</strong><small>X 开关 · 拖动选择区域</small></span><kbd className="tool-key">X</kbd>
            </button>
          </div>
          <div className="device-catalog">
            <div className="device-catalog-head"><strong>设备</strong><div className="device-tabs" aria-label="游戏设备分类">{DEVICE_CATEGORIES.map((category)=><button key={category} className={deviceCategory===category?"active":""} onClick={()=>setDeviceCategory(category)}>{category}</button>)}</div></div>
            <div className="device-list">{tools.filter((tool)=>tool.type==="device"&&(deviceCategory==="全部"||tool.category===deviceCategory)).map((tool)=><button key={tool.kind} className="tool" onPointerDown={(event)=>beginCatalogPointer(event,tool.kind)} onPointerMove={updateCatalogPointer} onPointerUp={finishCatalogPointer} onPointerCancel={cancelCatalogPointer} aria-label={`拖动添加${tool.label}`}><span className={`tool-glyph ${tool.kind}`}><AssetThumb src={tool.image} label={tool.label}/></span><span><strong>{tool.label}</strong><small>{tool.desc}</small></span></button>)}{!tools.some((tool)=>tool.type==="device"&&(deviceCategory==="全部"||tool.category===deviceCategory))&&<span className="empty-category">该分类设备将在数据核实后加入</span>}</div>
          </div>
          <div className="hint"><kbd>E</kbd> 开始 / 完成　<kbd>单击</kbd> 路径点　<kbd>右键</kbd> 取消本条</div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div><span className="live-dot" /> {canvasView==="blueprint"?"蓝图预览 / AIC-01":"产线流程图 / NODE OVERVIEW"}</div>
            <div className="canvas-controls">
              <div className="canvas-view-switch" role="group" aria-label="画布视图"><button className={canvasView==="blueprint"?"active":""} onClick={()=>setCanvasView("blueprint")}>蓝图</button><button className={canvasView==="flow"?"active":""} onClick={()=>setCanvasView("flow")}>流程图</button></div>
              {canvasView==="blueprint"?<><button onClick={() => setZoom(Math.max(.55, zoom-.1))}>−</button><span>{Math.round(zoom*100)}%</span><button onClick={() => setZoom(Math.min(1.7, zoom+.1))}>＋</button>
              <details className="settings"><summary>画布设置</summary><div className="settings-popover">
                <label><span>网格对比度 <b>{Math.round(gridOpacity*100)}%</b></span><input type="range" min="0.03" max="0.35" step="0.01" value={gridOpacity} onChange={e=>setGridOpacity(Number(e.target.value))}/></label>
                <label><span>缩放 <b>{Math.round(zoom*100)}%</b></span><input type="range" min="0.55" max="1.7" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
                <div className="size-inputs"><label>列数<input type="number" min="12" max={MAX_CANVAS_SIZE} value={cols} onChange={e=>setCols(Math.max(12,Math.min(MAX_CANVAS_SIZE,Number(e.target.value))))}/></label><label>行数<input type="number" min="8" max={MAX_CANVAS_SIZE} value={rows} onChange={e=>setRows(Math.max(8,Math.min(MAX_CANVAS_SIZE,Number(e.target.value))))}/></label></div>
                <button onClick={()=>{setPan({x:0,y:0});setZoom(1)}}>重置视图</button><small>滚轮缩放 · 按住滚轮拖动画布</small>
              </div></details></>:<span className="flow-summary">{flowGraph.nodes.length} 节点 · {flowGraph.edges.length} 连接</span>}
            </div>
          </div>
          {canvasView==="blueprint"?<div className="grid-wrap" style={{"--grid-opacity":gridOpacity} as React.CSSProperties}
            onMouseDown={e=>{if(e.button===1||e.altKey){e.preventDefault();setPanning({x:e.clientX,y:e.clientY,ox:pan.x,oy:pan.y})}}}
            onMouseMove={e=>{if(panning)setPan({x:panning.ox+e.clientX-panning.x,y:panning.oy+e.clientY-panning.y})}}
            onMouseUp={()=>setPanning(null)} onMouseLeave={()=>setPanning(null)}
            onWheel={e=>{e.preventDefault();setZoom(z=>Math.max(.55,Math.min(1.7,z*Math.exp(-e.deltaY*.001))))}}>
            {radialMenu&&<div className={`radial-menu ${radialMenu.phase}`} role="menu" aria-label={`${radialEntityLabel}快捷操作`} data-active={radialMenu.active??"none"} style={{left:radialMenu.x,top:radialMenu.y} as React.CSSProperties}>
              <span className="radial-ring" aria-hidden="true"/>
              {radialMenu.distance>0&&<span className="radial-vector" aria-hidden="true" style={{width:Math.min(82,Math.max(0,radialMenu.distance-18)),transform:`rotate(${radialMenu.angle}deg)`}}/>}
              {RADIAL_ACTIONS.map((action)=><span key={action.id} className={`radial-option ${action.position} ${radialMenu.active===action.id?"active":""}`} role="menuitem" aria-current={radialMenu.active===action.id?"true":undefined}><kbd>{action.keyLabel}</kbd><strong>{action.label}</strong></span>)}
              <span className="radial-center"><strong>{radialEntityLabel}</strong><small>{radialMenu.phase==="confirming"?"操作已确认":radialMenu.active?"松开执行":"拖向选项"}</small></span>
            </div>}
            {(groupSelection||selectedEntity||selectedRoute) && <div className="selection-toolbar">
              <span><kbd>X</kbd> 已选中 <strong>{groupSelection?`${groupSelection.entityIds.length} 个设备/部件 · ${groupSelection.gridKeys.length+groupSelection.pipeKeys.length} 格`:selectedEntity?tools.find((tool)=>tool.kind===selectedEntity.kind)?.label:`${selectedRoute?.kind==="pipe"?"管道":"传送带"}线路 · ${selectedRoute?.cells.length} 格`}</strong>{(pickedEntity||pickedGroup) && <em>{(pickedEntity?.mode??pickedGroup?.mode) === "move" ? "移动中" : "复制中"}</em>}</span>
              {selectedEntity?.kind==="depot"&&<label className="depot-item-select"><span>{selectedDepotItem&&<AssetThumb src={selectedDepotItem.image} label={selectedDepotItem.name}/>}输出物品</span><select aria-label="仓库取货口输出物品" value={selectedDepotItem?.id??""} onChange={(event)=>setDepotItem(selectedEntity.id,event.target.value)}><option value="" disabled>选择工业物品</option>{(["矿物","工业产物"] as const).map((category)=><optgroup key={category} label={category}>{INDUSTRIAL_ITEMS.filter((item)=>item.category===category).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label>}
              <button onClick={()=>groupSelection?prepareGroupPlacement("copy"):prepareSelectedPlacement("copy")}><kbd>C</kbd> 复制</button>
              <button onClick={()=>groupSelection?rotateGroupSelection():rotateSelected()}><kbd>R</kbd> 旋转</button>
              <button onClick={()=>groupSelection?prepareGroupPlacement("move"):prepareSelectedPlacement("move")}><kbd>M</kbd> 移动</button>
              <button className="delete-action" onClick={()=>groupSelection?deleteGroupSelection():deleteSelected()}><kbd>Del</kbd> 拆除</button>
              <button onClick={()=>{setSelectedEntityId(null);setSelectedTransportKey(null);setGroupSelection(null);setPickedEntity(null);setPickedGroup(null);setPlacementPreview(null);setSelectionMode(false)}}>取消</button>
            </div>}
            {beltBuildMode&&<div className="belt-build-toolbar"><span><kbd>{beltBuildMode==="pipe"?"Q":"E"}</kbd> {beltBuildMode==="pipe"?"管道":"传送带"}模式</span><strong>{beltDraft?`${beltDraft.waypoints.length} 个路径点`:"点击创建起点"}</strong><small>{beltDraft?"实时寻路 · 靠近匹配接口自动吸附":"可从空格或匹配类型的设备输出口开始"}</small><span><kbd>Esc / {beltBuildMode==="pipe"?"Q":"E"}</kbd> 完成　<kbd>右键</kbd> 取消</span></div>}
            {inventoryMenuVisible&&selectedEntityId&&selectedEntity&&<aside className="device-menu" role="dialog" aria-label={`${tools.find((tool)=>tool.kind===selectedEntity.kind)?.label??"设备"}库存`}>
              <header><div><small>DEVICE BUFFER</small><strong>{selectedDefinition?.name??tools.find((tool)=>tool.kind===selectedEntity.kind)?.label}</strong></div><button aria-label="关闭设备库存" onClick={()=>setSelectedEntityId(null)}>×</button></header>
              {PIPE_TRANSFER_DEVICES.has(selectedEntity.kind)&&<section className="underground-link">
                <div className="recipe-heading"><strong>地下暗管配对</strong><span>{selectedEntity.pairedEntityId?"已连接":"未连接"}</span></div>
                <label><span>配对设备</span><select aria-label="暗管配对设备" value={selectedEntity.pairedEntityId??""} onChange={(event)=>setUndergroundPair(selectedEntityId,event.target.value)}><option value="">不配对</option>{undergroundCandidates.map((candidate,index)=><option key={candidate.id} value={candidate.id}>{tools.find((tool)=>tool.kind===candidate.kind)?.label} #{String(index+1).padStart(2,"0")}</option>)}</select></label>
                {selectedUndergroundOutlet&&!selectedEntity.pairedEntityId&&<div className="underground-source-control"><div className="recipe-heading"><strong>未配对持续源</strong><span>{selectedUndergroundSourceItem?.name??"已关闭"}</span></div><label><span>液体 / 气体</span><select aria-label="暗管出口源介质" value={selectedUndergroundSourceItem?.id??""} onChange={(event)=>setUndergroundSource(selectedEntityId,{itemId:event.target.value})}><option value="">关闭持续输出</option>{INDUSTRIAL_ITEMS.filter((item)=>item.category==="流体").map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="underground-source-rate"><span>指定流速</span><div><input aria-label="暗管出口源流速" type="range" min="0" max={PIPE_ITEMS_PER_MINUTE} step="1" value={selectedUndergroundSourceRate} onChange={(event)=>setUndergroundSource(selectedEntityId,{ratePerMinute:Number(event.target.value)})}/><b>{selectedUndergroundSourceRate}/min</b></div></label><small>作为无限液体/气体源持续供给；该流速由全部输出口共享，实际输送仍受管道容量与下游阻塞限制。</small></div>}
                <small>{selectedUndergroundOutlet&&!selectedEntity.pairedEntityId?"选择介质后启用持续源；完成配对会自动停用持续源并恢复暗管转运。":"同规格入口与出口一对一连接；配对独立保存，不依赖画布上的可见管线路径。"}</small>
              </section>}
              {selectedProtocolStash&&<section className="recipe-control protocol-stash-control"><div className="recipe-heading"><strong>工作模式</strong><span>{PROTOCOL_STASH_POWER_USAGE} 电力</span></div><div className="mode-switch" role="group" aria-label="协议储存箱工作模式"><button className={selectedProtocolStashMode==="wireless"?"active":""} onClick={()=>setProtocolStashMode(selectedEntityId,"wireless")}>无线传输</button><button className={selectedProtocolStashMode==="storage"?"active":""} onClick={()=>setProtocolStashMode(selectedEntityId,"storage")}>仓储</button></div><small>{selectedProtocolStashMode==="wireless"?selectedProtocolStashPowered?"已接入供电范围 · 每 5 秒将全部存储物品回传基地仓库":"未接入供电范围 · 无线回传暂停":"保留全部库存 · 可通过右侧输出口向传送带发货"}</small><div className="protocol-transfer-meter"><span>{selectedProtocolStashMode==="storage"?"仓储模式":selectedProtocolStashPowered?running?`下次回传 ${selectedProtocolStashRemaining}s`:"模拟暂停":"等待供电"}</span><i><b style={{width:`${selectedProtocolStashMode==="wireless"&&selectedProtocolStashPowered?selectedProtocolStashProgress:0}%`}}/></i></div></section>}
              {selectedDefinition&&selectedRecipe&&<>
                {selectedDefinition.autoSchedule?<section className="recipe-control parallel-recipes"><div className="recipe-heading"><strong>{selectedDefinition.bufferSlots} 个内部暂存槽</strong><span>每槽 50 · {selectedDefinition.powerUsage} 电力</span></div><div className="parallel-recipe-list">{selectedDefinition.recipes.map((candidate)=>{const ticks=simulation.processes[`${selectedEntityId}::${candidate.id}`]??0,ready=candidate.inputs.every((requirement)=>(selectedInventory.input[requirement.itemId]??0)>=requirement.amount)&&Boolean(bufferAfterRecipe(selectedEntity.kind,selectedInventory.input,candidate));return <div key={candidate.id} className={ticks>0?"active":ready?"ready":""}><span><b>{candidate.name}</b><small>{ticks>0?"处理中 · 配方锁定":ready?"可运行":"等待暂存物"}</small></span><i><b style={{width:`${Math.min(100,ticks/candidate.durationTicks*100)}%`}}/></i></div>})}</div><small>{selectedDefinition.autoSchedule==="parallel"?"所有能跑通的配方同时处理；同一配方完成前不会重复启动。":"所有能跑通的配方轮流处理；当前配方完成前不会切换。"} 产物返回同一组暂存槽。</small>{selectedEntity.kind==="expandedReactor"&&<label className="placeholder-switch"><span><b>自动处理多配方阻塞</b><small>占位设置 · 具体处理规则待补充</small></span><input aria-label="自动处理多配方阻塞" type="checkbox" checked={Boolean(selectedEntity.autoMultiRecipeUnblock)} onChange={(event)=>setExpandedReactorAutoUnblock(selectedEntityId,event.target.checked)}/><i aria-hidden="true"/></label>}</section>:<section className="recipe-control"><div className="recipe-heading"><strong>工作模式与配方</strong><span>{selectedDefinition.powerUsage} 电力</span></div>{selectedModes.length>1&&<div className="mode-switch" role="group" aria-label="设备工作模式">{selectedModes.map((mode)=><button key={mode} className={selectedRecipe.mode===mode?"active":""} onClick={()=>setMachineRecipe(selectedEntityId,selectedDefinition.recipes.find((candidate)=>candidate.mode===mode)!.id)}>{modeLabel(mode)}</button>)}</div>}<label><span>当前配方</span><select aria-label="当前处理配方" value={selectedRecipe.id} onChange={(event)=>setMachineRecipe(selectedEntityId,event.target.value)}>{selectedDefinition.recipes.filter((candidate)=>candidate.mode===selectedRecipe.mode).map((candidate)=><option key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.durationTicks/SIM_TICKS_PER_SECOND}s</option>)}</select></label><small className="recipe-rate">额定流量 · {recipeRateText(selectedRecipe)}</small><small>设备会根据输入库存自动匹配配方；手动切换会清零当前加工周期。</small></section>}
                <div className="device-process"><span>{selectedSharedBuffer?"自动检查全部暂存槽配方":recipeText(selectedRecipe)}</span><i><b style={{width:`${machineStates[selectedEntityId]?.progress??0}%`}}/></i><small>{machineStates[selectedEntityId]?.status==="running"?`处理中 · 剩余 ${machineStates[selectedEntityId]?.remaining}s`:machineStates[selectedEntityId]?.status==="blocked"?(selectedSharedBuffer?"暂存槽无法继续处理 · 已阻塞":"产出库存已满 · 已阻塞"):machineStates[selectedEntityId]?.status==="environment"?"缺少酸性气体环境":"等待处理条件"}</small></div>
              </>}
              {selectedSlotInventory?<>
                <section className="inventory-section shared-buffer"><div className="inventory-heading"><strong>{selectedProtocolStash?"存储槽":"内部暂存槽"}</strong><span>{occupiedBufferSlots(selectedInventory.input)} / {bufferSlotsFor(selectedEntity.kind)} 槽 · 每槽 {PROTOCOL_STASH_SLOT_CAPACITY}</span></div>
                  <div className="inventory-meter"><i style={{width:`${Math.min(100,totalInventory(selectedInventory.input)/(bufferSlotsFor(selectedEntity.kind)*PROTOCOL_STASH_SLOT_CAPACITY)*100)}%`}}/></div>
                  <div className="buffer-slot-list">{Array.from({length:bufferSlotsFor(selectedEntity.kind)},(_,index)=>{const entry=Object.entries(selectedInventory.input).filter(([,quantity])=>quantity>0)[index],item=entry?INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===entry[0]):undefined;return <div key={index} className={entry?"occupied":"empty"}><em>{String(index+1).padStart(2,"0")}</em>{entry?<><span>{item&&<AssetThumb src={item.image} label={item.name}/>}<b>{item?.name??entry[0]}</b></span><strong>{entry[1]} / {PROTOCOL_STASH_SLOT_CAPACITY}</strong></>:<small>空槽</small>}</div>})}</div>
                </section>
                {selectedSharedBuffer&&<section className="output-routing"><div className="inventory-heading"><strong>暂存槽输出选择</strong><span>独立于配方</span></div>
                  {selectedHasSolidOutput&&<label><span>物品输出 · 全部传送带口</span><select aria-label="反应池物品输出" value={(selectedEntity.outputFilters??defaultOutputFilters(selectedDefinition)).solid??""} onChange={(event)=>setMachineOutputFilter(selectedEntityId,"solid",event.target.value)}><option value="">关闭输出</option>{selectedSolidOutputOptions.map((itemId)=><option key={itemId} value={itemId}>{itemName(itemId)}</option>)}</select></label>}
                  {selectedPipeOutputPorts.map((port,index)=>{const key=outputFilterKey(port,"pipe"),value=(selectedEntity.outputFilters??defaultOutputFilters(selectedDefinition))[key]??"";return <label key={port.key}><span>管道输出 {index+1}</span><select aria-label={`反应池管道输出 ${index+1}`} value={value} onChange={(event)=>setMachineOutputFilter(selectedEntityId,key,event.target.value)}><option value="">关闭输出</option>{selectedPipeOutputOptions.map((itemId)=><option key={itemId} value={itemId}>{itemName(itemId)}</option>)}</select></label>})}
                  <small>物品输出只能选择一种；两个管道输出可分别选择不同介质。只会取出暂存槽中实际存在的内容。</small>
                </section>}
              </>:selectedPipeTransfer?<>
                <section className="inventory-section fluid"><div className="inventory-heading"><strong>暗管介质库存</strong><span>{selectedFluidInputTotal} / {inputCapacityFor(selectedEntity.kind,"pipe")}</span></div>
                  <div className="inventory-meter fluid"><i style={{width:`${Math.min(100,selectedFluidInputTotal/inputCapacityFor(selectedEntity.kind,"pipe")*100)}%`}}/></div>
                  <div className="inventory-list">{selectedFluidInputItemIds.length?selectedFluidInputItemIds.map((itemId)=>{const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);return <div key={itemId}><span>{item&&<AssetThumb src={item.image} label={item.name}/>} {item?.name??itemId}</span><b>{selectedInventory.input[itemId]??0}</b></div>}):<small>暂无液体或气体</small>}</div>
                </section>
              </>:<>
                <section className="inventory-section solid"><div className="inventory-heading"><strong>固体输入库存</strong><span>{selectedSolidInputTotal} / {inputCapacityFor(selectedEntity.kind,"belt")}</span></div>
                  <div className="inventory-meter"><i style={{width:`${Math.min(100,selectedSolidInputTotal/inputCapacityFor(selectedEntity.kind,"belt")*100)}%`}}/></div>
                  <div className="inventory-list">{selectedSolidInputItemIds.length?selectedSolidInputItemIds.map((itemId)=>{const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);return <div key={itemId}><span>{item&&<AssetThumb src={item.image} label={item.name}/>} {item?.name??itemId}</span><b>{selectedInventory.input[itemId]??0}</b></div>}):<small>暂无固体物品</small>}</div>
                </section>
                {selectedHasFluidInput&&<section className="inventory-section fluid"><div className="inventory-heading"><strong>管道介质输入库存</strong><span>{selectedFluidInputTotal} / {inputCapacityFor(selectedEntity.kind,"pipe")}</span></div>
                  <div className="inventory-meter fluid"><i style={{width:`${Math.min(100,selectedFluidInputTotal/inputCapacityFor(selectedEntity.kind,"pipe")*100)}%`}}/></div>
                  <div className="inventory-list">{selectedFluidInputItemIds.length?selectedFluidInputItemIds.map((itemId)=>{const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);return <div key={itemId}><span>{item&&<AssetThumb src={item.image} label={item.name}/>} {item?.name??itemId}</span><b>{selectedInventory.input[itemId]??0}</b></div>}):<small>暂无管道介质</small>}</div>
                </section>}
                <section><div className="inventory-heading"><strong>产出库存</strong><span>{totalInventory(selectedInventory.output)} / {selectedOutputCapacity}</span></div>
                  <div className="inventory-meter output"><i style={{width:`${Math.min(100,totalInventory(selectedInventory.output)/selectedOutputCapacity*100)}%`}}/></div>
                  <div className="inventory-list">{selectedOutputItemIds.length?selectedOutputItemIds.map((itemId)=>{const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);return <div key={itemId}><span>{item&&<AssetThumb src={item.image} label={item.name}/>} {item?.name??itemId}</span><b>{selectedInventory.output[itemId]??0}</b></div>}):<small>暂无物品</small>}</div>
                </section>
              </>}
              {!selectedUndergroundOutlet&&<section className="inventory-inject"><strong>{selectedSharedBuffer?"直接放入内部暂存槽":selectedProtocolStash?"直接放入存储槽":selectedPipeTransfer?"直接放入暗管库存":"直接放入库存"}</strong><select aria-label="库存物品" value={selectedInventoryItemId} onChange={(event)=>setInventoryItemId(event.target.value)}>{selectedInventoryItems.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="放入数量" type="number" min="1" max="60" value={inventoryAmount} onChange={(event)=>setInventoryAmount(Math.max(1,Number(event.target.value)))}/><div><button onClick={()=>addInventory(selectedEntityId,"input",selectedInventoryItemId,inventoryAmount)}>{selectedSharedBuffer?"放入暂存槽":selectedProtocolStash?"放入存储槽":selectedPipeTransfer?"放入管道介质":"放入输入库存"}</button>{!selectedSlotInventory&&!selectedPipeTransfer&&<button onClick={()=>addInventory(selectedEntityId,"output",selectedInventoryItemId,inventoryAmount)}>放入产出库存</button>}</div></section>}
              <section className="inventory-collect"><span><strong>设备库存操作</strong><small>{selectedSharedBuffer?"清空全部内部暂存槽":selectedProtocolStash?"清空全部存储槽":selectedPipeTransfer?"清空全部暗管介质":"清空输入与产出库存"}</small></span><button aria-label="全部收取设备库存" disabled={totalInventory(selectedInventory.input)+totalInventory(selectedInventory.output)===0} onClick={()=>collectAllInventory(selectedEntityId)}>全部收取 <b>{totalInventory(selectedInventory.input)+totalInventory(selectedInventory.output)}</b></button></section>
              <footer>{inventoryFullIds.has(selectedEntityId)?"库存或暂存槽已阻塞 · 相连物流暂停，设备边框标红":selectedSharedBuffer?"所有物品共用暂存槽 · 错误物品同样占用槽位":selectedProtocolStash?"6 个物品槽共用库存 · 无线模式仅在供电并运行模拟时回传":selectedPipeTransfer?selectedUndergroundOutlet&&!selectedEntity.pairedEntityId?"暗管只存储液体或气体 · 未配对出口由所选持续源供给":"暗管只存储液体或气体 · 没有固体或独立产出库存":"固体与管道介质输入分别计容 · 任何物品均可进入并真实占用库存"}</footer>
            </aside>}
            <div className="axis axis-y">12<br/>08<br/>04<br/>00</div>
            <div ref={gridRef} className={`grid ${panning ? "is-panning" : ""} ${pickedEntity||pickedGroup?"is-placing":""} ${marqueeMode?"marquee-mode":""} ${running ? "simulation-running" : ""}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, aspectRatio:`${cols}/${rows}`, transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}
              onPointerDown={startMarquee} onPointerMove={updateMarquee} onPointerUp={finishMarquee} onPointerCancel={()=>setMarquee(null)}
              onMouseMove={(event)=>{const rect=event.currentTarget.getBoundingClientRect();if(beltBuildMode){const x=Math.max(0,Math.min(cols-1,Math.floor((event.clientX-rect.left)/rect.width*cols)));const y=Math.max(0,Math.min(rows-1,Math.floor((event.clientY-rect.top)/rect.height*rows)));setBeltPreviewPoint((current)=>current?.x===x&&current?.y===y?current:{x,y})}if(pickedEntity||pickedGroup){const x=Math.max(0,Math.min(cols-pickedWidth,Math.floor((event.clientX-rect.left)/rect.width*cols)));const y=Math.max(0,Math.min(rows-pickedHeight,Math.floor((event.clientY-rect.top)/rect.height*rows)));setPlacementPreview({x,y})}}}
              onMouseLeave={()=>{setHoveredEntity(null);setBeltPreviewPoint(null)}}>
              {pickedEntity&&placementPreview&&<><span className={`placement-snap ${placementValid?"valid":"invalid"}`} style={{left:`${placementPreview.x/cols*100}%`,top:`${placementPreview.y/rows*100}%`,width:`${pickedWidth/cols*100}%`,height:`${pickedHeight/rows*100}%`}}/><span className="placement-ghost" style={{left:`${placementPreview.x/cols*100}%`,top:`${placementPreview.y/rows*100}%`,width:`${pickedWidth/cols*100}%`,height:`${pickedHeight/rows*100}%`}}>{pickedEntity.sourceType==="entity"&&<><AssetThumb src={pickedEntity.image} label={pickedEntity.label}/><strong>{pickedEntity.label}</strong></>}</span></>}
              {pickedGroup&&placementPreview&&<><span className={`placement-snap group-placement ${groupPlacementValid?"valid":"invalid"}`} style={{left:`${placementPreview.x/cols*100}%`,top:`${placementPreview.y/rows*100}%`,width:`${pickedWidth/cols*100}%`,height:`${pickedHeight/rows*100}%`}}/><span className="placement-ghost group-ghost" style={{left:`${placementPreview.x/cols*100}%`,top:`${placementPreview.y/rows*100}%`,width:`${pickedWidth/cols*100}%`,height:`${pickedHeight/rows*100}%`}}><strong>{pickedGroup.label}</strong></span></>}
              {marqueeBounds&&<span className="marquee-box" style={{left:`${marqueeBounds.minX/cols*100}%`,top:`${marqueeBounds.minY/rows*100}%`,width:`${(marqueeBounds.maxX-marqueeBounds.minX+1)/cols*100}%`,height:`${(marqueeBounds.maxY-marqueeBounds.minY+1)/rows*100}%`}}/>}
              {groupSelection&&<span className="group-selection-box" style={{left:`${groupSelection.minX/cols*100}%`,top:`${groupSelection.minY/rows*100}%`,width:`${(groupSelection.maxX-groupSelection.minX+1)/cols*100}%`,height:`${(groupSelection.maxY-groupSelection.minY+1)/rows*100}%`}}/>}
              {catalogDrag&&catalogPreview&&<><span className={`placement-snap catalog-snap ${catalogPlacementValid?"valid":"invalid"}`} style={{left:`${catalogPreview.x/cols*100}%`,top:`${catalogPreview.y/rows*100}%`,width:`${catalogWidth/cols*100}%`,height:`${catalogHeight/rows*100}%`}}/><span className="placement-ghost catalog-ghost" style={{left:`${catalogPreview.x/cols*100}%`,top:`${catalogPreview.y/rows*100}%`,width:`${catalogWidth/cols*100}%`,height:`${catalogHeight/rows*100}%`}}><AssetThumb src={tools.find((tool)=>tool.kind===catalogDrag)?.image} label={tools.find((tool)=>tool.kind===catalogDrag)?.label??"设备"}/><strong>{tools.find((tool)=>tool.kind===catalogDrag)?.label}</strong></span></>}
              {showPowerZones && <svg className="power-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {powerZones.map((zone)=><rect key={zone.id} x={zone.x} y={zone.y} width={zone.size} height={zone.size} rx=".16"/>)}
              </svg>}
              {showPowerZones&&powerZones.map((zone)=><span key={zone.id} className="power-range-label" style={{left:`${Math.max(0,zone.x)/cols*100}%`,top:`${Math.max(0,zone.y)/rows*100}%`}}>供电范围 12×12 · 规划参考</span>)}
              {showGasZones&&<svg className="gas-zone-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">{gasZones.map((zone)=>{const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===zone.itemId);return <rect key={zone.id} x={zone.x} y={zone.y} width={zone.size} height={zone.size} rx=".16" style={{"--gas-zone-color":item?.color??"#bdd8cc"} as React.CSSProperties}/>})}</svg>}
              {showGasZones&&gasZones.map((zone)=><span key={zone.id} className="gas-range-label" style={{left:`${Math.max(0,zone.x)/cols*100}%`,top:`${Math.max(0,zone.y)/rows*100}%`}}>气体环境 14×14 · {itemName(zone.itemId??"")||"等待介质"}</span>)}
              <svg className="transport-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {displayFlowRoutes.map((route)=>{const connected=connectedFlowRoutes.find((candidate)=>candidate.id===route.id),pipeTransits=route.kind==="pipe"?(transitsByRoute.get(route.id)??[]):[],item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===(pipeTransits[0]?.itemId??connected?.itemId));return <g key={route.id} className={`route-track ${route.kind} ${selectedRoute?.id===route.id?"selected-route":""} ${pickedEntity?.sourceType==="route"&&pickedEntity.mode==="move"&&pickedEntity.id===route.id?"picked-route":""}`} style={route.kind==="pipe"?{"--pipe-fluid":item?.color??"transparent"} as React.CSSProperties:undefined} data-content={pipeTransits[0]?.itemId??connected?.itemId}>
                  <path className="track-edge" d={route.path}/>
                  {route.kind==="pipe"?route.cells.map(({x,y,cell},cellIndex)=>{const ratio=pipeFillRatio(pipeTransits,cellIndex,route.cells.length);return <path key={`fluid-${x},${y}`} className="pipe-fluid-segment" d={roundedPath([{x,y,cell}])} strokeWidth={ratio===0?0:.07+ratio*.43} data-fill={ratio.toFixed(2)}/>}):<path className="track-fill" d={route.path}/>}
                  {route.cells.map(({x,y,cell})=>{const anchor=arrowAnchor(x,y,cell);return <path key={`${x},${y}`} className="direction-arrow" d="M -.065 -.05 L .075 0 L -.065 .05 Z" transform={`translate(${anchor.x} ${anchor.y}) rotate(${arrowAngle(cell)})`}/>})}
                </g>})}
                {draftRoute&&<g className={`route-track ${draftRoute.kind} draft-route ${liveDraftRoute?"live-preview":""} ${draftAnalysis?.valid===false?"invalid":"valid"}`}>
                  <path className="track-edge" d={draftRoute.path}/><path className="track-fill" d={draftRoute.path}/>
                  {draftRoute.cells.map(({x,y,cell})=>{const anchor=arrowAnchor(x,y,cell);return <path key={`${x},${y}`} className="direction-arrow" d="M -.065 -.05 L .075 0 L -.065 .05 Z" transform={`translate(${anchor.x} ${anchor.y}) rotate(${arrowAngle(cell)})`}/>})}
                  {draftAnalysis?.crossings.map((crossing)=><rect key={crossing.key} className="draft-bridge-marker" x={crossing.x+.29} y={crossing.y+.29} width=".42" height=".42" rx=".04" transform={`rotate(${crossing.rotation*90} ${crossing.x+.5} ${crossing.y+.5})`}/>)}
                  {beltDraft?.waypoints.map((point,index)=><circle key={`${point.x},${point.y},${index}`} className="draft-waypoint" cx={point.x+.5} cy={point.y+.5} r=".065"/>)}
                  {liveDraftRoute&&<circle className={`draft-cursor ${snapCandidate?"snapped":""}`} cx={liveDraftRoute.cells[liveDraftRoute.cells.length-1].x+.5} cy={liveDraftRoute.cells[liveDraftRoute.cells.length-1].y+.5} r=".085"/>}
                </g>}
                {placementRoute&&<g className={`route-track ${placementRoute.kind} placement-route ${placementValid?"valid":"invalid"}`}><path className="track-edge" d={placementRoute.path}/><path className="track-fill" d={placementRoute.path}/>{placementRoute.cells.map(({x,y,cell})=>{const anchor=arrowAnchor(x,y,cell);return <path key={`${x},${y}`} className="direction-arrow" d="M -.065 -.05 L .075 0 L -.065 .05 Z" transform={`translate(${anchor.x} ${anchor.y}) rotate(${arrowAngle(cell)})`}/>})}</g>}
              </svg>
              {simulation.transits.length>0 && <svg className="flow-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {connectedFlowRoutes.map((route) => {
                  const transits=transitsByRoute.get(route.id)??[];
                  if(route.direct||route.kind==="pipe"||!transits.length||beltDraft?.replan?.routeId===route.id)return null;
                  const stalled=stalledRouteIds.has(route.id);
                  return <g key={route.id} className={`route-motion ${route.kind} ${stalled?"stalled":""}`}>
                    <CargoRouteSprites transits={transits} route={route} running={running} stalled={stalled}/>
                  </g>;
                })}
              </svg>}
              {Array.from({ length: cols * rows }).map((_, index) => {
                const x = index % cols; const y = Math.floor(index / cols); const key=keyOf(x,y),baseCell = grid[key],pipeCell=pipeGrid[key]; const cell=baseCell??pipeCell;
                const machineState=cell?machineStates[cell.id]:undefined;
                const status = machineState?.status??"idle";
                const stateLabel=status==="running"?"生产中":status==="waiting"?"周期等待":status==="starved"?"缺少输入":status==="blocked"?"输出阻塞":status==="unpowered"?"未供电":status==="environment"?"环境不足":"已暂停";
                const definition=cell&&cell.kind in MACHINE_DEFINITIONS?MACHINE_DEFINITIONS[cell.kind as ProductionKind]:null;
                const currentRecipe=definition?activeRecipe(definition,machineState?.recipeId??cell?.recipeId):null;
                const deviceInventoryFull=Boolean(cell&&inventoryFullIds.has(cell.id));
                const machine = definition&&currentRecipe ? { name:definition.name, recipe:`${modeLabel(currentRecipe.mode)} · ${currentRecipe.name}`, state:stateLabel, blocked:status==="blocked"||deviceInventoryFull?"是":"否" } : null;
                const processing = status === "running";
                const processProgress = machineState?.progress??0;
                const remainingSeconds = machineState?.remaining??"--";
                const machineImage = definition&&currentRecipe?machineImageFor(definition,currentRecipe):null;
                const cellWidth=cell?.width??cell?.size??1,cellHeight=cell?.height??cell?.size??1;
                const cellPorts=portsByCell.get(keyOf(x,y))??[];
                const footprintStyle=cell?.root?{left:`-${(cell.partX??0)*100}%`,top:`-${(cell.partY??0)*100}%`,right:`-${(cellWidth-1-(cell.partX??0))*100}%`,bottom:`-${(cellHeight-1-(cell.partY??0))*100}%`}:undefined;
                const entitySelected = Boolean(cell && cell.id===selectedEntityId);
                const routeSelected=Boolean(selectedRouteKeys.has(key)&&((selectedTransportKind==="pipe"&&pipeCell)||(selectedTransportKind==="belt"&&baseCell?.kind==="belt")));
                const groupSelected=groupGridKeySet.has(key)||groupPipeKeySet.has(key);
                const entityPicked = Boolean((cell && pickedEntity?.mode==="move"&&pickedEntity.sourceKeys.includes(keyOf(x,y)))||(pickedGroup?.mode==="move"&&(pickedGroup.sourceGridKeys.includes(key)||pickedGroup.sourcePipeKeys.includes(key))));
                const hasBelt=baseCell?.kind==="belt",hasPipe=Boolean(pipeCell);
                const hoverTransport:TransportKind|undefined=hasPipe?"pipe":hasBelt?"belt":undefined;
                const transport=hoverTransport?transportMeta.get(`${hoverTransport}:${key}`):undefined;
                const secondaryTransport=hasPipe&&hasBelt?transportMeta.get(`belt:${key}`):undefined;
                const routeForCell=hoverTransport?connectedRouteByCell.get(`${hoverTransport}:${key}`):undefined;
                const depotItem=cell?.kind==="depot"?INDUSTRIAL_ITEMS.find((item)=>item.id===cell.itemId):null;
                return <button key={index} className={`cell ${cell ? `placed ${cell.kind}` : ""} ${baseCell?.kind==="belt"?"belt":""} ${pipeCell?"pipe has-pipe":""} ${status} ${cell?.root?"entity-root":""} ${cellPorts.length?"entity-port":""} ${entitySelected ? "selected-entity" : ""} ${routeSelected?"selected-route-cell":""} ${groupSelected?"group-selected-cell":""} ${entityPicked ? "picked-entity" : ""}`} aria-label={`${x},${y}${baseCell ? ` ${baseCell.kind}` : ""}${pipeCell?" pipe":""}`}
                  aria-haspopup={baseCell&&!isTransport(baseCell.kind)?"menu":undefined}
                  onPointerDown={(event)=>{if(!marqueeMode&&baseCell&&!isTransport(baseCell.kind))startDeviceRadial(event,baseCell.id)}}
                  onPointerMove={updateDeviceRadial}
                  onPointerUp={finishDeviceRadial}
                  onPointerCancel={(event)=>{if(radialGestureRef.current?.pointerId===event.pointerId)cancelRadialMenu("轮盘操作已取消 · 设备保持选中")}}
                  onLostPointerCapture={(event)=>{if(radialGestureRef.current?.pointerId===event.pointerId)cancelRadialMenu("轮盘操作已取消 · 设备保持选中")}}
                  onMouseDown={(e) => {
                    if(e.button===1||e.altKey)return;
                    if (pickedGroup) { placePickedGroup(x,y); return; }
                    if(beltBuildMode){addBeltWaypoint(x,y,baseCell&&!isTransport(baseCell.kind)?baseCell.id:undefined);return}
                    if (pickedEntity) { placePicked(x,y); return; }
                    if(marqueeMode)return;
                    if (baseCell&&!isTransport(baseCell.kind)) {setGroupSelection(null);setSelectedEntityId(baseCell.id);setSelectedTransportKey(null);setNotice("已选中设备 · 库存与处理状态已打开");setSelectionMode(true);return}
                    const crossingKind:TransportKind|undefined=pipeCell&&baseCell?.kind==="belt"?(selectedTransportKey===key&&selectedTransportKind==="pipe"?"belt":"pipe"):undefined;
                    const selectedFlow=crossingKind==="pipe"?pipeCell:crossingKind==="belt"?baseCell:pipeCell??(baseCell?.kind==="belt"?baseCell:undefined);
                    if (selectedFlow) {
                      setGroupSelection(null);setSelectedTransportKind(selectedFlow.kind as TransportKind);setSelectedTransportKey(key);setSelectedEntityId(null);setNotice(`已选中整条${selectedFlow.kind==="pipe"?"管道":"传送带"}线路 · 可复制、旋转或移动`);
                      setSelectionMode(true);return;
                    }
                    if(selectionMode){setSelectedEntityId(null);setSelectedTransportKey(null);setNotice("该位置为空");return}
                    if(isTransport(selected)){setNotice(`请先按 ${selected==="pipe"?"Q":"E"} 进入${selected==="pipe"?"管道":"传送带"}模式`);return}
                    setNotice("设备只能从底部目录拖到画布上添加");
                  }} onMouseEnter={() => {if(beltBuildMode)setHoveredEntity(baseCell&&!isTransport(baseCell.kind)?{id:baseCell.id,x,y}:null)}} onMouseLeave={()=>{if(beltBuildMode&&hoveredEntity?.id===baseCell?.id)setHoveredEntity(null)}}
                  onContextMenu={(e) => {e.preventDefault();if(beltBuildMode){cancelBeltDraft();return}deleteAt(x,y,hoverTransport)}}>
                    {baseCell && !isTransport(baseCell.kind) && <>{baseCell.root && <span style={footprintStyle} className={`cell-glyph root ${!machine ? "compact" : ""} ${baseCell.kind==="powerPole"?"power-pole":""} ${entitySelected?"selected-root":""} ${deviceInventoryFull?"inventory-full":""}`}><b><AssetThumb src={machineImage??tools.find((t) => t.kind === baseCell.kind)?.image} label={tools.find((t) => t.kind === baseCell.kind)?.label??"设备"}/></b>{baseCell.kind==="depot"&&<span className="depot-source">{depotItem?<><AssetThumb src={depotItem.image} label={depotItem.name}/><small>{depotItem.name}</small></>:<small>未选择物品</small>}</span>}{machine && <span className="machine-overlay"><strong className="machine-name">{machine.name}</strong><span className="machine-recipe">{machine.recipe}</span><small className={status}>状态 · {machine.state}</small><small className={`power-state ${machineState?.powered?"powered":"unpowered"}`}>供电 · {machineState?.powered?"正常":"断开"}</small><em>阻塞 · {machine.blocked}</em><span className="machine-progress"><i><b className={processProgress===0?"cycle-reset":""} style={{width:`${processProgress}%`}}/></i><em>{processing ? `${processProgress}% · 剩余 ${remainingSeconds}s` : status==="unpowered" ? "等待供电 · --" : status==="environment" ? "等待酸性环境 · --" : status==="starved" ? "缺少输入 · --" : status==="blocked" ? "输出阻塞 · --" : running ? "周期等待 · --" : "未启动 · --"}</em></span></span>}{baseCell.kind==="powerPole"&&<span className="power-pole-label"><strong>供电桩</strong><small>12 × 12</small></span>}</span>}{cellPorts.filter((port)=>!hiddenDirectPortKeys.has(port.key)).map((port)=><span key={port.key} className={`port-marker ${port.type} ${port.transport} side-${port.side} ${snapCandidate?.key===port.key?"snap-target":""} ${isPortConnected(grid,pipeGrid,port,directlyConnectedPortKeys)?"connected":""}`} title={`${port.transport==="pipe"?"管道介质":"固体"}${port.type==="input"?"输入口":"输出口"} ${port.index+1}`} aria-label={`${port.transport==="pipe"?"管道介质":"固体"}${port.type==="input"?"输入口":"输出口"} ${port.index+1}`}><span className="port-icon" aria-hidden="true"><i/><b/></span></span>)}{baseCell.root && status === "waiting" && <span className="wait-ring" />}</>}
                    {transport&&<span className="transport-tooltip"><span>{routeForCell?.itemId?<AssetThumb src={transport.image} label={transport.name}/>:<i className="empty-item-icon">--</i>}<strong>{transport.kind==="pipe"?"管道":"传送带"} · {transport.name}</strong></span><small>当前流速 {transport.rate}/min · 占用 {transport.cargoCount}/{transport.capacity} 单位</small><small>线路 {routeForCell?.cells.length??0} 格 · 基准运输耗时 {transport.travelSeconds.toFixed(1)}s</small><small>额定吞吐 {transport.kind==="pipe"?PIPE_ITEMS_PER_MINUTE:BELT_ITEMS_PER_MINUTE}/min · {transport.kind==="pipe"?"每格缓存 4 单位":"每格最多 1 件"}</small>{routeForCell&&stalledRouteIds.has(routeForCell.id)&&<small>{transport.targetConnected?"下游库存已满 · 线路满载阻塞":"末端未接输入口 · 线路满载阻塞"}</small>}{transport.connected&&!transport.targetConnected&&!transport.full&&<small>已连接输出口 · 内容将在末端逐格堆积</small>}{!transport.connected&&<small>未连接设备输出口 · 不会生成内容</small>}{secondaryTransport&&<><span className="tooltip-layer"><strong>下层传送带 · {secondaryTransport.name}</strong></span><small>当前流速 {secondaryTransport.rate}/min · 占用 {secondaryTransport.cargoCount}/{secondaryTransport.capacity}</small><small>再次单击可在管道/传送带之间切换选择</small></>}</span>}
                  </button>;
              })}
              <div className="port-overlay" aria-label="设备输入输出口显示层">
                {resolvedPorts.filter((port)=>!hiddenDirectPortKeys.has(port.key)).map((port)=>{
                  const left=port.cellX+(port.side===0?1:port.side===2?0:.5),top=port.cellY+(port.side===1?1:port.side===3?0:.5);
                  return <span key={port.key} style={{left:`${left/cols*100}%`,top:`${top/rows*100}%`}} className={`port-marker global-port ${isLogistics(port.entityKind)?"compact-port":""} ${port.type} ${port.transport} side-${port.side} ${snapCandidate?.key===port.key?"snap-target":""} ${isPortConnected(grid,pipeGrid,port,directlyConnectedPortKeys)?"connected":""}`} title={`${port.transport==="pipe"?"液体":"固体"}${port.type==="input"?"输入口":"输出口"} ${port.index+1}`} aria-label={`${port.transport==="pipe"?"液体":"固体"}${port.type==="input"?"输入口":"输出口"} ${port.index+1}`}><span className="port-icon" aria-hidden="true"><i/><b/></span></span>;
                })}
              </div>
            </div>
            <div className="axis axis-x">00　　　04　　　08　　　12　　　16</div>
          </div>:<div className="flow-diagram" aria-label="工业设备缩略连接图">
            <div className="flow-legend"><span><i className="belt"/>传送带连接</span><span><i className="pipe"/>管道连接</span><small>物流桥已折叠 · 分流器与汇流器保留为节点</small></div>
            {flowGraph.nodes.length?<div className="flow-stage" style={{width:flowGraph.width,height:flowGraph.height}}>
              <svg className="flow-links" width={flowGraph.width} height={flowGraph.height} viewBox={`0 0 ${flowGraph.width} ${flowGraph.height}`} aria-hidden="true">
                {flowGraph.edges.map((edge)=>{const source=flowGraph.nodes.find((node)=>node.id===edge.from),target=flowGraph.nodes.find((node)=>node.id===edge.to);if(!source||!target)return null;const sx=source.x+flowGraph.nodeWidth,sy=source.y+flowGraph.nodeHeight/2,tx=target.x,ty=target.y+flowGraph.nodeHeight/2,bend=Math.max(48,Math.abs(tx-sx)*.48);return <g key={edge.id} className={`flow-link ${edge.kind}`}><path d={`M ${sx} ${sy} C ${sx+bend} ${sy}, ${tx-bend} ${ty}, ${tx} ${ty}`}/><circle cx={tx} cy={ty} r="3.5"/><title>{edge.kind==="pipe"?"管道":"传送带"} · {edge.itemName}</title></g>})}
              </svg>
              {flowGraph.nodes.map((node)=>{const state=machineStates[node.id]?.status,status=state==="running"?"生产中":state==="blocked"?"阻塞":state==="starved"?"缺少输入":state==="environment"?"环境不足":state==="unpowered"?"未供电":state==="idle"?"已暂停":node.status;return <article key={node.id} className={`flow-node ${node.kind} ${state??"idle"}`} style={{left:node.x,top:node.y,width:flowGraph.nodeWidth,height:flowGraph.nodeHeight}}><header>{node.label}<span>{status}</span></header><div><AssetThumb src={node.image} label={node.label}/><span><strong>{node.detail}</strong><small>{node.kind==="splitter"||node.kind==="pipeSplitter"?"1 入 · 多路输出":node.kind==="merger"||node.kind==="pipeMerger"?"多路输入 · 1 出":"工业设备"}</small></span></div><i className="node-input" aria-hidden="true"/><i className="node-output" aria-hidden="true"/></article>})}
            </div>:<div className="flow-empty">画布中还没有可显示的工业设备</div>}
          </div>}
          <div className="status-strip"><span>{notice}</span><span>网格 {cols} × {rows}</span><span>设备/传送带占用 {Math.round(Object.keys(grid).filter(k=>{const [x,y]=k.split(',').map(Number);return x<cols&&y<rows}).length / (cols * rows) * 100)}% · 管道 {counts.pipes} 格</span></div>
        </section>

        <aside className="inspector panel">
          <div className="panel-heading"><span>生产监控</span><small>LIVE / 02</small></div>
          <div className="metric-grid"><div><small>设备</small><strong>{counts.devices}</strong></div><div><small>物流格</small><strong>{counts.belts}<span> 带</span> / {counts.pipes}<span> 管</span></strong></div><div><small>已供电</small><strong>{productionStates.filter((state)=>state.powered).length}<span> / {productionStates.length}</span></strong></div><div><small>效率</small><strong>{running&&productionStates.length ? Math.round(productionStates.filter((state)=>state.status==="running").length/productionStates.length*100) : "—"}<span>%</span></strong></div></div>
          <div className="section-title"><span>设备状态</span><small>{running ? "SIMULATION ACTIVE" : "SIMULATION PAUSED"}</small></div>
          {prioritizedProductionStates.map(({state,sequence})=>{const stateText=state.status==="running"?"生产中":state.status==="waiting"?"周期等待":state.status==="starved"?"缺少输入":state.status==="blocked"?"输出阻塞":state.status==="environment"?"环境不足":state.status==="unpowered"?"未供电":"暂停",definition=MACHINE_DEFINITIONS[state.kind],currentRecipe=activeRecipe(definition,state.recipeId);return <div key={state.id} className={`machine-card ${state.status==="running"?"good":state.status!=="idle"?"warn":""}`}><div className="machine-icon"><AssetThumb src={machineImageFor(definition,currentRecipe)} label={definition.name}/></div><div><strong>{definition.name} #{String(sequence).padStart(2,"0")}</strong><small>{modeLabel(currentRecipe.mode)} · {currentRecipe.name} · {stateText} · {state.powered?"供电正常":"供电断开"}</small></div><em>{state.status==="running"?`${state.progress}%`:stateText}</em></div>})}
          <div className="section-title"><span>产销统计</span><small>ROLLING 5 MINUTES</small></div>
          <section className="production-stats" aria-label="产线物品产出量与消耗量统计">
            {involvedStatsItems.length?<>
              <div className="stat-overview"><span className="produced"><i/>产出</span><span className="consumed"><i/>消耗</span><small>30 秒平滑 · 5 秒采样</small></div>
              <div className="stat-list">{involvedStatsItems.map((item)=>{const chart=statsCharts.get(item.id)!;return <article className="stat-item" key={item.id}>
                <header><span><AssetThumb src={item.image} label={item.name}/><strong>{item.name}</strong></span><div className="stat-rates"><b className="produced">产 {Math.round(chart.produced.at(-1)??0)}</b><b className="consumed">耗 {Math.round(chart.consumed.at(-1)??0)}</b><small>/min</small></div></header>
                <svg className="stat-chart" viewBox="0 0 240 38" role="img" aria-label={`${item.name}最近五分钟产出与消耗折线图`}><path className="stat-grid-line" d="M 0 1 H 240 M 0 19 H 240 M 0 37 H 240"/><path className="stat-line produced" d={chart.producedPath}/><path className="stat-line consumed" d={chart.consumedPath}/></svg>
                <footer><span>5 分钟</span><span>产出 <b>{chart.producedTotal}</b></span><span>消耗 <b>{chart.consumedTotal}</b></span></footer>
              </article>})}</div>
              <small className="stat-note">仓库存货口收货仅计库存转移，不计消耗</small>
            </>:<div className="stat-empty">放置并连接生产设备后显示产销历史</div>}
          </section>
          <div className="clock-card"><span>模拟时钟</span><strong>{String(Math.floor(elapsedSeconds/60)).padStart(2,"0")}:{String(elapsedSeconds%60).padStart(2,"0")}</strong><small>× 1.0　·　每 250ms 提交模拟快照</small></div>
        </aside>
      </section>
    </main>
  );
}
