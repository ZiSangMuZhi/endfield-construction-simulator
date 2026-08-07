"use client";
/* eslint-disable @next/next/no-img-element -- local game and generated icons are rendered at native blueprint scale */

import { useEffect, useMemo, useRef, useState } from "react";

type Kind = "belt" | "pipe" | "refiner" | "fitter" | "tank" | "depot" | "powerPole";
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

type FlowRoute = { id: string; kind: "belt" | "pipe"; cells: { x:number; y:number; cell:Cell }[]; path: string };
type PickedEntity = { id:string; mode:"move" | "copy"; cells:{ dx:number; dy:number; cell:Cell }[] };
type MachineState = { id:string; kind:"refiner"|"fitter"; status:"idle"|"running"|"waiting"|"starved"|"blocked"|"unpowered"; progress:number; remaining:string; hasInput:boolean; hasOutput:boolean; powered:boolean };
type PowerZone = { id:string; x:number; y:number; size:number };
type Point = { x:number; y:number };
type PortType = "input" | "output";
type PortSpec = { x:number; y:number; side:Direction };
type EquipmentLayout = { width:number; height:number; inputs:PortSpec[]; outputs:PortSpec[] };
type ResolvedPort = { key:string; entityId:string; entityKind:Kind; type:PortType; index:number; side:Direction; cellX:number; cellY:number; externalX:number; externalY:number };
type BeltDraft = { cells:Point[]; waypoints:Point[]; sourcePort?:ResolvedPort; targetPort?:ResolvedPort };
type ConnectedFlowRoute = FlowRoute & { sourcePort?:ResolvedPort; targetPort?:ResolvedPort; valid:boolean; itemId?:string; itemName:string; itemImage:string };
type IndustrialItem = { id:string; name:string; category:"矿物"|"工业产物"; image:string };

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
];

const EQUIPMENT_LAYOUTS: Partial<Record<Kind,EquipmentLayout>> = {
  depot:{width:1,height:3,inputs:[],outputs:[{x:0,y:1,side:0}]},
  refiner:{width:3,height:3,inputs:[{x:0,y:1,side:2}],outputs:[{x:2,y:1,side:0}]},
  fitter:{width:3,height:3,inputs:[{x:0,y:1,side:2}],outputs:[{x:2,y:1,side:0}]},
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
      ports.push({key:`${entityId}:${type}:${index}`,entityId,entityKind:entity.kind,type,index,side:rotated.side,cellX,cellY,externalX:cellX+dx,externalY:cellY+dy});
    };
    layout.inputs.forEach((port,index)=>append(port,"input",index));
    layout.outputs.forEach((port,index)=>append(port,"output",index));
  });
  return ports;
}

function isPortConnected(grid:Grid,port:ResolvedPort) {
  const belt=grid[keyOf(port.externalX,port.externalY)];
  if(belt?.kind!=="belt")return false;
  return port.type==="output" ? belt.entry===opposite(port.side) : belt.rotation===opposite(port.side);
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
    const entry=previous?directionBetween(point.x,point.y,previous.x,previous.y)??undefined:draft.sourcePort?opposite(draft.sourcePort.side):undefined;
    const rotation=next?directionBetween(point.x,point.y,next.x,next.y)!:draft.targetPort?opposite(draft.targetPort.side):previous?directionBetween(previous.x,previous.y,point.x,point.y)!:draft.sourcePort?.side??0;
    return {x:point.x,y:point.y,cell:{kind:"belt" as const,rotation,entry,id:`draft-${index}`,root:true}};
  });
  return {id:"belt-draft",kind:"belt",cells,path:roundedPath(cells)};
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
  return { x:x+.5+(entry[0]+exit[0])*.1, y:y+.5+(entry[1]+exit[1])*.1 };
}

