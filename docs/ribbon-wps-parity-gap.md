# Ribbon 与 WPS 菜单结构对齐差距清单（Q19 交付物）

> 目标（用户 2026-09-10 裁定）：布局要分析 WPS 的菜单结构保持一致、大小一致；最后总结出哪些
> 菜单没有对上，后期一个个实现并对齐。本文就是那份清单的 v1 骨架——随逐 tab schema 化施工
> 持续回填，参照 `docs/wps-parity-playbook.md` 的逐项清单传统。
>
> 数据源（全部可脚本复跑）：
> - WPS 侧：`docs/wps-ribbon-reference/_layouts/<组件>/tab布局_ongmani/CT_*.kuip`（明文 XML，
>   WPS 12.1.28492 实机）。解析脚本 `_scripts/inventory_kuip.py`，产物 `inventory_{wps,et,wpp,pdf}.json`
>   （tab→组→控件类别+spaceHint 分布）。
> - 我们侧：`_scripts/inventory_ours.py`（扫各 app `ribbon-group-label` 标记，按 i18n zh 词典落中文名）。
> - 注意：`docs/wps-ribbon-reference/` 整目录保持 untracked（金山资产红线），本文只引用事实。

## 1. WPS 侧总量（解析实测）

| 组件 | tab 数 | 组引用数 | spaceHint 分布（组内控件） |
|---|---|---|---|
| wps 文字 | 45 | 315 | suitable×100、compact×17、autocompact×8、topsuitable×2、loose×2 |
| et 表格 | 36 | 226 | suitable×66、loose×6、compact×5、autocompact×8、**autoconsize×1（野值）** |
| wpp 演示 | 39 | 229 | suitable×82、autocompact×10、compact×9、**selfadaption×1（野值）** |
| pdf PDF | 33 | 261 | suitable×6 |

语义档案（引擎 B3 的规格依据）：5 档之外实存两个野值 `autoconsize`/`selfadaption`
（各仅 1 处，按最近似档 compact/suitable 归档即可）；`dynamicSpaceHint="suitable;compact"`
（随容器宽度切换档位）与 `singlerowmergegroup`（并单行合并组名）在 et/wpp 大量出现——
M2 引擎要支持"档位区间"语义而不是单值。

## 2. tab 级对照总表

图例：✅ 已有且结构对上 ｜ 🟡 部分对上（有 tab 但组/功能不全）｜ ❌ 我们缺失 ｜ ➖ 裁定不做（产品边界）
「上下文」= 选中对象才出现的上下文 tab。

### 2.1 文字 docs ↔ wps 文字（45 tabs）

