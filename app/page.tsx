"use client";
/* eslint-disable @next/next/no-img-element -- local game and generated icons are rendered at native blueprint scale */

import { useEffect, useMemo, useRef, useState } from "react";
import { BELT_HEADWAY_TICKS, BELT_ITEMS_PER_MINUTE, PIPE_HEADWAY_TICKS, PIPE_ITEMS_PER_MINUTE, PIPE_LANE_PROFILE, SIM_TICK_MS, SIM_TICKS_PER_SECOND, advanceBeltLane, advancePipeLane, beltLaneCanAccept, beltLaneIsFull, beltTravelSeconds, nextLaneReadyTick, pipeLaneCanAccept, pipeLaneIsFull } from "../lib/belt-timing";
import { RADIAL_CONFIRM_DELAY_MS, RADIAL_HOLD_DELAY_MS, RADIAL_PREOPEN_TOLERANCE_PX, RadialAction, radialSelection } from "../lib/radial-menu";

type TransportKind = "belt" | "pipe";
type Kind = TransportKind | "refiner" | "fitter" | "molder" | "filler" | "reactor" | "gearAssembler" | "waterPump" | "splitter" | "merger" | "logisticsBridge" | "pipeSplitter" | "pipeMerger" | "pipeBridge" | "storagePort" | "tank" | "depot" | "powerPole";
type ProductionKind = "refiner" | "fitter" | "molder" | "filler" | "reactor" | "gearAssembler" | "waterPump";
type DeviceCategory = "全部" | "资源开采" | "仓储存取" | "基础生产" | "合成制造" | "电力供应" | "功能设备" | "战斗辅助" | "种植调配";
type Direction = 0 | 1 | 2 | 3;
type PipeContent = "clean-water" | "liquid-xiranite" | "sewage";
type Cell = { kind: Kind; rotation: Direction; entry?: Direction; id: string; root?: boolean; partX?: number; partY?: number; size?: number; width?: number; height?: number; content?: PipeContent; itemId?: string };
type Grid = Record<string, Cell>;

const DEFAULT_COLS = 18;
const DEFAULT_ROWS = 12;
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
type MachineState = { id:string; kind:ProductionKind; status:"idle"|"running"|"waiting"|"starved"|"blocked"|"unpowered"; progress:number; remaining:string; hasInput:boolean; hasOutput:boolean; powered:boolean; inventoryFull:boolean };
type PowerZone = { id:string; x:number; y:number; size:number };
type Point = { x:number; y:number };
type PortType = "input" | "output";
type PortSpec = { x:number; y:number; side:Direction; transport?:TransportKind };
type EquipmentLayout = { width:number; height:number; inputs:PortSpec[]; outputs:PortSpec[] };
type ResolvedPort = { key:string; entityId:string; entityKind:Kind; type:PortType; index:number; side:Direction; transport:TransportKind; cellX:number; cellY:number; externalX:number; externalY:number };
type BeltReplan = { routeId:string; replaceKeys:string[]; anchorEntry?:Direction };
type BeltJoin = { key:string; rotation:Direction };
type BeltDraft = { kind:TransportKind; cells:Point[]; waypoints:Point[]; sourcePort?:ResolvedPort; targetPort?:ResolvedPort; join?:BeltJoin; replan?:BeltReplan };
type RadialMenuState = { entityId:string; x:number; y:number; pointerId:number; active:RadialAction|null; phase:"open"|"confirming"; angle:number; distance:number };
type RadialGesture = { entityId:string; pointerId:number; startX:number; startY:number; currentX:number; currentY:number; opened:boolean };
type ConnectedFlowRoute = FlowRoute & { sourcePort?:ResolvedPort; targetPort?:ResolvedPort; sourceConnected:boolean; targetConnected:boolean; valid:boolean; itemId?:string; itemName:string; itemImage:string };
type IndustrialItem = { id:string; name:string; category:"矿物"|"工业产物"|"流体"; image:string; color?:string };
type DeviceInventory = { input:Record<string,number>; output:Record<string,number> };
type MachineDefinition = { name:string; recipe:string; width:number; height:number; image:string; inputs:{itemId:string;amount:number}[]; output:{itemId:string;amount:number}; durationTicks:number };
type TransitItem = { id:string; routeId:string; itemId:string; position:number; previousPosition:number };
type ItemStatSample = { second:number; produced:Record<string,number>; consumed:Record<string,number> };
type SimulationState = { tick:number; inventories:Record<string,DeviceInventory>; processes:Record<string,number>; transits:TransitItem[]; routeCursor:Record<string,number>; laneReadyAt:Record<string,number>; routeTransfers:Record<string,number[]>; itemStats:ItemStatSample[] };
const SOLID_INPUT_CAPACITY=50;
const FLUID_INPUT_CAPACITY=50;
const OUTPUT_CAPACITY=60;
const totalInventory=(bucket:Record<string,number>)=>Object.values(bucket).reduce((sum,quantity)=>sum+quantity,0);
const inputCapacityFor=(kind:Kind|undefined,transport:TransportKind)=>kind==="storagePort"?240:["splitter","merger","logisticsBridge","pipeSplitter","pipeMerger","pipeBridge"].includes(kind??"")?30:transport==="pipe"?FLUID_INPUT_CAPACITY:SOLID_INPUT_CAPACITY;
const secondsToTicks=(seconds:number)=>Math.round(seconds*SIM_TICKS_PER_SECOND);
const addQuantity=(bucket:Record<string,number>,itemId:string,amount:number)=>{bucket[itemId]=(bucket[itemId]??0)+amount};
const chartPath=(values:number[],maximum:number,width=240,height=82)=>values.map((value,index)=>`${index?"L":"M"} ${(index/Math.max(1,values.length-1)*width).toFixed(2)} ${(height-value/Math.max(1,maximum)*height).toFixed(2)}`).join(" ");
const emptySimulationState=():SimulationState=>({tick:0,inventories:{},processes:{},transits:[],routeCursor:{},laneReadyAt:{},routeTransfers:{},itemStats:[]});

const INDUSTRIAL_ITEMS:IndustrialItem[] = [
  {id:"blue-iron-ore",name:"蓝铁矿",category:"矿物",image:"/assets/items/blue-iron-ore.webp"},
  {id:"purple-crystal-ore",name:"紫晶矿",category:"矿物",image:"/assets/items/purple-crystal-ore.svg"},
  {id:"red-copper-ore",name:"赤铜矿",category:"矿物",image:"/assets/items/red-copper-ore.svg"},
  {id:"blue-iron-block",name:"蓝铁块",category:"工业产物",image:"/assets/items/blue-iron-block.webp"},
  {id:"iron-parts",name:"铁制零件",category:"工业产物",image:"/assets/items/iron-parts.webp"},
  {id:"blue-iron-powder",name:"蓝铁粉末",category:"工业产物",image:"/assets/items/blue-iron-powder.svg"},
  {id:"purple-crystal-fiber",name:"紫晶纤维",category:"工业产物",image:"/assets/items/purple-crystal-fiber.svg"},
  {id:"purple-crystal-parts",name:"紫晶零件",category:"工业产物",image:"/assets/items/purple-crystal-parts.svg"},
  {id:"steel-block",name:"钢块",category:"工业产物",image:"/assets/items/steel-block.svg"},
  {id:"crystal-shell",name:"晶体外壳",category:"工业产物",image:"/assets/items/crystal-shell.svg"},
  {id:"purple-equipment-component",name:"紫晶装备原件",category:"工业产物",image:"/assets/items/purple-equipment-component.svg"},
  {id:"blue-iron-bottle",name:"蓝铁瓶",category:"工业产物",image:"/assets/items/blue-iron-bottle.svg"},
  {id:"water-filled-blue-iron-bottle",name:"蓝铁瓶（清水）",category:"工业产物",image:"/assets/items/water-filled-blue-iron-bottle.svg"},
  {id:"xiranite",name:"息壤",category:"工业产物",image:"/assets/items/xiranite.svg"},
  {id:"clean-water",name:"清水",category:"流体",image:"/assets/items/clean-water.svg",color:"#a9dbea"},
  {id:"liquid-xiranite",name:"液化息壤",category:"流体",image:"/assets/items/liquid-xiranite.svg",color:"#b8dfcf"},
];

const itemTransport=(itemId:string):TransportKind=>INDUSTRIAL_ITEMS.find((item)=>item.id===itemId)?.category==="流体"?"pipe":"belt";
const inputTotalFor=(bucket:Record<string,number>,transport:TransportKind)=>Object.entries(bucket).reduce((sum,[itemId,quantity])=>sum+(itemTransport(itemId)===transport?quantity:0),0);

const MACHINE_DEFINITIONS:Record<ProductionKind,MachineDefinition> = {
  refiner:{name:"精炼炉",recipe:"蓝铁矿 ×1 → 蓝铁块 ×1",width:3,height:3,image:"/assets/machines/refinery.webp",inputs:[{itemId:"blue-iron-ore",amount:1}],output:{itemId:"blue-iron-block",amount:1},durationTicks:secondsToTicks(2)},
  fitter:{name:"配件机",recipe:"蓝铁块 ×1 → 铁制零件 ×1",width:3,height:3,image:"/assets/machines/assembler.webp",inputs:[{itemId:"blue-iron-block",amount:1}],output:{itemId:"iron-parts",amount:1},durationTicks:secondsToTicks(2)},
  molder:{name:"塑形机",recipe:"蓝铁块 ×2 → 蓝铁瓶 ×1",width:3,height:3,image:"/assets/machines/molder.svg",inputs:[{itemId:"blue-iron-block",amount:2}],output:{itemId:"blue-iron-bottle",amount:1},durationTicks:secondsToTicks(2)},
  filler:{name:"灌装机",recipe:"蓝铁瓶 ×1 + 清水 ×1 → 蓝铁瓶（清水） ×1",width:4,height:6,image:"/assets/machines/filler.svg",inputs:[{itemId:"blue-iron-bottle",amount:1},{itemId:"clean-water",amount:1}],output:{itemId:"water-filled-blue-iron-bottle",amount:1},durationTicks:secondsToTicks(2)},
  reactor:{name:"反应池",recipe:"息壤 ×1 + 清水 ×1 → 液化息壤 ×1",width:5,height:5,image:"/assets/machines/reactor.svg",inputs:[{itemId:"xiranite",amount:1},{itemId:"clean-water",amount:1}],output:{itemId:"liquid-xiranite",amount:1},durationTicks:secondsToTicks(2)},
  gearAssembler:{name:"装备原件机",recipe:"晶体外壳 ×5 + 紫晶纤维 ×5 → 紫晶装备原件 ×1",width:4,height:6,image:"/assets/machines/gear-assembler.svg",inputs:[{itemId:"crystal-shell",amount:5},{itemId:"purple-crystal-fiber",amount:5}],output:{itemId:"purple-equipment-component",amount:1},durationTicks:secondsToTicks(10)},
  waterPump:{name:"水泵",recipe:"水源 → 清水 ×1",width:2,height:2,image:"/assets/machines/water-pump.svg",inputs:[],output:{itemId:"clean-water",amount:1},durationTicks:secondsToTicks(1)},
};

const edgePorts=(height:number,side:Direction,x:number):PortSpec[]=>Array.from({length:height},(_,y)=>({x,y,side}));

