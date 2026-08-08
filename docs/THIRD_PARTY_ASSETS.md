# 第三方代码与素材登记

## eddy3721/arknights-endfield-bp-tool

- 来源：https://github.com/eddy3721/arknights-endfield-bp-tool
- 获取日期：2026-08-07
- 许可：MIT（仓库代码）；版权声明保留为 `Copyright (c) 2024 Eddy`。
- 本项目参考内容：`E` 切换连线模式、单击添加锚点、预览线与右键取消的编辑流程；A* 避障思路；设备输入/输出端口数组；3×3 生产设备和独立物流层的视觉组织。本项目按用户要求改为 `E` / `Esc` 完成，并保留完整端口握手后才运输的独立模拟规则。
- 复用素材：设备图 `refinery`、`assembler`、`supply-pole`、`warehouse-pickup-port`、`warehouse-storage-port`、`splitter`、`merger`、`logistics-bridge`、`molder`、`component-assembler`、`filler`、`reactor`、`crusher`、`sealer`、`grinder`、`seedHarvester`、`planter`、`tian-you-hong-furnace` 的重命名副本；物品图标 0、7、33、38、40、43、44、45、46、50、51、52、53、54、57、60、61、62、64、71、73、77、79、82、83、85、112、118、119、120、124、125、127、131 的重命名副本。当前素材基于仓库提交 `9ced75bb6fea3bb4707e9797cebc412a15fa7ecd` 登记。

上述图片属于游戏相关素材，其游戏相关图像与商标权归原权利人所有。这里只用于非商业的玩家规划工具；若无法继续确认分发许可，应替换为项目自制图标。

## 项目自制物品图

- `public/assets/items/qiao-capsule-generated.webp`：2026-08-07 使用内置图像生成工具制作，表示荞愈胶囊；原始生成图使用纯色键背景，去背后缩放为 256×256 透明 WebP。
- `public/assets/items/red-copper-block-generated.webp`：2026-08-07 使用内置图像生成工具制作，表示赤铜块；原始生成图使用纯色键背景，去背后缩放为 256×256 透明 WebP。
- 两枚图仅作为历史占位素材保留，不声称为游戏官方图标，文件名保留 `generated` 标记。2026-08-08 起运行时已改用 `qiao-capsule.webp` 与 `red-copper-block.webp` 游戏原图，不再引用这两枚生成图。

## hsyhhssyy/IndustrialPlanner 游戏素材镜像

- 来源：https://github.com/hsyhhssyy/IndustrialPlanner
- 获取日期：2026-08-08
- 固定版本：`f0eae6b19ecb879e809a696166097d3ddef04613`
- 本轮复用：`public/item-icons/` 中可映射到稳定物品 ID 的 41 项 WebP；`public/3d-top-view/sprites/` 中的水泵、协议储存箱和四类暗管高清俯视图。
- 用户已明确确认相关 Wiki 游戏图像可在本项目中再分发。游戏图像版权仍归原权利方所有；项目只在非商业玩家规划工具中使用。
- 完整语义文件名、用途和原文件分组见 `docs/ASSET_SOURCES.md`。

## 待补图片清单

二型耐酸水泵目前明确复用普通水泵俯视图，仍待独立正式图。其余无法映射到可审计原图的条目继续显示具名“待补图”内容占位；用户后续提供图片时，应在这里逐项登记文件、来源、许可与修改情况后再接入稳定 ID。
