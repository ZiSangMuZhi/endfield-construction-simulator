# 数据与素材规范

## 游戏数据

正式配方必须记录：游戏版本、来源链接、采集日期、物品输入/输出、周期、设备类型和可信度。未核实字段必须为 `null`，不得用猜测数值补齐。当前 UI 数据均标记为演示。

建议数据结构：

```json
{
  "gameVersion": "x.y.z",
  "recipes": [{ "id": "...", "machine": "...", "duration": null, "inputs": [], "outputs": [], "source": "..." }]
}
```

## 图标与版权

游戏原图标仅在获得明确许可、且能记录来源与许可的情况下纳入仓库。每个外部素材必须登记原始 URL、作者、许可、修改情况。无法确认许可时，使用项目自制的几何图标；不得直接抓取第三方站点素材后再发布。

Alpha 版优先复用已登记的本地游戏相关图标；没有可用图标的物品使用项目自制 SVG 几何图标，避免使用 Emoji 或让来源不明素材混入仓库。后续若用户提供合法导出的个人素材包，可通过稳定物品 ID 映射替换。

## 已核实设备占地

2026-08-07 依据 END Wiki 的 Placement 字段，精炼设备与装配设备均为 `3 × 3 × 4`，规划器取前两维作为地面占地 `3 × 3`。来源：

- https://endfield.games/en/factory/buildings/furnance-1/
- https://endfield.games/en/factory/buildings/component-mc-1/

供电桩按 `2×2` 占地实现。公开资料可确认其不耗电并为范围内设备无线供电；当前 `12×12` 网格范围采用参考规划工具中的可审计配置，作为规划数据而非官方公开数值。来源：

- https://endfield.hypergryph.com/news/7235
- https://gl.ali213.net/html/2026-1/1742509_57.html
- https://360game.360.cn/article/content?id=6971b6366354a8b07c18537f&page=6
- https://github.com/eddy3721/arknights-endfield-bp-tool/blob/main/src/config/machines.ts

装备原件机公开设备页记录占地 `6 × 4 × 4`、功率 10，并给出“晶体外壳 ×5 + 紫晶纤维 ×5 → 紫晶装备原件 ×1、10s”的示例配方。规划器以 `4×6` 作为默认朝向，旋转后为 `6×4`，两者是同一地面占地。来源：

- https://endfield.games/zh-Hans/factory/buildings/winder-1/

公开页面没有逐格说明端口位置。当前端口布局采用参考工具可审计配置：精炼炉/配件机为左侧 3 入、右侧 3 出；装备原件机为左侧 6 入、右侧 6 出；分流器为 1 入 3 出，汇流器为 3 入 1 出；仓库存货口为 `1×3` 且中格输入。这些属于规划器兼容配置，不标记为官方端口数据：

- https://github.com/eddy3721/arknights-endfield-bp-tool/blob/main/src/config/machines.ts

同一参考配置记录塑形机 `3×3`、灌装机 `4×6`、反应池 `5×5`。官方简中资料可核实“塑形机”（不是“塑型机”）、“灌装机”、“反应池”、“水泵”、“物流桥”、“管道桥”、“管道分流器”和“管道汇流器”这些名称，并确认分流器为 1 入至多 3 出、汇流器为至多 3 入 1 出、桥让两条同类线路正交通过而互不干扰：

- https://endfield.wiki.gg/wiki/Moulding_Unit
- https://endfield.wiki.gg/wiki/Filling_Unit
- https://endfield.wiki.gg/wiki/Reactor_Crucible
- https://endfield.wiki.gg/wiki/Fluid_Pump
- https://endfield.wiki.gg/wiki/Belt_Bridge
- https://endfield.wiki.gg/wiki/Pipe_Bridge
- https://endfield.wiki.gg/wiki/Pipe_Splitter
- https://endfield.wiki.gg/wiki/Pipe_Converger

公开页面仍未给出灌装机和反应池的逐格固体/流体端口细分。当前实现暂定灌装机左侧为固体输入、底侧为管道输入、右侧为固体输出；反应池左侧保留一条固体输入和一条管道输入，右侧两条为管道输出。该字段标为“待用户实机校正”，不得视为官方数据。

## 简体中文命名

