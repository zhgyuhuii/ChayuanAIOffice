# WPS 对标补齐：需求理解与实现分析（2026-09-03）

> 依据 `docs/wps-ribbon-parity.md` §九未完成清单 + WPS macOS 截图（`~/Downloads/wps-screen`）逐区视觉分析。
> 本文是每个功能的「需求理解 / 分析逻辑 / 达到效果」记录，实现按此执行，完成后逐项回填状态。

图例：⬜ 未开始 ◐ 进行中 ✅ 已完成

---

## F1 切换·速度 / 效果选项（方向）/ 声音 ✅（`97cdb84`）  〔§八-1、二-切换〕

**WPS 需求（截图 wps-ppt/4.png 切换 tab）**
- 计时组：`速度` 数字输入框（形如 `00.50`，单位秒，步进 0.1，可调）、`声音` 下拉（无声音 / 爆炸 / 打字机 / 风铃 / 鼓掌 / 刹车 / 切换 / 咖啡 / 推动等预置音，底部含「循环播放直到下一个声音开始」开关）、`单击鼠标时换片`☑（本项目恒开）、`自动换片`☑ + 秒数输入（已实现）。
- 切换效果组右端：「效果选项」按钮（有方向的效果可用，无方向效果禁用），点开为该效果支持的方向集。
- 画廊右端「应用到全部」（已实现）。

**分析逻辑**
- 速度：OOXML 双轨 —— 现代属性 `p14:dur`（毫秒，mc:AlternateContent Choice 包裹）+ 旧属性 `spd="slow|med|fast"`（Fallback，映射 <625ms=fast、<875ms=med、其余 slow，锚点 0.5/0.75/1.0s）。UI 用 WPS 式秒数输入（1:1），引擎以 durationMs 为唯一真值；未显式设置时按 spd 反推，都没有则回显 0.50s 默认。
- 方向：按内核给定支持集 —— push/wipe/cover/pull 支持 8 向（l/r/u/d/lu/ld/ru/rd；push 官方仅 4 向，保守 4 向），split 写 `orient="vert|horiz" dir="in|out"`，zoom 写 `dir="in|out"`，fade/dissolve/circle/random/morph 无方向。读取时从 transition 元素属性回显。
- 声音：`<p:transition><p:sndAc><p:stSnd loop?><p:snd r:embed="rId" name="...wav"/></p:stSnd></p:sndAc></p:transition>`。预置音用程序合成 PCM wav（正弦/噪声/包络合成爆炸、风铃、鼓掌、打字机、刹车、切换、咖啡、推动、锤打、电压），首次选用时才嵌入 media part + slide rel（复用 media-insert 管线，wav 已在 MIME 表）。本项目放映时用 WebAudio 同步播放（与切换同刻触发）。清除 = 无声音（sndAc 整体移除，media part 留给资源回收）。
- 工作树已有另一会话的半成品（spd/dir 引擎+IPC+App 状态，Ribbon UI 未接、setTransSpeed 未声明不能编译）：吸收重写为 durationMs 模型，UI 按 WPS 形态接全。

**达到效果**：切换 tab 与 WPS 同构——速度秒数框、声音下拉（预置音+循环）、效果选项方向菜单；写出的 pptx 在 PowerPoint 里速度/方向/声音全部生效；本项目放映也按 dur 播放、有声效。

## F2 动画效果扩充（第一批经典滤镜族）✅（`d9afa8d`，18→34） 〔§八-2〕

**WPS 需求（wps-ppt/5.png 动画 tab）**：画廊可见 动态数字/百叶窗/擦除/出现/飞入/盒状/缓慢进入/阶梯状…，滚动还有 棋盘/切入/十字形扩展/随机线条/溶解/楔入/舒展/缩放/陀螺旋转/旋转/弹跳/上升/悬浮 等。WPS 全库 100+，本项目 18。

