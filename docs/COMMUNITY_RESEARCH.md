# 社区资料核对记录（2026-08-07）

本文件记录论坛攻略、玩家实测和第三方数据库如何进入模拟器。社区资料可以补足公开教程没有列出的吞吐与运行行为，但单个帖子不作为最终数值来源。

## 证据等级

- `A`：至少一个结构化资料页或游戏教程，与一个独立攻略/玩家实测一致；可进入模拟。
- `B`：多个社区来源一致，但缺少独立结构化字段；可记录为可替换参数，并在界面/文档中标出来源边界。
- `C`：只确认设备或功能存在，关键占地、功率、端口或周期缺失/冲突；只记录，不进入模拟。

## 本轮结论

| 项目 | 资料页 / 数据库 | 社区交叉核对 | 等级 | 实现决定 |
| --- | --- | --- | --- | --- |
| 废水处理机占地 | Game8 记录 `3×3` | 玩家蓝图显示为 3 格级加工设施 | A | 录入 `3×3` |
| 废水处理机功率 | Endfield Factory Calculator 记录 50 | Reddit 玩家直接讨论 50 功率；另有 6 台替换后节省 300 功率的产线记录 | A | 录入 50 |
| 污水处理结果 | GameWith 明确处理后完全消失、无水和残渣 | 多个 Reddit 讨论将它称为纯废水销毁设施 | A | 允许 `outputs: []` 的终点配方 |
| 污水吞吐 | 设备说明确认可处理污水，但未列周期 | Reddit 产线记录 `180/min` 对应 6 台；折算单台 `30/min` | A | 污水 ×1 / 2s |
| 壤晶废液 / 惰性壤晶废液 | Game8 确认可处理但效率较低 | 未找到当前版本的独立精确周期 | C | 不开放对应配方，避免把“低效率”误写成 2s |
| 管道吞吐 / 水泵 | 设备与配方资料确认管道、水泵用途 | Reddit 蓝图记录单管 2/s、单泵 1/s | B | 暂保留管道 120/min、水泵 60/min，集中为可替换常量 |
| 传送带与初始出货口 | 设备教程确认传送带用途 | 森空岛量化攻略记录每 2 秒 1 件，即 30/min；另一篇配平攻略独立使用相同值 | A | 保持 30/min，并继续把发货间隔与空间移动分离 |
| 装备原件机六配方 | 两个结构化中文设备页列出相同输入、输出和 10s 周期 | 森空岛息壤产线实测确认 6/min，且息壤消耗 60/min | A | 补齐六种装备原件配方；缺图物品使用内容占位 |
| 缺料生产行为 | 配方页提供整数批次投料 | 森空岛对照实测显示物料不足会空过生产机会 | A | 保持“整批输入满足后推进周期”，不按连续平均流量凭空补料 |
| 协议储存箱 | 教程确认通电后定时回传仓库，也可接传送带 | 尚缺容量、回传间隔、占地与逐格端口 | C | 暂不加入可放置目录，防止伪造吞吐与占地 |
| 扩容反应池 | 教程和设备页确认更多反应缓存、可同时进行多个反应 | 玩家讨论同样涉及多个活动配方及独立堵塞行为 | C | 暂缓；先设计多配方槽状态机，不以普通反应池复制品代替 |

## 来源

- 废水处理机占地与可处理介质：https://game8.co/games/Arknights-Endfield/archives/588810
- 工厂功率表：https://www.endfieldcalculator.com/factory-calculator
- 污水处理后无返还物：https://gamewith.net/akendfield/73756
- 50 功率玩家复核：https://www.reddit.com/r/Endfield/comments/1rxtcgf/man_i_dont_wanna_spend_50_power_on_water/
- `180/min` 与 6 台处理机记录：https://www.reddit.com/r/Endfield/comments/1tnvq93/was_the_new_purification_facility_worth_it/
- 管道 2/s、水泵 1/s 蓝图讨论：https://www.reddit.com/r/Endfield/comments/1ru8c9j/blueprint_cuprium/
- 森空岛出货速度转载：https://www.gamersky.com/handbook/202601/2081425.shtml
- 森空岛产量配平转载：https://www.gamersky.com/handbook/202601/2080925.shtml
- 森空岛缺料效率实测转载：https://www.gamersky.com/handbook/202601/2080410.shtml
- 装备原件机结构化配方：https://endfield.games/zh-Hans/factory/buildings/winder-1/
- 装备原件机第二份中文配方表：https://www.gamewolf.tw/endfield/article/facility-29
- 森空岛息壤装备原件产线转载：https://www.gamersky.com/handbook/202601/2082367.shtml
- 协议储存箱功能说明：https://endfield.games/zh-Hans/tutorials/factory/?t=fac-liquid-furnance
- 扩容反应池功能说明：https://endfield.games/en/tutorials/factory/?t=fac-port
- 扩容反应池配方页：https://end.wiki/zh-Hans/factory/buildings/mix-pool-2/

## 暂缓项

扩容反应池不是“多一条配方的普通设备”。它需要每个设备实体持有多个独立的活动配方、进度、输入争用与堵塞状态；在占地、功率、槽数和端口布局核实前直接加入会使产出计算失真。后续优先从实机设备面板、蓝图截图或可审计数据表补齐这些字段，再实现多槽调度。

污水之外的两种废液也不使用旧测试服的 6 秒数据。旧模块与当前玩家吞吐存在版本差异，除非能找到当前版本实测或设备面板数值，否则继续保持未启用。
