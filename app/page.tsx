"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Kind = "belt" | "pipe" | "refiner" | "fitter" | "tank" | "depot" | "powerPole";
type Direction = 0 | 1 | 2 | 3;
type PipeContent = "clean-water" | "liquid-xiranite" | "sewage";
type Cell = { kind: Kind; rotation: Direction; entry?: Direction; id: string; root?: boolean; partX?: number; partY?: number; size?: number; width?: number; height?: number; content?: PipeContent };
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
  "2,4": { kind: "depot", rotation: 0, id: "a", partX:0, partY:0, width:1, height:3 },
  "2,5": { kind: "depot", rotation: 0, id: "a", root:true, partX:0, partY:1, width:1, height:3 },
  "2,6": { kind: "depot", rotation: 0, id: "a", partX:0, partY:2, width:1, height:3 },
  "3,5": { kind: "belt", rotation: 0, entry:2, id: "b" },
  "4,5": { kind: "belt", rotation: 3, entry:2, id: "c" },
  "4,4": { kind: "belt", rotation: 3, entry:1, id: "c2" },
  "4,3": { kind: "belt", rotation: 0, entry:1, id: "c3" },
  "8,4": { kind: "belt", rotation: 0, entry:2, id: "e" },
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
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const drawHead = useRef<{ x:number; y:number; kind:Kind } | null>(null);
  const holdTimer = useRef<number | null>(null);
  const [notice, setNotice] = useState("演示蓝图已载入");
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
      const inputSide=opposite(cell.rotation), outputSide=cell.rotation;
      const onSide=(part:Cell,side:Direction)=>side===0 ? part.partX===width-1 : side===1 ? part.partY===height-1 : side===2 ? part.partX===0 : part.partY===0;
      const neighborAt=(position:{x:number;y:number},side:Direction)=>{const [dx,dy]=DELTAS[side];return grid[keyOf(position.x+dx,position.y+dy)]};
      const hasInput=positions.some((position)=>onSide(position.cell,inputSide) && (()=>{const neighbor=neighborAt(position,inputSide);return neighbor?.kind==="belt" && neighbor.rotation===opposite(inputSide)})());
      const hasOutput=positions.some((position)=>onSide(position.cell,outputSide) && (()=>{const neighbor=neighborAt(position,outputSide);return neighbor?.kind==="belt" && neighbor.entry===opposite(outputSide)})());
      const minX=Math.min(...positions.map(({x})=>x)),minY=Math.min(...positions.map(({y})=>y));
      const powered=powerZones.some((zone)=>zone.x<minX+width&&zone.x+zone.size>minX&&zone.y<minY+height&&zone.y+zone.size>minY);
      const cycle=cell.kind==="fitter"?50:30, active=cell.kind==="fitter"?36:30;
      const phase=(tick+entityPhase(id,cycle))%cycle;
      const status:MachineState["status"]=!powered?"unpowered":!running?"idle":!hasInput?"starved":!hasOutput?"blocked":cell.kind==="fitter"&&phase>=active?"waiting":"running";
      const progress=status==="running"?Math.min(100,Math.round(phase/active*100)):0;
      states[id]={id,kind:cell.kind,status,progress,remaining:status==="running"?Math.max(0,(active-phase)*.12).toFixed(1):"--",hasInput,hasOutput,powered};
    });
    return states;
  },[grid,powerZones,running,tick]);
  const productionStates = Object.values(machineStates);
  const selectedEntity = selectedEntityId ? Object.values(grid).find((cell)=>cell.id===selectedEntityId) : null;
  const showPowerZones=selected==="powerPole"||selectedEntity?.kind==="powerPole";
  const beltMeta=useMemo(()=>{
    const meta=new Map<string,{name:string;image:string;rate:number}>();
    flowRoutes.forEach((route)=>{
      const ore=route.cells[0]?.x<8;
      route.cells.forEach(({x,y})=>meta.set(keyOf(x,y),{name:ore?"蓝铁矿":"蓝铁块",image:ore?"/assets/items/blue-iron-ore.webp":"/assets/items/blue-iron-block.webp",rate:30}));
    });
    return meta;
  },[flowRoutes]);

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

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if (key === "e") { setSelected("belt"); setSelectionMode(false); setPickedEntity(null); setNotice("E · 传送带放置模式"); }
      if (key === "q") { setNotice("管道与储液罐暂未开放，当前阶段先完成传送带生产链"); }
      if (key === "x") { setSelectionMode(true); setPickedEntity(null); setNotice("X · 选择模式：点击一个方块"); }
      if (key === "r" && selectedEntityId) { event.preventDefault(); rotateSelected(); }
      if (key === "c" && selectedEntityId) { event.preventDefault(); preparePlacement(selectedEntityId,"copy"); }
      if (key === "m" && selectedEntityId) { event.preventDefault(); preparePlacement(selectedEntityId,"move"); }
      if (key === "escape") { setPickedEntity(null); setSelectedEntityId(null); setSelectionMode(false); setNotice("已取消选择"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedEntityId, grid]);

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
                <button key={tool.kind} className={`tool ${selected === tool.kind && !selectionMode ? "active" : ""}`} onClick={() => {setSelected(tool.kind);setSelectionMode(false);setPickedEntity(null);setSelectedEntityId(null)}}>
                  <span className={`tool-glyph ${tool.kind}`}>{tool.image ? <img src={tool.image} alt=""/> : tool.glyph}</span>
                  <span><strong>{tool.label}</strong><small>{tool.desc}</small></span>
                  {tool.kind === "belt" && <kbd className="tool-key">E</kbd>}
                </button>
              ))}
            </div>
          ))}
          <button className={`tool selection-tool ${selectionMode ? "active" : ""}`} onClick={()=>{setSelectionMode(true);setPickedEntity(null);setNotice("X · 选择模式：点击一个方块")}}>
            <span className="tool-glyph">SEL</span><span><strong>选择 / 移动</strong><small>长按拿起 · R 旋转</small></span><kbd className="tool-key">X</kbd>
          </button>
          <div className="hint"><kbd>拖拽</kbd> 连续铺设　<kbd>右键</kbd> 拆除</div>
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
              <button onClick={()=>preparePlacement(selectedEntity.id,"copy")}><kbd>C</kbd> 复制</button>
              <button onClick={rotateSelected}><kbd>R</kbd> 旋转</button>
              <button onClick={()=>preparePlacement(selectedEntity.id,"move")}><kbd>M</kbd> 移动</button>
              <button onClick={()=>{setSelectedEntityId(null);setPickedEntity(null);setSelectionMode(false)}}>取消</button>
            </div>}
            <div className="axis axis-y">12<br/>08<br/>04<br/>00</div>
            <div className={`grid ${panning ? "is-panning" : ""} ${running ? "simulation-running" : ""}`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)`, aspectRatio:`${cols}/${rows}`, transform:`translate(${pan.x}px,${pan.y}px) scale(${zoom})` }} onMouseLeave={() => { setDrawing(false); drawHead.current=null; }}>
              {showPowerZones && <svg className="power-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {powerZones.map((zone)=><rect key={zone.id} x={zone.x} y={zone.y} width={zone.size} height={zone.size} rx=".16"/>)}
              </svg>}
              <svg className="transport-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {flowRoutes.map((route)=><g key={route.id} className={`route-track ${route.kind}`} data-content={route.cells[0]?.cell.content}>
                  <path className="track-edge" d={route.path}/><path className="track-fill" d={route.path}/>
                  {route.cells.map(({x,y,cell})=>{const anchor=arrowAnchor(x,y,cell);return <path key={`${x},${y}`} className="direction-arrow" d="M -.09 -.075 L .11 0 L -.09 .075 Z" transform={`translate(${anchor.x} ${anchor.y}) rotate(${arrowAngle(cell)})`}/>})}
                </g>)}
              </svg>
              {running && <svg className="flow-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {flowRoutes.map((route) => {
                  const duration = Math.max(1.5, (route.cells.length - 1) * 1.1);
                  const cargoCount = route.cells.length;
                  const cargo = route.cells[0].x < 8 ? "/assets/items/blue-iron-ore.webp" : "/assets/items/blue-iron-block.webp";
                  return <g key={route.id} className={`route-motion ${route.kind}`}>
                    {Array.from({length:cargoCount}).map((_,cargoIndex)=><g className="flow-cargo" key={cargoIndex}>
                      <rect x="-.3" y="-.3" width=".6" height=".6" rx=".05"/>
                      <image href={cargo} x="-.25" y="-.25" width=".5" height=".5" preserveAspectRatio="xMidYMid meet"/>
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
                const sideHasCell = (side:Direction) => side===0 ? cell?.partX===cellWidth-1 : side===1 ? cell?.partY===cellHeight-1 : side===2 ? cell?.partX===0 : cell?.partY===0;
                const sideCenterCell = (side:Direction) => side===0||side===2 ? cell?.partY===Math.floor(cellHeight/2) : cell?.partX===Math.floor(cellWidth/2);
                const outputSide = cell?.rotation ?? 0, inputSide = opposite(outputSide);
                const inputPort = machine && sideHasCell(inputSide)&&sideCenterCell(inputSide);
                const outputPort = (cell?.kind==="depot"||machine) && sideHasCell(outputSide)&&sideCenterCell(outputSide);
                const footprintStyle=cell?.root?{left:`-${(cell.partX??0)*100}%`,top:`-${(cell.partY??0)*100}%`,right:`-${(cellWidth-1-(cell.partX??0))*100}%`,bottom:`-${(cellHeight-1-(cell.partY??0))*100}%`}:undefined;
                const entitySelected = Boolean(cell && cell.id===selectedEntityId);
                const entityPicked = Boolean(cell && pickedEntity?.id===cell.id && pickedEntity.mode==="move");
                const belt=cell?.kind==="belt"?beltMeta.get(keyOf(x,y)):undefined;
                return <button key={index} className={`cell ${cell ? `placed ${cell.kind}` : ""} ${status} ${cell?.root?"entity-root":""} ${inputPort||outputPort?"entity-port":""} ${entitySelected ? "selected-entity" : ""} ${entityPicked ? "picked-entity" : ""}`} aria-label={`${x},${y}${cell ? ` ${cell.kind}` : ""}`}
                  onMouseDown={(e) => {
                    if(e.button===1||e.altKey)return;
                    if (pickedEntity) { placePicked(x,y); return; }
                    if (selectionMode) { setSelectedEntityId(cell?.id??null); setNotice(cell ? "已选中设施" : "该位置为空"); return; }
                    if (cell && !isTransport(cell.kind)) {
                      if(holdTimer.current)window.clearTimeout(holdTimer.current);
                      holdTimer.current=window.setTimeout(()=>{setSelectedEntityId(cell.id);preparePlacement(cell.id,"move")},450);
                      return;
                    }
                    drawHead.current=null; setDrawing(true); paint(x, y, true);
                  }} onMouseEnter={() => drawing && paint(x, y)} onMouseLeave={()=>{if(holdTimer.current){window.clearTimeout(holdTimer.current);holdTimer.current=null}}} onMouseUp={() => {if(holdTimer.current){window.clearTimeout(holdTimer.current);holdTimer.current=null}setDrawing(false);drawHead.current=null;}}
                  onContextMenu={(e) => { e.preventDefault(); setGrid((old) => { const target=old[keyOf(x,y)]; if(!target)return old; const next={...old}; Object.keys(next).forEach(k=>{if(next[k].id===target.id)delete next[k]}); return next; }); }}>
                    {cell && !isTransport(cell.kind) && <>{cell.root && <span style={footprintStyle} className={`cell-glyph root ${!machine ? "compact" : ""} ${cell.kind==="powerPole"?"power-pole":""} ${entitySelected?"selected-root":""}`}><b>{machineImage ? <img src={machineImage} alt={tools.find((t) => t.kind === cell.kind)?.label}/> : tools.find((t) => t.kind === cell.kind)?.image ? <img src={tools.find((t) => t.kind === cell.kind)?.image} alt={tools.find((t) => t.kind === cell.kind)?.label}/> : tools.find((t) => t.kind === cell.kind)?.glyph}</b>{machine && <span className="machine-overlay"><strong className="machine-name">{machine.name}</strong><span className="machine-recipe">{machine.recipe}</span><small className={status}>状态 · {machine.state}</small><small className={`power-state ${machineState?.powered?"powered":"unpowered"}`}>供电 · {machineState?.powered?"正常":"断开"}</small><em>阻塞 · {machine.blocked}</em><span className="machine-progress"><i><b style={{width:`${processProgress}%`}}/></i><em>{processing ? `${processProgress}% · 剩余 ${remainingSeconds}s` : status==="unpowered" ? "等待供电 · --" : status==="starved" ? "缺少输入 · --" : status==="blocked" ? "输出阻塞 · --" : running ? "周期等待 · --" : "未启动 · --"}</em></span></span>}{cell.kind==="powerPole"&&<span className="power-pole-label"><strong>供电桩</strong><small>12 × 12</small></span>}</span>}{inputPort && <span className={`port-marker input side-${inputSide}`} title="物品输入口"><i>IN</i><b>›</b></span>}{outputPort && <span className={`port-marker output side-${outputSide}`} title="物品输出口"><b>›</b><i>OUT</i></span>}{cell.root && status === "waiting" && <span className="wait-ring" />}</>}
                    {belt&&<span className="transport-tooltip"><span><img src={belt.image} alt=""/><strong>{belt.name}</strong></span><small>当前流速 {running?belt.rate:0}/min</small><small>额定带宽 {belt.rate}/min</small></span>}
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
          <div className="flow-row"><span>蓝铁矿</span><b>{running ? 30 : 0}</b><i style={{ width: running ? "54%" : 0 }} /></div>
          <div className="flow-row"><span>蓝铁块</span><b>{running ? 18 : 0}</b><i style={{ width: running ? "34%" : 0 }} /></div>
          <div className="flow-row"><span>铁制零件</span><b>{running ? 9 : 0}</b><i style={{ width: running ? "18%" : 0 }} /></div>
          <div className="clock-card"><span>模拟时钟</span><strong>{String(Math.floor(tick / 10)).padStart(2, "0")}:{String(tick % 10).padStart(2, "0")}</strong><small>× 1.0　·　演示配方数据</small></div>
        </aside>
      </section>
    </main>
  );
}