**分析逻辑**：按官方 presetID 补齐经典 animEffect 滤镜族（OOXML `filter` 声明，PowerPoint 原生播放）：
- 进入 13 种：blinds 百叶窗(3)、box 盒状(4)、checkerboard 棋盘(5)、circleIn 圆形扩展(6)、crawlIn 缓慢进入(7)、diamond 菱形(8)、dissolveIn 溶解(9)、randomBars 随机线条(14)、stretch 舒展(17)、strips 阶梯状(18)、wedge 楔入(20)、wheel 轮子(21)、floatIn 浮入(30 sub 上升/悬浮变体取上升)。
- 退出 4 种：boxOut(4)、checkerboardOut(5)、dissolveOut(9)、randomBarsOut(14)。
- 画布播放：NodeAnimState.clip 扩展 pattern 模式（blinds 条带、checkerboard 棋盘格序、randomBars 随机条、dissolve 像素格（种子随机）、box/circle/diamond 中心扩展、wedge 扇形扫、wheel 时钟辐条、strips 斜条），crawlIn/floatIn/stretch 用现有位移/缩放场。读回映射 effectFromPreset 同步。

**达到效果**：动画画廊 20→37 项（无 + 36 效果 + 路径组），WPS 画廊里全部经典族都有对应项；保存的 pptx 在 PowerPoint 用官方 presetID 播放；本项目画布悬停预览/放映同效果。剩余差距（陀螺旋转等强调族、变体方向、100+ 全量）在文档记为后续批次。

## F3 放映 tab 补齐（放映到显示器 / 演讲者视图开关 / 排练计时子菜单）✅（`861220f`） 〔§六-C 余项〕

**WPS 需求（wps-ppt/6.png）**：组3 `放映到[主要显示器]⌄` + `☑显示演讲者视图`；组4 `排练计时⌄`（子菜单）、手机遥控、屏幕录制、倒计时。

**分析逻辑**
- 放映到显示器：新 IPC `slides:list-displays`（main `screen.getAllDisplays()` 归一化 label/index）→ 下拉选择；放映时若非主显示器且为外接屏，show 窗口 move 到目标 display（Electron BrowserWindow setBounds 全屏）；演讲者视图☑=当前演讲者视图开关的回显与切换（放映到=目标屏、☑=本机是否开演讲者视图，两者组合即 PowerPoint「显示演讲者视图」语义）。
- 排练计时⌄：子菜单 [开始排练（现按钮行为）/ 清除排练计时（清全部 advTm，走 set-advance-times 批量 null）]。
- 手机遥控（需移动端配对生态）、倒计时（放映设置语义不明）、屏幕录制（OS 级能力）维持占位/不做，文档记因。AI 组三按钮走 AI 侧栏已有同款（审阅 tab 已有拼写检查/翻译入口），不重复铺 ribbon。

**达到效果**：放映 tab 组结构与 WPS 一致：显示器选择+演讲者视图勾选真实可用，排练计时带子菜单。

## F4 docs「页面」tab 合并（设计+布局→页面）✅（`dee8153`） 〔§七-T1/T3〕

**WPS 需求（wps-word/3.png）**：Word 端 tab 行 = 文件|开始|插入|**页面**|引用|审阅|视图|工具|论文助手|WPS AI，无独立设计/布局。页面组序：页边距⌄/纸张方向⌄/纸张大小⌄/打印预览｜稿纸｜水印⌄/页面颜色⌄/页面边框｜分栏/首字下沉…

**分析逻辑**：docs 的 design+layout 两组件按 WPS 顺序合并为单 tab `page`（开始 插入 页面 绘制 引用 审阅 视图；绘制为本项目特有保留）。合并只重组不删功能：LayoutTab 的页边距/纸张方向/纸张大小/分栏/分隔符等 + DesignTab 的页面颜色/水印/主题字体/主题颜色按 WPS 组序排列。tabRequest 'design'/'layout' 引用改指 'page'。i18n 19 locale 增 ribbonTabPage。

**达到效果**：三端 tab 命名对齐 WPS（word/sheets=页面布局语义、slides=设计），docs tab 数 8→7，无功能丢失。

## F5 三端「文件」入口 ✅（`77ee642`） 〔§七-T4〕

**WPS 需求**：macOS WPS 三组件 tab 行最左均为「☰ 文件」下拉按钮（非 tab），内容为文件级命令。

