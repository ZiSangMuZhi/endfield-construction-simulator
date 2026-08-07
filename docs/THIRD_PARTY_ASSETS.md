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
- 两枚图仅作为缺少可确认游戏原图时的项目占位素材，不声称为游戏官方图标，文件名保留 `generated` 标记。

## 待补图片清单

本轮没有下载、生成或复制新的设备/物品图片。拆解机、提纯机、废水处理机、紫晶质瓶（清水/污水/锦草溶液）、赤铜粉末、壤晶、赫铜块、壤晶废液、惰性壤晶废液、沉积酸、赤铜溶液和赫铜溶液的数据记录暂不设置 `image`，由界面显示具名“待补图”内容占位。用户后续提供图片时，应在这里逐项登记文件、来源、许可与修改情况后再接入稳定 ID。