| WPS tab | 我们 | 状态 | 备注 |
|---|---|---|---|
| File 文件 | 文件（win） | ✅ | mac 走原生菜单，两边一致 |
| Home 开始 | 开始 | 🟡 | 组级深比对见 §3 |
| Insert 插入 | 插入 | 🟡 | 我们 8 组：页面/表格/插图/文本/链接/批注/页眉和页脚/符号；WPS 8 组：Pages/Common Object/Symbol/Comment/Links/Component/Media/More Object——组形似但内容互有缺失（见骨架勾选） |
| PageLayout 页面布局 | 页面（=设计+布局合并） | 🟡 | 我们合并了 Word 的 Design+Layout；WPS 本就只有 PageLayout——**合并是否解散回 WPS 原样待裁定**（默认维持合并） |
| References 引用 | 引用 | 🟡 | 我们 3 组（目录/脚注/引文与索引），WPS 另有书签/题注/交叉引用等组 |
| Review 审阅 | 审阅 | 🟡 | 我们 7 组（校对/语言/批注/修订/比较/简繁转换/保护）；WPS 另有 WPSProofread（AI 校对）独立 tab |
| View 视图 | 视图 | 🟡 | 我们 5 组（视图/缩放/外观/显示/窗口）；WPS 6 组另含护眼/比较 |
| DrawingTools/InkDraw/InkTools 绘图 | 绘制 | 🟡 | WPS 拆 3 个 tab；我们 1 个（选择/绘图工具/清除 3 组） |
| TableTools 表格工具（上下文） | 表格设计+表格布局（上下文×2） | 🟡 | WPS 单 tab 7 组；我们拆两 tab——**M1 校验场按 WPS 单 tab 7 组规格还原时需裁定是否合并回单 tab**（Q15 建议按 WPS 原样） |
| PictureTools 图片工具（上下文） | 图片工具（上下文） | ✅ | 组级比对待 schema 化时回填 |
| GraphicTool 形状工具（上下文） | 形状工具（上下文） | 🟡 | 我们 3 组（形状样式/文本/排列+调整/大小）；WPS 组更多 |
| HeaderFooter 页眉页脚（上下文） | ➖（并入插入+页面） | 🟡 | WPS 独立上下文 tab；我们暂并入两处 |
| Outline 大纲 | ❌ | | 大纲视图专用 tab |
| EquationTools 公式工具（上下文） | ❌ | | docs 无公式编辑器 |
| ChartTools 图表工具（上下文） | ❌ | | docs 无图表功能 |
| SmartArtDesign/SmartArtFormatTool | ❌ | | 无 SmartArt |
| WordArt 艺术字（上下文） | ❌ | | 无艺术字对象 |
| Security 安全 | ❌ | | 密码/权限保护（审阅·保护组覆盖部分） |
| Tools 工具 | ❌ | | 选项/宏类入口 |
| WorkSpace 工作空间 | ❌ | | 协同/云文档（我们另线） |
| Mailings 邮件 | ❌ | | 邮件合并 |
| OfdPreview / Print2022 / Official* ×6 / StudentTools / PremiumServices / AddOns | ➖ | | 国产版式/公文模式/会员/学生/特色应用——产品边界，裁定不做（后期可单列） |
| TextTool 文本工具（上下文） | ➖ | | 文本框上下文（我们形状工具内含文本组） |
| DevelopTools 开发工具 | ➖ | | 二次开发启用后按 M3 另议 |

### 2.2 表格 sheets ↔ et 表格（36 tabs）

| WPS tab | 我们 | 状态 | 备注 |
|---|---|---|---|
| File 文件 | 文件（win） | ✅ | |
| Home 开始 | 开始 | ✅ | 近四轮（d7a7007b/fe05074a 等）已深度对齐：转换富菜单/条件格式全量/表格样式 20 款/单元格样式五组/数据处理组；**组级比对在 sheets schema 化时回填** |
| Insert 插入 | 插入 | 🟡 | |
| Layout 页面布局 | 页面布局 | 🟡 | |
| Formulas 公式 | 公式 | 🟡 | |
| Data 数据 | 数据 | 🟡 | |
| Review 审阅 | 审阅 | 🟡 | |
| View 视图 | 视图 | 🟡 | |
| ChartTools 图表工具（上下文） | 图表工具（上下文） | ✅ | ChartDataDialog/图表插入闭环已有 |
| PictureTool 图片工具（上下文） | 图片工具（上下文） | ✅ | 门禁修复+图片工具 tab 已落（c05fd93 系） |
| TableTool 表格工具（上下文） | ❌ | | 超级表/透视表上下文 |
| SparklineTools 迷你图（上下文） | ❌ | | 无迷你图功能 |
| PivotTableDesign / PivotTableOptions / SlicerOptions / AutoFilterTools（上下文） | ❌ | | 透视表/切片器/筛选视图未建 |
| Design（表格设计，上下文） | ❌ | | 超级表设计 |
| DrawingTools / EquationTools / WordArt / TextTool（上下文） | ➖/❌ | | 形状/公式/艺术字未建 |
| Security / Tools / WorkSpace / DevelopTools | ➖ | | 同 docs 裁定 |
| SmartArt×2 / StudentTools / PremiumServices / AddOns / Print2022 / WAshadow 等 | ➖ | | 产品边界 |

