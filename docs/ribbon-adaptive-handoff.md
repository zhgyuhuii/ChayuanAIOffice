# Ribbon 自适应改造 — 研究资料与共识交接（2026-09-10）

> **这份文档是什么**：2026-09-10 的一次深度调研 + 需求共识的完整交接。那轮工作最初误定位到
> chayuan-wps（WPS 加载项）项目，用户中途纠正：**真正的目标项目是本项目 chayuan-office**
> （自研套件，`packages/ribbon` 即自家功能区）。规范研究、WPS 资源包逆向、组件清单、图标参考
> 资产全部直接适用；少数共识是在"WPS 加载项宿主"的错误前提下做的，本文第 4 节逐条重新定位。
> 新会话请从本文出发继续分析与规划，**在达成新的共识之前不要写实现代码**（用户明确立规）。

---

## 1. 用户协作规矩（后续会话必须遵守）

1. 整体计划达成共识之前，把用户往死里问（顺着每个决定追连锁反应问到底）；
2. 每次只问**一个**问题；
3. 每个问题**必须附建议答案**；
4. 达成共识之前绝对不准偷偷写代码（调研、探针、资产提取可以）。

## 2. 目标（已达成共识的需求描述）

把 `packages/ribbon`（顶部功能区）改造成 **WPS 式自适应**：

- **范围**：仅桌面窄窗口场景（分屏半屏），不做移动端/平板（Q1=C；`mobile/MobileRibbon.tsx` 是另一条线，本方案不动它）；
- **路线**：自研引擎，组件按 ribbon 标准构造、渲染时按实测结果自适应，**不用**宿主式 autoScale 离散状态机（Q2、Q5=B）；
- **降级模型**：照抄 WPS 的**连续 spaceHint 模型**——每控件带空间提示（loose/suitable/topsuitable/compact/autocompact）+ 可隐文字，空间不足相邻组合并单行（Q5=B）；
- **终态兜底**：连续降级到极限仍放不下时，从最右组开始逐组收成组名按钮，点击弹出原布局面板（Q6=A）；
- **组件质量**：v1 控件族全量对齐 WPS；组件精细、无边框、无毛边、图标一个不多一个不少；布局规格/结构/交互态与 WPS **一比一对照**；图标**全部自绘同风格**（规格事实无版权，金山美术资产有），用 WPS 截图逐像素校准（Q10=B、Q11=A）；
- **单一事实源**：JS/JSON 组件模型；二次开发通过 **ribbon 协议（customUI 风格）声明适配层**接入，翻译进内部模型，onAction 走统一分发，动态回调只白名单 getVisible/getLabel（Q4=A、Q7=A）；
- **条形态**：默认展开（约 80px）+ 自带 ∧/∨ 收起开关（收起后约 24px 组名行，组名仍可点击弹面板），记住偏好（Q8=A）；tab 标签支持窄宽降级与条件隐藏（Q9=A）。

## 3. WPS 宿主与规范研究结论（背景事实，均已查实）

### 3.1 宿主机制（对自研套件的意义：我们自己就是宿主）

- WPS 加载项的 ribbon.xml 由**宿主**渲染，加载项无法注入 HTML 进功能区条；自研套件无此限制。
- RibbonX 规范两套易混：**Windows Ribbon Framework**（Win32 原生，SizeDefinition/ScalingPolicy/IdealSizes）≠ **Office RibbonX/CustomUI**（加载项用）。加载项能用的只有后者。
- `autoScale`（group 收缩）是 **Office 2010 引入、属于 2009/07 命名空间（customUI14）** 的属性；2006/01 旧命名空间下不合规（Office 会整文件拒载，WPS 宽松忽略）。contextMenus 同为 2010 扩展。→ 若做兼容声明格式，统一用 2009/07 命名空间。
- ribbon.xml 在 WPS Android/iOS **不存在**（移动端是另一套移动 JSAPI SDK）——对本项目无影响，仅备忘。

### 3.2 WPS 自家功能区的真实架构（本机 /Applications/wpsoffice.app 12.1.28492 实测）

WPS 自己的功能区 = **纯声明式明文 XML 资源，运行时延迟加载、引擎渲染**，分四层：

