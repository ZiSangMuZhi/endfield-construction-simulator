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

## 简体中文命名

设备目录优先采用简体中文资料中的游戏内名称。当前固体生产链使用：`精炼炉`、`配件机`、`仓库取货口`、`供电桩`、`传送带`。配方示例采用 `蓝铁矿 → 蓝铁块` 与 `蓝铁块 → 铁制零件`。主要核对来源为终末地 Wiki 的简体中文工厂教程与设备页：

- https://endfield.games/zh-Hans/tutorials/factory/
- https://endfield.games/zh-Hans/factory/buildings/furnance-1/

占地补充核对：参考 `eddy3721/arknights-endfield-bp-tool` 的 [`src/config/machines.ts`](https://github.com/eddy3721/arknights-endfield-bp-tool/blob/main/src/config/machines.ts)，仓库取货口为 `1×3`，单个输出端口位于中间格；本项目按相同占地与旋转规则实现。传送带额定带宽 `30/min` 与蓝铁块冶炼 `2s` 按用户提供的当前游戏数据记录。

仓库取货口首批固体物品清单包含 `蓝铁矿`、`紫晶矿`、`赤铜矿`、`蓝铁块`、`铁制零件`、`蓝铁粉末`、`紫晶纤维`、`紫晶零件`、`钢块`。简体中文名称和“矿物/工业产物”分类依据公开物品图鉴与配方页核对：

- https://endfield.games/zh-Hans/items/
- https://end.wiki/zh-Hans/factory/recipes/
- https://wiki.biligame.com/zmd/物品图鉴

其中新增的赤铜矿、紫晶矿、蓝铁粉末、紫晶纤维、紫晶零件、钢块、晶体外壳与紫晶装备原件图标为项目自制 SVG，并非游戏原图标。装备原件机、仓库存货口、分流器与汇流器在没有可登记游戏图标时同样使用项目自制蓝图风格 SVG。

其他设备在来源未核实前仍按占位数据处理，并在 UI/数据层标明可信度。

## 设备目录分类

设备筛选采用公开设备目录的简体中文分类：`全部`、`资源开采`、`仓储存取`、`基础生产`、`合成制造`、`电力供应`、`功能设备`、`战斗辅助`、`种植调配`。来源：

- https://endfield.games/zh-Hans/factory/buildings/

当前已实现设备只分配到有数据支持的分类；尚无设备的分类保留空态，避免把未实现设施误标成其他类型。

## 传送带时序

公开资料和游戏内社区复核一致支持传送带 `30/min`，即每条线路 2 秒 1 件。公开教程说明端口连接和传送带用途，但没有给出“每格移动耗时”这一独立空间参数：

- https://endfield.games/en/tutorials/factory/?t=fac-port
- https://www.reddit.com/r/ArknightsEndfield/comments/1r7qztd/tips_for_aic_building/

为避免用吞吐量冒充未公开字段，代码将两者分开：`BELT_HEADWAY_TICKS` 是已核实的 2 秒发货间隔；`BELT_CELL_TRAVEL_TICKS` 是可替换的空间模型参数。当前以一格等于一个物品间距，设为每格 2 秒，并在悬浮提示中直接显示线路格数和计算结果。获得可靠实测后只修改 `lib/belt-timing.ts`，不改库存、轮询和背压算法。