function entityPhase(id: string, cycle: number) {
  let hash=0;
  for (const character of id) hash=(hash*31+character.charCodeAt(0))>>>0;
  return hash%cycle;
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

function getFlowRoutes(grid: Grid, kind: "belt" | "pipe"): FlowRoute[] {
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

const tools: { kind: Kind; label: string; group: string; glyph: string; desc: string; image?: string }[] = [
  { kind: "belt", label: "传送带", group: "物流", glyph: "→", desc: "固体 · 30/min" },
  { kind: "depot", label: "仓库取货口", group: "物流", glyph: "D", desc: "1×3 · 指定物品输出" },
  { kind: "refiner", label: "精炼炉", group: "生产", glyph: "R", desc: "矿石 → 金属块", image:"/assets/machines/refinery.webp" },
  { kind: "fitter", label: "配件机", group: "生产", glyph: "F", desc: "金属块 → 零件", image:"/assets/machines/assembler.webp" },
  { kind: "powerPole", label: "供电桩", group: "电力", glyph: "PWR", desc: "2×2 · 供电范围 12×12", image:"/assets/machines/supply-pole.webp" },
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

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [grid, setGrid] = useState<Grid>(initial);
  const [selected, setSelected] = useState<Kind>("belt");
  const [pipeContent] = useState<PipeContent>("clean-water");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [pickedEntity, setPickedEntity] = useState<PickedEntity | null>(null);
  const [beltBuildMode,setBeltBuildMode]=useState(false);
  const [beltDraft,setBeltDraft]=useState<BeltDraft|null>(null);
  const [hoveredEntity,setHoveredEntity]=useState<{id:string;x:number;y:number}|null>(null);
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const drawHead = useRef<{ x:number; y:number; kind:Kind } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const [notice, setNotice] = useState("演示蓝图已载入 · 按 E 规划传送带");
  const [cols, setCols] = useState(DEFAULT_COLS);
  const [rows, setRows] = useState(DEFAULT_ROWS);
  const [gridOpacity, setGridOpacity] = useState(0.1);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [panning, setPanning] = useState<{ x:number; y:number; ox:number; oy:number } | null>(null);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setTick((v) => (v + 1) % 100), 120);
    return () => window.clearInterval(timer);
  }, [running]);

  const counts = useMemo(() => {
    const values = Object.values(grid);
    return {
      devices: new Set(values.filter((c) => !isTransport(c.kind)).map((c) => c.id)).size,
      belts: values.filter((c) => c.kind === "belt").length,
      pipes: values.filter((c) => c.kind === "pipe").length,
    };
  }, [grid]);
  const flowRoutes = useMemo(() => getFlowRoutes(grid, "belt"), [grid]);
  const resolvedPorts=useMemo(()=>resolvePorts(grid),[grid]);
  const connectedFlowRoutes=useMemo<ConnectedFlowRoute[]>(()=>flowRoutes.map((route)=>{
    const first=route.cells[0],last=route.cells[route.cells.length-1];
    const sourcePort=resolvedPorts.find((port)=>port.type==="output"&&port.externalX===first.x&&port.externalY===first.y&&first.cell.entry===opposite(port.side));
    const targetPort=resolvedPorts.find((port)=>port.type==="input"&&port.externalX===last.x&&port.externalY===last.y&&last.cell.rotation===opposite(port.side));
    const depotCell=sourcePort?.entityKind==="depot"?Object.values(grid).find((cell)=>cell.id===sourcePort.entityId):undefined;
    const depotItem=INDUSTRIAL_ITEMS.find((item)=>item.id===depotCell?.itemId);
    const item=sourcePort?.entityKind==="depot"?depotItem:sourcePort?.entityKind==="refiner"?INDUSTRIAL_ITEMS.find((candidate)=>candidate.id==="blue-iron-block"):sourcePort?.entityKind==="fitter"?INDUSTRIAL_ITEMS.find((candidate)=>candidate.id==="iron-parts"):undefined;
    return {...route,sourcePort,targetPort,valid:Boolean(sourcePort&&targetPort),itemId:item?.id,itemName:item?.name??(sourcePort?.entityKind==="depot"?"取货口未选择物品":"未接入输出口"),itemImage:item?.image??""};
  }),[flowRoutes,resolvedPorts,grid]);
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
  const machineStates = useMemo<Record<string,MachineState>>(()=>{
    const entities = new Map<string,{cell:Cell;positions:{x:number;y:number;cell:Cell}[]}>();
    Object.entries(grid).forEach(([key,cell])=>{
      if (cell.kind!=="refiner" && cell.kind!=="fitter") return;
      const [x,y]=key.split(",").map(Number);
      const existing=entities.get(cell.id)??{cell,positions:[]};
      existing.positions.push({x,y,cell}); entities.set(cell.id,existing);
    });
    const states:Record<string,MachineState>={};
    entities.forEach(({cell,positions},id)=>{
      const width=cell.width??cell.size??3, height=cell.height??cell.size??3;
      const entityPorts=resolvedPorts.filter((port)=>port.entityId===id);
      const inputPorts=entityPorts.filter((port)=>port.type==="input"),outputPorts=entityPorts.filter((port)=>port.type==="output");
      const expectedItemId=cell.kind==="refiner"?"blue-iron-ore":"blue-iron-block";
      const hasInput=inputPorts.length===0||inputPorts.every((port)=>connectedFlowRoutes.some((route)=>route.valid&&route.targetPort?.key===port.key&&route.itemId===expectedItemId));
      const hasOutput=outputPorts.length===0||outputPorts.every((port)=>connectedFlowRoutes.some((route)=>route.valid&&route.sourcePort?.key===port.key));
      const minX=Math.min(...positions.map(({x})=>x)),minY=Math.min(...positions.map(({y})=>y));
      const powered=powerZones.some((zone)=>zone.x<minX+width&&zone.x+zone.size>minX&&zone.y<minY+height&&zone.y+zone.size>minY);
      const cycle=cell.kind==="fitter"?50:30, active=cell.kind==="fitter"?36:30;
      const phase=(tick+entityPhase(id,cycle))%cycle;
      const status:MachineState["status"]=!powered?"unpowered":!running?"idle":!hasInput?"starved":!hasOutput?"blocked":cell.kind==="fitter"&&phase>=active?"waiting":"running";
      const progress=status==="running"?Math.min(100,Math.round(phase/active*100)):0;
      states[id]={id,kind:cell.kind,status,progress,remaining:status==="running"?Math.max(0,(active-phase)*.12).toFixed(1):"--",hasInput,hasOutput,powered};
    });
    return states;
  },[grid,powerZones,resolvedPorts,connectedFlowRoutes,running,tick]);
  const productionStates = Object.values(machineStates);
  const selectedEntity = selectedEntityId ? Object.values(grid).find((cell)=>cell.id===selectedEntityId) : null;
  const selectedDepotItem=selectedEntity?.kind==="depot"?INDUSTRIAL_ITEMS.find((item)=>item.id===selectedEntity.itemId):null;
  const showPowerZones=selected==="powerPole"||selectedEntity?.kind==="powerPole";
  const movingRouteIds=useMemo(()=>new Set(connectedFlowRoutes.filter((route)=>route.valid&&Boolean(route.itemId)&&running&&(route.sourcePort?.entityKind==="depot"||machineStates[route.sourcePort?.entityId??""]?.status==="running")).map((route)=>route.id)),[connectedFlowRoutes,machineStates,running]);
  const beltMeta=useMemo(()=>{
    const meta=new Map<string,{name:string;image:string;rate:number;connected:boolean}>();
    connectedFlowRoutes.forEach((route)=>route.cells.forEach(({x,y})=>meta.set(keyOf(x,y),{name:route.itemName,image:route.itemImage,rate:movingRouteIds.has(route.id)?30:0,connected:route.valid})));
    return meta;
  },[connectedFlowRoutes,movingRouteIds]);
  const itemFlowRates=useMemo(()=>{
    const rates=new Map<string,number>();
    connectedFlowRoutes.forEach((route)=>{if(route.itemId&&movingRouteIds.has(route.id))rates.set(route.itemId,(rates.get(route.itemId)??0)+30)});
    return rates;
  },[connectedFlowRoutes,movingRouteIds]);
  const snapCandidate=useMemo(()=>{
    if(!beltBuildMode||!hoveredEntity)return null;
    const type:PortType=beltDraft?"input":"output";
    const last=beltDraft?.cells[beltDraft.cells.length-1];
    const draftKeys=new Set(beltDraft?.cells.map((point)=>keyOf(point.x,point.y))??[]);
    return resolvedPorts.filter((port)=>port.entityId===hoveredEntity.id&&port.type===type&&port.externalX>=0&&port.externalY>=0&&port.externalX<cols&&port.externalY<rows&&!grid[keyOf(port.externalX,port.externalY)]&&(!draftKeys.has(keyOf(port.externalX,port.externalY))||(last?.x===port.externalX&&last?.y===port.externalY))).sort((a,b)=>Math.abs(a.cellX-hoveredEntity.x)+Math.abs(a.cellY-hoveredEntity.y)-Math.abs(b.cellX-hoveredEntity.x)-Math.abs(b.cellY-hoveredEntity.y))[0]??null;
  },[beltBuildMode,beltDraft,cols,grid,hoveredEntity,resolvedPorts,rows]);
  const draftRoute=useMemo(()=>beltDraft?makeDraftRoute(beltDraft):null,[beltDraft]);

  function preparePlacement(id: string, mode: "move" | "copy") {
    const entries = Object.entries(grid).filter(([, cell]) => cell.id === id);
    if (!entries.length) return;
    const positions = entries.map(([key, cell]) => { const [x,y]=key.split(",").map(Number); return {x,y,cell}; });
    const minX=Math.min(...positions.map((item)=>item.x)), minY=Math.min(...positions.map((item)=>item.y));
    setPickedEntity({ id, mode, cells:positions.map(({x,y,cell})=>({dx:x-minX,dy:y-minY,cell})) });
    setSelectionMode(true);
    setNotice(mode === "move" ? "移动模式 · 点击目标位置放下" : "复制模式 · 点击目标位置放置副本");
  }

  function placePicked(x: number, y: number) {
    if (!pickedEntity) return false;
    const targets = pickedEntity.cells.map((item)=>({key:keyOf(x+item.dx,y+item.dy),x:x+item.dx,y:y+item.dy,item}));
    const blocked = targets.some(({key,x:tx,y:ty}) => tx<0 || ty<0 || tx>=cols || ty>=rows || (grid[key] && !(pickedEntity.mode === "move" && grid[key].id === pickedEntity.id)));
    if (blocked) { setNotice("目标位置超出画布或与现有设施冲突"); return true; }
    const placedId = pickedEntity.mode === "copy" ? crypto.randomUUID() : pickedEntity.id;
    setGrid((old)=>{
      const next={...old};
      if (pickedEntity.mode === "move") Object.keys(next).forEach((key)=>{if(next[key].id===pickedEntity.id)delete next[key]});
      targets.forEach(({key,item})=>{next[key]={...item.cell,id:placedId}});
      return next;
    });
    setSelectedEntityId(placedId); setPickedEntity(null);
    setNotice(pickedEntity.mode === "copy" ? "副本已放置" : "设备已移动");
    return true;
  }

  function rotateSelected() {
    if (!selectedEntityId) return;
    setGrid((old)=>{
      const entries=Object.entries(old).filter(([,cell])=>cell.id===selectedEntityId);
      if(!entries.length)return old;
      const first=entries[0][1];
      const next={...old};
      if(isTransport(first.kind)){
        entries.forEach(([key,cell])=>{next[key]={...cell,rotation:((cell.rotation+1)%4) as Direction,entry:cell.entry==null?undefined:((cell.entry+1)%4) as Direction}});
        setNotice("已顺时针旋转 90°");
        return next;
      }
      const positioned=entries.map(([key,cell])=>{const [x,y]=key.split(",").map(Number);return{x,y,cell}});
      const minX=Math.min(...positioned.map((item)=>item.x)),minY=Math.min(...positioned.map((item)=>item.y));
      const width=first.width??first.size??1,height=first.height??first.size??1;
      const rotated=positioned.map(({cell})=>{const partX=cell.partX??0,partY=cell.partY??0;return{x:minX+height-1-partY,y:minY+partX,cell,partX:height-1-partY,partY:partX}});
      if(rotated.some(({x,y})=>x<0||y<0||x>=cols||y>=rows||(old[keyOf(x,y)]&&old[keyOf(x,y)].id!==selectedEntityId))){setNotice("旋转后将超出画布或与现有设施冲突");return old}
      entries.forEach(([key])=>delete next[key]);
      rotated.forEach(({x,y,cell,partX,partY})=>{next[keyOf(x,y)]={...cell,partX,partY,width:height,height:width,rotation:((cell.rotation+1)%4) as Direction}});
      setNotice("已顺时针旋转 90°");
      return next;
    });
  }

  function activateBeltMode() {
    setSelected("belt");setSelectionMode(false);setPickedEntity(null);setSelectedEntityId(null);setBeltBuildMode(true);setBeltDraft(null);setHoveredEntity(null);
    setNotice("传送带模式 · 点击起点，继续点击添加路径点");
  }

  function availableSnapPort(entityId:string,type:PortType,x:number,y:number) {
    const last=beltDraft?.cells[beltDraft.cells.length-1];
    const draftKeys=new Set(beltDraft?.cells.map((point)=>keyOf(point.x,point.y))??[]);
    return resolvedPorts.filter((port)=>port.entityId===entityId&&port.type===type&&port.externalX>=0&&port.externalY>=0&&port.externalX<cols&&port.externalY<rows&&!grid[keyOf(port.externalX,port.externalY)]&&(!draftKeys.has(keyOf(port.externalX,port.externalY))||(last?.x===port.externalX&&last?.y===port.externalY))).sort((a,b)=>Math.abs(a.cellX-x)+Math.abs(a.cellY-y)-Math.abs(b.cellX-x)-Math.abs(b.cellY-y))[0]??null;
  }

  function addBeltWaypoint(x:number,y:number,entityId?:string) {
    const port=entityId?availableSnapPort(entityId,beltDraft?"input":"output",x,y):null;
    if(entityId&&!port){setNotice(beltDraft?"该设备没有可用输入口":"该设备没有可用输出口");return}
    const point=port?{x:port.externalX,y:port.externalY}:{x,y};
    if(point.x<0||point.y<0||point.x>=cols||point.y>=rows){setNotice("路径点超出画布");return}
    if(grid[keyOf(point.x,point.y)]){setNotice("该格已被占用，请选择空白路径点");return}
    if(!beltDraft){
      setBeltDraft({cells:[point],waypoints:[point],sourcePort:port?.type==="output"?port:undefined});
      setNotice(port?`已吸附到输出口 ${port.index+1} · 点击添加路径点`:`起点已创建 · 点击添加路径点`);
      return;
    }
    const start=beltDraft.cells[beltDraft.cells.length-1];
    if(start.x===point.x&&start.y===point.y){setNotice("该路径点已经存在");return}
    const blocked=new Set(Object.keys(grid));
    beltDraft.cells.slice(0,-1).forEach((cell)=>blocked.add(keyOf(cell.x,cell.y)));
    blocked.delete(keyOf(start.x,start.y));blocked.delete(keyOf(point.x,point.y));
    const segment=findAutoPath(start,point,cols,rows,blocked);
    if(!segment){setNotice("没有可用路径，请增加一个中间路径点");return}
    const cells=[...beltDraft.cells,...segment.slice(1)];
    setBeltDraft({...beltDraft,cells,waypoints:[...beltDraft.waypoints,point],targetPort:port?.type==="input"?port:undefined});
    setNotice(port?`已吸附到输入口 ${port.index+1} · 按 E 或 Esc 完成`:`路径点 ${beltDraft.waypoints.length+1} 已创建 · 按 E 或 Esc 完成`);
  }

  function finishBeltBuild() {
    if(!beltDraft){setBeltBuildMode(false);setHoveredEntity(null);setNotice("已退出传送带模式");return}
    const route=makeDraftRoute(beltDraft);
    if(!route){setBeltBuildMode(false);setBeltDraft(null);return}
    if(route.cells.some(({x,y})=>grid[keyOf(x,y)])){setNotice("路径与现有设施冲突，未提交");return}
    setGrid((old)=>{const next={...old};route.cells.forEach(({x,y,cell})=>{next[keyOf(x,y)]={...cell,id:crypto.randomUUID()}});return next});
    const connected=Boolean(beltDraft.sourcePort&&beltDraft.targetPort);
    setBeltBuildMode(false);setBeltDraft(null);setHoveredEntity(null);
    setNotice(connected?"传送带已完成并连接输入/输出口":"传送带已完成 · 未连接完整端口时不会生成物品");
  }

  function cancelBeltDraft() {
    setBeltDraft(null);setHoveredEntity(null);setNotice("当前传送带路径已取消 · 仍处于传送带模式");
  }

  function setDepotItem(entityId:string,itemId:string) {
    const item=INDUSTRIAL_ITEMS.find((candidate)=>candidate.id===itemId);
    if(!item)return;
    setGrid((old)=>Object.fromEntries(Object.entries(old).map(([key,cell])=>[key,cell.id===entityId&&cell.kind==="depot"?{...cell,itemId}:cell])));
    setNotice(`仓库取货口已设为 ${item.name} · 有效连接后按 30/min 输出`);
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if (key === "e") { event.preventDefault(); if(beltBuildMode)finishBeltBuild();else activateBeltMode();return; }
      if (key === "q") { setNotice("管道与储液罐暂未开放，当前阶段先完成传送带生产链"); }
      if (key === "x") { setSelectionMode(true); setPickedEntity(null); setNotice("X · 选择模式：点击一个方块"); }
      if (key === "r" && selectedEntityId) { event.preventDefault(); rotateSelected(); }
      if (key === "c" && selectedEntityId) { event.preventDefault(); preparePlacement(selectedEntityId,"copy"); }
      if (key === "m" && selectedEntityId) { event.preventDefault(); preparePlacement(selectedEntityId,"move"); }
      if (key === "escape"&&beltBuildMode) { event.preventDefault();finishBeltBuild();return; }
      if (key === "escape") { setPickedEntity(null); setSelectedEntityId(null); setSelectionMode(false); setNotice("已取消选择"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  // The keyboard listener is intentionally rebound to the current editor snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedEntityId, grid, beltBuildMode, beltDraft, resolvedPorts]);

  function paint(x: number, y: number, begin = false) {
    const key = keyOf(x, y);
    setGrid((old) => {
      if (isTransport(selected)) {
        if (old[key] && !isTransport(old[key].kind)) return old;
        const previous = !begin && drawHead.current?.kind === selected ? drawHead.current : null;
        const direction = previous ? directionBetween(previous.x, previous.y, x, y) : null;
        if (previous && direction == null) return old;
        const next = { ...old };
        const existing = next[key];
        if (existing?.kind && existing.kind !== selected) return old;
        if (previous && direction != null) {
          const previousKey = keyOf(previous.x, previous.y);
          const previousCell = next[previousKey];
          if (previousCell?.kind === selected) next[previousKey] = { ...previousCell, rotation:direction };
        }
        next[key] = existing?.kind === selected
          ? { ...existing, ...(direction != null ? { entry:opposite(direction), rotation:direction } : {}) }
          : { kind:selected, rotation:direction ?? 0, ...(direction != null ? { entry:opposite(direction) } : {}), id:crypto.randomUUID(), root:true, ...(selected === "pipe" ? { content:pipeContent } : {}) };
        drawHead.current = { x, y, kind:selected };
        return next;
      }
      const width = selected === "refiner" || selected === "fitter" ? 3 : selected === "powerPole" ? 2 : 1;
      const height = selected === "refiner" || selected === "fitter" || selected === "depot" ? 3 : selected === "powerPole" ? 2 : 1;
      if (x + width > cols || y + height > rows) return old;
      const cells = Array.from({ length: width * height }, (_, i) => keyOf(x + i % width, y + Math.floor(i / width)));
      if (cells.some((k) => old[k])) { setNotice("设备占地与现有设施冲突"); return old; }
      const id = crypto.randomUUID(); const next = { ...old };
      const rootIndex=Math.floor(height/2)*width+Math.floor(width/2);
      cells.forEach((k, i) => next[k] = { kind:selected,rotation:0,id,root:i===rootIndex,partX:i%width,partY:Math.floor(i/width),size:Math.max(width,height),width,height });
      return next;
    });
  }

  function save() {
    localStorage.setItem("endfield-blueprint-v1", JSON.stringify(grid));
    setNotice("蓝图已保存到本机");
  }

  function load() {
    const saved = localStorage.getItem("endfield-blueprint-v1");
    if (saved) setGrid(JSON.parse(saved));
    setNotice(saved ? "已恢复本机蓝图" : "没有找到已保存蓝图");
  }

  return (
    <main data-theme={theme} className="app-shell">
      <header className="topbar">
        <div className="brand-mark">ECS</div>
        <div className="brand-copy"><strong>编辑蓝图</strong><span>ENDFIELD INDUSTRIES / AIC BLUEPRINT</span></div>
        <div className="top-actions">
          <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="切换主题">{theme === "dark" ? "浅色" : "深色"}</button>
          <button onClick={load}>载入</button><button onClick={save}>保存蓝图</button>
          <button className={running ? "primary danger" : "primary"} onClick={() => setRunning(!running)}>{running ? "停止模拟" : "开始模拟"}</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="library panel">
          <div className="panel-heading"><span>构建设施</span><small>BUILD / 01</small></div>
          {["物流", "生产", "电力"].map((group) => (
            <div className="tool-group" key={group}>
              <p>{group}</p>
              {tools.filter((t) => t.group === group).map((tool) => (
                <button key={tool.kind} className={`tool ${selected === tool.kind && !selectionMode && (tool.kind!=="belt"||beltBuildMode) ? "active" : ""}`} onClick={() => {
                  if(tool.kind==="belt"){if(beltBuildMode)finishBeltBuild();else activateBeltMode();return}
                  if(beltBuildMode)finishBeltBuild();setSelected(tool.kind);setSelectionMode(false);setPickedEntity(null);setSelectedEntityId(null);
                }}>
                  <span className={`tool-glyph ${tool.kind}`}>{tool.image ? <img src={tool.image} alt=""/> : tool.glyph}</span>
                  <span><strong>{tool.label}</strong><small>{tool.desc}</small></span>
                  {tool.kind === "belt" && <kbd className="tool-key">E</kbd>}
                </button>
              ))}
            </div>
          ))}
          <button className={`tool selection-tool ${selectionMode ? "active" : ""}`} onClick={()=>{if(beltBuildMode)finishBeltBuild();setSelectionMode(true);setPickedEntity(null);setNotice("X · 选择模式：点击一个方块")}}>
            <span className="tool-glyph">SEL</span><span><strong>选择 / 移动</strong><small>长按拿起 · R 旋转</small></span><kbd className="tool-key">X</kbd>
          </button>
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
                <button onClick={()=>{setPan({x:0,y:0});setZoom(1)}}>重置视图</button><small>Alt + 左键 / 鼠标中键拖动画布</small>
              </div></details>
            </div>
          </div>
          <div className="grid-wrap" style={{"--grid-opacity":gridOpacity} as React.CSSProperties}
            onMouseDown={e=>{if(e.button===1||e.altKey){e.preventDefault();setPanning({x:e.clientX,y:e.clientY,ox:pan.x,oy:pan.y})}}}
            onMouseMove={e=>{if(panning)setPan({x:panning.ox+e.clientX-panning.x,y:panning.oy+e.clientY-panning.y})}}
            onMouseUp={()=>setPanning(null)} onMouseLeave={()=>setPanning(null)}
            onWheel={e=>{if(e.ctrlKey){e.preventDefault();setZoom(z=>Math.max(.55,Math.min(1.7,z-e.deltaY*.001)))}}}>
            {selectedEntity && <div className="selection-toolbar">
              <span><kbd>X</kbd> 已选中 <strong>{tools.find((tool)=>tool.kind===selectedEntity.kind)?.label}</strong>{pickedEntity && <em>{pickedEntity.mode === "move" ? "移动中" : "复制中"}</em>}</span>
              {selectedEntity.kind==="depot"&&<label className="depot-item-select"><span>{selectedDepotItem&&<img src={selectedDepotItem.image} alt=""/>}输出物品</span><select aria-label="仓库取货口输出物品" value={selectedDepotItem?.id??""} onChange={(event)=>setDepotItem(selectedEntity.id,event.target.value)}><option value="" disabled>选择工业物品</option>{(["矿物","工业产物"] as const).map((category)=><optgroup key={category} label={category}>{INDUSTRIAL_ITEMS.filter((item)=>item.category===category).map((item)=><option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>)}</select></label>}
              <button onClick={()=>preparePlacement(selectedEntity.id,"copy")}><kbd>C</kbd> 复制</button>
              <button onClick={rotateSelected}><kbd>R</kbd> 旋转</button>
              <button onClick={()=>preparePlacement(selectedEntity.id,"move")}><kbd>M</kbd> 移动</button>
              <button onClick={()=>{setSelectedEntityId(null);setPickedEntity(null);setSelectionMode(false)}}>取消</button>
            </div>}
            {beltBuildMode&&<div className="belt-build-toolbar"><span><kbd>E</kbd> 传送带模式</span><strong>{beltDraft?`${beltDraft.waypoints.length} 个路径点`:"点击创建起点"}</strong><small>{beltDraft?.sourcePort?"输出口已吸附":"可从空格或设备输出口开始"}</small><span><kbd>Esc / E</kbd> 完成　<kbd>右键</kbd> 取消</span></div>}
            <div className="axis axis-y">12<br/>08<br/>04<br/>00</div>
            <div className={`grid ${panning ? "is-panning" : ""} ${running ? "simulation-running" : ""}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, aspectRatio:`${cols}/${rows}`, transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})` }} onMouseLeave={() => { setDrawing(false);setHoveredEntity(null); drawHead.current=null; }}>
              {showPowerZones && <svg className="power-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {powerZones.map((zone)=><rect key={zone.id} x={zone.x} y={zone.y} width={zone.size} height={zone.size} rx=".16"/>)}
              </svg>}
              {showPowerZones&&powerZones.map((zone)=><span key={zone.id} className="power-range-label" style={{left:`${Math.max(0,zone.x)/cols*100}%`,top:`${Math.max(0,zone.y)/rows*100}%`}}>供电范围 12×12 · 规划参考</span>)}
              <svg className="transport-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {flowRoutes.map((route)=><g key={route.id} className={`route-track ${route.kind}`} data-content={route.cells[0]?.cell.content}>
                  <path className="track-edge" d={route.path}/><path className="track-fill" d={route.path}/>
                  {route.cells.map(({x,y,cell})=>{const anchor=arrowAnchor(x,y,cell);return <path key={`${x},${y}`} className="direction-arrow" d="M -.09 -.075 L .11 0 L -.09 .075 Z" transform={`translate(${anchor.x} ${anchor.y}) rotate(${arrowAngle(cell)})`}/>})}
                </g>)}
                {draftRoute&&<g className="route-track belt draft-route">
                  <path className="track-edge" d={draftRoute.path}/><path className="track-fill" d={draftRoute.path}/>
                  {draftRoute.cells.map(({x,y,cell})=>{const anchor=arrowAnchor(x,y,cell);return <path key={`${x},${y}`} className="direction-arrow" d="M -.09 -.075 L .11 0 L -.09 .075 Z" transform={`translate(${anchor.x} ${anchor.y}) rotate(${arrowAngle(cell)})`}/>})}
                  {beltDraft?.waypoints.map((point,index)=><circle key={`${point.x},${point.y},${index}`} className="draft-waypoint" cx={point.x+.5} cy={point.y+.5} r=".12"/>)}
                </g>}
              </svg>
              {running && <svg className="flow-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {connectedFlowRoutes.filter((route)=>movingRouteIds.has(route.id)).map((route) => {
                  const duration = Math.max(1.5, (route.cells.length - 1) * 1.1);
                  const cargoCount = route.cells.length;
                  return <g key={route.id} className={`route-motion ${route.kind}`}>
                    {Array.from({length:cargoCount}).map((_,cargoIndex)=><g className="flow-cargo" key={cargoIndex}>
                      <rect x="-.3" y="-.3" width=".6" height=".6" rx=".05"/>
                      <image href={route.itemImage} x="-.25" y="-.25" width=".5" height=".5" preserveAspectRatio="xMidYMid meet"/>
                      <animateMotion path={route.path} dur={`${duration}s`} begin={`${-(duration * cargoIndex / cargoCount)}s`} repeatCount="indefinite" rotate="auto"/>
                    </g>)}
                  </g>;
                })}
              </svg>}
              {Array.from({ length: cols * rows }).map((_, index) => {
                const x = index % cols; const y = Math.floor(index / cols); const cell = grid[keyOf(x, y)];
                const machineState=cell?machineStates[cell.id]:undefined;
                const status = machineState?.status??"idle";
                const stateLabel=status==="running"?"生产中":status==="waiting"?"周期等待":status==="starved"?"缺少输入":status==="blocked"?"输出阻塞":status==="unpowered"?"未供电":"已暂停";
                const machine = cell?.kind === "refiner" ? { name:"精炼炉", recipe:"蓝铁矿 ×1 → 蓝铁块 ×1", state:stateLabel, blocked:status==="blocked"?"是":"否" } : cell?.kind === "fitter" ? { name:"配件机", recipe:"蓝铁块 ×1 → 铁制零件 ×1", state:stateLabel, blocked:status==="blocked"?"是":"否" } : null;
                const processing = status === "running";
                const processProgress = machineState?.progress??0;
                const remainingSeconds = machineState?.remaining??"--";
                const machineImage = cell?.kind === "refiner" ? "/assets/machines/refinery.webp" : cell?.kind === "fitter" ? "/assets/machines/assembler.webp" : null;
                const cellWidth=cell?.width??cell?.size??1,cellHeight=cell?.height??cell?.size??1;
                const cellPorts=resolvedPorts.filter((port)=>port.cellX===x&&port.cellY===y);
                const footprintStyle=cell?.root?{left:`-${(cell.partX??0)*100}%`,top:`-${(cell.partY??0)*100}%`,right:`-${(cellWidth-1-(cell.partX??0))*100}%`,bottom:`-${(cellHeight-1-(cell.partY??0))*100}%`}:undefined;
                const entitySelected = Boolean(cell && cell.id===selectedEntityId);
                const entityPicked = Boolean(cell && pickedEntity?.id===cell.id && pickedEntity.mode==="move");
                const belt=cell?.kind==="belt"?beltMeta.get(keyOf(x,y)):undefined;
                const depotItem=cell?.kind==="depot"?INDUSTRIAL_ITEMS.find((item)=>item.id===cell.itemId):null;
                return <button key={index} className={`cell ${cell ? `placed ${cell.kind}` : ""} ${status} ${cell?.root?"entity-root":""} ${cellPorts.length?"entity-port":""} ${entitySelected ? "selected-entity" : ""} ${entityPicked ? "picked-entity" : ""}`} aria-label={`${x},${y}${cell ? ` ${cell.kind}` : ""}`}
                  onMouseDown={(e) => {
                    if(e.button===1||e.altKey)return;
                    if(beltBuildMode){addBeltWaypoint(x,y,cell&&!isTransport(cell.kind)?cell.id:undefined);return}
                    if (pickedEntity) { placePicked(x,y); return; }
                    if (selectionMode) { setSelectedEntityId(cell?.id??null); setNotice(cell ? "已选中设施" : "该位置为空"); return; }
                    if (cell && !isTransport(cell.kind)) {
                      if(holdTimer.current)window.clearTimeout(holdTimer.current);
                      holdTimer.current=window.setTimeout(()=>{setSelectedEntityId(cell.id);preparePlacement(cell.id,"move")},450);
                      return;
                    }
                    if(selected==="belt"){setNotice("请先按 E 进入传送带模式");return}
                    drawHead.current=null; setDrawing(true); paint(x, y, true);
                  }} onMouseEnter={() => {if(beltBuildMode)setHoveredEntity(cell&&!isTransport(cell.kind)?{id:cell.id,x,y}:null);if(drawing)paint(x,y)}} onMouseLeave={()=>{if(beltBuildMode&&hoveredEntity?.id===cell?.id)setHoveredEntity(null);if(holdTimer.current){window.clearTimeout(holdTimer.current);holdTimer.current=null}}} onMouseUp={() => {if(holdTimer.current){window.clearTimeout(holdTimer.current);holdTimer.current=null}setDrawing(false);drawHead.current=null;}}
                  onContextMenu={(e) => { e.preventDefault();if(beltBuildMode){cancelBeltDraft();return} setGrid((old) => { const target=old[keyOf(x,y)]; if(!target)return old; const next={...old}; Object.keys(next).forEach(k=>{if(next[k].id===target.id)delete next[k]}); return next; }); }}>
                    {cell && !isTransport(cell.kind) && <>{cell.root && <span style={footprintStyle} className={`cell-glyph root ${!machine ? "compact" : ""} ${cell.kind==="powerPole"?"power-pole":""} ${entitySelected?"selected-root":""}`}><b>{machineImage ? <img src={machineImage} alt={tools.find((t) => t.kind === cell.kind)?.label}/> : tools.find((t) => t.kind === cell.kind)?.image ? <img src={tools.find((t) => t.kind === cell.kind)?.image} alt={tools.find((t) => t.kind === cell.kind)?.label}/> : tools.find((t) => t.kind === cell.kind)?.glyph}</b>{cell.kind==="depot"&&<span className="depot-source">{depotItem?<><img src={depotItem.image} alt=""/><small>{depotItem.name}</small></>:<small>未选择物品</small>}</span>}{machine && <span className="machine-overlay"><strong className="machine-name">{machine.name}</strong><span className="machine-recipe">{machine.recipe}</span><small className={status}>状态 · {machine.state}</small><small className={`power-state ${machineState?.powered?"powered":"unpowered"}`}>供电 · {machineState?.powered?"正常":"断开"}</small><em>阻塞 · {machine.blocked}</em><span className="machine-progress"><i><b style={{width:`${processProgress}%`}}/></i><em>{processing ? `${processProgress}% · 剩余 ${remainingSeconds}s` : status==="unpowered" ? "等待供电 · --" : status==="starved" ? "缺少输入 · --" : status==="blocked" ? "输出阻塞 · --" : running ? "周期等待 · --" : "未启动 · --"}</em></span></span>}{cell.kind==="powerPole"&&<span className="power-pole-label"><strong>供电桩</strong><small>12 × 12</small></span>}</span>}{cellPorts.map((port)=><span key={port.key} className={`port-marker ${port.type} side-${port.side} ${snapCandidate?.key===port.key?"snap-target":""} ${isPortConnected(grid,port)?"connected":""}`} title={`${port.type==="input"?"物品输入口":"物品输出口"} ${port.index+1}`}>{port.type==="input"?<><i>IN {port.index+1}</i><b>›</b></>:<><b>›</b><i>OUT {port.index+1}</i></>}</span>)}{cell.root && status === "waiting" && <span className="wait-ring" />}</>}
                    {belt&&<span className="transport-tooltip"><span>{belt.image?<img src={belt.image} alt=""/>:<i className="empty-item-icon">--</i>}<strong>{belt.name}</strong></span><small>当前流速 {belt.rate}/min</small><small>额定带宽 30/min</small>{!belt.connected&&<small>未连接完整输入/输出口</small>}</span>}
                  </button>;
              })}
            </div>
            <div className="axis axis-x">00　　　04　　　08　　　12　　　16</div>
          </div>
          <div className="status-strip"><span>{notice}</span><span>网格 {cols} × {rows}</span><span>占用 {Math.round(Object.keys(grid).filter(k=>{const [x,y]=k.split(',').map(Number);return x<cols&&y<rows}).length / (cols * rows) * 100)}%</span></div>
        </section>

        <aside className="inspector panel">
          <div className="panel-heading"><span>生产监控</span><small>LIVE / 02</small></div>
          <div className="metric-grid"><div><small>设备</small><strong>{counts.devices}</strong></div><div><small>传送带</small><strong>{counts.belts}</strong></div><div><small>已供电</small><strong>{productionStates.filter((state)=>state.powered).length}<span> / {productionStates.length}</span></strong></div><div><small>效率</small><strong>{running&&productionStates.length ? Math.round(productionStates.filter((state)=>state.status==="running").length/productionStates.length*100) : "—"}<span>%</span></strong></div></div>
          <div className="section-title"><span>设备状态</span><small>{running ? "SIMULATION ACTIVE" : "SIMULATION PAUSED"}</small></div>
          {productionStates.map((state,index)=>{const stateText=state.status==="running"?"生产中":state.status==="waiting"?"周期等待":state.status==="starved"?"缺少输入":state.status==="blocked"?"输出阻塞":state.status==="unpowered"?"未供电":"暂停";return <div key={state.id} className={`machine-card ${state.status==="running"?"good":state.status!=="idle"?"warn":""}`}><div className="machine-icon">{state.kind==="refiner"?"R":"F"}</div><div><strong>{state.kind==="refiner"?"精炼炉":"配件机"} #{String(index+1).padStart(2,"0")}</strong><small>{state.kind==="refiner"?"蓝铁矿 → 蓝铁块":"蓝铁块 → 铁制零件"} · {stateText} · {state.powered?"供电正常":"供电断开"}</small></div><em>{state.status==="running"?`${state.progress}%`:stateText}</em></div>})}
          <div className="section-title"><span>流量</span><small>PER MINUTE</small></div>
          {INDUSTRIAL_ITEMS.filter((item)=>itemFlowRates.has(item.id)||["blue-iron-ore","blue-iron-block","iron-parts"].includes(item.id)).slice(0,5).map((item)=>{const rate=itemFlowRates.get(item.id)??0;return <div className="flow-row" key={item.id}><span><img src={item.image} alt=""/>{item.name}</span><b>{rate}</b><i style={{ width:`${Math.min(100,rate/60*100)}%` }} /></div>})}
          <div className="clock-card"><span>模拟时钟</span><strong>{String(Math.floor(tick / 10)).padStart(2, "0")}:{String(tick % 10).padStart(2, "0")}</strong><small>× 1.0　·　演示配方数据</small></div>
        </aside>
      </section>
    </main>
  );
}