设备目录优先采用简体中文资料中的游戏内名称。当前使用：`精炼炉`、`配件机`、`塑形机`、`灌装机`、`反应池`、`水泵`、`仓库取货口`、`供电桩`、`传送带`、`管道`。配方示例采用 `蓝铁矿 → 蓝铁块`、`蓝铁块 → 铁制零件`、`蓝铁块 ×2 → 蓝铁瓶`、`息壤 + 清水 → 液化息壤`。主要核对来源为终末地 Wiki 的简体中文工厂教程、设备页与配方模块：

- https://endfield.games/zh-Hans/tutorials/factory/
- https://endfield.games/zh-Hans/factory/buildings/furnance-1/
- https://endfield.wiki.gg/wiki/Module:Recipe/Reactor_Crucible

占地补充核对：参考 `eddy3721/arknights-endfield-bp-tool` 的 [`src/config/machines.ts`](https://github.com/eddy3721/arknights-endfield-bp-tool/blob/main/src/config/machines.ts)，仓库取货口为 `1×3`，单个输出端口位于中间格；本项目按相同占地与旋转规则实现。传送带额定带宽 `30/min`、蓝铁块冶炼 `2s` 与配件机 `2s/个` 按用户提供的当前游戏数据记录。

仓库取货口首批固体物品清单包含 `蓝铁矿`、`紫晶矿`、`赤铜矿`、`蓝铁块`、`铁制零件`、`蓝铁粉末`、`紫晶纤维`、`紫晶零件`、`钢块`。简体中文名称和“矿物/工业产物”分类依据公开物品图鉴与配方页核对：

- https://endfield.games/zh-Hans/items/
- https://end.wiki/zh-Hans/factory/recipes/
- https://wiki.biligame.com/zmd/物品图鉴

其中新增的赤铜矿、紫晶矿、蓝铁粉末、紫晶纤维、紫晶零件、钢块、晶体外壳、紫晶装备原件、蓝铁瓶、清水、息壤和液化息壤图标为项目自制 SVG，并非游戏原图标。装备原件机、塑形机、灌装机、反应池、水泵及新增物流部件同样使用项目自制蓝图风格 SVG。

其他设备在来源未核实前仍按占位数据处理，并在 UI/数据层标明可信度。

## 设备目录分类

设备筛选采用公开设备目录的简体中文分类：`全部`、`资源开采`、`仓储存取`、`基础生产`、`合成制造`、`电力供应`、`功能设备`、`战斗辅助`、`种植调配`。来源：

- https://endfield.games/zh-Hans/factory/buildings/

当前已实现设备只分配到有数据支持的分类；尚无设备的分类保留空态，避免把未实现设施误标成其他类型。

## 传送带时序

公开资料和游戏内社区复核一致支持传送带 `30/min`，即每条线路 2 秒 1 件。公开教程说明端口连接和传送带用途，但没有给出“每格移动耗时”这一独立空间参数：

当前容量模型按用户提供的游戏行为实现：每个传送带格最多容纳 1 件物品。线路只需连接设备输出口即可接收物品；若没有有效输入端或目标库存已满，货物会停在末端并逐格向上游堆积，直到线路格数全部占满。

- https://endfield.games/en/tutorials/factory/?t=fac-port
- https://www.reddit.com/r/ArknightsEndfield/comments/1r7qztd/tips_for_aic_building/

为避免用吞吐量冒充未公开字段，代码将两者分开：`BELT_HEADWAY_TICKS` 是已核实的 2 秒发货间隔；`BELT_CELL_TRAVEL_TICKS` 是可替换的空间模型参数。当前以一格等于一个物品间距，设为每格 2 秒，并在悬浮提示中直接显示线路格数和计算结果。获得可靠实测后只修改 `lib/belt-timing.ts`，不改库存、轮询和背压算法。

## 管道时序

官方物品和配方页面确认清水由水泵提取，反应池流体配方通常以 2 秒为周期。官方说明没有直接列出管道额定流量；当前 `120/min` 单管和 `60/min` 水泵来自多组玩家实测交叉核对，可信度低于传送带 `30/min`，因此集中保存在 `lib/belt-timing.ts` 并等待用户实机确认：

- https://endfield.wiki.gg/wiki/Clean_Water
- https://endfield.wiki.gg/wiki/Reactor_Crucible
- https://www.reddit.com/r/Endfield/comments/1ra99eb/feeding_2_pumps_to_the_same_pipe_investigation_of/

管道的吞吐、每格缓存、空间移动速度和颜色均为独立参数。当前每格缓存 4 个流体单位只用于有限队列与背压，不参与决定源设备的生产速率。