| 层 | 位置 | 内容 |
|---|---|---|
| 命令注册表 | `office6/res/<app>common.kuip` | 每命令的 id、**idMso（与 Office 同名）**、icon、文字、快捷键 |
| entry 平表 | `office6/res/<app>entries.kuip`（Writer 4187 条） | idPath → 命令名 |
| 功能区布局 | `office6/res/commands/<app>/ongmani/CT_*.kuip`（每 tab 一个文件） | tab 的 `Context` 元素（`idMso="TabHome"` 等）经 `delayloadPath` 懒加载 |
| 皮肤 | `office6/skins/*/uicontrol.kuip` | 纯样式（颜色/圆角/边框），与结构完全分离 |

**自适应就写在每个组件声明里**（这是本方案要照抄的核心）：

- `spaceHint` 实测 **5 个值**：`loose` / `suitable` / `topsuitable` / `compact` / `autocompact`（Writer 全 tab 统计：suitable×323、compact×105、autocompact×26、loose×5、topsuitable×2）；
- `canHideText="0/1"`：窄时允许隐藏文字只留图标；
- `controlType` 枚举 0~16（无需照抄数字，语义覆盖即可）；
- 布局树 `KRbLayoutListCommand`：`layoutName="vbox"`、`horizontalSpacing`、`fixedWidth`、`layoutOnly`；两行叠放 `KRbDualVLayoutListCommand`；字体块 `KFontRbLayoutListCommand`；
- **窄时并单行**：`KxSingleRowMergeGroupCommand`（多个组挤进同一行的原生实现）。

### 3.3 WPS 组件族权威清单（Writer 全部 CT_*.kuip 实测，12 族）

| # | 组件族 | WPS 证据类名 | 本项目 schema 现有 kind |
|---|---|---|---|
| 1 | 触发/开关按钮 | KxLegacyTriggerCommand ×858 | button / toggle ✓ |
| 2 | 菜单/下拉列表 | KListCommand ×361、KxListCommand、KQuickMenu、KAutoHideList | dropdown ✓ |
| 3 | 画廊（网格预览） | KxStaticGalleryItemCommand ×352、图表/项目符号/函数画廊 | gallery ✓ |
| 4 | 组合框 | KxWpsFontComboBoxCommand、FontSizeComboBox | combobox ✓ |
| 5 | 数字步进器 | KxWpsCellWidth/HeightSpinboxCommand | number ✓ |
| 6 | 取色按钮（调色板下拉） | Fill/Font/Line/More/Underline/Highlight/Snap 七类 | colorpicker ✓ |
| 7 | 复选框 | KxCheckBoxCommand | （并入 toggle/row？待核） |
| 8 | 数值命令 | KxValueCommand ×265 | — |
| 9 | 布局容器 | KRbLayoutListCommand(hbox)、DualV、FontBlock、固定宽垫片 | row / column ✓ |
| 10 | 并单行合并 | KxSingleRowMergeGroupCommand | ✗ **核心缺口** |
| 11 | 分隔符 | separator | separator ✓ |
| 12 | 代理/包装层 | KProxyCommand 等（管道非视觉件） | command/registry 层 ✓ |

### 3.4 复刻校验场：WPS 表格工具 tab（`CT_TableTools.kuip`）

7 个分组：属性(RB_Table) / 字体(RB_Table_Font) / 行和列(RB_RowsAndColumns) / 合并(RB_Merge) / 对齐方式(RB_Alignment) / 调整(RB_Adjust) / 数据(RB_Data)。含字体块组合框、行高列宽 spinbox、插行列画廊、七类取色钮——**一个 tab 覆盖 12 族里的 9 族**，按它原样还原一组即可当全规格校验场（Q10 要求）。

### 3.5 图标与资源容器格式（qres，已逆向）

- `mui/default/*.rcc` = 自研 **qres** 容器：28 字节头（`qres` + ver=2 + 5×u32）+ **顺序 zlib 流**（每流一个文件）+ 尾部 **UTF-16LE 明文名字表**。
- `prometheus_kso_res.rcc` 里有 **545 张 SVG 矢量图标（含 `*_kd` 命名，即新 UI 功能区图标）**——已全部提取。
- 经典皮肤的图标是自研原始位图格式（`01 + 3字节关键色` 头），**未破解**；自绘路线不依赖它。
- `mso_builtin_icons.rcc` = MSO 内置图标库（对齐 idMso 时有用）。

## 4. 共识 Q1–Q11 逐条重新定位（⚠️ = 原前提错误，需新会话重新确认）

