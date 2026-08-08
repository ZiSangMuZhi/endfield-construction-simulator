# 图像资产来源登记

更新时间：2026-08-08

本项目中的《明日方舟：终末地》设备与物品图像版权归游戏权利方所有。用户已在 2026-08-08 明确确认：相关 Wiki 图像可以在本项目中再分发。本文件只登记来源与落地文件，不改变原始资产权属。

## 本轮来源

| 来源 | 用途 | 版本/页面 |
| --- | --- | --- |
| 明日方舟：终末地 Wiki 设备页 | 核对官方简体名称、设备分类、暗管占地和设备说明 | <https://endfield.games/zh-Hans/factory/buildings/> |
| 明日方舟：终末地 Wiki 工业教程 | 核对扩容反应池、暗管、二型耐酸水泵、废水处理机与提纯机行为 | <https://endfield.games/zh-Hans/tutorials/factory/?t=fac-liquid-furnance> |
| `hsyhhssyy/IndustrialPlanner` | Wiki 域名在本机 DNS 无法稳定解析时，作为同源游戏缩略图与结构化设备数据镜像 | commit `9dcccc16bb7fb3856a9ffc720f38db1fd8b8f2a7` |
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
| `public/assets/machines/underground-pipe-inlet.webp` | `item_port_udpipe_loader_1.webp` |
| `public/assets/machines/underground-pipe-outlet.webp` | `item_port_udpipe_unloader_1.webp` |
| `public/assets/machines/multi-underground-pipe-inlet.webp` | `item_port_udpipe_loader_2.webp` |
| `public/assets/machines/multi-underground-pipe-outlet.webp` | `item_port_udpipe_unloader_2.webp` |
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

## 仍缺图像

- 二型耐酸水泵：当前暂时复用水泵图像，不能视为最终图。
- 高晶零件/瓶、芽针粉末、酮化树种、钢/赤铜/赫铜瓶：当前使用内容占位符。
- 后续取得 Wiki 原图时，应保留当前稳定文件名替换内容，并在本文件补充原页面或原始文件 URL。
