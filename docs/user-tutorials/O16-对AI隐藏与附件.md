---
id: O16
title: 对 AI 隐藏与附件（{{占位}} 与 📎）
entry: 右键「把选中的内容对 AI 隐藏」；📎
level: P2
tags: [对 AI 隐藏, 占位符, 隐私, 附件, 图片内联]
status: draft
---

## 一句话说明

两个保护/携带数据的入口：①「把选中的内容对 AI 隐藏」——在文档/表格/演示/HTML/Markdown 五个编辑器里把选中内容标记起来，**文字原样留在文档和文件里，AI 读到的却只是 `{{占位名}}`**，保存、导出、渲染全部不受影响；② 附件 📎——把本地文件带进 AI 对话：单文件上限 50MB，图片直接给模型看，文本/办公文件在本机解析后分页读。

## 适用场景

- 文档里有客户电话、内部编号、涉密单位名，想让 AI 帮忙润色全文但不把这几处递给它；
- 截图、报表、参考资料在手边，想让 AI 读了再回答或写稿；
- 想确认「隐藏之后文件里到底还有没有原文」「AI 是不是真的看不见」。

典型提问（chabot 语料视角）：

- 「怎么让 AI 看不到文档里的某几句话？」
- 「对 AI 隐藏之后，保存的文件里内容还在吗？」
- 「附件最大能传多大？图片有限制吗？」

## 前置条件

- 「对 AI 隐藏」不依赖模型配置，纯本机标记行为；附件对话需要已配置至少一个对话模型。
- 五端支持隐藏：文档（Docs）、表格（Sheets）、演示（Slides）、HTML、Markdown；**PDF 编辑器没有此功能**（PDF 的「涂黑」是物理删除内容的另一功能，见 O29）。

## 操作步骤

**第 1 步 · 隐藏选中内容（文档端）**

1. 选中一段文字，右键菜单点「**把选中的内容对 AI 隐藏**」。
2. 弹出对话框，说明「**这段文字会留在文档和文件里，AI 读到的却是下面的标记。给它起个名字，AI 才知道它是什么。**」，并附边界提示「**这只针对本应用的 AI。命令行、MCP 工具和无界面导出会直接读取文件，仍然看得到这些文字。**」。
3. 输入占位名称（占位提示「**占位名称，例如：客户电话**」）：输入框上方**实时预览**模型将看到的 `{{标记}}`；名称会自动清洗掉 `{}<>=“'` 等字符、最长 40 字符，留空时回退为 `{{private}}`。点「**隐藏**」（或回车）生效，「取消」（或 Esc）放弃。
4. 生效后文字原样保留，下方多一条紫色线作视觉标记。再用 Word/WPS 打开该文件，同样能看到这条线且标记随文件保留。
5. 反悔：选中带标记的内容右键，点「**把选中的内容重新对 AI 显示**」即解除（文字不动，只摘标记）。

**第 2 步 · 各端入口差异**

- **演示（Slides）**：选中文字后右键同款菜单项；**图片/视频/音频元素**也能右键隐藏——媒体对模型只给出 `{{名字}}`，不递给它可取用的引用（链接型媒体的外链地址对模型不可见）。单选一个元素时才可隐藏。
- **表格（Sheets）**：选中单元格右键同款菜单项。两个表格特有行为：① 隐藏以**底色**标记（因为单元格没有放标记线的位置；清除标记会还原你原本的填充色）；② 被**隐藏的单元格不参与 AI 的统计聚合**——防止「用总和减去其他行」把隐藏值算出来；③ 未保存的新行会被拦下提示「**这一行还没存进文件。请先存盘，再隐藏其中的单元格。**」。
- **HTML**：在**源码编辑器**里选中一段右键隐藏。标记按选中对象分三种：元素内容（`data-gx-redact="名字"`）、属性值（`data-gx-redact-<属性>="名字"`）、脚本字符串（前面的 `/*gx:redact:名字*/` 注释）——都是合法且惰性的源码，浏览器照常渲染。
- **Markdown**：先点工具条上的**闭眼图标**（悬停提示「**选中文字后右键，即可对 AI 隐藏。**」）启用入口，再选中右键操作；隐藏文字带紫色下划线底纹。再点一次闭眼图标收起入口（已有标记不受影响）。

**第 3 步 · 认清边界（写进对话框的原文，务必读一遍）**

- 隐藏是「**本应用 AI 视图**」层面的屏蔽：应用内 AI 面板读到的是 `{{占位}}`；AI 的改写若会碰到或拆散隐藏段，会被先检查拦截。
- 但**不是加密**：命令行（`chaoffice docs read` 等）、MCP 工具、无界面导出直接读文件，看得到原文；模型若被明确要求猜测占位背后的内容，也不阻止其推理。它防的是「顺手递出去」的意外。