### 2.3 演示 slides ↔ wpp 演示（39 tabs）

| WPS tab | 我们 | 状态 | 备注 |
|---|---|---|---|
| File 文件 | 文件（win） | ✅ | |
| Home 开始 | 开始 | 🟡 | 我们组最全（剪贴板/字体/段落/绘图/形状/排列/调整/编辑/幻灯片等 30+ 组），组级回填待 schema 化 |
| Insert 插入 | 插入 | 🟡 | |
| DrawingTool 绘图 | 绘图 | 🟡 | |
| Design 设计 | 设计 | 🟡 | 主题/变体/页面设置组已有（themes/背景/大小键可见） |
| SlideTrans 切换 | 切换 | ✅ | 动画 36+变体七轮已落（2346ca3 系） |
| Animation 动画 | 动画 | ✅ | 同上 |
| SlideShow 放映 | 放映 | 🟡 | |
| Review 审阅 | 审阅 | 🟡 | |
| View 视图 | 视图 | 🟡 | |
| TableTool / PictureTool / ChartTools / GraphicTool / EquationTools / WordArt / SmartArt×2 / OrgChart / AudioTool / VideoTool（上下文） | 部分 ❌ | 🟡 | 我们有形状/图片/表格/图表上下文；音频/视频/艺术字/SmartArt/组织结构图未建 |
| SlideMaster / HandoutMaster / NotesMaster 母版三件 | ❌ | | 母版编辑未建 |
| InkDraw / InkTools / DrawingTool_Vml 等 | ➖ | | 墨迹 |
| Security / Tool(s) / WorkSpace / StudentTools / PremiumServices / AddOns / Print2022 等 | ➖ | | 产品边界 |

## 3. 组级深比对·第一场：docs 开始 tab（WPS CT_Home）

WPS Writer CT_Home 组序（inventory_wps.json 实测）：
`Official Templates → Official Material → Clipboard → Font → Official Font → Paragraph →
Official Paragraph → Styles → Find → Typography → RB_ProfessionalMode → Settings →
Document Settings → Smart Official → RB_AIAssistant → RB_OfficialModeEntry`

去掉公文模式条件组（Official*/Professional/Smart Official 等，filterFlag 控制显示）后的
**常态组序 = Clipboard / Font / Paragraph / Styles / Find(+Typography) / Settings**。

| WPS 组 | 我们（home-tab.tsx） | 状态 | 动作 |
|---|---|---|---|
| Clipboard 剪贴板 | 剪贴板 | ✅ | 粘贴大钮+子菜单/剪切/复制/格式刷——控件级比对 schema 化时回填 |
| Font 字体 | 字体 | 🟡 | WPS 字体框 minimumWidth=151/字号框 fixedWidth=60（硬规格，M1 落 token）；B/I/U/上标下标/突出显示/字符底纹/拼音指南/更改大小写/字符边框等控件逐个比对 |
| Paragraph 段落 | 段落 | 🟡 | 项目符号/编号/多级列表三画廊、缩进、行距、对齐、边框底纹、显示隐藏编辑标记等 |
| Styles 样式 | 样式 | 🟡 | 我们 STYLE_GALLERY 7 预设+字符样式；WPS 样式集/更多样式入口待补 |
| Find 查找（编辑组） | ❌（查找在视图/AI 线） | ❌ | **开始 tab 缺「查找/替换/选择」编辑组**——补组（命令已有，纯搬迁） |
| Typography 中文版式 | ❌ | ❌ | 中文版式（拼音/带圈字符…）部分在字体菜单——归并策略待裁定 |
| Settings/Document Settings | ❌ | ❌ | WPS 文档设置入口（我们设置在 shell 层）——➖ 维持现状概率高 |

**结论（docs 开始 tab）**：结构差 ≈1.5 个组（查找编辑组缺口明确；中文版式/设置待裁定）；
控件级差异在逐组 schema 化时按本表勾选回填。