| Q | 当时结论 | 在 chayuan-office 的定位 |
|---|---|---|
| Q1=C | 只做桌面窄窗口 | ✅ 直接适用（mobile 不动） |
| Q2=A+转折 | 自研引擎、按渲染结果自适应 | ✅ 适用且已有一半：`packages/ribbon` 就是自研渲染器，缺的是组级自适应 |
| Q3=A | ⚠️ 顶部停靠任务窗格 + 原生 tab 瘦身 + 停靠探针 | **全部作废**——那是 WPS 加载项宿主的前提。自研套件里功能区就是自己的 React 组件，无停靠问题。替代动作：**M0 改为审计 packages/ribbon 现状**（见第 6 节） |
| Q4=A+扩展 | JS/JSON 单一事实源 + ribbon 协议声明适配 | ✅ 适用，且与 `docs/ribbon-extensibility-plan.md`（proposal，未实施）、`src/schema/merge.ts` 的 SchemaPatch 通道天然合流 |
| Q5=B | 连续 spaceHint 模型 | ✅ 核心方案 |
| Q6=A | 终态兜底（组名收拢 + 弹面板） | ✅ 适用 |
| Q7=A | 声明适配层，动态回调白名单 | ✅ 适用 |
| Q8=A | 默认展开 80px + 收起 24px + 记偏好 | ✅ 适用（自研窗口内自由控制） |
| Q9=A | tab 微标签切换 + 条件隐藏 + 窄宽降级 | ✅ 适用（tab-strip overflow 已有部分能力） |
| Q10=B | 控件族全量对齐 WPS + 一比一规格 | ✅ 适用 |
| Q11=A | 规格/结构 1:1 + 图标自绘 + 提取 WPS 图标供参考 | ✅ 适用，资产已提取（第 5 节） |

## 5. 参考资产（已就位）

**`docs/wps-ribbon-reference/`**（从本机 WPS 12.1.28492 解包，见其 README）：

| 目录 | 内容 | 价值 |
|---|---|---|
| `_layouts/`（2026-09-10 晚增补） | **四组件完整明文布局 XML：wps 46 / et 37 / wpp 40 / pdf 34 个 tab + 各家 common/entries/ongmani 三件套（169 文件 4.6MB）**，属性速查见其 说明.md | ★★★★★ 一手规格基准：M1 规格、M2 自适应语义（spaceHint/canHideText/controlType/宽度硬规格/SingleRowMerge）、Q19 差距清单的对照面全在这里 |
| `prometheus_kso/` | 545 张 SVG 新 UI 矢量图标（**按序号命名**，`*_kd` 真名在 names.txt，**名字↔文件 join 未破**，见勘误）+ names.txt | ★★★ 自绘图标风格基准 |
| `ico/` | 73 张多尺寸 PNG | 窗口/通用图标参考 |
| `public_res/` `mso_builtin_icons/` | 92 / 3 个文件 + 名单 | 公共控件、idMso 对齐 |
| `ongmani_res/` `2016white_highdpi/` | 名字表为主（位图格式未破解） | 名单对照 |

**勘误（2026-09-10 晚，源自 ~/Desktop/WPS-icon/破解说明.md 的第二轮破解）**：
1. §3.5 称经典皮肤位图「未破解」仍成立，但 qres 容器破解已推进：**17 个 rcc 的名字表 100% 解出（~1.4 万真名、UTF-16BE 记录格式）**，树区 22 字节定长记录结构已定位（join 规则未破）；破解过程/脚本/原始 rcc 备份在 `~/Desktop/WPS-icon/`（`_originals/` 37MB 未入仓库，`_scripts/` 已同步进参考目录）。
2. 本节早前称 SVG「含 `*_kd` 命名」不准确：文件是按 blob 顺序编号的，真名只在 names.txt；**按图标名取原版图目前做不到**（Q18 图标管线开工前需先破 join 或按视觉索引）。
3. 以上已同步进 `docs/wps-ribbon-reference/`（含 `_layouts/`、破解说明.md、README.txt、`_scripts/`），该目录保持 untracked 不入 git。

⚠️ **IP 红线**：布局规格/结构/交互态可一比一对照（事实无版权）；本目录的金山美术资产**仅供肉眼参考，禁止复制进产品分发**。

另有既有资料：`docs/wps-ribbon-parity.md`（三大板块与 WPS 的功能对比，基准截图在仓库外 `~/Downloads/wps-screen/{wps-word,wps-excel,wps-ppt}`，31 张）——自绘图标的像素校准基准就是它。