const EQUIPMENT_LAYOUTS: Partial<Record<Kind,EquipmentLayout>> = {
  depot:{width:1,height:3,inputs:[],outputs:[{x:0,y:1,side:0}]},
  storagePort:{width:1,height:3,inputs:[{x:0,y:1,side:2}],outputs:[]},
  refiner:{width:3,height:3,inputs:edgePorts(3,2,0),outputs:edgePorts(3,0,2)},
  fitter:{width:3,height:3,inputs:edgePorts(3,2,0),outputs:edgePorts(3,0,2)},
  molder:{width:3,height:3,inputs:edgePorts(3,2,0),outputs:edgePorts(3,0,2)},
  filler:{width:4,height:6,inputs:[...edgePorts(6,2,0),{x:1,y:5,side:1,transport:"pipe"}],outputs:edgePorts(6,0,3)},
  reactor:{width:5,height:5,inputs:[{x:0,y:1,side:2},{x:0,y:3,side:2,transport:"pipe"}],outputs:[{x:4,y:1,side:0,transport:"pipe"},{x:4,y:3,side:0,transport:"pipe"}]},
  gearAssembler:{width:4,height:6,inputs:edgePorts(6,2,0),outputs:edgePorts(6,0,3)},
  waterPump:{width:2,height:2,inputs:[],outputs:[{x:1,y:1,side:0,transport:"pipe"}]},
  splitter:{width:1,height:1,inputs:[{x:0,y:0,side:2}],outputs:[{x:0,y:0,side:0},{x:0,y:0,side:1},{x:0,y:0,side:3}]},
  merger:{width:1,height:1,inputs:[{x:0,y:0,side:2},{x:0,y:0,side:1},{x:0,y:0,side:3}],outputs:[{x:0,y:0,side:0}]},
  logisticsBridge:{width:1,height:1,inputs:[{x:0,y:0,side:2},{x:0,y:0,side:3}],outputs:[{x:0,y:0,side:0},{x:0,y:0,side:1}]},
  pipeSplitter:{width:1,height:1,inputs:[{x:0,y:0,side:2,transport:"pipe"}],outputs:[{x:0,y:0,side:0,transport:"pipe"},{x:0,y:0,side:1,transport:"pipe"},{x:0,y:0,side:3,transport:"pipe"}]},
  pipeMerger:{width:1,height:1,inputs:[{x:0,y:0,side:2,transport:"pipe"},{x:0,y:0,side:1,transport:"pipe"},{x:0,y:0,side:3,transport:"pipe"}],outputs:[{x:0,y:0,side:0,transport:"pipe"}]},
  pipeBridge:{width:1,height:1,inputs:[{x:0,y:0,side:2,transport:"pipe"},{x:0,y:0,side:3,transport:"pipe"}],outputs:[{x:0,y:0,side:0,transport:"pipe"},{x:0,y:0,side:1,transport:"pipe"}]},
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
  const entities=new Map<string,{kind:Kind;rotation:Direction;positions:Point[]}>();
  Object.entries(grid).forEach(([key,cell])=>{
    if(!EQUIPMENT_LAYOUTS[cell.kind])return;
    const [x,y]=key.split(",").map(Number);
    const entity=entities.get(cell.id)??{kind:cell.kind,rotation:cell.rotation,positions:[]};
    entity.positions.push({x,y}); entities.set(cell.id,entity);
  });
  const ports:ResolvedPort[]=[];
  entities.forEach((entity,entityId)=>{
    const layout=EQUIPMENT_LAYOUTS[entity.kind];
    if(!layout)return;
    const minX=Math.min(...entity.positions.map(({x})=>x)),minY=Math.min(...entity.positions.map(({y})=>y));
    const append=(spec:PortSpec,type:PortType,index:number)=>{
      const rotated=rotatePort(spec,layout.width,layout.height,entity.rotation);
      const [dx,dy]=DELTAS[rotated.side];
      const cellX=minX+rotated.x,cellY=minY+rotated.y;
      ports.push({key:`${entityId}:${type}:${index}`,entityId,entityKind:entity.kind,type,index,side:rotated.side,transport:spec.transport??"belt",cellX,cellY,externalX:cellX+dx,externalY:cellY+dy});
    };
    layout.inputs.forEach((port,index)=>append(port,"input",index));
    layout.outputs.forEach((port,index)=>append(port,"output",index));
  });
  return ports;
}

