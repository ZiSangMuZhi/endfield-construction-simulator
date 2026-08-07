"use client";

import { useEffect, useMemo, useState } from "react";

type Kind = "belt" | "pipe" | "refiner" | "fitter" | "tank" | "depot";
type Cell = { kind: Kind; rotation: number; id: string };
type Grid = Record<string, Cell>;

const COLS = 18;
const ROWS = 12;
const keyOf = (x: number, y: number) => `${x},${y}`;

const tools: { kind: Kind; label: string; group: string; glyph: string; desc: string }[] = [
  { kind: "belt", label: "传送带", group: "物流", glyph: "→", desc: "固体 · 60/min" },
  { kind: "pipe", label: "管道", group: "物流", glyph: "≈", desc: "流体 · 90/min" },
  { kind: "depot", label: "仓储接口", group: "物流", glyph: "D", desc: "输入 / 输出" },
  { kind: "refiner", label: "精炼设备", group: "生产", glyph: "R", desc: "矿石 → 粉末" },
  { kind: "fitter", label: "装配设备", group: "生产", glyph: "F", desc: "粉末 → 零件" },
  { kind: "tank", label: "储液罐", group: "储存", glyph: "T", desc: "容量 600" },
];

const initial: Grid = {
  "2,5": { kind: "depot", rotation: 0, id: "a" },
  "3,5": { kind: "belt", rotation: 0, id: "b" },
  "4,5": { kind: "belt", rotation: 0, id: "c" },
  "5,5": { kind: "refiner", rotation: 0, id: "d" },
  "6,5": { kind: "belt", rotation: 0, id: "e" },
  "7,5": { kind: "belt", rotation: 0, id: "f" },
  "8,5": { kind: "fitter", rotation: 0, id: "g" },
  "11,7": { kind: "tank", rotation: 0, id: "h" },
  "12,7": { kind: "pipe", rotation: 0, id: "i" },
  "13,7": { kind: "pipe", rotation: 0, id: "j" },
};

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
      devices: values.filter((c) => !["belt", "pipe"].includes(c.kind)).length,
      belts: values.filter((c) => c.kind === "belt").length,
      pipes: values.filter((c) => c.kind === "pipe").length,
    };
  }, [grid]);

  function paint(x: number, y: number) {
    const key = keyOf(x, y);
    setGrid((old) => ({ ...old, [key]: { kind: selected, rotation: 0, id: crypto.randomUUID() } }));
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
                return <button key={index} className={`cell ${cell ? `placed ${cell.kind}` : ""} ${status}`} aria-label={`${x},${y}${cell ? ` ${cell.kind}` : ""}`}
                  onMouseDown={() => { setDrawing(true); paint(x, y); }} onMouseEnter={() => drawing && paint(x, y)} onMouseUp={() => setDrawing(false)}
                  onContextMenu={(e) => { e.preventDefault(); setGrid((old) => { const next = { ...old }; delete next[keyOf(x, y)]; return next; }); }}>
                    {cell && <><span className="cell-glyph">{tools.find((t) => t.kind === cell.kind)?.glyph}</span>{status === "waiting" && <span className="wait-ring" />}</>}
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
          <div className="machine-card good"><div className="machine-icon">R</div><div><strong>精炼设备 #01</strong><small>{running ? "铁矿石 → 铁粉末" : "等待启动"}</small></div><em>{running ? "全速" : "暂停"}</em></div>
          <div className={`machine-card ${running ? "warn" : ""}`}><div className="machine-icon">F</div><div><strong>装配设备 #01</strong><small>{running ? "输入不足 · 等待 1.8s" : "等待启动"}</small></div><em>{running ? "72%" : "暂停"}</em></div>
          <div className="section-title"><span>流量</span><small>PER MINUTE</small></div>
          <div className="flow-row"><span>铁矿石</span><b>{running ? 30 : 0}</b><i style={{ width: running ? "54%" : 0 }} /></div>
          <div className="flow-row"><span>铁粉末</span><b>{running ? 18 : 0}</b><i style={{ width: running ? "34%" : 0 }} /></div>
          <div className="flow-row"><span>工业零件</span><b>{running ? 9 : 0}</b><i style={{ width: running ? "18%" : 0 }} /></div>
          <div className="clock-card"><span>模拟时钟</span><strong>{String(Math.floor(tick / 10)).padStart(2, "0")}:{String(tick % 10).padStart(2, "0")}</strong><small>× 1.0　·　演示配方数据</small></div>
        </aside>
      </section>
    </main>
  );
}