## 6. 本项目现状与缺口（新会话先做 M0 审计确认）

`packages/ribbon`（React 19）已有：

- `schema/types.ts`：12 种控件 kind（button/split/dropdown/combobox/number/toggle/colorpicker/gallery/separator/custom/row/column）——与 WPS 12 族几乎一一对应；
- `command/`：命令注册表（register/override）；
- `schema/merge.ts`：**SchemaPatch 二次开发通道**（build-time 注入，含 add/remove/patch tab/group/control）；
- `schema/serialize.ts`：TS ⇄ JSON（"the ribbon file"）；
- `desktop/`：DesktopRibbon + `use-tab-strip-overflow.ts`（tab 标签溢出已处理）+ `mobile/MobileRibbon.tsx`（本方案不动）。

**待核实的缺口（M0 审计清单）**：

1. 组（group）一级有没有任何宽度自适应？猜没有或只有简单 overflow——WPS 式 spaceHint 连续降级 + 并单行 + 组名收拢兜底是本方案要新建的主体；
2. 控件有没有 `canHideText`/空间提示类字段？（schema 里 grep 到 overflow/collapse 命中极少）
3. DesktopRibbon 的排版是 flex 流还是测量驱动？降级需要"实测可用宽度→按提示降级→再测"的循环；
4. `number` kind 是否已具备 spinbox 形态（行高列宽那种）；
5. checkbox 是否需要独立 kind（WPS 有 KxCheckBoxCommand）；
6. `when.ts` 条件体系与 tab 条件隐藏的衔接。

## 7. 建议里程碑草案（供新会话讨论修订，非定稿）

- **M0 现状审计 + 差距表**：按第 6 节清单审 `packages/ribbon`；对照 `~/Downloads/wps-screen/` 截图列逐项差距；确认 12 kind ↔ 12 族映射表。
- **M1 规格一比一静态渲染**：从 kuip/皮肤提取规格事实（间距/字号/16·32 图标栅格/hover·pressed 色）落到 token；**校验场 = 按表格工具 tab 7 分组原样还原一组**（覆盖 9/12 族）；质量线：无边框、无毛边、图标不多不少。
- **M2 连续自适应引擎**：spaceHint 5 值 + canHideText 进 schema；测量驱动降级循环；并单行（SingleRowMerge 语义）；终态组名收拢 + 弹面板；条收起开关 80/24px 记偏好。
- **M3 声明适配层**：customUI 风格（2009/07 命名空间语义）声明 → SchemaPatch/内部模型翻译；onAction 统一分发；动态回调白名单 getVisible/getLabel。与 `ribbon-extensibility-plan.md` 合流。
- **M4 验收**：宽度梯度 × spaceHint 档位 × 展开/收起截图比对（WPS 同界面截图为基准）+ 无毛边巡检 + 三应用（docs/sheets/slides）回归。

## 8. 开放问题（新会话继续问下去的起点）

1. ~~用户 2026-09-10 提到"刚调整了表格编辑器的顶部菜单"——落点未找到~~ **已解**：即本仓 sheets 开始 tab 对齐 WPS 系列（2026-09-10 前后 d7a7007b/fe05074a 第四轮：转换富菜单/条件格式/表格样式/单元格样式/数据处理组），sheets 侧手写 Ribbon 持续演进中；
2. 第 4 节 ⚠️ 行（Q3 作废后的替代形态）需向用户重新确认；→ 已被 Q12 答案覆盖（见 §10）；
3. 自研套件里 parity gate 的形态（原"条功能不全不瘦身原生 tab"不再适用，改成什么验收门槛）；→ 待确认，见 §10 Q19；
4. 深色主题是否纳入 v1（WPS 有多皮肤，`uicontrol.kuip` 是参照）；→ 待确认，见 §10 Q17；
5. MobileRibbon 是否完全出范围（Q1=C 倾向是，但需用户点头）；→ Q12 选项描述含「MobileRibbon 本身不动」，用户选定即视为点头（§10）；
6. 图标自绘的生产管线（谁画、SVG 源码管理、命名对齐 `*_kd` 惯例还是另立）；→ 待确认，见 §10 Q18。

---

## 9. M0 现状审计结果（2026-09-10 下午新会话实测，比 §6 预估严峻）