## 4. 施工骨架（逐 tab schema 化时回填勾选）

- [ ] docs 开始（校验场前置：M1 规格 token 先行）→ 回填控件级比对
- [ ] docs 表格工具（Q15 校验场，按 WPS 7 组原样：属性/字体/行和列/合并/对齐方式/调整/数据）
- [ ] docs 视图（DOCS_SCHEMA 已全声明——首个真实受益自适应的 tab）
- [ ] docs 插入/引用/审阅/绘制/页面（renderBody → schema 化逐个换装）
- [ ] sheets 开始（结构已近对齐，schema 化时把 spaceHint 标注按 §1 档位语义落）
- [ ] sheets 其余 7 tab
- [ ] slides 开始/插入（平行副本合并最大收益点）
- [ ] slides 切换/动画（已有 36+变体，纯搬迁+标注）
- [ ] 每完成一个 tab：本文档对应行打勾 + 把「未对上控件」逐条转 `wps-parity-playbook.md`

## 5. 裁定遗留（本次未决，随施工确认）

1. docs「页面」合并 tab 是否解散回 WPS 原样（默认维持合并，见 §2.1）；
2. docs 表格上下文两 tab 是否按 WPS 合并为单 tab 校验场（Q15 建议：按原样单 tab 还原）；
3. 中文版式组归并策略（并入字体菜单 vs 独立组）；
4. et 组名 caption 刻意隐藏（ExcelShell 6840「No visible group captions」）与 WPS 组名常显相悖——schema 化时统一为常显（Q16 组名行依赖）。

## 6. 像素级对比（playground 自测 vs WPS 实测，2026-09-11）

自测配方：`packages/ribbon/playground/`（12 kind 全渲染 + 5 组样例 schema），esbuild 打包 →
静态服务 → 无头 Chrome `--headless --screenshot --virtual-time-budget=5000` 多宽度截图 →
PIL 剖析（组分隔线检测/控件簇/体带高度）。**WPS 视觉规则实证：控件无边框、无毛边，
唯一的线是组分隔浅灰竖线**（wps-word/1.png 实测：全条带仅组间灰线，控件idle态零描边）——
controls.css 已按此重写（border:none + hover 平涂，面板类下拉除外）。

| 指标 | WPS（wps-word/1.png 实测 @2x） | 我们（playground 实测） | 结论 |
|---|---|---|---|
| 体带高度（内容+组名行） | ~74 内容 + 组名行 ≈ 84-90 | 84（含 14px 组名行） | ✅ 对齐 |
| 大钮（粘贴类）高度 | 42 逻辑 px | 40 | ✅ ±2 抗锯齿内 |
| 大钮布局 | 粘贴=图标左文字右（117 宽水平大钮） | icon-over-label 垂直 | 🟡 M1 控件规格项：big 变体需补水平布局形态 |
| 组分隔线 | 组间浅灰竖线，仅此有线 | 1px `--rb-sep` 仅组间（全宽态实测仅 4 条） | ✅ 对齐 |
| 控件 idle 边框 | 无（干净） | 无（controls.css 重写后） | ✅ 对齐 |
| 降级阶梯 | spaceHint 连续降级→并单行→组名收拢 | 全显 ≥800 → 隐文字（窗口窄段）→ 右起收拢（≤780 全段，darkpx 364/335/289 随宽度自适应，无振荡） | ✅ 引擎生效；merge-row 待实现 |

宽度扫描记录（体带 h / 内容暗像素）：880-800: 84/485（全显）｜780: 51/364｜760-620: 51/335｜
560: 51/289——收拢数随可用宽度递增，回退滞回工作正常。

**M1 新增规格项（从本次对比发现）**：big 变体水平形态（图标左文字右，粘贴/对齐类专用）——
schema 或需 `bigLayout?: 'vertical' | 'horizontal'`，施工时随校验场裁定。