function isPortConnected(grid:Grid,pipeGrid:Grid,port:ResolvedPort) {
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
  return <g ref={routeRef} className={`route-cargo-sprites ${running?"moving":"paused"} ${stalled?"stalled":""}`}>{transits.map((transit)=>{const renderPosition=running?transit.previousPosition:transit.position,initial=pointOnRoute(route,renderPosition/route.cells.length),item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===transit.itemId);return <g key={transit.id} className="flow-cargo" transform={`translate(${initial.x} ${initial.y})`} data-transit-id={transit.id} data-position={transit.position.toFixed(3)}><rect x="-.3" y="-.3" width=".6" height=".6" rx=".05"/><image href={item?.image??""} x="-.25" y="-.25" width=".5" height=".5" preserveAspectRatio="xMidYMid meet"/></g>})}</g>;
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
  { kind: "depot", label: "仓库取货口", type:"device", category:"仓储存取", glyph: "D", desc: "1×3 · 指定物品输出" },
  { kind: "storagePort", label: "仓库存货口", type:"device", category:"仓储存取", glyph: "ST", desc: "1×3 · 回收入库", image:"/assets/machines/storage-port.svg" },
  { kind: "splitter", label: "分流器", type:"device", category:"仓储存取", glyph: "S", desc: "1 入 · 3 出", image:"/assets/machines/splitter.svg" },
  { kind: "merger", label: "汇流器", type:"device", category:"仓储存取", glyph: "M", desc: "3 入 · 1 出", image:"/assets/machines/merger.svg" },
  { kind: "logisticsBridge", label: "物流桥", type:"device", category:"仓储存取", glyph: "BR", desc: "两条传送带正交跨越", image:"/assets/machines/logistics-bridge.svg" },
  { kind: "pipeSplitter", label: "管道分流器", type:"device", category:"仓储存取", glyph: "PS", desc: "1 入 · 至多 3 出", image:"/assets/machines/pipe-splitter.svg" },
  { kind: "pipeMerger", label: "管道汇流器", type:"device", category:"仓储存取", glyph: "PM", desc: "至多 3 入 · 1 出", image:"/assets/machines/pipe-merger.svg" },
  { kind: "pipeBridge", label: "管道桥", type:"device", category:"仓储存取", glyph: "PB", desc: "两条管道正交跨越", image:"/assets/machines/pipe-bridge.svg" },
  { kind: "refiner", label: "精炼炉", type:"device", category:"基础生产", glyph: "R", desc: "矿石 → 金属块", image:"/assets/machines/refinery.webp" },
  { kind: "fitter", label: "配件机", type:"device", category:"基础生产", glyph: "F", desc: "金属块 → 零件", image:"/assets/machines/assembler.webp" },
  { kind: "molder", label: "塑形机", type:"device", category:"基础生产", glyph: "MO", desc: "3×3 · 容器塑形", image:"/assets/machines/molder.svg" },
  { kind: "gearAssembler", label: "装备原件机", type:"device", category:"合成制造", glyph: "GA", desc: "6×4 · 双物料合成", image:"/assets/machines/gear-assembler.svg" },
  { kind: "filler", label: "灌装机", type:"device", category:"合成制造", glyph: "FI", desc: "4×6 · 固体与流体输入", image:"/assets/machines/filler.svg" },
  { kind: "reactor", label: "反应池", type:"device", category:"合成制造", glyph: "RC", desc: "5×5 · 固液反应", image:"/assets/machines/reactor.svg" },
  { kind: "waterPump", label: "水泵", type:"device", category:"资源开采", glyph: "WP", desc: "2×2 · 清水 60/min", image:"/assets/machines/water-pump.svg" },
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
  const [selectedStatsItemId,setSelectedStatsItemId]=useState("blue-iron-ore");
  const [inventoryItemId,setInventoryItemId]=useState("blue-iron-ore");
  const [inventoryAmount,setInventoryAmount]=useState(10);
  const [notice, setNotice] = useState("演示蓝图已载入 · 按 E 规划传送带");
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [gridOpacity, setGridOpacity] = useState(0.1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState<{ x:number; y:number; ox:number; oy:number } | null>(null);
  const [radialMenu,setRadialMenu]=useState<RadialMenuState|null>(null);
  const [catalogDrag,setCatalogDrag]=useState<Kind|null>(null);
  const [catalogPreview,setCatalogPreview]=useState<Point|null>(null);
  const catalogDragKindRef=useRef<Kind|null>(null);
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

  useEffect(()=>{
    const pointAt=(clientX:number,clientY:number,kind:Kind)=>{
      const element=gridRef.current;if(!element)return null;
      const layout=EQUIPMENT_LAYOUTS[kind],width=layout?.width??(kind==="powerPole"?2:1),height=layout?.height??(kind==="powerPole"?2:1),rect=element.getBoundingClientRect();
      if(clientX<rect.left||clientY<rect.top||clientX>rect.right||clientY>rect.bottom)return null;
      const x=Math.max(0,Math.min(cols-width,Math.floor((clientX-rect.left)/rect.width*cols))),y=Math.max(0,Math.min(rows-height,Math.floor((clientY-rect.top)/rect.height*rows)));
      const valid=Array.from({length:width*height},(_,index)=>keyOf(x+index%width,y+Math.floor(index/width))).every((key)=>!grid[key]&&!pipeGrid[key]);
      return{x,y,valid};
    };
    const move=(event:MouseEvent|PointerEvent)=>{const kind=catalogDragKindRef.current;if(!kind)return;const point=pointAt(event.clientX,event.clientY,kind);setCatalogPreview(point?{x:point.x,y:point.y}:null)};
    const finish=(event:MouseEvent|PointerEvent)=>{const kind=catalogDragKindRef.current;if(!kind)return;const point=pointAt(event.clientX,event.clientY,kind);catalogDragKindRef.current=null;setCatalogDrag(null);setCatalogPreview(null);if(point?.valid)catalogDropRef.current(point.x,point.y,kind);else{setSelected("belt");setNotice(point?"目标占地与现有设备或物流线路冲突":"拖动已取消 · 请在画布网格内释放")}};
    const cancel=()=>{if(catalogDragKindRef.current===null)return;catalogDragKindRef.current=null;setCatalogDrag(null);setCatalogPreview(null);setSelected("belt")};
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
  const portsByCell=useMemo(()=>{
    const index=new Map<string,ResolvedPort[]>();
    resolvedPorts.forEach((port)=>{const key=keyOf(port.cellX,port.cellY),ports=index.get(key)??[];ports.push(port);index.set(key,ports)});
    return index;
  },[resolvedPorts]);
  const connectedFlowRoutes=useMemo<ConnectedFlowRoute[]>(()=>{
    const routes=flowRoutes.map((route)=>{
      const first=route.cells[0],last=route.cells[route.cells.length-1];
      const sourcePort=resolvedPorts.find((port)=>port.transport===route.kind&&port.type==="output"&&port.externalX===first.x&&port.externalY===first.y&&first.cell.entry===opposite(port.side));
      const targetPort=resolvedPorts.find((port)=>port.transport===route.kind&&port.type==="input"&&port.externalX===last.x&&port.externalY===last.y&&last.cell.rotation===opposite(port.side));
      const depotCell=sourcePort?.entityKind==="depot"?Object.values(grid).find((cell)=>cell.id===sourcePort.entityId):undefined;
      const sourceDefinition=sourcePort&&sourcePort.entityKind in MACHINE_DEFINITIONS?MACHINE_DEFINITIONS[sourcePort.entityKind as ProductionKind]:undefined;
      const item=sourcePort?.entityKind==="depot"?INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===depotCell?.itemId):sourceDefinition?INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===sourceDefinition.output.itemId):undefined;
      return {...route,sourcePort,targetPort,sourceConnected:Boolean(sourcePort),targetConnected:Boolean(targetPort),valid:Boolean(sourcePort),itemId:item?.id,itemName:item?.name??(sourcePort?.entityKind==="depot"?"取货口未选择物品":"未接入输出口"),itemImage:item?.image??""};
    });
    for(let pass=0;pass<6;pass++)routes.forEach((route)=>{
      if(route.itemId||!route.sourcePort||!(route.sourcePort.entityKind==="splitter"||route.sourcePort.entityKind==="merger"||route.sourcePort.entityKind==="logisticsBridge"||route.sourcePort.entityKind==="pipeSplitter"||route.sourcePort.entityKind==="pipeMerger"||route.sourcePort.entityKind==="pipeBridge"))return;
      const isBridge=route.sourcePort.entityKind==="logisticsBridge"||route.sourcePort.entityKind==="pipeBridge";
      const upstream=routes.find((candidate)=>candidate.valid&&candidate.targetPort?.entityId===route.sourcePort?.entityId&&candidate.itemId&&(!isBridge||candidate.targetPort?.index===route.sourcePort?.index));
      if(!upstream)return;
      route.itemId=upstream.itemId;route.itemName=upstream.itemName;route.itemImage=upstream.itemImage;
    });
    return routes;
  },[flowRoutes,resolvedPorts,grid]);
  const connectedRouteByCell=useMemo(()=>{
    const index=new Map<string,ConnectedFlowRoute>();
    connectedFlowRoutes.forEach((route)=>route.cells.forEach(({x,y})=>index.set(`${route.kind}:${keyOf(x,y)}`,route)));
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
  useEffect(()=>{
    if(!running)return;
    const timer=window.setInterval(()=>setSimulation((previous)=>{
      const tick=previous.tick+1;
      const inventories=Object.fromEntries(Object.entries(previous.inventories).map(([id,inventory])=>[id,{input:{...inventory.input},output:{...inventory.output}}]));
      const processes={...previous.processes};
      const routeCursor={...previous.routeCursor};
      const laneReadyAt={...previous.laneReadyAt};
      const routeTransfers=Object.fromEntries(Object.entries(previous.routeTransfers).map(([routeId,ticks])=>[routeId,ticks.filter((transferTick)=>tick-transferTick<=60*SIM_TICKS_PER_SECOND)]));
      const producedThisTick:Record<string,number>={};
      const consumedThisTick:Record<string,number>={};
      const ensureInventory=(id:string)=>inventories[id]??(inventories[id]={input:{},output:{}});
      const entityKinds=new Map<string,Kind>();
      const productionEntities=new Map<string,{kind:ProductionKind;positions:Point[];cell:Cell}>();
      Object.entries(grid).forEach(([key,cell])=>{
        entityKinds.set(cell.id,cell.kind);
        if(!(cell.kind in MACHINE_DEFINITIONS))return;
        const [x,y]=key.split(",").map(Number),kind=cell.kind as ProductionKind;
        const entity=productionEntities.get(cell.id)??{kind,positions:[],cell};entity.positions.push({x,y});productionEntities.set(cell.id,entity);
      });
      productionEntities.forEach((entity,id)=>{
        const definition=MACHINE_DEFINITIONS[entity.kind],inventory=ensureInventory(id);
        const minX=Math.min(...entity.positions.map(({x})=>x)),minY=Math.min(...entity.positions.map(({y})=>y));
        const powered=powerZones.some((zone)=>zone.x<minX+(entity.cell.width??definition.width)&&zone.x+zone.size>minX&&zone.y<minY+(entity.cell.height??definition.height)&&zone.y+zone.size>minY);
        const inputsReady=definition.inputs.every((requirement)=>(inventory.input[requirement.itemId]??0)>=requirement.amount);
        const outputTotal=Object.values(inventory.output).reduce((sum,quantity)=>sum+quantity,0);
        if(!powered||!inputsReady||outputTotal+definition.output.amount>OUTPUT_CAPACITY)return;
        const nextProgress=(processes[id]??0)+1;
        if(nextProgress<definition.durationTicks){processes[id]=nextProgress;return}
        definition.inputs.forEach((requirement)=>{inventory.input[requirement.itemId]=Math.max(0,(inventory.input[requirement.itemId]??0)-requirement.amount);addQuantity(consumedThisTick,requirement.itemId,requirement.amount)});
        inventory.output[definition.output.itemId]=(inventory.output[definition.output.itemId]??0)+definition.output.amount;
        addQuantity(producedThisTick,definition.output.itemId,definition.output.amount);
        processes[id]=0;
      });
      const previousByRoute=new Map<string,TransitItem[]>();
      previous.transits.forEach((transit)=>{const lane=previousByRoute.get(transit.routeId)??[];lane.push(transit);previousByRoute.set(transit.routeId,lane)});
      const activeTransits:TransitItem[]=[];
      const activeByRoute=new Map<string,TransitItem[]>();
      connectedFlowRoutes.forEach((route)=>{
        const lane=previousByRoute.get(route.id)??[];
        const target=route.targetPort?ensureInventory(route.targetPort.entityId):null;
        const canExit=Boolean(target&&inputTotalFor(target.input,route.kind)<inputCapacityFor(entityKinds.get(route.targetPort!.entityId),route.kind));
         const advanced=route.kind==="pipe"?advancePipeLane(lane,route.cells.length,canExit):advanceBeltLane(lane,route.cells.length,canExit);
        activeByRoute.set(route.id,advanced.active);activeTransits.push(...advanced.active);
        if(target)advanced.delivered.forEach((transit)=>{target.input[transit.itemId]=(target.input[transit.itemId]??0)+1});
      });
      const groups=new Map<string,ConnectedFlowRoute[]>();
      connectedFlowRoutes.forEach((route)=>{if(!route.valid||!route.itemId||!route.sourcePort)return;const list=groups.get(route.sourcePort.entityId)??[];list.push(route);groups.set(route.sourcePort.entityId,list)});
      groups.forEach((routes,sourceId)=>{
        const sourceKind=entityKinds.get(sourceId),sourceInventory=ensureInventory(sourceId);
        const ready=new Set(routes.filter((route)=>{
          if((laneReadyAt[route.id]??0)>tick)return false;
           return route.kind==="pipe"?pipeLaneCanAccept(activeByRoute.get(route.id)??[],route.cells.length):beltLaneCanAccept(activeByRoute.get(route.id)??[],route.cells.length);
        }).map((route)=>route.id));
        if(!ready.size)return;
        const sourceBucket=sourceKind&&sourceKind in MACHINE_DEFINITIONS?sourceInventory.output:sourceInventory.input;
        const cursor=(routeCursor[sourceId]??0)%routes.length;
        const ordered=routes.map((_,index)=>routes[(cursor+index)%routes.length]).filter((route)=>ready.has(route.id));
        const available={...sourceBucket};
        const dispatched=ordered.filter((route)=>{
          if(sourceKind==="depot")return true;
          const itemId=route.itemId!,stock=available[itemId]??0;
          if(stock<=0)return false;
          available[itemId]=stock-1;return true;
        });
        dispatched.forEach((route)=>{
          const transit={id:crypto.randomUUID(),routeId:route.id,itemId:route.itemId!,position:0,previousPosition:0};
          activeTransits.push(transit);activeByRoute.set(route.id,[...(activeByRoute.get(route.id)??[]),transit]);
          laneReadyAt[route.id]=nextLaneReadyTick(tick,route.kind==="pipe"?PIPE_HEADWAY_TICKS:BELT_HEADWAY_TICKS);
          routeTransfers[route.id]=[...(routeTransfers[route.id]??[]),tick];
          if(sourceKind==="depot")addQuantity(producedThisTick,route.itemId!,1);
        });
        if(sourceKind!=="depot")dispatched.forEach((route)=>{const itemId=route.itemId!;sourceBucket[itemId]=Math.max(0,(sourceBucket[itemId]??0)-1)});
        if(dispatched.length)routeCursor[sourceId]=(routes.indexOf(dispatched[dispatched.length-1])+1)%routes.length;
      });
      const second=Math.floor(tick/SIM_TICKS_PER_SECOND),itemStats=(previous.itemStats??[]).map((sample)=>({second:sample.second,produced:{...sample.produced},consumed:{...sample.consumed}}));
      if(Object.keys(producedThisTick).length||Object.keys(consumedThisTick).length){
        const sample=itemStats[itemStats.length-1];
        if(sample?.second===second){Object.entries(producedThisTick).forEach(([itemId,amount])=>addQuantity(sample.produced,itemId,amount));Object.entries(consumedThisTick).forEach(([itemId,amount])=>addQuantity(sample.consumed,itemId,amount))}
        else itemStats.push({second,produced:producedThisTick,consumed:consumedThisTick});
      }
      // Storage-port delivery is inventory transfer, not consumption; recipe removal is the only consumption event.
      return {tick,inventories,processes,transits:activeTransits,routeCursor,laneReadyAt,routeTransfers,itemStats:itemStats.filter((sample)=>sample.second>=second-64)};
    }),SIM_TICK_MS);
    return ()=>window.clearInterval(timer);
  },[running,grid,connectedFlowRoutes,powerZones]);
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
      const hasInput=definition.inputs.every((requirement)=>(inventory.input[requirement.itemId]??0)>=requirement.amount);
      const hasOutput=outputTotal+definition.output.amount<=OUTPUT_CAPACITY;
      const minX=Math.min(...positions.map(({x})=>x)),minY=Math.min(...positions.map(({y})=>y));
      const powered=powerZones.some((zone)=>zone.x<minX+width&&zone.x+zone.size>minX&&zone.y<minY+height&&zone.y+zone.size>minY);
      const progressTicks=simulation.processes[id]??0;
      const status:MachineState["status"]=!powered?"unpowered":!running?"idle":!hasInput?"starved":!hasOutput?"blocked":"running";
      const progress=Math.min(100,Math.round(progressTicks/definition.durationTicks*100));
      states[id]={id,kind,status,progress,remaining:status==="running"?Math.max(0,(definition.durationTicks-progressTicks)/SIM_TICKS_PER_SECOND).toFixed(1):"--",hasInput,hasOutput,powered,inventoryFull:solidInputTotal>=inputCapacityFor(kind,"belt")||fluidInputTotal>=inputCapacityFor(kind,"pipe")||outputTotal>=OUTPUT_CAPACITY};
    });
    return states;
  },[grid,powerZones,simulation.inventories,simulation.processes,running]);
  const tick=simulation.tick;
  const elapsedSeconds=Math.floor(tick/SIM_TICKS_PER_SECOND);
  const productionStates = Object.values(machineStates);
  const selectedEntity = selectedEntityId ? Object.values(grid).find((cell)=>cell.id===selectedEntityId) : null;
  const radialEntity = radialMenu ? Object.values(grid).find((cell)=>cell.id===radialMenu.entityId) : null;
  const radialEntityLabel=radialEntity?tools.find((tool)=>tool.kind===radialEntity.kind)?.label??"设备":"设备";
  const selectedRoute=selectedTransportKey?flowRoutes.find((route)=>route.kind===selectedTransportKind&&route.cells.some(({x,y})=>keyOf(x,y)===selectedTransportKey))??null:null;
  const selectedRouteKeys=useMemo(()=>new Set(selectedRoute?.cells.map(({x,y})=>keyOf(x,y))??[]),[selectedRoute]);
  const selectedDepotItem=selectedEntity?.kind==="depot"?INDUSTRIAL_ITEMS.find((item)=>item.id===selectedEntity.itemId):null;
  const showPowerZones=selected==="powerPole"||selectedEntity?.kind==="powerPole";
  const entityKinds=useMemo(()=>new Map(Object.values(grid).map((cell)=>[cell.id,cell.kind])),[grid]);
  const inventoryFullIds=useMemo(()=>{
    const ids=new Set<string>();
    Object.entries(simulation.inventories).forEach(([id,inventory])=>{
      const kind=entityKinds.get(id);
      if(inputTotalFor(inventory.input,"belt")>=inputCapacityFor(kind,"belt")||inputTotalFor(inventory.input,"pipe")>=inputCapacityFor(kind,"pipe")||totalInventory(inventory.output)>=OUTPUT_CAPACITY)ids.add(id);
    });
    return ids;
  },[entityKinds,simulation.inventories]);
  const transitsByRoute=useMemo(()=>{
    const lanes=new Map<string,TransitItem[]>();
    simulation.transits.forEach((transit)=>{const lane=lanes.get(transit.routeId)??[];lane.push(transit);lanes.set(transit.routeId,lane)});
    return lanes;
  },[simulation.transits]);
  const stalledRouteIds=useMemo(()=>new Set(connectedFlowRoutes.filter((route)=>{
    if(!running||!route.valid)return false;
    const targetBlocked=!route.targetPort||inputTotalFor((simulation.inventories[route.targetPort.entityId]??{input:{},output:{}}).input,route.kind)>=inputCapacityFor(entityKinds.get(route.targetPort.entityId),route.kind);
     return targetBlocked&&(route.kind==="pipe"?pipeLaneIsFull(transitsByRoute.get(route.id)??[],route.cells.length):beltLaneIsFull(transitsByRoute.get(route.id)??[],route.cells.length));
  }).map((route)=>route.id)),[connectedFlowRoutes,entityKinds,running,simulation.inventories,transitsByRoute]);
  const transportMeta=useMemo(()=>{
    const meta=new Map<string,{kind:TransportKind;name:string;image:string;rate:number;connected:boolean;targetConnected:boolean;travelSeconds:number;cargoCount:number;capacity:number;full:boolean;color?:string}>();
    const observedSeconds=Math.max(5,Math.min(60,simulation.tick/SIM_TICKS_PER_SECOND));
    connectedFlowRoutes.forEach((route)=>{const lane=transitsByRoute.get(route.id)??[],cargoCount=lane.length,isPipe=route.kind==="pipe",capacity=route.cells.length*(isPipe?PIPE_LANE_PROFILE.unitsPerCell:1),full=isPipe?pipeLaneIsFull(lane,route.cells.length):beltLaneIsFull(lane,route.cells.length),item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===route.itemId),rate=Math.round((simulation.routeTransfers[route.id]?.length??0)*60/observedSeconds);route.cells.forEach(({x,y})=>meta.set(`${route.kind}:${keyOf(x,y)}`,{kind:route.kind,name:route.itemName,image:route.itemImage,rate,connected:route.sourceConnected,targetConnected:route.targetConnected,travelSeconds:isPipe?route.cells.length/(PIPE_LANE_PROFILE.cellsPerTick*SIM_TICKS_PER_SECOND):beltTravelSeconds(route.cells.length),cargoCount,capacity,full,color:item?.color}))});
    return meta;
  },[connectedFlowRoutes,simulation.routeTransfers,simulation.tick,transitsByRoute]);
  const involvedStatsItems=useMemo(()=>{
    const itemIds=new Set<string>();
    const entityIds=new Set<string>();
    Object.values(grid).forEach((cell)=>{
      if(entityIds.has(cell.id))return;entityIds.add(cell.id);
      if(cell.kind==="depot"&&cell.itemId)itemIds.add(cell.itemId);
      if(cell.kind in MACHINE_DEFINITIONS){const definition=MACHINE_DEFINITIONS[cell.kind as ProductionKind];definition.inputs.forEach((input)=>itemIds.add(input.itemId));itemIds.add(definition.output.itemId)}
    });
    connectedFlowRoutes.forEach((route)=>{if(route.itemId)itemIds.add(route.itemId)});
    Object.values(simulation.inventories).forEach((inventory)=>{Object.keys(inventory.input).forEach((itemId)=>itemIds.add(itemId));Object.keys(inventory.output).forEach((itemId)=>itemIds.add(itemId))});
    simulation.itemStats.forEach((sample)=>{Object.keys(sample.produced).forEach((itemId)=>itemIds.add(itemId));Object.keys(sample.consumed).forEach((itemId)=>itemIds.add(itemId))});
    return INDUSTRIAL_ITEMS.filter((item)=>itemIds.has(item.id));
  },[connectedFlowRoutes,grid,simulation.inventories,simulation.itemStats]);
  const selectedStatsItem=involvedStatsItems.find((item)=>item.id===selectedStatsItemId)??involvedStatsItems[0];
  const statsChart=useMemo(()=>{
    const currentSecond=Math.floor(simulation.tick/SIM_TICKS_PER_SECOND),samples=new Map(simulation.itemStats.map((sample)=>[sample.second,sample]));
    const chartItemId=selectedStatsItem?.id??"";
    const seconds=Array.from({length:60},(_,index)=>currentSecond-59+index);
    const producedAmounts=seconds.map((second)=>samples.get(second)?.produced[chartItemId]??0),consumedAmounts=seconds.map((second)=>samples.get(second)?.consumed[chartItemId]??0);
    const rollingRate=(amounts:number[])=>amounts.map((_,index)=>{const start=Math.max(0,index-4),window=amounts.slice(start,index+1);return window.reduce((sum,amount)=>sum+amount,0)*60/window.length});
    const produced=rollingRate(producedAmounts),consumed=rollingRate(consumedAmounts),maximum=Math.max(1,...produced,...consumed);
    return {produced,consumed,maximum,producedPath:chartPath(produced,maximum),consumedPath:chartPath(consumed,maximum),producedTotal:producedAmounts.reduce((sum,amount)=>sum+amount,0),consumedTotal:consumedAmounts.reduce((sum,amount)=>sum+amount,0)};
  },[selectedStatsItem?.id,simulation.itemStats,simulation.tick]);
  const snapCandidate=useMemo(()=>{
    if(!beltBuildMode||!hoveredEntity)return null;
    const type:PortType=beltDraft?"input":"output";
    const last=beltDraft?.cells[beltDraft.cells.length-1];
    const draftKeys=new Set(beltDraft?.cells.map((point)=>keyOf(point.x,point.y))??[]);
    const replaceable=new Set(beltDraft?.replan?.replaceKeys??[]);
    const transportGrid=beltBuildMode==="pipe"?pipeGrid:grid;
    return resolvedPorts.filter((port)=>port.transport===beltBuildMode&&port.entityId===hoveredEntity.id&&port.type===type&&port.externalX>=0&&port.externalY>=0&&port.externalX<cols&&port.externalY<rows&&(!transportGrid[keyOf(port.externalX,port.externalY)]||replaceable.has(keyOf(port.externalX,port.externalY)))&&(!draftKeys.has(keyOf(port.externalX,port.externalY))||(last?.x===port.externalX&&last?.y===port.externalY))).sort((a,b)=>Math.abs(a.cellX-hoveredEntity.x)+Math.abs(a.cellY-hoveredEntity.y)-Math.abs(b.cellX-hoveredEntity.x)-Math.abs(b.cellY-hoveredEntity.y))[0]??null;
  },[beltBuildMode,beltDraft,cols,grid,hoveredEntity,pipeGrid,resolvedPorts,rows]);
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
  const selectedInventory=selectedEntityId?simulation.inventories[selectedEntityId]??{input:{},output:{}}:{input:{},output:{}};
  const inventoryMenuVisible=Boolean(selectedEntity&&selectedEntity.kind!=="depot"&&selectedEntity.kind!=="powerPole");
  const selectedInputItemIds=[...new Set([...(selectedDefinition?.inputs.map((item)=>item.itemId)??[]),...Object.keys(selectedInventory.input)])];
  const selectedSolidInputItemIds=selectedInputItemIds.filter((itemId)=>itemTransport(itemId)==="belt");
  const selectedFluidInputItemIds=selectedInputItemIds.filter((itemId)=>itemTransport(itemId)==="pipe");
  const selectedSolidInputTotal=inputTotalFor(selectedInventory.input,"belt");
  const selectedFluidInputTotal=inputTotalFor(selectedInventory.input,"pipe");
  const selectedOutputItemIds=[...new Set([...(selectedDefinition?[selectedDefinition.output.itemId]:[]),...Object.keys(selectedInventory.output)])];
  const pickedWidth=pickedEntity?Math.max(...pickedEntity.cells.map((cell)=>cell.dx))+1:0;
  const pickedHeight=pickedEntity?Math.max(...pickedEntity.cells.map((cell)=>cell.dy))+1:0;
  const catalogLayout=catalogDrag?EQUIPMENT_LAYOUTS[catalogDrag]:undefined;
  const catalogWidth=catalogLayout?.width??(catalogDrag==="powerPole"?2:1),catalogHeight=catalogLayout?.height??(catalogDrag==="powerPole"?2:1);
  const catalogPlacementValid=Boolean(catalogDrag&&catalogPreview&&!isTransport(catalogDrag))&&Array.from({length:catalogWidth*catalogHeight},(_,index)=>keyOf(catalogPreview!.x+index%catalogWidth,catalogPreview!.y+Math.floor(index/catalogWidth))).every((key)=>!grid[key]&&!pipeGrid[key]);
  const placementTargets=useMemo(()=>pickedEntity&&placementPreview?pickedEntity.cells.map((item)=>({x:placementPreview.x+item.dx,y:placementPreview.y+item.dy,item})):[],[pickedEntity,placementPreview]);
  const placementValid=useMemo(()=>Boolean(pickedEntity&&placementPreview)&&placementTargets.every(({x,y})=>{
    if(x<0||y<0||x>=cols||y>=rows)return false;
    const key=keyOf(x,y),movingOwn=Boolean(pickedEntity?.mode==="move"&&pickedEntity.sourceKeys.includes(key));
    if(pickedEntity?.sourceType==="entity")return (!grid[key]||movingOwn)&&!pipeGrid[key];
    const kind=pickedEntity?.cells[0]?.cell.kind;
    return kind==="pipe"?(!pipeGrid[key]||movingOwn)&&!Boolean(grid[key]&&!isTransport(grid[key].kind)):!grid[key]||movingOwn;
  }),[cols,grid,pickedEntity,pipeGrid,placementPreview,placementTargets,rows]);
  const placementRoute=useMemo<FlowRoute|null>(()=>{
    if(!pickedEntity||pickedEntity.sourceType!=="route"||!placementTargets.length)return null;
    const cells=placementTargets.map(({x,y,item})=>({x,y,cell:item.cell}));
    return {id:"placement-route",kind:cells[0]?.cell.kind==="pipe"?"pipe":"belt",cells,path:roundedPath(cells)};
  },[pickedEntity,placementTargets]);

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
    const write=(old:Grid)=>{const next={...old};if(pickedEntity.mode==="move")pickedEntity.sourceKeys.forEach((key)=>delete next[key]);targets.forEach(({key,item})=>{next[key]={...item.cell,id:placedId}});return next};
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
    cancelRadialMenu();setRunning(false);setSelected(kind);setSelectionMode(false);setPickedEntity(null);setPlacementPreview(null);setSelectedEntityId(null);setSelectedTransportKey(null);setSelectedTransportKind(kind);setBeltBuildMode(kind);setBeltDraft(null);setBeltPreviewPoint(null);setHoveredEntity(null);
    setNotice(`${kind==="pipe"?"管道":"传送带"}模式 · 点击起点，继续点击添加路径点`);
  }

  function availableSnapPort(entityId:string,type:PortType,x:number,y:number) {
    const last=beltDraft?.cells[beltDraft.cells.length-1];
    const draftKeys=new Set(beltDraft?.cells.map((point)=>keyOf(point.x,point.y))??[]);
    const replaceable=new Set(beltDraft?.replan?.replaceKeys??[]);
    const kind=beltDraft?.kind??beltBuildMode??"belt",transportGrid=kind==="pipe"?pipeGrid:grid;
    return resolvedPorts.filter((port)=>port.transport===kind&&port.entityId===entityId&&port.type===type&&port.externalX>=0&&port.externalY>=0&&port.externalX<cols&&port.externalY<rows&&(!transportGrid[keyOf(port.externalX,port.externalY)]||replaceable.has(keyOf(port.externalX,port.externalY)))&&(!draftKeys.has(keyOf(port.externalX,port.externalY))||(last?.x===port.externalX&&last?.y===port.externalY))).sort((a,b)=>Math.abs(a.cellX-x)+Math.abs(a.cellY-y)-Math.abs(b.cellX-x)-Math.abs(b.cellY-y))[0]??null;
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
    const port=entityId?availableSnapPort(entityId,beltDraft?"input":"output",x,y):null;
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
      if(port?.type==="input"){setBeltDraft({...beltDraft,targetPort:port,join:undefined});setNotice(`已吸附到输入口 ${port.index+1} · 按 E 或 Esc 完成`);return}
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
    setBeltDraft({...beltDraft,cells,waypoints:[...beltDraft.waypoints,point],targetPort:port?.type==="input"?port:undefined,join});
    setNotice(port?`已吸附到输入口 ${port.index+1} · 按 E 或 Esc 完成`:join?`末端已按原方向接入现有${kind==="pipe"?"管道":"传送带"} · 按 E 或 Esc 完成`:`路径点 ${beltDraft.waypoints.length+1} 已创建 · 重叠线路将被覆盖`);
  }

  function finishBeltBuild() {
    if(!beltDraft){setBeltBuildMode(null);setBeltPreviewPoint(null);setHoveredEntity(null);setNotice("已退出物流绘制模式");return}
    const route=makeDraftRoute(beltDraft);
    if(!route){setBeltBuildMode(null);setBeltDraft(null);return}
    if(beltDraft.replan&&route.cells.length<2){setBeltBuildMode(null);setBeltDraft(null);setBeltPreviewPoint(null);setNotice("未添加新的下游路径 · 原线路保持不变");return}
    if(route.cells.some(({x,y})=>{const base=grid[keyOf(x,y)];return Boolean(base&&!isTransport(base.kind))})){setNotice("路径与现有设备冲突，未提交");return}
    const overwrittenKeys=new Set(route.cells.map(({x,y})=>keyOf(x,y)));
    const affectedRouteIds=new Set(flowRoutes.filter((candidate)=>candidate.kind===beltDraft.kind&&candidate.cells.some(({x,y})=>overwrittenKeys.has(keyOf(x,y)))).map((candidate)=>candidate.id));
    const write=(old:Grid)=>{const next={...old};beltDraft.replan?.replaceKeys.forEach((key)=>delete next[key]);route.cells.forEach(({x,y,cell})=>{next[keyOf(x,y)]={...cell,id:crypto.randomUUID()}});return next};
    if(beltDraft.kind==="pipe")setPipeGrid(write);else setGrid(write);
    if(affectedRouteIds.size||beltDraft.replan)setSimulation((previous)=>{const laneReadyAt={...previous.laneReadyAt},routeTransfers={...previous.routeTransfers};affectedRouteIds.forEach((routeId)=>{delete laneReadyAt[routeId];delete routeTransfers[routeId]});if(beltDraft.replan){delete laneReadyAt[beltDraft.replan.routeId];delete routeTransfers[beltDraft.replan.routeId]}return {...previous,laneReadyAt,routeTransfers,transits:previous.transits.filter((transit)=>!affectedRouteIds.has(transit.routeId)&&transit.routeId!==beltDraft.replan?.routeId)}});
    setBeltBuildMode(null);setBeltDraft(null);setBeltPreviewPoint(null);setHoveredEntity(null);
    const label=beltDraft.kind==="pipe"?"管道":"传送带";
    setNotice(beltDraft.join?`${label}已覆盖重叠格并按末端方向接入现有线路`:beltDraft.replan?`${label}中段改线已提交 · 上游连接保持不变`:beltDraft.sourcePort?beltDraft.targetPort?`${label}已完成并连接输入/输出口`:`${label}已接输出口 · 末端未卸货时会逐格堆满并阻塞`:`${label}已完成 · 未连接设备输出口时不会生成物品`);
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

  function addInventory(entityId:string,side:"input"|"output",itemId:string,amount:number) {
    const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);
    if(!item||!Number.isFinite(amount)||amount<=0)return;
    const kind=entityKinds.get(entityId),capacity=side==="input"?inputCapacityFor(kind,itemTransport(itemId)):OUTPUT_CAPACITY;
    setSimulation((previous)=>{
      const current=previous.inventories[entityId]??{input:{},output:{}};
      const bucket={...current[side]},space=Math.max(0,capacity-(side==="input"?inputTotalFor(bucket,itemTransport(itemId)):totalInventory(bucket)));
      const inserted=Math.min(Math.floor(amount),space);
      bucket[itemId]=(bucket[itemId]??0)+inserted;
      return {...previous,inventories:{...previous.inventories,[entityId]:{...current,[side]:bucket}}};
    });
    setNotice(`${item.name}已放入${side==="input"?"输入":"产出"}库存 · 超出容量的数量不会写入`);
  }

  function deleteAt(x:number,y:number,preferredKind?:TransportKind) {
    const key=keyOf(x,y),target=preferredKind==="pipe"?pipeGrid[key]:preferredKind==="belt"?grid[key]:grid[key]??pipeGrid[key];if(!target)return;
    const route=isTransport(target.kind)?flowRoutes.find((candidate)=>candidate.kind===target.kind&&candidate.cells.some((point)=>point.x===x&&point.y===y)):undefined;
    const keys=route?route.cells.map((point)=>keyOf(point.x,point.y)):isTransport(target.kind)?[keyOf(x,y)]:Object.entries(grid).filter(([,cell])=>cell.id===target.id).map(([key])=>key);
    const remove=(old:Grid)=>{const next={...old};keys.forEach((key)=>delete next[key]);return next};
    if(target.kind==="pipe")setPipeGrid(remove);else setGrid(remove);
    if(route)setSimulation((previous)=>{const laneReadyAt={...previous.laneReadyAt},routeTransfers={...previous.routeTransfers};delete laneReadyAt[route.id];delete routeTransfers[route.id];return {...previous,transits:previous.transits.filter((transit)=>transit.routeId!==route.id),laneReadyAt,routeTransfers}});
    else if(!isTransport(target.kind))setSimulation((previous)=>{const inventories={...previous.inventories},processes={...previous.processes},laneReadyAt={...previous.laneReadyAt},routeTransfers={...previous.routeTransfers};delete inventories[target.id];delete processes[target.id];const affected=new Set(connectedFlowRoutes.filter((candidate)=>candidate.sourcePort?.entityId===target.id||candidate.targetPort?.entityId===target.id).map((candidate)=>candidate.id));affected.forEach((routeId)=>{delete laneReadyAt[routeId];delete routeTransfers[routeId]});return {...previous,inventories,processes,laneReadyAt,routeTransfers,transits:previous.transits.filter((transit)=>!affected.has(transit.routeId))}});
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
      if (key === "x") { setSelectionMode(true); setPickedEntity(null);setPlacementPreview(null);setNotice("X · 单击设备或传送带即可选中"); }
      if (key === "r" && (selectedEntityId||selectedRoute)) { event.preventDefault(); rotateSelected(); }
      if (key === "c" && (selectedEntityId||selectedRoute)) { event.preventDefault(); prepareSelectedPlacement("copy"); }
      if (key === "m" && (selectedEntityId||selectedRoute)) { event.preventDefault(); prepareSelectedPlacement("move"); }
      if ((key === "delete"||key === "backspace") && (selectedEntityId||selectedRoute)) { event.preventDefault();deleteSelected();return; }
      if (key === "escape"&&beltBuildMode) { event.preventDefault();finishBeltBuild();return; }
      if (key === "escape") { setPickedEntity(null);setPlacementPreview(null);setSelectedEntityId(null);setSelectedTransportKey(null);setSelectionMode(false);setNotice("已取消选择"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // The keyboard listener is intentionally rebound to the current editor snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntityId, selectedRoute, grid, beltBuildMode, beltDraft, resolvedPorts, radialMenu]);

  function placeTool(x: number, y: number,kind:Kind=selected) {
    setGrid((old) => {
      if(isTransport(kind)){setNotice(`请先按 ${kind==="pipe"?"Q":"E"} 进入${kind==="pipe"?"管道":"传送带"}模式`);return old}
      const layout=EQUIPMENT_LAYOUTS[kind];
      const width = layout?.width??(kind === "powerPole" ? 2 : 1);
      const height = layout?.height??(kind === "powerPole" ? 2 : 1);
      if (x + width > cols || y + height > rows) return old;
      const cells = Array.from({ length: width * height }, (_, i) => keyOf(x + i % width, y + Math.floor(i / width)));
      if (cells.some((k) => old[k]||pipeGrid[k])) { setNotice("设备占地与现有设施或管道冲突"); return old; }
      const id = crypto.randomUUID(); const next = { ...old };
      const rootIndex=Math.floor(height/2)*width+Math.floor(width/2);
      cells.forEach((k, i) => next[k] = { kind,rotation:0,id,root:i===rootIndex,partX:i%width,partY:Math.floor(i/width),size:Math.max(width,height),width,height });
      setSelected("belt");setSelectionMode(true);setSelectedEntityId(id);setSelectedTransportKey(null);setNotice(`${tools.find((tool)=>tool.kind===kind)?.label??"设备"}已放置 · 已打开设备详情`);
      return next;
    });
  }

  function beginCatalogPointer(event:React.PointerEvent<HTMLButtonElement>,kind:Kind) {
    if(!event.isPrimary||event.button!==0||isTransport(kind))return;
    event.preventDefault();
    if(beltBuildMode)finishBeltBuild();
    try{event.currentTarget.setPointerCapture(event.pointerId)}catch{}
    catalogDragKindRef.current=kind;setCatalogDrag(kind);setSelected(kind);setCatalogPreview(null);setSelectionMode(false);setPickedEntity(null);setPlacementPreview(null);
    setNotice(`${tools.find((tool)=>tool.kind===kind)?.label??"设备"} · 拖到画布网格放置`);
  }

  function catalogPointAt(clientX:number,clientY:number,kind:Kind) {
    const gridElement=gridRef.current;if(!gridElement)return null;
    const layout=EQUIPMENT_LAYOUTS[kind],width=layout?.width??(kind==="powerPole"?2:1),height=layout?.height??(kind==="powerPole"?2:1);
    const rect=gridElement.getBoundingClientRect();if(clientX<rect.left||clientY<rect.top||clientX>rect.right||clientY>rect.bottom)return null;
    const x=Math.max(0,Math.min(cols-width,Math.floor((clientX-rect.left)/rect.width*cols))),y=Math.max(0,Math.min(rows-height,Math.floor((clientY-rect.top)/rect.height*rows)));
    const valid=Array.from({length:width*height},(_,index)=>keyOf(x+index%width,y+Math.floor(index/width))).every((key)=>!grid[key]&&!pipeGrid[key]);
    return{x,y,valid};
  }

  function updateCatalogPointer(event:React.PointerEvent<HTMLButtonElement>) {
    const kind=catalogDragKindRef.current;if(!kind)return;
    const point=catalogPointAt(event.clientX,event.clientY,kind);if(!point){setCatalogPreview(null);return}const{x,y}=point;setCatalogPreview((current)=>current?.x===x&&current?.y===y?current:{x,y});
  }

  function finishCatalogPointer(event:React.PointerEvent<HTMLButtonElement>) {
    const kind=catalogDragKindRef.current;if(!kind)return;
    event.preventDefault();event.stopPropagation();
    try{if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId)}catch{}
    const point=catalogPointAt(event.clientX,event.clientY,kind);
    catalogDragKindRef.current=null;setCatalogDrag(null);setCatalogPreview(null);
    if(point?.valid)placeTool(point.x,point.y,kind);else{setSelected("belt");setNotice(point?"目标占地与现有设备或物流线路冲突":"拖动已取消 · 请在画布网格内释放")}
  }

  function cancelCatalogPointer() {
    if(catalogDragKindRef.current===null)return;
    catalogDragKindRef.current=null;setCatalogDrag(null);setCatalogPreview(null);setSelected("belt");
  }

  function save() {
    localStorage.setItem("endfield-blueprint-v3", JSON.stringify({grid,pipeGrid,simulation:{...simulation,transits:[],laneReadyAt:{}}}));
    setNotice("蓝图已保存到本机");
  }

  function resetSimulation() {
    setRunning(false);
    setSimulation(emptySimulationState());
    setNotice("模拟已重置 · 蓝图、设备配方与仓库取货口配置已保留");
  }

  function load() {
    const saved = localStorage.getItem("endfield-blueprint-v3")??localStorage.getItem("endfield-blueprint-v2")??localStorage.getItem("endfield-blueprint-v1");
    if (saved) {
      const parsed=JSON.parse(saved);
      if(parsed.grid){const savedSimulation=parsed.simulation??{};setGrid(parsed.grid);setPipeGrid(parsed.pipeGrid??{});setSimulation({tick:savedSimulation.tick??0,inventories:savedSimulation.inventories??{},processes:savedSimulation.processes??{},transits:[],routeCursor:savedSimulation.routeCursor??{},laneReadyAt:{},routeTransfers:savedSimulation.routeTransfers??{},itemStats:savedSimulation.itemStats??[]})}else setGrid(parsed);
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
          <button className="reset-action" onClick={resetSimulation}>重置模拟</button>
          <button className={running ? "primary danger" : "primary"} onClick={() => setRunning(!running)}>{running ? "停止模拟" : "开始模拟"}</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="library panel">
          <div className="editor-tools">
            <p>工具</p>
            {tools.filter((tool)=>tool.type==="tool").map((tool)=><button key={tool.kind} className={`tool ${selected===tool.kind&&!selectionMode&&beltBuildMode===tool.kind?"active":""}`} onClick={()=>{const kind=tool.kind as TransportKind;if(beltBuildMode)finishBeltBuild();else activateBeltMode(kind)}}><span className={`tool-glyph ${tool.kind}`}>{tool.image?<img src={tool.image} alt=""/>:tool.glyph}</span><span><strong>{tool.label}</strong><small>{tool.desc}</small></span><kbd className="tool-key">{tool.kind==="pipe"?"Q":"E"}</kbd></button>)}
            <button className={`tool selection-tool ${selectionMode ? "active" : ""}`} onClick={()=>{if(beltBuildMode)finishBeltBuild();setSelectionMode(true);setPickedEntity(null);setPlacementPreview(null);setNotice("X · 单击设备或传送带即可选中")}}>
              <span className="tool-glyph">SEL</span><span><strong>选择 / 编辑</strong><small>单击选中 · Del 拆除</small></span><kbd className="tool-key">X</kbd>
            </button>
          </div>
          <div className="device-catalog">
            <div className="device-catalog-head"><strong>设备</strong><div className="device-tabs" aria-label="游戏设备分类">{DEVICE_CATEGORIES.map((category)=><button key={category} className={deviceCategory===category?"active":""} onClick={()=>setDeviceCategory(category)}>{category}</button>)}</div></div>
            <div className="device-list">{tools.filter((tool)=>tool.type==="device"&&(deviceCategory==="全部"||tool.category===deviceCategory)).map((tool)=><button key={tool.kind} className="tool" onPointerDown={(event)=>beginCatalogPointer(event,tool.kind)} onPointerMove={updateCatalogPointer} onPointerUp={finishCatalogPointer} onPointerCancel={cancelCatalogPointer} aria-label={`拖动添加${tool.label}`}><span className={`tool-glyph ${tool.kind}`}>{tool.image?<img src={tool.image} alt=""/>:tool.glyph}</span><span><strong>{tool.label}</strong><small>{tool.desc}</small></span></button>)}{!tools.some((tool)=>tool.type==="device"&&(deviceCategory==="全部"||tool.category===deviceCategory))&&<span className="empty-category">该分类设备将在数据核实后加入</span>}</div>
          </div>
          <div className="hint"><kbd>E</kbd> 开始 / 完成　<kbd>单击</kbd> 路径点　<kbd>右键</kbd> 取消本条</div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div><span className="live-dot" /> 蓝图预览 / AIC-01</div>
            <div className="canvas-controls">
              <button onClick={() => setZoom(Math.max(.55, zoom-.1))}>−</button><span>{Math.round(zoom*100)}%</span><button onClick={() => setZoom(Math.min(1.7, zoom+.1))}>＋</button>
              <details className="settings"><summary>画布设置</summary><div className="settings-popover">
                <label><span>网格对比度 <b>{Math.round(gridOpacity*100)}%</b></span><input type="range" min="0.03" max="0.35" step="0.01" value={gridOpacity} onChange={e=>setGridOpacity(Number(e.target.value))}/></label>
                <label><span>缩放 <b>{Math.round(zoom*100)}%</b></span><input type="range" min="0.55" max="1.7" step="0.05" value={zoom} onChange={e=>setZoom(Number(e.target.value))}/></label>
                <div className="size-inputs"><label>列数<input type="number" min="12" max="32" value={cols} onChange={e=>setCols(Math.max(12,Math.min(32,Number(e.target.value))))}/></label><label>行数<input type="number" min="8" max="24" value={rows} onChange={e=>setRows(Math.max(8,Math.min(24,Number(e.target.value))))}/></label></div>
                <button onClick={()=>{setPan({x:0,y:0});setZoom(1)}}>重置视图</button><small>滚轮缩放 · 按住滚轮拖动画布</small>
              </div></details>
            </div>
          </div>
          <div className="grid-wrap" style={{"--grid-opacity":gridOpacity} as React.CSSProperties}
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
            {(selectedEntity||selectedRoute) && <div className="selection-toolbar">
              <span><kbd>X</kbd> 已选中 <strong>{selectedEntity?tools.find((tool)=>tool.kind===selectedEntity.kind)?.label:`${selectedRoute?.kind==="pipe"?"管道":"传送带"}线路 · ${selectedRoute?.cells.length} 格`}</strong>{pickedEntity && <em>{pickedEntity.mode === "move" ? "移动中" : "复制中"}</em>}</span>
              {selectedEntity?.kind==="depot"&&<label className="depot-item-select"><span>{selectedDepotItem&&<img src={selectedDepotItem.image} alt=""/>}输出物品</span><select aria-label="仓库取货口输出物品" value={selectedDepotItem?.id??""} onChange={(event)=>setDepotItem(selectedEntity.id,event.target.value)}><option value="" disabled>选择工业物品</option>{(["矿物","工业产物"] as const).map((category)=><optgroup key={category} label={category}>{INDUSTRIAL_ITEMS.filter((item)=>item.category===category).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label>}
              <button onClick={()=>prepareSelectedPlacement("copy")}><kbd>C</kbd> 复制</button>
              <button onClick={rotateSelected}><kbd>R</kbd> 旋转</button>
              <button onClick={()=>prepareSelectedPlacement("move")}><kbd>M</kbd> 移动</button>
              <button className="delete-action" onClick={deleteSelected}><kbd>Del</kbd> 拆除</button>
              <button onClick={()=>{setSelectedEntityId(null);setSelectedTransportKey(null);setPickedEntity(null);setPlacementPreview(null);setSelectionMode(false)}}>取消</button>
            </div>}
            {beltBuildMode&&<div className="belt-build-toolbar"><span><kbd>{beltBuildMode==="pipe"?"Q":"E"}</kbd> {beltBuildMode==="pipe"?"管道":"传送带"}模式</span><strong>{beltDraft?`${beltDraft.waypoints.length} 个路径点`:"点击创建起点"}</strong><small>{beltDraft?"移动鼠标实时预览自动寻路":"可从空格或匹配类型的设备输出口开始"}</small><span><kbd>Esc / {beltBuildMode==="pipe"?"Q":"E"}</kbd> 完成　<kbd>右键</kbd> 取消</span></div>}
            {inventoryMenuVisible&&selectedEntityId&&selectedEntity&&<aside className="device-menu" role="dialog" aria-label={`${tools.find((tool)=>tool.kind===selectedEntity.kind)?.label??"设备"}库存`}>
              <header><div><small>DEVICE BUFFER</small><strong>{selectedDefinition?.name??tools.find((tool)=>tool.kind===selectedEntity.kind)?.label}</strong></div><button aria-label="关闭设备库存" onClick={()=>setSelectedEntityId(null)}>×</button></header>
              {selectedDefinition&&<div className="device-process"><span>{selectedDefinition.recipe}</span><i><b style={{width:`${machineStates[selectedEntityId]?.progress??0}%`}}/></i><small>{machineStates[selectedEntityId]?.status==="running"?`处理中 · 剩余 ${machineStates[selectedEntityId]?.remaining}s`:machineStates[selectedEntityId]?.status==="blocked"?"产出库存已满 · 已阻塞":"等待处理条件"}</small></div>}
              <section className="inventory-section solid"><div className="inventory-heading"><strong>固体输入库存</strong><span>{selectedSolidInputTotal} / {inputCapacityFor(selectedEntity.kind,"belt")}</span></div>
                <div className="inventory-meter"><i style={{width:`${Math.min(100,selectedSolidInputTotal/inputCapacityFor(selectedEntity.kind,"belt")*100)}%`}}/></div>
                <div className="inventory-list">{selectedSolidInputItemIds.length?selectedSolidInputItemIds.map((itemId)=>{const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);return <div key={itemId}><span>{item&&<img src={item.image} alt=""/>}{item?.name??itemId}</span><b>{selectedInventory.input[itemId]??0}</b></div>}):<small>暂无固体物品</small>}</div>
              </section>
              <section className="inventory-section fluid"><div className="inventory-heading"><strong>液体输入库存</strong><span>{selectedFluidInputTotal} / {inputCapacityFor(selectedEntity.kind,"pipe")}</span></div>
                <div className="inventory-meter fluid"><i style={{width:`${Math.min(100,selectedFluidInputTotal/inputCapacityFor(selectedEntity.kind,"pipe")*100)}%`}}/></div>
                <div className="inventory-list">{selectedFluidInputItemIds.length?selectedFluidInputItemIds.map((itemId)=>{const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);return <div key={itemId}><span>{item&&<img src={item.image} alt=""/>}{item?.name??itemId}</span><b>{selectedInventory.input[itemId]??0}</b></div>}):<small>暂无液体</small>}</div>
              </section>
              <section><div className="inventory-heading"><strong>产出库存</strong><span>{totalInventory(selectedInventory.output)} / {OUTPUT_CAPACITY}</span></div>
                <div className="inventory-meter output"><i style={{width:`${Math.min(100,totalInventory(selectedInventory.output)/OUTPUT_CAPACITY*100)}%`}}/></div>
                <div className="inventory-list">{selectedOutputItemIds.length?selectedOutputItemIds.map((itemId)=>{const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);return <div key={itemId}><span>{item&&<img src={item.image} alt=""/>}{item?.name??itemId}</span><b>{selectedInventory.output[itemId]??0}</b></div>}):<small>暂无物品</small>}</div>
              </section>
              <section className="inventory-inject"><strong>直接放入库存</strong><select aria-label="库存物品" value={inventoryItemId} onChange={(event)=>setInventoryItemId(event.target.value)}>{INDUSTRIAL_ITEMS.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select><input aria-label="放入数量" type="number" min="1" max="60" value={inventoryAmount} onChange={(event)=>setInventoryAmount(Math.max(1,Number(event.target.value)))}/><div><button onClick={()=>addInventory(selectedEntityId,"input",inventoryItemId,inventoryAmount)}>放入输入库存</button><button onClick={()=>addInventory(selectedEntityId,"output",inventoryItemId,inventoryAmount)}>放入产出库存</button></div></section>
              <footer>{inventoryFullIds.has(selectedEntityId)?"对应介质库存已满 · 相连物流暂停，设备边框标红":"固体与液体输入分别计容 · 产物按输出线路轮询分配"}</footer>
            </aside>}
            <div className="axis axis-y">12<br/>08<br/>04<br/>00</div>
            <div ref={gridRef} className={`grid ${panning ? "is-panning" : ""} ${pickedEntity?"is-placing":""} ${running ? "simulation-running" : ""}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, aspectRatio:`${cols}/${rows}`, transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})` }}
              onMouseMove={(event)=>{const rect=event.currentTarget.getBoundingClientRect();if(beltBuildMode){const x=Math.max(0,Math.min(cols-1,Math.floor((event.clientX-rect.left)/rect.width*cols)));const y=Math.max(0,Math.min(rows-1,Math.floor((event.clientY-rect.top)/rect.height*rows)));setBeltPreviewPoint((current)=>current?.x===x&&current?.y===y?current:{x,y})}if(pickedEntity){const x=Math.max(0,Math.min(cols-pickedWidth,Math.floor((event.clientX-rect.left)/rect.width*cols)));const y=Math.max(0,Math.min(rows-pickedHeight,Math.floor((event.clientY-rect.top)/rect.height*rows)));setPlacementPreview({x,y})}}}
              onMouseLeave={()=>{setHoveredEntity(null);setBeltPreviewPoint(null)}}>
              {pickedEntity&&placementPreview&&<><span className={`placement-snap ${placementValid?"valid":"invalid"}`} style={{left:`${placementPreview.x/cols*100}%`,top:`${placementPreview.y/rows*100}%`,width:`${pickedWidth/cols*100}%`,height:`${pickedHeight/rows*100}%`}}/><span className="placement-ghost" style={{left:`${placementPreview.x/cols*100}%`,top:`${placementPreview.y/rows*100}%`,width:`${pickedWidth/cols*100}%`,height:`${pickedHeight/rows*100}%`}}>{pickedEntity.sourceType==="entity"&&<>{pickedEntity.image&&<img src={pickedEntity.image} alt=""/>}<strong>{pickedEntity.label}</strong></>}</span></>}
              {catalogDrag&&catalogPreview&&<><span className={`placement-snap catalog-snap ${catalogPlacementValid?"valid":"invalid"}`} style={{left:`${catalogPreview.x/cols*100}%`,top:`${catalogPreview.y/rows*100}%`,width:`${catalogWidth/cols*100}%`,height:`${catalogHeight/rows*100}%`}}/><span className="placement-ghost catalog-ghost" style={{left:`${catalogPreview.x/cols*100}%`,top:`${catalogPreview.y/rows*100}%`,width:`${catalogWidth/cols*100}%`,height:`${catalogHeight/rows*100}%`}}>{tools.find((tool)=>tool.kind===catalogDrag)?.image&&<img src={tools.find((tool)=>tool.kind===catalogDrag)!.image} alt=""/>}<strong>{tools.find((tool)=>tool.kind===catalogDrag)?.label}</strong></span></>}
              {showPowerZones && <svg className="power-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {powerZones.map((zone)=><rect key={zone.id} x={zone.x} y={zone.y} width={zone.size} height={zone.size} rx=".16"/>)}
              </svg>}
              {showPowerZones&&powerZones.map((zone)=><span key={zone.id} className="power-range-label" style={{left:`${Math.max(0,zone.x)/cols*100}%`,top:`${Math.max(0,zone.y)/rows*100}%`}}>供电范围 12×12 · 规划参考</span>)}
              <svg className="transport-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {displayFlowRoutes.map((route)=>{const connected=connectedFlowRoutes.find((candidate)=>candidate.id===route.id),item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===connected?.itemId),pipeTransits=route.kind==="pipe"?(transitsByRoute.get(route.id)??[]):[];return <g key={route.id} className={`route-track ${route.kind} ${selectedRoute?.id===route.id?"selected-route":""} ${pickedEntity?.sourceType==="route"&&pickedEntity.mode==="move"&&pickedEntity.id===route.id?"picked-route":""}`} style={route.kind==="pipe"?{"--pipe-fluid":item?.color??"transparent"} as React.CSSProperties:undefined} data-content={connected?.itemId}>
                  <path className="track-edge" d={route.path}/>
                  {route.kind==="pipe"?route.cells.map(({x,y,cell},cellIndex)=>{const ratio=pipeFillRatio(pipeTransits,cellIndex,route.cells.length);return <path key={`fluid-${x},${y}`} className="pipe-fluid-segment" d={roundedPath([{x,y,cell}])} strokeWidth={ratio===0?0:.07+ratio*.43} data-fill={ratio.toFixed(2)}/>}):<path className="track-fill" d={route.path}/>}
                  {route.cells.map(({x,y,cell})=>{const anchor=arrowAnchor(x,y,cell);return <path key={`${x},${y}`} className="direction-arrow" d="M -.065 -.05 L .075 0 L -.065 .05 Z" transform={`translate(${anchor.x} ${anchor.y}) rotate(${arrowAngle(cell)})`}/>})}
                </g>})}
                {draftRoute&&<g className={`route-track ${draftRoute.kind} draft-route ${liveDraftRoute?"live-preview":""}`}>
                  <path className="track-edge" d={draftRoute.path}/><path className="track-fill" d={draftRoute.path}/>
                  {draftRoute.cells.map(({x,y,cell})=>{const anchor=arrowAnchor(x,y,cell);return <path key={`${x},${y}`} className="direction-arrow" d="M -.065 -.05 L .075 0 L -.065 .05 Z" transform={`translate(${anchor.x} ${anchor.y}) rotate(${arrowAngle(cell)})`}/>})}
                  {beltDraft?.waypoints.map((point,index)=><circle key={`${point.x},${point.y},${index}`} className="draft-waypoint" cx={point.x+.5} cy={point.y+.5} r=".065"/>)}
                  {liveDraftRoute&&<circle className={`draft-cursor ${snapCandidate?"snapped":""}`} cx={liveDraftRoute.cells[liveDraftRoute.cells.length-1].x+.5} cy={liveDraftRoute.cells[liveDraftRoute.cells.length-1].y+.5} r=".085"/>}
                </g>}
                {placementRoute&&<g className={`route-track ${placementRoute.kind} placement-route ${placementValid?"valid":"invalid"}`}><path className="track-edge" d={placementRoute.path}/><path className="track-fill" d={placementRoute.path}/>{placementRoute.cells.map(({x,y,cell})=>{const anchor=arrowAnchor(x,y,cell);return <path key={`${x},${y}`} className="direction-arrow" d="M -.065 -.05 L .075 0 L -.065 .05 Z" transform={`translate(${anchor.x} ${anchor.y}) rotate(${arrowAngle(cell)})`}/>})}</g>}
              </svg>
              {simulation.transits.length>0 && <svg className="flow-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {connectedFlowRoutes.map((route) => {
                  const transits=transitsByRoute.get(route.id)??[];
                  if(route.kind==="pipe"||!transits.length||beltDraft?.replan?.routeId===route.id)return null;
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
                const stateLabel=status==="running"?"生产中":status==="waiting"?"周期等待":status==="starved"?"缺少输入":status==="blocked"?"输出阻塞":status==="unpowered"?"未供电":"已暂停";
                const definition=cell&&cell.kind in MACHINE_DEFINITIONS?MACHINE_DEFINITIONS[cell.kind as ProductionKind]:null;
                const deviceInventoryFull=Boolean(cell&&inventoryFullIds.has(cell.id));
                const machine = definition ? { name:definition.name, recipe:definition.recipe, state:stateLabel, blocked:status==="blocked"||deviceInventoryFull?"是":"否" } : null;
                const processing = status === "running";
                const processProgress = machineState?.progress??0;
                const remainingSeconds = machineState?.remaining??"--";
                const machineImage = definition?.image??null;
                const cellWidth=cell?.width??cell?.size??1,cellHeight=cell?.height??cell?.size??1;
                const cellPorts=portsByCell.get(keyOf(x,y))??[];
                const footprintStyle=cell?.root?{left:`-${(cell.partX??0)*100}%`,top:`-${(cell.partY??0)*100}%`,right:`-${(cellWidth-1-(cell.partX??0))*100}%`,bottom:`-${(cellHeight-1-(cell.partY??0))*100}%`}:undefined;
                const entitySelected = Boolean(cell && cell.id===selectedEntityId);
                const routeSelected=Boolean(selectedRouteKeys.has(key)&&((selectedTransportKind==="pipe"&&pipeCell)||(selectedTransportKind==="belt"&&baseCell?.kind==="belt")));
                const entityPicked = Boolean(cell && pickedEntity?.mode==="move"&&pickedEntity.sourceKeys.includes(keyOf(x,y)));
                const hasBelt=baseCell?.kind==="belt",hasPipe=Boolean(pipeCell);
                const hoverTransport:TransportKind|undefined=hasPipe?"pipe":hasBelt?"belt":undefined;
                const transport=hoverTransport?transportMeta.get(`${hoverTransport}:${key}`):undefined;
                const secondaryTransport=hasPipe&&hasBelt?transportMeta.get(`belt:${key}`):undefined;
                const routeForCell=hoverTransport?connectedRouteByCell.get(`${hoverTransport}:${key}`):undefined;
                const depotItem=cell?.kind==="depot"?INDUSTRIAL_ITEMS.find((item)=>item.id===cell.itemId):null;
                return <button key={index} className={`cell ${cell ? `placed ${cell.kind}` : ""} ${baseCell?.kind==="belt"?"belt":""} ${pipeCell?"pipe has-pipe":""} ${status} ${cell?.root?"entity-root":""} ${cellPorts.length?"entity-port":""} ${entitySelected ? "selected-entity" : ""} ${routeSelected?"selected-route-cell":""} ${entityPicked ? "picked-entity" : ""}`} aria-label={`${x},${y}${baseCell ? ` ${baseCell.kind}` : ""}${pipeCell?" pipe":""}`}
                  aria-haspopup={baseCell&&!isTransport(baseCell.kind)?"menu":undefined}
                  onPointerDown={(event)=>{if(baseCell&&!isTransport(baseCell.kind))startDeviceRadial(event,baseCell.id)}}
                  onPointerMove={updateDeviceRadial}
                  onPointerUp={finishDeviceRadial}
                  onPointerCancel={(event)=>{if(radialGestureRef.current?.pointerId===event.pointerId)cancelRadialMenu("轮盘操作已取消 · 设备保持选中")}}
                  onLostPointerCapture={(event)=>{if(radialGestureRef.current?.pointerId===event.pointerId)cancelRadialMenu("轮盘操作已取消 · 设备保持选中")}}
                  onMouseDown={(e) => {
                    if(e.button===1||e.altKey)return;
                    if(beltBuildMode){addBeltWaypoint(x,y,baseCell&&!isTransport(baseCell.kind)?baseCell.id:undefined);return}
                    if (pickedEntity) { placePicked(x,y); return; }
                    if (baseCell&&!isTransport(baseCell.kind)) {setSelectedEntityId(baseCell.id);setSelectedTransportKey(null);setNotice("已选中设备 · 库存与处理状态已打开");setSelectionMode(true);return}
                    const crossingKind:TransportKind|undefined=pipeCell&&baseCell?.kind==="belt"?(selectedTransportKey===key&&selectedTransportKind==="pipe"?"belt":"pipe"):undefined;
                    const selectedFlow=crossingKind==="pipe"?pipeCell:crossingKind==="belt"?baseCell:pipeCell??(baseCell?.kind==="belt"?baseCell:undefined);
                    if (selectedFlow) {
                      setSelectedTransportKind(selectedFlow.kind as TransportKind);setSelectedTransportKey(key);setSelectedEntityId(null);setNotice(`已选中整条${selectedFlow.kind==="pipe"?"管道":"传送带"}线路 · 可复制、旋转或移动`);
                      setSelectionMode(true);return;
                    }
                    if(selectionMode){setSelectedEntityId(null);setSelectedTransportKey(null);setNotice("该位置为空");return}
                    if(isTransport(selected)){setNotice(`请先按 ${selected==="pipe"?"Q":"E"} 进入${selected==="pipe"?"管道":"传送带"}模式`);return}
                    setNotice("设备只能从底部目录拖到画布上添加");
                  }} onMouseEnter={() => {if(beltBuildMode)setHoveredEntity(baseCell&&!isTransport(baseCell.kind)?{id:baseCell.id,x,y}:null)}} onMouseLeave={()=>{if(beltBuildMode&&hoveredEntity?.id===baseCell?.id)setHoveredEntity(null)}}
                  onContextMenu={(e) => {e.preventDefault();if(beltBuildMode){cancelBeltDraft();return}deleteAt(x,y,hoverTransport)}}>
                    {baseCell && !isTransport(baseCell.kind) && <>{baseCell.root && <span style={footprintStyle} className={`cell-glyph root ${!machine ? "compact" : ""} ${baseCell.kind==="powerPole"?"power-pole":""} ${entitySelected?"selected-root":""} ${deviceInventoryFull?"inventory-full":""}`}><b>{machineImage ? <img src={machineImage} alt={tools.find((t) => t.kind === baseCell.kind)?.label}/> : tools.find((t) => t.kind === baseCell.kind)?.image ? <img src={tools.find((t) => t.kind === baseCell.kind)?.image} alt={tools.find((t) => t.kind === baseCell.kind)?.label}/> : tools.find((t) => t.kind === baseCell.kind)?.glyph}</b>{baseCell.kind==="depot"&&<span className="depot-source">{depotItem?<><img src={depotItem.image} alt=""/><small>{depotItem.name}</small></>:<small>未选择物品</small>}</span>}{machine && <span className="machine-overlay"><strong className="machine-name">{machine.name}</strong><span className="machine-recipe">{machine.recipe}</span><small className={status}>状态 · {machine.state}</small><small className={`power-state ${machineState?.powered?"powered":"unpowered"}`}>供电 · {machineState?.powered?"正常":"断开"}</small><em>阻塞 · {machine.blocked}</em><span className="machine-progress"><i><b style={{width:`${processProgress}%`}}/></i><em>{processing ? `${processProgress}% · 剩余 ${remainingSeconds}s` : status==="unpowered" ? "等待供电 · --" : status==="starved" ? "缺少输入 · --" : status==="blocked" ? "输出阻塞 · --" : running ? "周期等待 · --" : "未启动 · --"}</em></span></span>}{baseCell.kind==="powerPole"&&<span className="power-pole-label"><strong>供电桩</strong><small>12 × 12</small></span>}</span>}{cellPorts.map((port)=><span key={port.key} className={`port-marker ${port.type} ${port.transport} side-${port.side} ${snapCandidate?.key===port.key?"snap-target":""} ${isPortConnected(grid,pipeGrid,port)?"connected":""}`} title={`${port.transport==="pipe"?"液体":"固体"}${port.type==="input"?"输入口":"输出口"} ${port.index+1}`} aria-label={`${port.transport==="pipe"?"液体":"固体"}${port.type==="input"?"输入口":"输出口"} ${port.index+1}`}><span className="port-icon" aria-hidden="true"><i/><b/></span></span>)}{baseCell.root && status === "waiting" && <span className="wait-ring" />}</>}
                    {transport&&<span className="transport-tooltip"><span>{transport.image?<img src={transport.image} alt=""/>:<i className="empty-item-icon">--</i>}<strong>{transport.kind==="pipe"?"管道":"传送带"} · {transport.name}</strong></span><small>当前流速 {transport.rate}/min · 占用 {transport.cargoCount}/{transport.capacity} 单位</small><small>线路 {routeForCell?.cells.length??0} 格 · 基准运输耗时 {transport.travelSeconds.toFixed(1)}s</small><small>额定吞吐 {transport.kind==="pipe"?PIPE_ITEMS_PER_MINUTE:BELT_ITEMS_PER_MINUTE}/min · {transport.kind==="pipe"?"每格缓存 4 单位":"每格最多 1 件"}</small>{routeForCell&&stalledRouteIds.has(routeForCell.id)&&<small>{transport.targetConnected?"下游库存已满 · 线路满载阻塞":"末端未接输入口 · 线路满载阻塞"}</small>}{transport.connected&&!transport.targetConnected&&!transport.full&&<small>已连接输出口 · 内容将在末端逐格堆积</small>}{!transport.connected&&<small>未连接设备输出口 · 不会生成内容</small>}{secondaryTransport&&<><span className="tooltip-layer"><strong>下层传送带 · {secondaryTransport.name}</strong></span><small>当前流速 {secondaryTransport.rate}/min · 占用 {secondaryTransport.cargoCount}/{secondaryTransport.capacity}</small><small>再次单击可在管道/传送带之间切换选择</small></>}</span>}
                  </button>;
              })}
            </div>
            <div className="axis axis-x">00　　　04　　　08　　　12　　　16</div>
          </div>
          <div className="status-strip"><span>{notice}</span><span>网格 {cols} × {rows}</span><span>设备/传送带占用 {Math.round(Object.keys(grid).filter(k=>{const [x,y]=k.split(',').map(Number);return x<cols&&y<rows}).length / (cols * rows) * 100)}% · 管道 {counts.pipes} 格</span></div>
        </section>

        <aside className="inspector panel">
          <div className="panel-heading"><span>生产监控</span><small>LIVE / 02</small></div>
          <div className="metric-grid"><div><small>设备</small><strong>{counts.devices}</strong></div><div><small>物流格</small><strong>{counts.belts}<span> 带</span> / {counts.pipes}<span> 管</span></strong></div><div><small>已供电</small><strong>{productionStates.filter((state)=>state.powered).length}<span> / {productionStates.length}</span></strong></div><div><small>效率</small><strong>{running&&productionStates.length ? Math.round(productionStates.filter((state)=>state.status==="running").length/productionStates.length*100) : "—"}<span>%</span></strong></div></div>
          <div className="section-title"><span>设备状态</span><small>{running ? "SIMULATION ACTIVE" : "SIMULATION PAUSED"}</small></div>
          {productionStates.map((state,index)=>{const stateText=state.status==="running"?"生产中":state.status==="waiting"?"周期等待":state.status==="starved"?"缺少输入":state.status==="blocked"?"输出阻塞":state.status==="unpowered"?"未供电":"暂停",definition=MACHINE_DEFINITIONS[state.kind];return <div key={state.id} className={`machine-card ${state.status==="running"?"good":state.status!=="idle"?"warn":""}`}><div className="machine-icon"><img src={definition.image} alt=""/></div><div><strong>{definition.name} #{String(index+1).padStart(2,"0")}</strong><small>{definition.recipe} · {stateText} · {state.powered?"供电正常":"供电断开"}</small></div><em>{state.status==="running"?`${state.progress}%`:stateText}</em></div>})}
          <div className="section-title"><span>产销统计</span><small>ROLLING 60 SECONDS</small></div>
          <section className="production-stats" aria-label="产线物品产出量与消耗量统计">
            {involvedStatsItems.length&&selectedStatsItem?<>
              <label className="stat-selector"><span><img src={selectedStatsItem.image} alt=""/>统计物品</span><select value={selectedStatsItem.id} onChange={(event)=>setSelectedStatsItemId(event.target.value)}>{involvedStatsItems.map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
              <div className="stat-chart-head"><strong>{selectedStatsItem.name}</strong><small>5 秒滚动平均 · 单位/min</small></div>
              <svg className="stat-chart" viewBox="0 0 240 82" role="img" aria-label={`${selectedStatsItem.name}产出与消耗折线图`}>
                <path className="stat-grid-line" d="M 0 1 H 240 M 0 41 H 240 M 0 81 H 240"/>
                <path className="stat-line produced" d={statsChart.producedPath}/>
                <path className="stat-line consumed" d={statsChart.consumedPath}/>
              </svg>
              <div className="stat-legend"><span className="produced"><i/>产出 <b>{Math.round(statsChart.produced.at(-1)??0)}/min</b></span><span className="consumed"><i/>消耗 <b>{Math.round(statsChart.consumed.at(-1)??0)}/min</b></span></div>
              <div className="stat-totals"><span>最近 60 秒产出 <b>{statsChart.producedTotal}</b></span><span>消耗 <b>{statsChart.consumedTotal}</b></span></div>
              <small className="stat-note">仓库存货口收货仅计库存转移，不计消耗</small>
            </>:<div className="stat-empty">放置并连接生产设备后显示产销历史</div>}
          </section>
          <div className="clock-card"><span>模拟时钟</span><strong>{String(Math.floor(elapsedSeconds/60)).padStart(2,"0")}:{String(elapsedSeconds%60).padStart(2,"0")}</strong><small>× 1.0　·　每 250ms 提交模拟快照</small></div>
        </aside>
      </section>
    </main>
  );
}
