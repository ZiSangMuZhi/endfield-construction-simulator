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

## 简体中文命名

设备目录优先采用简体中文资料中的游戏内名称。当前固体生产链使用：`精炼炉`、`配件机`、`仓库取货口`、`供电桩`、`传送带`。配方示例采用 `蓝铁矿 → 蓝铁块` 与 `蓝铁块 → 铁制零件`。主要核对来源为终末地 Wiki 的简体中文工厂教程与设备页：

- https://endfield.games/zh-Hans/tutorials/factory/
- https://endfield.games/zh-Hans/factory/buildings/furnance-1/

占地补充核对：参考 `eddy3721/arknights-endfield-bp-tool` 的 [`src/config/machines.ts`](https://github.com/eddy3721/arknights-endfield-bp-tool/blob/main/src/config/machines.ts)，仓库取货口为 `1×3`，单个输出端口位于中间格；本项目按相同占地与旋转规则实现。传送带额定带宽按用户提供的当前游戏数据记为 `30/min`。

仓库取货口首批固体物品清单包含 `蓝铁矿`、`紫晶矿`、`赤铜矿`、`蓝铁块`、`铁制零件`、`蓝铁粉末`、`紫晶纤维`、`紫晶零件`、`钢块`。简体中文名称和“矿物/工业产物”分类依据公开物品图鉴与配方页核对：

- https://endfield.games/zh-Hans/items/
- https://end.wiki/zh-Hans/factory/recipes/
- https://wiki.biligame.com/zmd/物品图鉴

其中新增的赤铜矿、紫晶矿、蓝铁粉末、紫晶纤维、紫晶零件与钢块图标为项目自制 SVG，并非游戏原图标。

其他设备在来源未核实前仍按占位数据处理，并在 UI/数据层标明可信度。
