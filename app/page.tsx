"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Kind = "belt" | "pipe" | "refiner" | "fitter" | "tank" | "depot";
type Direction = 0 | 1 | 2 | 3;
type PipeContent = "clean-water" | "liquid-xiranite" | "sewage";
type Cell = { kind: Kind; rotation: Direction; entry?: Direction; id: string; root?: boolean; partX?: number; partY?: number; size?: number; content?: PipeContent };
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
  { kind: "belt", label: "传送带", group: "物流", glyph: "→", desc: "固体 · 60/min" },
  { kind: "pipe", label: "管道", group: "物流", glyph: "≈", desc: "流体 · 默认清水" },
  { kind: "depot", label: "仓库取货口", group: "物流", glyph: "D", desc: "指定物品输出" },
  { kind: "refiner", label: "精炼炉", group: "生产", glyph: "R", desc: "矿石 → 金属块", image:"/assets/machines/refinery.webp" },
  { kind: "fitter", label: "配件机", group: "生产", glyph: "F", desc: "金属块 → 零件", image:"/assets/machines/assembler.webp" },
  { kind: "tank", label: "储液罐", group: "储存", glyph: "T", desc: "容量 600" },
];

const baseInitial: Grid = {
  "2,5": { kind: "depot", rotation: 0, id: "a" },
  "3,5": { kind: "belt", rotation: 0, entry:2, id: "b" },
  "4,5": { kind: "belt", rotation: 3, entry:2, id: "c" },
  "4,4": { kind: "belt", rotation: 3, entry:1, id: "c2" },
  "4,3": { kind: "belt", rotation: 0, entry:1, id: "c3" },
  "8,4": { kind: "belt", rotation: 0, entry:2, id: "e" },
  "8,3": { kind: "belt", rotation: 0, entry:2, id: "f" },
  "11,8": { kind: "tank", rotation: 0, id: "h", root: true },
  "12,8": { kind: "pipe", rotation: 0, entry:2, id: "i", content:"liquid-xiranite" },
  "13,8": { kind: "pipe", rotation: 3, entry:2, id: "j", content:"liquid-xiranite" },
  "13,7": { kind: "pipe", rotation: 3, entry:1, id: "j2", content:"liquid-xiranite" },
  "13,6": { kind: "pipe", rotation: 3, entry:1, id: "j3", content:"liquid-xiranite" },
};

const initial = (() => {
  const next = { ...baseInitial };
  const seed = (kind: "refiner" | "fitter", sx: number, sy: number, id: string) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++)
      next[keyOf(sx + dx, sy + dy)] = { kind, rotation: 0, id, root: dx === 1 && dy === 1, partX:dx, partY:dy, size:3 };
  };
  seed("refiner", 5, 2, "d"); seed("fitter", 9, 2, "g");
  return next;
})();

const isTransport = (kind?: Kind) => kind === "belt" || kind === "pipe";