**第 4 步 · 附件（首页对话 📎）**

1. 主页中栏对话输入框左下点 📎「**添加附件**」选本地文件。
2. 上限：**单文件 50MB**；**单张图片 5MB**（超限的图片会被拒绝）。支持类型：图片 png/jpg/jpeg/gif/webp；办公与文档 doc/docx/pdf/ppt/pptx/xls/xlsx/xlsm；文本类 txt/md/csv/json/yaml/xml/html/log 等。
3. 去向：**图片直接内联**随消息发给模型（多模态直读）；办公/PDF/文本文件**在本机解析提取文本**（文件不出机器），AI 按需翻读——先读前 **12,000 字符**，更长的用读取工具按字符位置分页续读（单次最多 48,000）。文件卡片显示缩略图/类型与大小，发送前可移除。

**第 5 步 · 编辑器 AI 面板的附件入口**

- **文档（Docs）**：面板输入框左下 📎 按钮（提示「**添加本地文件作为附件(也可拖拽到面板)**」），支持拖文件进面板、粘贴截图。
- **表格（Sheets）/演示（Slides）/HTML**：输入框左下「**＋**」按钮 → 「**添加文件**」；表格端另支持拖文件到面板与粘贴位图。
- 编辑器面板的文本附件由 AI 用 `read_attachment` 工具按 **24,000 字符/页**分页读取（结果报告总字符数与当前区间，AI 自行决定是否续读）；图片附件同样内联直读。
- **PDF 与 Markdown 的 AI 面板没有附件入口**（只挂技能菜单）；要让 AI 借助外部资料，用首页对话或文档/表格端。

### 验证

1. 文档端隐藏一处电话号码后让 AI「总结全文」：AI 回复里该处应只以 `{{你起的名字}}` 出现；保存后用文本查看器/Word 打开文件，原文完好、紫色线仍在。
2. Markdown 端点闭眼图标启用后右键有「把选中的内容对 AI 隐藏」；再点一次闭眼图标，右键菜单恢复浏览器默认。
3. 首页对话附一张 6MB 截图：应被拒绝（超 5MB/张）；附一个 10MB 的 txt：正常受理，AI 首轮只拿到前 12,000 字符，追问后半部分时它会翻页续读。

## 常见问题

**Q1：AI 能「看到」我隐藏的内容吗？它改写时会不会破坏原文？**
本应用 AI 面板读不到：发给模型的文本里隐藏段已被替换成 `{{标记}}`；AI 回写时若编辑会落在隐藏段上，应用会先检查并拒绝这类改动。但要清楚两条边界（第 3 步）：命令行/MCP 直读文件绕过这层；这不是加密，极端追问不阻止推理。

**Q2：隐藏之后保存/导出，文件里是什么？**
就是你的原文，一字不差。`{{占位}}` 只存在于「发给模型的那份视图」，从不写进文件（表格端的隐藏记录写在文件内一个专用部件里，也不含占位替换）。存盘、导出 PDF/Word、浏览器渲染都不受影响。

**Q3：隐藏的颜色被我手动改掉了，保护还有效吗？**
有效。表格端的底色只是视觉提示，真正的屏蔽在读路径上；文档端的紫线同理。反之，只上色不隐藏也不构成保护。

**Q4：附件发不出去/被拒了？**
三种常见原因：单文件超 50MB、图片单张超 5MB、扩展名不在支持清单。大文件可先压缩或摘取相关部分再附；PDF 面板要读的是打开中的文件本身，不需要附件。

**Q5：为什么 AI 说「没读到附件全部内容」？**
文本类附件按页读：编辑器面板每页 24,000 字符、首页对话先读前 12,000 字符。长文件首轮只有开头，AI 会在需要时自己翻页；也可以直接说「继续读完附件的剩余部分」。

## 形态差异

- 隐藏与附件功能随各编辑器渲染层提供：HTML 端（源码右键隐藏）仅桌面形态；其余四端（文档/表格/演示/Markdown）桌面与 web/dsh 形态（五编辑器）同源提供。PDF 端两者皆无（隐藏无此功能；附件无入口）。

## 事实来源

