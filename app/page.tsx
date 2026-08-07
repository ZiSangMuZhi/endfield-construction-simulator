"use client";

import { useEffect, useMemo, useState } from "react";

type Kind = "belt" | "pipe" | "refiner" | "fitter" | "tank" | "depot";
type Cell = { kind: Kind; rotation: number; id: string; root?: boolean };
type Grid = Record<string, Cell>;

const COLS = 18;
const ROWS = 12;
const keyOf = (x: number, y: number) => `${x},${y}`;

const tools: { kind: Kind; label: string; group: string; glyph: string; desc: string }[] = [
  { kind: "belt", label: "传送带", group: "物流", glyph: "→", desc: "固体 · 60/min" },
  { kind: "pipe", label: "管道", group: "物流", glyph: "≈", desc: "流体 · 90/min" },
  { kind: "depot", label: "仓库取货口", group: "物流", glyph: "D", desc: "指定物品输出" },
  { kind: "refiner", label: "精炼炉", group: "生产", glyph: "R", desc: "矿石 → 金属块" },
  { kind: "fitter", label: "配件机", group: "生产", glyph: "F", desc: "金属块 → 零件" },
  { kind: "tank", label: "储液罐", group: "储存", glyph: "T", desc: "容量 600" },
];

const baseInitial: Grid = {
  "2,5": { kind: "depot", rotation: 0, id: "a" },
  "3,5": { kind: "belt", rotation: 0, id: "b" },
  "4,5": { kind: "belt", rotation: 0, id: "c" },
  "4,4": { kind: "belt", rotation: 0, id: "c2" },
  "4,3": { kind: "belt", rotation: 0, id: "c3" },
  "8,4": { kind: "belt", rotation: 0, id: "e" },
  "8,3": { kind: "belt", rotation: 0, id: "f" },
  "11,8": { kind: "tank", rotation: 0, id: "h", root: true },
  "12,8": { kind: "pipe", rotation: 0, id: "i" },
  "13,8": { kind: "pipe", rotation: 0, id: "j" },
  "13,7": { kind: "pipe", rotation: 0, id: "j2" },
  "13,6": { kind: "pipe", rotation: 0, id: "j3" },
};

const initial = (() => {
  const next = { ...baseInitial };
  const seed = (kind: "refiner" | "fitter", sx: number, sy: number, id: string) => {
    for (let dy = 0; dy < 3; dy++) for (let dx = 0; dx < 3; dx++)
      next[keyOf(sx + dx, sy + dy)] = { kind, rotation: 0, id, root: dx === 1 && dy === 1 };
  };
  seed("refiner", 5, 2, "d"); seed("fitter", 9, 2, "g");
  return next;
})();

const isTransport = (kind?: Kind) => kind === "belt" || kind === "pipe";

function cellStatus(cell: Cell, running: boolean) {
  if (!running || !["refiner", "fitter"].includes(cell.kind)) return "idle";
  return cell.kind === "refiner" ? "running" : "waiting";
}