**分析逻辑**：WPS 文件菜单含 新建/打开/保存/另存为/输出PDF/打印/关闭 等；本项目按已有能力填充：新建（新文档）、打开、保存、另存为（三端都有对应 action），不造没有的能力（PDF 导出等记为后续）。形态：tab 行最左 ☰+「文件」下拉面板组件，三端复用；docs Windows 版已有 file tab 保持不变（平台差异如 WPS）。

**达到效果**：三端 tab 行左端出现与 WPS 同位的文件下拉，菜单项可直接执行已有文件命令。

## F6 sheets 富下拉第二批 + 图标补齐 ✅（`9d3d7e2`，88 处选项行） 〔§六-A4/T9、§八-3〕

**WPS 需求（wps-excel/3/4.png）**：下拉面板选项行=线性图标+文字（迷你图行、图表彩色缩略图行、边框缩略图等）；按钮图标为单色细线性。

**分析逻辑**：MenuSelect/largeMenu 35 处菜单行加 `icon` 槽（ReactNode），按 WPS 形态富化重点项：边框（框线缩略图）、页边距（边距示意图）、纸张方向（纵向/横向矩形）、排序（升降箭头）、迷你图（折线/柱形/盈亏小图）、合并（四态示意图）、冻结窗格（窗格示意图）、数字格式（示例预览）、打印区域/分隔符/计算选项（线性图标）；其余菜单统一线性图标行。补齐未映射字形（🔓×2、文、⋯、⇳）为 SVG。工具按钮图标现状已多数 SVG 化，仅查漏。

**达到效果**：sheets 全部下拉为「图标+文字」富行，与 docs/slides 菜单观感一致；视觉保真度不再三端垫底。

## F7 docs 样式库全量 ◐✅（`67471fe`：正文+标题1-6+字符样式；非标题段落样式需 pStyle 引擎支持，记后续） 〔§八-4〕

**WPS 需求（wps-word/1.png）**：样式库卡片带 AaBbCc 样式预览，一整行多卡+常驻下拉展开，含 正文/标题1-9/列表段落/引用/强调 等文档样式全集。

**分析逻辑**：现仅 4 段落预设+2 字符预设。接入文档自带样式（Ribbon 已收 `styles` prop，doc-style-css.ts 可渲染预览）：段落样式按 pPr/rPr 生成卡片预览（字体/字号/颜色/对齐），按 Word 惯例排序（正文→标题1-9→列表→引用…）；无样式文档回退预设集。应用路径沿用现有 applyStyle（styleId）。

**达到效果**：样式库卡片数随文档样式展开（典型 docx 十余张），WPS 同款常驻画廊+下拉。

## F8 下拉面板 Anchor Positioning 回退 ✅（`6959ac5`，observer shim 三端接入） 〔§八-5〕

**WPS 需求**：无直接对应；本项目三端富面板依赖 CSS Anchor Positioning（Electron 43/新 Chromium），老浏览器完全不可见。

**分析逻辑**：`@chaoffice/ui` 增加 `useAnchorFallback`：`CSS.supports('anchor-name: --a')` 为假时，用 trigger `getBoundingClientRect()` 计算 fixed 定位（翻转策略简化为：下方放不下放上），挂 `.anchor-fallback` class 关闭 anchor CSS。sheets MenuSelect、slides rb-drop、docs dropdown 三处接入。

**达到效果**：老 Chromium/Firefox 上面板以 JS 定位呈现，不再消失；新浏览器零变化。

---

## 实施顺序与提交切分

1. F1 切换速度/方向/声音（吸收工作树半成品）
2. F2 动画第一批
3. F3 放映 tab 补齐
4. F4 docs 页面合并 → F5 文件入口（依赖 F4 的 docs tab 列表）
5. F6 sheets 菜单富化 → F7 docs 样式库 → F8 anchor 回退
6. `docs/wps-ribbon-parity.md` 状态与落地记录更新

每步 gates：对应包 tests / tsc / eslint / prettier（仅本次触碰文件）；直接 main 分逻辑提交。