- 五端入口与文案：`apps/docs/src/renderer/i18n/app/zh.ts`、`apps/slides/src/renderer/i18n/app/zh.ts`、`apps/html/src/renderer/i18n/app/zh.ts`、`apps/markdown/src/renderer/i18n/strings.ts`、`apps/sheets/src/renderer/i18n/app/zh.ts`（redactMenuLabel/redactDialogDesc/redactDialogScope/redactDialogPlaceholder/redactInsert/redactShowLabel/redactEnable；Sheets 另有 redactNeedsSavedRow/redactRecoveredFromNames）
- 共享规则：`packages/agent-core/src/redact-core.ts`（`{{}}` 形态、MAX_LABEL_LENGTH=40、sanitizeLabel 去 `{}<>=“'`（注释载体再去 `*` `/`）、空标签回退 private）＋ `packages/ui/src/use-redact-label.ts`（对话框行为：实时预览、Enter/Esc、空不禁用提交）
- 文档端：`apps/docs/src/renderer/editor/redaction.ts`（标记=真实文字上的 run 边框 w:bdr 紫线 + 自定义 rPr 元素，Word 可见可回带；save 从不写 `{{…}}`）＋ `apps/docs/src/renderer/ai/redact-view.ts`（请求路径替换，未识别节点原样放行防漏）＋ `apps/docs/src/renderer/components/ContextMenu.tsx`（右键两项及禁用条件）
- 演示端：`apps/slides/src/renderer/ai/redact.ts`（run/元素 redact 标记存 `<a:extLst>`，pptx 保留真实文字；媒体隐藏=不给模型引用/外链）＋ `apps/slides/src/renderer/context-menu-items.ts`（文字选区与单个媒体元素两项）
- 表格端：`apps/sheets/src/renderer/ai/redact.ts`（标记存 `xl/gxRedactions.json`；直接读替换 + 聚合统计排除隐藏值防算术泄露）＋ `apps/sheets/src/renderer/redact-menu.ts`（Univer 右键扩展点）、`apps/sheets/src/renderer/redact-tint.ts`（底色标记还原原填充色）
- HTML 端：`apps/html/src/renderer/ai/redact.ts`（三种标记：data-gx-redact 内容 / data-gx-redact-<attr> 属性值 / /*gx:redact:label*/ 脚本字符串；惰性不渲染）＋ `apps/html/src/renderer/source/SourceEditor.tsx`（源码右键入口）＋ `apps/html/src/renderer/ai/redact-guard.ts`（模型改写区间检查）
- Markdown 端：`apps/markdown/src/renderer/editor/redact.ts`（真实文字上的 mark，磁盘内容不变）＋ `apps/markdown/src/renderer/components/RedactMenu.tsx`（右键菜单两项、有选区才弹）＋ `apps/markdown/src/renderer/components/Ribbon.tsx`（IconEyeOff 闭眼开关）＋ `apps/markdown/src/renderer/App.tsx`（'mdapp.redact' 开关记忆）＋ `apps/markdown/src/renderer/styles.css`（redact-span 紫色下划线底纹）
- 附件上限与解析：`apps/docs/src/main/docs-main.ts`（ATTACHMENT_MAX_BYTES=50MB、ATTACHMENT_IMAGE_MAX_BYTES=5MB、ATTACHMENT_IMAGE_EXTS png/jpg/jpeg/gif/webp、办公/PDF 扩展名清单经 @chaoffice/file-parse 本机解析、粘贴图临时目录）
- 分页口径：编辑器面板 `packages/agent-core/src/attachments-skill.ts`（read_attachment 工具、ATTACHMENT_READ_CHUNK_CHARS=24,000/页、图片附件不重复读）；首页对话 `apps/shell/src/renderer/src/home-chat/agent.ts`（read_document 默认 12,000/次、上限 48,000、附件首轮自动注入前 12,000）
- 附件入口：`apps/shell/src/renderer/src/AskAttachments.tsx`（chips/缩略图）＋ `apps/shell/src/renderer/src/i18n-local-strings.ts`（chatAttach「添加附件」）；`apps/docs/src/renderer/ai/AiConversationBody.tsx`（aiAttachTitle「添加本地文件作为附件(也可拖拽到面板)」）；`apps/sheets/src/renderer/ai/AiChatPanel.tsx`＋`packages/ui/src/AiSkillsMenu.tsx`＋`packages/ui/src/strings-ai-skills.ts`（＋→「添加文件」）；`apps/slides/src/renderer/ai/AiPanel.tsx`、`apps/html/src/renderer/ai/AiPanel.tsx`（同构）；PDF/Markdown 面板无附件入口（`apps/pdf/src/renderer/ai/AiPanel.tsx`、`apps/markdown/src/renderer/ai/AiPanel.tsx` 仅有技能菜单，已核对）
