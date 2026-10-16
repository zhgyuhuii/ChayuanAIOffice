# WPS 编辑器能力全面分析（编辑补全 / 流式输出 / 右键菜单 / 二次开发）

> 方法：macOS 版 WPS Office（`com.kingsoft.wpsoffice.mac`，pid 99181）实机操作 + 官方开放平台文档/社区资料检索。
> 实测对象：`爱唠叨的妈妈.docx`（正文/表格/页脚混合内容）。分析日期：2026-09-03。
> ⚠️ 实测期间发现另一会话在同一 WPS 实例上做表格功能验证，为避免互相污染，图片右键菜单与 AI 流式输出未做破坏性实测（结论由已捕获素材 + 官方资料补充，均已标注）。

---

## 一、AI 文字补全（AI 伴写）

**实测**：在正文新起一段连续键入两段中文（共 31 字），光标停顿 2–6 秒，**均未出现灰色补全建议**；也没有 Tab 采纳交互。

**官方机制**（[WPS 官方博客](https://plus.wps.cn/blog/p109339.html)、[WPS 365 官网](https://365.wps.cn/content/30929a7f2779465b8f408b9da5da4200.html)）：

- 写完一句后光标后方出现**浅灰色续写建议**（ghost text）；
- **Tab** 采纳，建议转为正文；**Alt+↓** 切换其他续写方案；
- 该能力叫 **"AI 伴写"**，与"AI 帮我写（一键生成大纲/全文）""AI 帮我改（多风格润色）"并列，主要随 WPS 365/企业版分发（[企业版介绍](https://365.wps.cn/content/30929a7f2779465b8f408b9da5da4200.html)）。

**本机未出现的原因推断**：未登录 WPS 账号 / 个人版未灰度 AI 伴写 / macOS 版开关默认关闭（AI 伴写属于云端能力，需要账号态）。右键 mini 工具条上的"续写"按钮是手动触发等价能力的入口。

## 二、流式输出

**实测**：未触发（依赖登录态；且编辑写入会污染并发会话的测试现场）。

**官方形态**（[AI 帮我写升级说明](https://plus.wps.cn/blog/p109339.html)）：

- "AI 帮我写"一键生成：**先出大纲，再逐段流式生成全文**（打字机式逐字/逐段上屏，可中途停）；
- "AI 伴写"：边写边按上下文实时出续写建议（本质是逐次短补全，配合 Tab 采纳形成连续流式体验）；
- 全新升级整合 **一键生成 + 灵感市集 + AI 伴写** 三合一，覆盖公文/学术/营销/合同场景。

**对本项目的参照**：流式渲染需要"逐 token 上屏 + 可中断 + 采纳前不落盘（临时层）"三件事；本项目 AI 面板已具备流式，差"应用到文档的临时层/逐段采纳"形态。

## 三、不同内容类型的右键菜单（实测）

### 3.1 正文文字

菜单上方有 **mini 格式工具条**：字体框（宋体(正文)）/字号框（小四）、B/I/U/删除线、字体颜色、项目符号、编号、对齐；第二行 AI 快捷：**解析 / 翻译 / 快速调色 / 续写**、更多(…)。

菜单项：剪切、复制、粘贴为文本(T)、选择性粘贴(S)⇧⌘V、字体(F)⌘D、段落(P)⌥⌘M、项目符号和编号(N)…、更换背景(B)＞、格式刷(F)、超链接(H)⌘K、批注插入(M)、全文处理＞、全文翻译[试]、添加到察元、**察元AI文本分析＞、察元AI翻译＞、察元AI知识库＞**。

### 3.2 表格（单元格内）

顶部出现**表格工具/表格样式**上下文 ribbon tab；mini 工具条切换为表格版（多边框/底纹/对齐按钮 + **续写**）。

菜单项：剪切、复制、粘贴、**插入(I)＞、拆分单元格(P)…、删除单元格(D)…、全选表格(L)、自动调整(A)＞、拆分表格(X)＞**、超链接(H)、边框和底纹(B)…、单元格对齐方式(G)＞、文字方向(X)…、项目符号和编号(N)…、表格属性(R)…、**AI 美化表格**（高亮）、更多表格样式。

### 3.3 页面空白处

与正文菜单**相同**（点击自动落位到最近段落）——WPS 文字没有独立"空白区"菜单。

### 3.4 页眉/页脚区

仅一个小气泡菜单：**编辑页脚(E)**（页眉同理），进入页脚编辑态后 ribbon 出现"页眉页脚"上下文 tab。

### 3.5 关键发现：第三方加载项可注入右键菜单

正右键菜单中的"察元AI 文本分析/翻译/知识库"与顶部 tab"察元AI助理/察元AI编审"，是**企业品牌（察元）通过 WPS 加载项注入的自定义菜单**——机制为 `ribbon.xml` 的 `<contextMenus><contextMenu idMso="ContextMenuText">` 节点（[WPS 开发文档：自定义功能区 CustomUI 标准](https://qn.cache.wpscdn.cn/encs/doc/office_v13/index.htm)、[加载项开发说明](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)、社区案例 [ContextMenu 注入问题](https://bbs.wps.cn/topic/54168)）。这证明**本项目品牌（ChaOffice/察元系）已有 WPS 加载项注入实践**，是"文字右键 AI 菜单"的现成参照。

图片/形状右键菜单未实测（并发冲突避让）：官方加载项文档按 `idMso` 分 MenuText/MenuCell/MenuPicture 等多种上下文菜单，形状/图片必有独立菜单（环绕方式/裁剪/提取文字等），后续可单独补测。

## 四、编辑器功能盘点（本次实测补充）

- **插入 tab**：空白页、封面、分页、页码、页眉页脚｜表格、图片、文档、截屏、形状、图标、功能图、流程图、思维导图、图表、SmartArt｜文本框、艺术字｜公式、符号｜批注｜超链接、书签｜文档部件、首字下沉、对象附件｜素材中心。
- **图片下拉三通道**：本机图片(P)、**AI 生成图片(G)**、在线图库（搜索 + 精选分类：教育/商务/科技/医疗/节日节气…）。
- **状态栏**：页码、字数、拼写检查（开/关）、**AI 校对**、缺失字体提醒、本地备份开关、视图切换、显示比例。
- **选中浮动反馈**：文档页边出现"一键美化 AI"浮钮；表格左侧出现行标浮动柄。
- **上下文 ribbon tab**：表格 → 表格工具/表格样式；开发工具态 → 开发工具；页眉页脚态 → 页眉页脚 tab。与本项目 docs/slides 的 contextTab 思路一致，但 WPS 的上下文 tab 是**追加**而非替换选中逻辑。

## 五、二次开发体系（网络检索汇总）

| 能力                   | 内容                                                                                                                                                                                                                                                          | 入口/资料                                                                                                                                                                                                                                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WPS 加载项（JSAPI）    | 基于 Web 技术：`ribbon.xml`（CustomUI 标准，定义功能区按钮/下拉/画廊 + `<contextMenus>` 右键注入）+ 网页（index.html + JS 调 API）；支持任务窗格/对话框/Web 嵌入；`wpsjs create/debug/publish` 全链路工具；个人版 oem.ini + jsplugins.xml 部署已停用          | [加载项概述](https://open.wps.cn/previous/docs/client/wpsload)、[开发说明](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/wps-integration-mode/wps-addin-development/wps-addin-development-instructions)、[知乎：深入开发](https://zhuanlan.zhihu.com/p/266673886)                                          |
| JSA 宏（WPS 宏编辑器） | 内置 **V8 运行时**，支持大部分 ES6；VBA 式对象模型（`Application`/`ActiveDocument`/`ActiveWorkbook`/`Range`）；事件模型（如 `Worksheet_SelectionChange`、`Document_BeforeClose`）；录制宏生成代码；跨平台（Linux/UOS 可用）；启用：文件→选项→默认 JS 开发环境 | [JS 运行时说明](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/macro-editor-api/javascript-runtime-instructions)、[宏编辑器概述](https://qn.cache.wpscdn.cn/encs/doc/office_v18/topics/WPS%20集成模式/WPS宏编辑器开发/宏编辑器概述.html)、[JSA 入门](https://www.cnblogs.com/nutix/p/15189657.html)   |
| 控件工具箱 / XML       | 开发工具 tab 内：设计模式、控件属性、JS 控件（内容控件类）、**XML 映射（查看代码/组合）**——文档级结构化数据绑定（customXml）能力                                                                                                                              | 本次 GUI 实测截图                                                                                                                                                                                                                                                                                                                      |
| B/S 集成               | WPS WebOffice 开放平台（在线预览/编辑/格式转换/OCR，纯 Web 免插件）；本地版"浏览器应用集成嵌入 WPS 指南"（如 `PrintOut` 静默打印接口）                                                                                                                        | [WebOffice 开放平台](https://solution.wps.cn/)、[PrintOut API](https://qn.cache.wpscdn.cn/encs/doc/office_v11/topics/%E6%B5%8F%E8%A7%88%E5%99%A8%E5%BA%94%E7%94%A8%E9%9B%86%E6%88%90%E5%B5%8C%E5%85%A5WPS%E6%8C%87%E5%8D%97/%E8%A1%A8%E6%A0%BC%20API%20%E5%8F%82%E8%80%83/Charts/%E6%96%B9%E6%B3%95/PrintOut%20%E6%96%B9%E6%B3%95.htm) |
| 进程级 RPC             | `pywpsrpc`（官方 Linux 二次开发接口的 Python 封装）：调起 WPS 打开/编辑/保存/转换，或把 WPS 嵌入自有程序做服务端静默处理                                                                                                                                      | [pywpsrpc](https://pypi.org/project/pywpsrpc/)                                                                                                                                                                                                                                                                                         |
| 企业集成案例           | 致远等 OA 通过客户端 JSAPI 无控件在线编辑、1:1 还原微软格式                                                                                                                                                                                                   | [致远集成文档](https://open.seeyoncloud.com/v5devCTP/1842/1851/1852.html)                                                                                                                                                                                                                                                              |

**实机入口对照**（macOS 版）：工具 tab → 开发工具组（运行宏[需启用]/录制新宏/宏安全性/WPS 宏编辑器）+ 加载项组（WPS 加载项）；开发工具上下文 tab → 宏组 / 加载项 / 控件工具箱（设计模式+JS 控件）/ XML 映射 / 组合。

## 六、对 ChaOffice 的借鉴要点

1. **AI 伴写交互范式**值得照抄：ghost text + Tab 采纳 + Alt+↓ 换方案——本项目 docs 的 tiptap 可用 decoration + 键盘拦截实现，成本低、心智与 WPS 一致。
2. **流式落盘三件套**：临时层（不进 undo 栈）→ 逐段采纳 → 可中断；"AI 帮我写"的大纲先行/逐段生成是长文生成的正确形态。
3. **右键菜单按内容类型分化** + mini 工具条上叠 AI 快捷（解析/翻译/续写）是高频好设计；本项目 ContextMenu 可按 text/table/image 分化并注入 AI 组。
4. **上下文 ribbon tab**（表格工具等）本项目已有（contextTab），WPS 的"追加 tab"细节可对比对齐。
5. **察元系 WPS 加载项的存在**说明公司有 WPS 二次开发通道；ChaOffice 若需与 WPS 生态互通（打开/保存回传、企业菜单），加载项 + JSAPI 是标准路径。

## 附：本次实测遗留

- 测试输入"妈妈的唠叨是世界上最温暖的旋律，每一次回想起来都让我心头一暖。"仍留在《爱唠叨的妈妈.docx》正文（字数 1022→1053）。因并发会话共享撤销栈，未做自动撤销/清理，**未保存**（若另一会话保存文件则会一并写入，请手动删除）。
- 误开的空标签"演示文稿2"未关闭。
- 未实测：图片/形状右键菜单、AI 流式输出全程（并发冲突避让；机制已由官方资料补齐）。

外部资料：[WPS 开放平台](https://open.wps.cn/previous/docs/client/wpsload) · [AI 伴写升级](https://plus.wps.cn/blog/p109339.html) · [WPS 365 AI](https://365.wps.cn/content/30929a7f2779465b8f408b9da5da4200.html) · [JSA 运行时](https://open.wps.cn/documents/app-integration-dev/wps365/client/wpsoffice/jsapi/macro-editor-api/javascript-runtime-instructions) · [CustomUI/contextMenus](https://qn.cache.wpscdn.cn/encs/doc/office_v13/index.htm) · [WebOffice 平台](https://solution.wps.cn/) · [pywpsrpc](https://pypi.org/project/pywpsrpc/) · [致远集成](https://open.seeyoncloud.com/v5devCTP/1842/1851/1852.html) · [ContextMenu 社区案例](https://bbs.wps.cn/topic/54168)
