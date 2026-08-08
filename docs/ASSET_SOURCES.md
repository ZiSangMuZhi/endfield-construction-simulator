# 图像资产来源登记

更新时间：2026-08-08

本项目中的《明日方舟：终末地》设备与物品图像版权归游戏权利方所有。用户已在 2026-08-08 明确确认：相关 Wiki 图像可以在本项目中再分发。本文件只登记来源与落地文件，不改变原始资产权属。

## 本轮来源

| 来源 | 用途 | 版本/页面 |
| --- | --- | --- |
| 明日方舟：终末地 Wiki 设备页 | 核对官方简体名称、设备分类、暗管占地和设备说明 | <https://endfield.games/zh-Hans/factory/buildings/> |
| 明日方舟：终末地 Wiki 工业教程 | 核对扩容反应池、暗管、二型耐酸水泵、废水处理机与提纯机行为 | <https://endfield.games/zh-Hans/tutorials/factory/?t=fac-liquid-furnance> |
| `hsyhhssyy/IndustrialPlanner` | Wiki 域名在本机 DNS 无法稳定解析时，作为同源游戏缩略图、俯视设备图与结构化设备数据镜像 | commit `f0eae6b19ecb879e809a696166097d3ddef04613` |
| 用户实机截图 | 端口、占地、模式和配方证据 | `docs/assets/equipment-references/R01`～`R50` |

## 已落地设备图

以下文件由数据镜像的 `public/device-icons/` 复制并改为项目内稳定文件名：

| 项目文件 | 对应原文件 |
| --- | --- |
| `public/assets/machines/expanded-reactor.webp` | `item_port_mix_pool_2.webp` |
| `public/assets/machines/water-treatment.webp` | `item_liquid_cleaner_1.webp` |
| `public/assets/machines/purifier.webp` | `item_port_liquid_purifier_1.webp` |
| `public/assets/machines/dismantler.webp` | `item_port_dismantler_1.webp` |
| `public/assets/machines/gas-disperser.webp` | `vaporizer_1.webp` |
| `public/assets/machines/liquid-gas-converter.webp` | `transmuter_1_liquidtrans.webp` |
| `public/assets/machines/liquid-gas-converter-gas.webp` | `transmuter_1_gastrans.webp` |
| `public/assets/machines/solid-gas-converter.webp` | `transmuter_2_solidtrans.webp` |
| `public/assets/machines/solid-gas-converter-gas.webp` | `transmuter_2_gastrans.webp` |
| `public/assets/machines/gas-reactor.webp` | `item_port_gas_reactor_1.webp` |
| `public/assets/machines/molder-gas.webp` | `shaper_1_gas.webp` |
| `public/assets/machines/purifier-gas.webp` | `liquid_purifier_1_gas.webp` |
| `public/assets/machines/underground-pipe-inlet.webp` | `3d-top-view/sprites/item_port_udpipe_loader_1.webp` |
| `public/assets/machines/underground-pipe-outlet.webp` | `3d-top-view/sprites/item_port_udpipe_unloader_1.webp` |
| `public/assets/machines/multi-underground-pipe-inlet.webp` | `3d-top-view/sprites/item_port_udpipe_loader_2.webp` |
| `public/assets/machines/multi-underground-pipe-outlet.webp` | `3d-top-view/sprites/item_port_udpipe_unloader_2.webp` |
| `public/assets/machines/protocol-stash.webp` | `3d-top-view/sprites/item_port_storager_1.webp` |
| `public/assets/machines/water-pump.webp` | `3d-top-view/sprites/item_port_water_pump_1.webp` |
| `public/assets/machines/item-limiter.webp` | `item_log_admission.webp` |
| `public/assets/machines/pipe-limiter.webp` | `item_pipe_admission.webp` |

## 已落地物品图

本轮复制的物品文件保持数据镜像原始文件名，以便通过稳定物品 ID 审计来源：

- 碳链：`item_carbon_*`
- 柑实链：`item_plant_moss_2.webp`、`item_plant_moss_powder_2.webp`、`item_plant_moss_enr_powder_2.webp`、`item_plant_moss_seed_2.webp`
- 气体链：`item_gas_*`
- 赤铜耐压罐及灌装产物：`item_copper_jar.webp`、`item_gasjar_copper_*`
- 武陵液体链：`item_liquid_plant_grass_2.webp`、`item_liquid_xiranite_enr.webp`
- 高阶材料：`item_copper_enr2*.webp`、`item_iron_enr_cmpt.webp`、`item_quartz_enr*.webp`

2026-08-08 第二批把用户配方截图中能明确识别、且镜像有稳定物品 ID 的 41 项游戏原图落地为项目语义文件名。包括赤铜矿/赤铜块、清水/污水、荞愈胶囊、蓝铁/高晶/息壤/赤铜/赫铜装备原件、密制晶体链、高晶零件与瓶体、芽针与种子、酮化树种、钢/赤铜/赫铜瓶、沉积酸、赤铜/赫铜溶液及壤晶废液链。源文件均位于该提交的 `public/item-icons/`；具体项目文件与原始 ID 可用文件哈希复核，名称映射同时保存在 `app/planner-client.tsx` 的 `INDUSTRIAL_ITEMS` 中。

其中用户的 R04、R05、R28、R29、R31、R32 截图用于交叉核对图形和中文名称；程序中使用的是镜像内独立 WebP 原图，不是从截图裁切的图片。

## 仍缺图像

- 二型耐酸水泵：当前暂时复用本轮更新后的高清水泵俯视图，不能视为其最终模式图。
- 其余条目若仍没有可审计的独立原图，继续显示具名内容占位符；不得用相似设备或物品冒充。
- 后续取得 Wiki 原图时，应保留当前稳定文件名替换内容，并在本文件补充原页面、原始文件 URL 或镜像提交。