function cellStatus(cell: Cell, running: boolean, tick: number) {
  if (!running || !["refiner", "fitter"].includes(cell.kind)) return "idle";
  return cell.kind === "refiner" || tick % 50 < 36 ? "running" : "waiting";
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [grid, setGrid] = useState<Grid>(initial);
  const [selected, setSelected] = useState<Kind>("belt");
  const [pipeContent, setPipeContent] = useState<PipeContent>("clean-water");
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
  const flowRoutes = useMemo(() => [...getFlowRoutes(grid, "belt"), ...getFlowRoutes(grid, "pipe")], [grid]);
  const selectedEntity = selectedEntityId ? Object.values(grid).find((cell)=>cell.id===selectedEntityId) : null;

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
      const next={...old};
      Object.keys(next).forEach((key)=>{if(next[key].id===selectedEntityId){const cell=next[key];next[key]={...cell,rotation:((cell.rotation+1)%4) as Direction,entry:cell.entry==null?undefined:((cell.entry+1)%4) as Direction}}});
      return next;
    });
    setNotice("已顺时针旋转 90°");
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select")) return;
      const key = event.key.toLowerCase();
      if (key === "e") { setSelected("belt"); setSelectionMode(false); setPickedEntity(null); setNotice("E · 传送带放置模式"); }
      if (key === "q") { setSelected("pipe"); setSelectionMode(false); setPickedEntity(null); setNotice("Q · 管道放置模式"); }
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
      const size = selected === "refiner" || selected === "fitter" ? 3 : 1;
      if (x + size > cols || y + size > rows) return old;
      const cells = Array.from({ length: size * size }, (_, i) => keyOf(x + i % size, y + Math.floor(i / size)));
      if (cells.some((k) => old[k])) { setNotice("设备占地与现有设施冲突"); return old; }
      const id = crypto.randomUUID(); const next = { ...old };
      cells.forEach((k, i) => next[k] = { kind: selected, rotation: 0, id, root: size === 1 || i === 4, partX:i%size, partY:Math.floor(i/size), size });
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
          <button className="icon-button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label="切换主题">{theme === "dark" ? "☼" : "◐"}</button>
          <button onClick={load}>载入</button><button onClick={save}>保存蓝图</button>
          <button className={running ? "primary danger" : "primary"} onClick={() => setRunning(!running)}>{running ? "■ 停止模拟" : "▶ 开始模拟"}</button>
        </div>
      </header>

      <section className="workspace">
        <aside className="library panel">
          <div className="panel-heading"><span>构建设施</span><small>BUILD / 01</small></div>
          {["物流", "生产", "储存"].map((group) => (
            <div className="tool-group" key={group}>
              <p>{group}</p>
              {tools.filter((t) => t.group === group).map((tool) => (
                <button key={tool.kind} className={`tool ${selected === tool.kind && !selectionMode ? "active" : ""}`} onClick={() => {setSelected(tool.kind);setSelectionMode(false);setPickedEntity(null);setSelectedEntityId(null)}}>
                  <span className={`tool-glyph ${tool.kind}`}>{tool.image ? <img src={tool.image} alt=""/> : tool.glyph}</span>
                  <span><strong>{tool.label}</strong><small>{tool.desc}</small></span>
                  {(tool.kind === "belt" || tool.kind === "pipe") && <kbd className="tool-key">{tool.kind === "belt" ? "E" : "Q"}</kbd>}
                </button>
              ))}
            </div>
          ))}
          <button className={`tool selection-tool ${selectionMode ? "active" : ""}`} onClick={()=>{setSelectionMode(true);setPickedEntity(null);setNotice("X · 选择模式：点击一个方块")}}>
            <span className="tool-glyph">□</span><span><strong>选择 / 移动</strong><small>长按拿起 · R 旋转</small></span><kbd className="tool-key">X</kbd>
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
                <label><span>新管道内容</span><select value={pipeContent} onChange={e=>setPipeContent(e.target.value as PipeContent)}><option value="clean-water">清水</option><option value="liquid-xiranite">液化息壤</option><option value="sewage">污水</option></select></label>
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
              <svg className="transport-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {flowRoutes.map((route)=><g key={route.id} className={`route-track ${route.kind}`} data-content={route.cells[0]?.cell.content}>
                  <path className="track-edge" d={route.path}/><path className="track-fill" d={route.path}/>
                  {route.cells.map(({x,y,cell})=><path key={`${x},${y}`} className="direction-arrow" d="M -.13 -.11 L .16 0 L -.13 .11 Z" transform={`translate(${x+.5} ${y+.5}) rotate(${cell.rotation*90})`}/>) }
                </g>)}
              </svg>
              {running && <svg className="flow-overlay" viewBox={`0 0 ${cols} ${rows}`} preserveAspectRatio="none" aria-hidden="true">
                {flowRoutes.map((route) => {
                  const duration = Math.max(1.5, (route.cells.length - 1) * 1.1);
                  const cargoCount = route.cells.length;
                  const cargo = route.kind === "pipe" ? "/assets/items/liquid-xiranite.webp" : route.cells[0].x < 8 ? "/assets/items/blue-iron-ore.webp" : "/assets/items/blue-iron-block.webp";
                  return <g key={route.id} className={`route-motion ${route.kind}`}>
                    {Array.from({length:cargoCount}).map((_,cargoIndex)=><g className="flow-cargo" key={cargoIndex}>
                      <rect x={route.kind === "pipe" ? "-.21" : "-.3"} y={route.kind === "pipe" ? "-.21" : "-.3"} width={route.kind === "pipe" ? ".42" : ".6"} height={route.kind === "pipe" ? ".42" : ".6"} rx={route.kind === "pipe" ? ".21" : ".05"}/>
                      <image href={cargo} x={route.kind === "pipe" ? "-.17" : "-.25"} y={route.kind === "pipe" ? "-.17" : "-.25"} width={route.kind === "pipe" ? ".34" : ".5"} height={route.kind === "pipe" ? ".34" : ".5"} preserveAspectRatio="xMidYMid meet"/>
                      <animateMotion path={route.path} dur={`${duration}s`} begin={`${-(duration * cargoIndex / cargoCount)}s`} repeatCount="indefinite" rotate="auto"/>
                    </g>)}
                  </g>;
                })}
              </svg>}
              {Array.from({ length: cols * rows }).map((_, index) => {
                const x = index % cols; const y = Math.floor(index / cols); const cell = grid[keyOf(x, y)];
                const status = cell ? cellStatus(cell, running, tick) : "";
                const machine = cell?.kind === "refiner" ? { recipe:"蓝铁矿 ×1 → 蓝铁块 ×1", state:running ? "生产中" : "已暂停", blocked:"否" } : cell?.kind === "fitter" ? { recipe:"蓝铁块 ×1 → 铁制零件 ×1", state:status === "running" ? "生产中" : running ? "缺料等待" : "已暂停", blocked:"否" } : null;
                const activeTicks = cell?.kind === "fitter" ? 36 : 30;
                const phaseTick = cell?.kind === "fitter" ? tick % 50 : tick % 30;
                const processing = Boolean(machine && status === "running");
                const processProgress = processing ? Math.min(100,Math.round(phaseTick/activeTicks*100)) : 0;
                const remainingSeconds = processing ? Math.max(0,(activeTicks-phaseTick)*.12).toFixed(1) : "--";
                const machineImage = cell?.kind === "refiner" ? "/assets/machines/refinery.webp" : cell?.kind === "fitter" ? "/assets/machines/assembler.webp" : null;
                const sideHasCell = (side:Direction) => side===0 ? cell?.partX===(cell?.size??1)-1 : side===1 ? cell?.partY===(cell?.size??1)-1 : side===2 ? cell?.partX===0 : cell?.partY===0;
                const outputSide = cell?.rotation ?? 0, inputSide = opposite(outputSide);
                const inputPort = machine && sideHasCell(inputSide);
                const outputPort = machine && sideHasCell(outputSide);
                const entitySelected = Boolean(cell && cell.id===selectedEntityId);
                const entityPicked = Boolean(cell && pickedEntity?.id===cell.id && pickedEntity.mode==="move");
                return <button key={index} className={`cell ${cell ? `placed ${cell.kind}` : ""} ${status} ${entitySelected ? "selected-entity" : ""} ${entityPicked ? "picked-entity" : ""}`} aria-label={`${x},${y}${cell ? ` ${cell.kind}` : ""}`}
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
                    {cell && !isTransport(cell.kind) && <><span className={`cell-glyph ${cell.root ? `root ${cell.size === 1 || cell.size == null ? "compact" : ""}` : "part"}`}>{cell.root && <><b>{machineImage ? <img src={machineImage} alt={tools.find((t) => t.kind === cell.kind)?.label}/> : tools.find((t) => t.kind === cell.kind)?.glyph}</b>{machine && <span className="machine-overlay"><strong>{machine.recipe}</strong><small className={status}>● {machine.state}</small><em>阻塞：{machine.blocked}</em><span className="machine-progress"><i><b style={{width:`${processProgress}%`}}/></i><em>{processing ? `${processProgress}% · 剩余 ${remainingSeconds}s` : running ? "等待输入 · --" : "未启动 · --"}</em></span></span>}</>}</span>{inputPort && <span className={`port-marker input side-${inputSide}`} title="物品输入口"><i>IN</i><b>›</b></span>}{outputPort && <span className={`port-marker output side-${outputSide}`} title="物品输出口"><b>›</b><i>OUT</i></span>}{cell.root && status === "waiting" && <span className="wait-ring" />}</>}
                  </button>;
              })}
            </div>
            <div className="axis axis-x">00　　　04　　　08　　　12　　　16</div>
          </div>
          <div className="status-strip"><span>{notice}</span><span>网格 {cols} × {rows}</span><span>占用 {Math.round(Object.keys(grid).filter(k=>{const [x,y]=k.split(',').map(Number);return x<cols&&y<rows}).length / (cols * rows) * 100)}%</span></div>
        </section>

        <aside className="inspector panel">
          <div className="panel-heading"><span>生产监控</span><small>LIVE / 02</small></div>
          <div className="metric-grid"><div><small>设备</small><strong>{counts.devices}</strong></div><div><small>物流线</small><strong>{counts.belts + counts.pipes}</strong></div><div><small>功率</small><strong>42<span> kW</span></strong></div><div><small>效率</small><strong>{running ? "72" : "—"}<span>%</span></strong></div></div>
          <div className="section-title"><span>设备状态</span><small>{running ? "SIMULATION ACTIVE" : "SIMULATION PAUSED"}</small></div>
          <div className="machine-card good"><div className="machine-icon">R</div><div><strong>精炼炉 #01</strong><small>{running ? "蓝铁矿 → 蓝铁块 · 未阻塞" : "等待启动"}</small></div><em>{running ? "全速" : "暂停"}</em></div>
          <div className={`machine-card ${running ? "warn" : ""}`}><div className="machine-icon">F</div><div><strong>配件机 #01</strong><small>{running ? "蓝铁块 → 铁制零件 · 缺料 / 未阻塞" : "等待启动"}</small></div><em>{running ? "72%" : "暂停"}</em></div>
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