| §6 待核实项 | 实测结论 |
|---|---|
| 1. 组级宽度自适应 | **没有**。`.ribbon-group { flex-shrink: 0 }`，窄窗走 `.ribbon-body` 横向滚动条；且 `.ribbon-group-label { display: none }`——组名根本不渲染，WPS 式"组名收拢兜底"的锚点缺失 |
| 2. spaceHint/canHideText | **完全没有**，schema 无空间提示概念 |
| 3. flex 流 vs 测量驱动 | **纯 flex 流**；全包仅 tab 标签条有 ResizeObserver（use-tab-strip-overflow） |
| 4. number kind spinbox | 渲染器**渲染不了**（见下） |
| 5. checkbox 独立 kind | 无独立 kind，toggle 可覆盖 |
| 6. when + tab 条件隐藏 | **已有**：`tab.when`/`contextWhen`/`autoActivate` 全齐（Q9 成立） |

**重大偏差（§6 未预料）**：

1. **DesktopRibbon 零生产挂载**——只存在于测试。生产三端全是手写 Ribbon：docs `components/Ribbon.tsx`（2662 行）+ slides `components/Ribbon.tsx` 平行副本 + sheets ExcelShell 自带条 + pdf 自带顶栏。包的消费面仅：docs MobileRibbon（移动线）+ sheets/slides/pdf 的 TabStripArrows/useTabStripOverflow + tab-strip.css。
2. **DesktopRibbon 只能渲染 7/12 kind**：`controls.tsx` switch 里 combobox/number/toggle/colorpicker/gallery 显式 `return null`（注释：等 C3-C7）。即便今天挂载，WPS 组件族 5 族不显示。
3. docs strangler 机械已备好一半：`ribbon/schema/` 有 DOCS_SCHEMA v2 = 文件菜单（全声明）+ 6 个已提取 tab（renderBody 承载：Design/Insert/Layout/References/Draw/Review）+ View tab（全声明）；**Home tab + 全部上下文 tab（表格/图片/形状）仍在 legacy Ribbon.tsx 里**（painter 状态机/样式画廊是 RibbonInner 内部件）。
4. 好消息：Q8 的条收起已在手写 Ribbon 存在（双击标签/chevron 折叠 + localStorage，三端同款），形态可演进；`legacyDropdown` 桥接手法（RibbonDropdownApi ↔ 扁平 setDropdown）在 host-tabs.tsx 有现成范例；DesktopRibbon 的 `renderBody` 整 tab 承载（strangler hosting）是 types.ts 明确支持的能力。

## 10. 共识进度（Q12 起，2026-09-10 新会话）

**已确认**：

- **Q12 施工顺序 = 分期收敛，引擎只进渲染器**：先补全 DesktopRibbon 缺的 5 种控件渲染，docs 先切 schema 驱动并把 M1 规格 + M2 自适应引擎直接做在渲染器里；docs 验收通过后 slides/sheets 跟进收敛。不在三端手写 Ribbon 上重复实现降级逻辑。MobileRibbon 本身不动（Q1=C 落定）。
- **Q13 docs 切换姿势 = 蛙跳**：Home + 上下文 tab 先拆独立组件走 renderBody 适配器立即挂载 DesktopRibbon，legacy Ribbon.tsx 退役；之后逐 tab schema 化，每化一个 tab 该 tab 即获得自适应。DesktopRibbon 新增 bodyOnly 模式承接移动换装桥（移动线行为不变）。混合期未 schema 化 tab 仍横向滚动，视觉用同一套 token 拉齐。

**已确认（2026-09-10 晚，用户逐题裁定）**：

- **Q14 spaceHint 建模 = A 可选字段+默认推导**：schema 控件加可选 `spaceHint`（loose/suitable/topsuitable/compact/autocompact 五档）+ `canHideText`，缺省按 kind+size 推导（内置推导表 = 我们控件族的档位基准），组级可整组覆盖；WPS 原值可查的控件显式覆盖精调。
- **Q15 校验场 = docs 表格上下文 tab**：schema 化时按 WPS 表格工具 tab 7 分组（属性/字体/行和列/合并/对齐方式/调整/数据）规格一比一还原，功能映射 docs 现有表格能力，缺的占位禁用。
- **Q16 条收起 = WPS 式组名行**：收起态约 24px 组名行、组名可点击弹原布局面板（`.ribbon-group-label` 要打开渲染）；触发保留双击标签 + 右下 chevron；三端折叠偏好 localStorage 键迁移统一。
- **Q17 深色主题 = v1 只精调 light**：规格 token 全走 CSS 变量，dark token 集预留，dark 不单独验收。
- **Q18 图标 = 出 v1 范围（用户裁定）**：控件先用现有 per-app 图标（iconMap 机制不变），布局/结构/大小对齐优先；图标自绘管线（SVG 进包、命名、像素校准）推迟到结构对齐之后单独立项。
- **Q19 parity gate = 菜单结构对齐清单（用户裁定）**：整体交付物必须含**「与 WPS 菜单结构未对齐清单」**——逐 tab 对照 WPS 同名 tab 的分组/控件结构（CT_*.kuip 实测为基准），总结哪些分组/控件没对上，后期一个个实现并对齐。形态延续 `docs/wps-parity-playbook.md` 的逐项清单传统。M4 验收 = 宽度梯度 × 档位 × 展开/收起截图比对 + 无毛边巡检 + 三应用回归 + 该差距清单交付。