export default function Home() {
  const [theme, setTheme] = useState<"light" | "dark">("dark");
  const [grid, setGrid] = useState<Grid>(initial);
  const [selected, setSelected] = useState<Kind>("belt");
  const [running, setRunning] = useState(false);
  const [tick, setTick] = useState(0);
  const [drawing, setDrawing] = useState(false);
  const [notice, setNotice] = useState("演示蓝图已载入");

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

  function paint(x: number, y: number) {
    const key = keyOf(x, y);
    setGrid((old) => {
      if (isTransport(selected)) {
        if (old[key] && !isTransport(old[key].kind)) return old;
        return { ...old, [key]: { kind: selected, rotation: 0, id: crypto.randomUUID(), root: true } };
      }
      const size = selected === "refiner" || selected === "fitter" ? 3 : 1;
      if (x + size > COLS || y + size > ROWS) return old;
      const cells = Array.from({ length: size * size }, (_, i) => keyOf(x + i % size, y + Math.floor(i / size)));
      if (cells.some((k) => old[k])) { setNotice("设备占地与现有设施冲突"); return old; }
      const id = crypto.randomUUID(); const next = { ...old };
      cells.forEach((k, i) => next[k] = { kind: selected, rotation: 0, id, root: size === 1 || i === 4 });
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
        <div className="brand-copy"><strong>终末地 · 工业规划台</strong><span>ENDFIELD CONSTRUCTION SIMULATOR / ALPHA 0.1</span></div>
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
                <button key={tool.kind} className={`tool ${selected === tool.kind ? "active" : ""}`} onClick={() => setSelected(tool.kind)}>
                  <span className={`tool-glyph ${tool.kind}`}>{tool.glyph}</span>
                  <span><strong>{tool.label}</strong><small>{tool.desc}</small></span>
                </button>
              ))}
            </div>
          ))}
          <div className="hint"><kbd>拖拽</kbd> 连续铺设　<kbd>右键</kbd> 拆除</div>
        </aside>

        <section className="canvas-panel">
          <div className="canvas-toolbar">
            <div><span className="live-dot" /> AIC-01 / 规划层</div>
            <div className="scale">−　100%　＋</div>
          </div>
          <div className="grid-wrap">
            <div className="axis axis-y">12<br/>08<br/>04<br/>00</div>
            <div className="grid" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }} onMouseLeave={() => setDrawing(false)}>
              {Array.from({ length: COLS * ROWS }).map((_, index) => {
                const x = index % COLS; const y = Math.floor(index / COLS); const cell = grid[keyOf(x, y)];
                const status = cell ? cellStatus(cell, running) : "";
                const mask = cell && isTransport(cell.kind) ? [y > 0 && grid[keyOf(x,y-1)]?.kind === cell.kind ? "n":"", x < COLS-1 && grid[keyOf(x+1,y)]?.kind === cell.kind ? "e":"", y < ROWS-1 && grid[keyOf(x,y+1)]?.kind === cell.kind ? "s":"", x > 0 && grid[keyOf(x-1,y)]?.kind === cell.kind ? "w":""].join("") : "";
                const machine = cell?.kind === "refiner" ? { recipe:"蓝铁矿 ×1 → 蓝铁块 ×1", state:running ? "生产中" : "已暂停", blocked:"否" } : cell?.kind === "fitter" ? { recipe:"蓝铁块 ×1 → 铁制零件 ×1", state:running ? "缺料等待" : "已暂停", blocked:"否" } : null;
                return <button key={index} className={`cell ${cell ? `placed ${cell.kind}` : ""} ${status}`} aria-label={`${x},${y}${cell ? ` ${cell.kind}` : ""}`}
                  onMouseDown={() => { setDrawing(true); paint(x, y); }} onMouseEnter={() => drawing && paint(x, y)} onMouseUp={() => setDrawing(false)}
                  onContextMenu={(e) => { e.preventDefault(); setGrid((old) => { const target=old[keyOf(x,y)]; if(!target)return old; const next={...old}; Object.keys(next).forEach(k=>{if(next[k].id===target.id)delete next[k]}); return next; }); }}>
                    {cell && isTransport(cell.kind) && <span className="transport-track" data-mask={mask || "e"}><i className="seg n"/><i className="seg e"/><i className="seg s"/><i className="seg w"/>{running && (x+y)%2===0 && <b className={`item-icon ${cell.kind === "pipe" ? "fluid" : "solid"}`}>{cell.kind === "pipe" ? "●" : "◆"}</b>}</span>}
                    {cell && !isTransport(cell.kind) && <><span className={`cell-glyph ${cell.root ? "root" : "part"}`}>{cell.root && <><b>{tools.find((t) => t.kind === cell.kind)?.glyph}</b>{machine && <span className="machine-overlay"><strong>{machine.recipe}</strong><small className={status}>● {machine.state}</small><em>阻塞：{machine.blocked}</em></span>}</>}</span>{cell.root && status === "waiting" && <span className="wait-ring" />}</>}
                  </button>;
              })}
            </div>
            <div className="axis axis-x">00　　　04　　　08　　　12　　　16</div>
          </div>
          <div className="status-strip"><span>{notice}</span><span>网格 {COLS} × {ROWS}</span><span>占用 {Math.round(Object.keys(grid).length / (COLS * ROWS) * 100)}%</span></div>
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
