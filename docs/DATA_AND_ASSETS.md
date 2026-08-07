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

Alpha 版使用文字与 CSS 几何符号作为临时图标，避免让占位素材混入正式资产。后续若用户提供合法导出的个人素材包，可通过映射表替换。

## 已核实设备占地

2026-08-07 依据 END Wiki 的 Placement 字段，精炼设备与装配设备均为 `3 × 3 × 4`，规划器取前两维作为地面占地 `3 × 3`。来源：

- https://endfield.games/en/factory/buildings/furnance-1/
- https://endfield.games/en/factory/buildings/component-mc-1/

## 简体中文命名

设备目录优先采用简体中文资料中的游戏内名称。当前已核对：`精炼炉`、`配件机`、`仓库取货口`、`储液罐`、`传送带`、`管道`。配方示例采用 `蓝铁矿 → 蓝铁块` 与 `蓝铁块 → 铁制零件`。主要核对来源为终末地 Wiki 的简体中文工厂教程与设备页：

- https://endfield.games/zh-Hans/tutorials/factory/
- https://endfield.games/zh-Hans/factory/buildings/furnance-1/

占地补充核对：参考 `eddy3721/arknights-endfield-bp-tool` 的 [`src/config/machines.ts`](https://github.com/eddy3721/arknights-endfield-bp-tool/blob/main/src/config/machines.ts)，仓库取货口为 `1×3`，单个输出端口位于中间格；本项目按相同占地与旋转规则实现。传送带额定带宽按用户提供的当前游戏数据记为 `30/min`。

其他设备在来源未核实前仍按占位数据处理，并在 UI/数据层标明可信度。