**不问、直接定（实现细节，共识表评审时可推翻）**：

- 样式归属：包自带 `controls.css`（结构 chrome + 默认 token，tab-strip.css 先例），app 侧只留 theme token 覆盖——对应 WPS 皮肤与结构分离；
- sheets 富菜单（MenuRows/三级子菜单/色块画廊）进 schema 先走 `renderMenu` 原样搬，菜单声明化后置；
- checkbox 不设独立 kind（toggle 承担，必要时加视觉变体）；
- M1 的规格提取以 `CT_TableTools.kuip` + 皮肤 `uicontrol.kuip` + wps-screen 截图三方互证。

## 11. 施工进度（2026-09-10 深夜批次）

**已落地（全部提交推送）**：

1. **控件族补全**（4da894b6 前):DesktopRibbon 12 kind 全渲染（toggle/number/combobox/colorpicker/gallery 五视图 + 内置三调色板 + `controls.css` 默认样式），schema 增 `spaceHint`/`canHideText`/toggle `size`。
2. **Q19 差距清单 v1**：`docs/ribbon-wps-parity-gap.md`——三端 vs WPS tab 级全对照（45/36/39 tabs）、docs 开始 tab 组级深比对（缺口=查找编辑组/中文版式裁定）、spaceHint 语义档案（含野值 autoconsize/selfadaption 与 dynamicSpaceHint 区间语义）、施工勾选骨架、4 条裁定遗留。解析脚本在参考目录 `_scripts/`（inventory_kuip.py / inventory_ours.py，可复跑）。
3. **M2 引擎核心**：`desktop/adaptive.ts`（deriveSpaceHint/deriveCanHideText 推导表 + textHideOrder + planCollapse 终态兜底数学）+ DesktopRibbon 测量驱动降级循环（ResizeObserver+useLayoutEffect，溢出→隐文字→右起逐组收拢成组名按钮，组名弹原布局面板； retreated 带 28px 滞回）+ GroupItems hideText 作用域 env + `.ribbon-body-row` 测量容器（schema 组接管溢出，renderBody 遗留体保持横向滚动）+ bodyOnly 模式 + collapsed 受控开关（`.ribbon-collapse-btn`/`.ribbon-collapsed`，偏好存储留给宿主）。包内 111 测试全绿。

**下一步（按序）**：

1. **C=docs 蛙跳切换**（未做，入口在此）：先调和 `DOCS_SCHEMA v2` 与现实——legacy Ribbon 已把 Design+Layout 合并为「页面」tab，而 schema 仍是 Design/Layout 两独立 tab；需要 schema 侧合并成 page（renderBody 双组件承载）。然后 App.tsx 挂 DesktopRibbon：6 个已提取 tab 用现成 host-tabs 适配器；Home（`components/home-tab.tsx` 已是独立组件！）+ 上下文四 tab（`contextual-tabs.tsx`）补 renderBody 适配器（照 legacyDropdown 桥接手法）；移动换装桥切 DesktopRibbon bodyOnly（MobileRibbon 不动）；legacy `components/Ribbon.tsx` 退役。风险面：App↔Ribbon ~45 回调 props 的承接、ribbon-collapse/记忆键迁移、docs 2010 测试回归。
2. M1 规格 token（WPS 硬规格进 controls.css 变量：字体框 minimumWidth=151/字号框 fixedWidth=60 等）+ 表格工具校验场按差距清单 §4 勾选推进。
3. merge-row（并单行）真实现（schema `group.adapt` 已预留类型）。
4. sheets/slides 收敛 + 差距清单回填。
