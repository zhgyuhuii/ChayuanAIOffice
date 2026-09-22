# 编辑器 AI 对话栏多会话（多 Tab）开发计划

> 目标：六个编辑器（docs / sheets / slides / pdf / markdown / html）的 AI 对话栏支持多个对话并行——
> 会话以 tab 标签展示在对话栏上方、可关闭；右上角「+ 新建对话」与「🕘 历史对话」两个图标按钮
> 位于面板布局按钮左侧（顺序 [+] [🕘]）；🕘 点开下拉浮层，可还原/单个删除/全部删除历史对话。
>
> 本文是需求讨论共识的固化产物（已经过 3 轮独立审查修订 + 4 轮用户补充需求：D10「断点续作」、D11「上下文保真」、D12「空会话不进历史」、D13「历史对话改为图标下拉」），供下一个会话直接实施。
> 执行前必读 `docs/upstream-coexistence.md`（下称「制度」），本文的分区判断与登记要求均遵循该制度。
> 术语约定：**B 区** = 上游没有的本地独占文件（自由改动、零冲突）；**C 区** = 双方都要改的接缝文件
> （改动压到单行/追加式）；**D 区** = 本地对上游文件的实质改写（须登记）。定义见制度 §2。

---

## 1. 现状盘点（实施前事实基线，均已在 2026-09-21 对码核实）

### 1.1 六端面板组件与关键位置

| 端 | 面板文件 | tab 定义 | 「新对话」实现 | 按钮渲染 | 聊天持久化 |
|---|---|---|---|---|---|
| docs | `apps/docs/src/renderer/ai/AiPanel.tsx` | :357 | `newChat()` :1122 | :1299-1316（含条件） | 面板内 :545-640（`historicChat` 状态 + loop.restore） |
| sheets | `apps/sheets/src/renderer/ai/AiChatPanel.tsx` | :298 | prop `onNewChat` :238/:280 | :484-491 | **在 `apps/sheets/src/renderer/App.tsx`**（`handleNewChat` :1630-1645，prop 传递 :6276） |
| slides | `apps/slides/src/renderer/ai/AiPanel.tsx` | :465 | `newChat()` :2209 | :2354 | 面板内（`historicChat`） |
| pdf | `apps/pdf/src/renderer/ai/AiPanel.tsx` | :100 | 内联 onClick :622-643 | 同左 | 面板内 :185-226（**无 `historicChat` 状态**，历史直接并入 `chat`） |
| markdown | `apps/markdown/src/renderer/ai/AiPanel.tsx` | :160 | 内联 onClick :777-800 | 同左 | 面板内 :500-535（无 `historicChat` 状态） |
| html | `apps/html/src/renderer/ai/AiPanel.tsx` | :292 | 内联 onClick :1129-1152 | 同左 | 面板内 :797-843（无 `historicChat` 状态） |

> 行号会随实现漂移，仅作定位起点；以符号名（`newChat` / `handleNewChat` / `aiTabs` / `PanelTabs`）检索为准。

### 1.2 「新对话」现有语义（将被本功能替换）

六端共同核心：终止在途请求 → `loopRef.reset()` → `setBusy(false)` → 清空 `chat` → 清空恢复历史 → 清附件。
端特有副作用：

- docs：`pendingSendRef` 中止、`abandonWriter()`（写作会话）
- slides：`dismissClarify()`、`qcAbortRef.abort()`、`clarifyAnswers`、`readAttachmentPathsRef`
- sheets（App.tsx）：`setAiRunScope(undefined)`、`setPreview(null)`/`lazyPreviewRef`、`setMessage(...)`
- markdown：`abandonWriter()`
- html：`setReceipts([])`
- pdf：无额外

> ⚠️ 上述清单是**分类输入**而非搬迁清单：哪些副作用随会话实例走、哪些留在面板级，
> 按 §4.5 的资源归属分类判定后才能定（例如 docs/markdown 的 writer 为对话/助手两体共享，**不**进实例清理）。

按钮可见性条件（将被移除）：docs/slides/sheets 为 `tab==='chat' && (chat.length>0 || historicChat.length>0)`；
pdf/markdown/html 为 `tab==='chat' && chat.length>0`。

### 1.3 共享层与持久化（含接线点确切路径）

- `packages/ui/src/PanelTabs.tsx`（**B 区**，上游无此文件）：props = `tabs/activeId/onTabChange/actions/chromeActions/dragProps`；
  `actions` 槽渲染在 `chromeActions` **之前**（PanelTabs.tsx:58-60）——「+」放 `actions` 槽即自然落在面板布局按钮左侧，无需改 DockShell。
  `usePanelTab(persistKey, tabs)` 用 localStorage 记住激活 tab（存 id、不在列表则回退第一个）。
- `packages/ui/src/DockShell.tsx`（**B 区**）：`chrome.buttons` 顺序 = 面板布局 / 最大化 / 收起。
  > 勘误注：制度 §2 的 D 区举例中列有「DockShell」，实测上游 genoffice 全库无此文件，按 **B 区** 处理；
  > 制度该举例系历史残留，后续可顺手修订制度文档。
- tab 条样式在 `packages/ui/src/dock.css`（**B 区**，`.ai-tab-header` / `.ai-tab` / `.ai-tab-header-actions` 已在此）。
- 现有「对话 / 助手」双体切换模式：两个 body 都保持挂载，非激活的 `style={{display:'none'}}`
  （docs：对话体 :1323、输入区 :1561 分别切换；pdf 的 `.ai-chat` 容器同法）。**本功能的会话多实例沿用同一模式。**
- `packages/project-store`：`store.ts` 上游已有聊天 API（`resolveChatForFile` 一文件 ↔ 一 chatId 的
  `chatIdByPath` 映射、`appendChat`/`loadChat`/`rebindChat`，每会话一个 jsonl：
  `chatsDir = <projectDir>/chats`（store.ts:188-190），文件名 `{chatId}.jsonl`，`assertSafeId` 防路径穿越）；
  `ipc.ts` 注册通道（命名惯例 `project:xxx`）；渲染端经 `window.projectApi` 调用。
- **window.projectApi 接线点（六端各自一份）**：
  - preload 实现：`apps/<app>/src/preload/index.ts`（如 docs 的 `resolveChat: (args) => ipcRenderer.invoke('project:resolveChat', args)` :317）
  - 渲染端类型：`apps/<app>/src/renderer/env.d.ts`（docs/sheets/slides/markdown/html 均有；**pdf 的 env.d.ts 无 projectApi 声明**，实施时检索 pdf 端 `projectApi` 类型声明确切落点再补）
- 未保存文档：临时 chatId `unsaved-${Date.now()}`，首次保存出真实路径后 `rebindChat` 换绑（docs :560-585 为参考实现）。
- i18n 装配点（实施 §4.6 时挂 local 词条处）：
  - docs/sheets/slides/html：`apps/<app>/src/renderer/i18n/strings-ai.ts`（ai 词条装配文件，上游同路径 = C 区）
  - pdf/markdown：`apps/<app>/src/renderer/i18n/strings.ts`
  - 合并写法模板：`apps/shell/src/renderer/src/strings.ts:7244-7250`（`localStrings` spread 合并，制度 §3.1 试点）
- 上游 `genoffice`（remote `upstream` = `/Users/zyh/work/genoffice`）：同样拥有六端 AiPanel 文件
  （上游 docs 的 `newChat` 在 :1108，与本地已漂移）与 project-store 聊天 API；**没有** PanelTabs/DockShell/dock.css。
- 测试：根 `npm test` 按 workspace 链式执行；新测试分别跑 `npm test -w @chatoffice/project-store`、
  `npm test -w @chatoffice/ui`。既有相关套件：`packages/ui/tests/`（dock-shell 等）、`packages/project-store/tests/`（store/traversal-limit 等）。

---

## 2. 共识决策（D1–D9，需求方已逐条确认）

| # | 决策 | 内容 |
|---|---|---|
| D1 | 信息架构：顶层混排 | tab 行 = `[会话1][会话2]…[助手]`，会话 tab 动态增减，「助手」固定在会话 tab 之后；**历史对话不占 tab**——以 🕘 图标按钮紧跟「+ 新对话」之后（D13 修订） |
| D2 | 关闭语义 | 关闭 ✕ = 会话进历史，**数据保留**（jsonl 不删）；删除只发生在「历史对话」里 |
| D3 | 二态互斥 | 打开的会话只在 tab 行、关闭的只在历史列表；历史点击条目 = 还原成 tab（从列表消失）；「单个删除 / 全部删除」只作用于历史里的（未打开）会话；想删正打开的对话：先关闭再到历史删 |
| D4 | 重开恢复 | 持久化「打开集合 + 激活项」，重开文件原样恢复；存量老用户单会话历史视为「上次打开着」自动迁为一个 tab；全新文档空开一个新会话 |
| D5 | 运行时并行 | 每会话独立运行循环；切走后台继续流式；非激活 tab 显示运行中圆点；关闭运行中的 tab 弹确认「停止并关闭」，确认 = 先中止该会话运行再关闭进历史 |
| D6 | 标题 | 首条用户消息前 ~14 字自动截断为标题，未发言显示「新对话」；第一版不做手动重命名（字段预留 title） |
| D7 | 实现方式 | 抽公共层：`packages/ui` 会话池 hook + tab 条扩展，六端接入，不做六份复制 |
| D8 | 上游冲突最小化 | 新逻辑全进 B 区新文件；六端面板只做整块替换；单会话时行为与现状等价；`store.ts` 只留最小接线 |
| D9 | 集成形态 | 每会话一个挂载实例 + `display:none` 切换（与上游「对话/助手」双体同模式），对话体抽成按会话 id 实例化的组件 |
| D10 | 断点续作（后补需求） | 任务被中断后说「继续」，模型必须知道断在哪、接着做完不重做。**被中断的半截轮次照常落盘**（半截文本 + 已执行工具活动）并打 `interrupted` 标记；恢复后转录带「已中断」角标、半截文本喂回模型上下文；「继续」入口复用/新建续作指令（措辞沿用 docs 的 `DOCS_CONTINUE_INSTRUCTION`：「只做没做完的、不重复已完成的」）。此决策推翻上游「cancelled 轮次不持久化」现状（docs AiPanel:839 的 `!cancelled` 门）与旧稿「未完成轮次不落盘、作废」的说法 |
| D11 | 上下文保真（后补需求） | 任何时刻问「总结以上」，模型必须立刻拿到**当前会话的全部问答**。恢复链路全量装载：六端 `loadChat` 的 limit 从 200 上调至 **10_000**（store 既有 `MAX_CHAT_LIMIT`，store.ts:69，渲染端一行 ×6、store 零改动），配合 §4.3 的缓冲→建 loop→restore 硬性衔接链；被中断轮次随 D10 在场。成本口径见 §4.8：装载量与请求量是两回事，loop 既有预算机制兜底 |
| D12 | 空会话不进历史（后补需求） | 「空」= 转录中 **0 条消息记录**（从未发出消息；jsonl 因惰性落盘而不存在）。关闭空会话 = 直接丢弃：**不进历史列表、删除元数据条目、不弹任何确认**；未发送的输入草稿一并丢弃。迁移场景下存量 jsonl 为空的会话同规则 |
| D13 | 历史对话改为图标下拉（后补需求） | 「历史对话」不再是 tab：改为 🕘 图标按钮，**紧跟「+ 新对话」之后**（actions 槽内、面板布局按钮左侧，常驻可见）。点击在图标下方弹出下拉浮层（与 DockShell 面板布局菜单同交互模式），条目点击 = 还原成 tab 并激活、浮层收起，点外部关闭。激活态类型随之收窄为 `chatId ｜ 'assistant' ｜ 'empty'`（历史是浮层，不占激活态） |

### 2.1 小默认项（未单独确认，按此执行；如有异议在实施前提出）

- 「+ 新建对话」与「🕘 历史对话」两个图标按钮常驻右上角 `actions` 槽（布局按钮左侧，顺序 `[+] [🕘]`，D13），
  不再受「有内容才显示」限制；点击 + = 新开 tab 并激活
- tab 不设硬上限，超出横向滚动
- 历史里单个删除、全部删除均弹确认（不可逆）
- tab 可关到零：tab 行只剩「助手」（无高亮），对话体区域显示空态引导
  （大「新建对话」按钮 + 「点右上角 🕘 从历史对话还原」提示）；新建或还原后自动离开空态
- 关闭空会话（0 条消息）= 直接丢弃：不进历史、删元数据、无确认；未发送草稿一并丢弃（D12）
- 历史条目：标题 + 最后活跃时间；hover 出单个删除；列表底部「全部删除」
- 「全部删除」只清历史（未打开会话），绝不误伤打开中的 tab
- 未保存文档沿用 `unsaved-*` + `rebindChat` 换绑机制（含 §4.1 的索引换绑）
- `window.projectApi` 不存在的环境（web 预览等）：会话功能降级为内存态（本会话有效，不持久化），历史列表只含本次关闭的会话

---

## 3. 冲突分析与消解（为何这样设计）

| 冲突 | 消解 |
|---|---|
| `newChat` 语义：销毁式清空 → 无破坏新开 | 原清空动作组**经 §4.5 分类后**拆分：实例私有资源的清理搬进会话实例的卸载/关闭生命周期；面板级共享资源（writer/预览等）的清理留在面板级。「+」只负责新建。 |
| 单份 state 隐含「同时只有一个会话」 | 对话体抽成按 chatId 实例化的子组件，N 实例全挂载 + `display:none`（D9）；草稿/流式/忙碌态每实例独立 |
| 历史恢复 + docs #195 / sheets #224 补丁 | 按会话懒加载各自 jsonl；「newChat 必须清 historicChat」的补丁行为自然作废（切 tab 换整个 transcript，无残留问题） |
| `resolveChatForFile` 一文件 ↔ 一 chatId 契约 | `resolveChat` 保留做兼容与存量迁移；新索引模块独立成文件（§4.1），`store.ts` 不加业务逻辑 |
| sheets 聊天状态在 App.tsx | 会话池 hook 挂在 sheets 的 App.tsx，其余五端挂在 AiPanel；公共层接口一致。资源归属分类（§4.5）先行 |
| 上游同步冲突面 | 六端面板各只动 4 处连续区块（§4.3）；全部按制度 §4 的 D 区登记格式标记并回写台账（§4.3、§6 P5） |
| **「助手」tab 体与共享资源** | 助手 tab 体（如 docs 的 `AssistantBrowser`）**保持面板级原样不动、不实例化**；writer 等跨体共享资源归面板级，实例卸载清单只含实例私有资源（§4.5） |

---

## 4. 技术设计

### 4.1 project-store：会话索引（新 B 区模块 + 最小 C 区接线）

**新文件 `packages/project-store/src/conversations.ts`**（B 区，业务逻辑全在此）：

- 独立索引文件 `<projectDir>/chats/conversations.json`（chats 目录已存在（store.ts:188-190），只放 jsonl，无命名冲突；
  **不动**上游 index 的 `chatIdByPath`）：

```jsonc
{
  "version": 1,
  "byFile": {
    "<filePath>": {
      "conversations": [
        { "chatId": "a1b2c3…", "title": "帮我把这份合同的风险…", "createdAt": 1726880000000, "lastActiveAt": 1726880900000 }
      ],
      "openIds": ["a1b2c3…"],
      "activeId": "a1b2c3…"
    }
  }
}
```

- API（Main 进程侧，供 ipc 注册；通道名沿用 `project:` 惯例）：
  - `project:conversationsList` — `conversationsList(filePath)` → `{ conversations, openIds, activeId }`；
    **首次未命中即迁移**：调 `store.resolveChatForFile(filePath)` 取既有 chatId → 播种
    `{conversations:[{chatId, title:''}], openIds:[chatId], activeId:chatId}`
    （title 留空由渲染端加载历史后按 D6 回填，见 §4.3 实例职责；空 title 显示「新对话」）
    ——保证老用户升级后首屏与现状逐字节等价（D8）
  - `project:conversationCreate` — `conversationCreate(filePath)` → `{ projectId, chatId }`
    （新 chatId 用 `crypto.randomUUID()`，过 `assertSafeId`；jsonl 由首次 `appendChat` 惰性创建）
  - `project:conversationMeta` — `conversationMeta(filePath, chatId, { title?, lastActiveAt? })`
  - `project:conversationsOpenSet` — `conversationsOpenSet(filePath, openIds, activeId)`
  - `project:conversationDelete` — `conversationDelete(filePath, chatId)` → 移除元数据 + 删除对应 jsonl
  - `project:conversationsDeleteAll` — `conversationsDeleteAll(filePath)` → 只删除 **不在 openIds 里** 的会话（元数据 + jsonl）
  - `project:conversationsRebind` — `conversationsRebind(oldPath, newPath)` → 迁移 `byFile` 键
    （未保存文档首次保存、文件重命名/移动时与既有 `rebindChat` 配套调用；否则打开集合与标题全部丢失）
- 复用 `store.ts` 既有 `chatsDir`/`assertSafeId`/jsonl 删除；不新增穿越面。

**D10 增量：中断标记字段（集中式、向后兼容）**：

- `packages/project-store/src/types.ts` 的 `ChatMessage`（:40）追加 `interrupted?: boolean`
- `ipc.ts` 的 `AppendChatArgs` 同步追加；`loadChat` 返回自然携带
- 旧记录无此字段 → 视为 `false`，无需迁移

**C 区接线（union 友好的最小追加，各处 1-3 行、带 LOCAL 标记）**：

| 文件 | 改动 |
|---|---|
| `packages/project-store/src/ipc.ts` | 注册上述 7 个通道（追加式）；`ProjectApi` 接口（:99 一带）追加 7 方法 + `AppendChatArgs.interrupted` |
| `apps/<app>/src/preload/index.ts`（六端各一） | 追加 7 个方法（照 `resolveChat` :317 的形态） |
| `apps/<app>/src/renderer/env.d.ts` | **仅引用型**：`projectApi: ProjectApi`（docs env.d.ts:12），类型集中在 project-store，通常无需逐端改；实施时确认各端 import 链即可 |

### 4.2 packages/ui 公共层（全部 B 区；文案一律 labels props 由端注入，组件内不取词）

**新文件 `packages/ui/src/useAiConversations.ts`** —— 会话池 hook，单端接入点：

```ts
interface AiConversationMeta { chatId: string; title: string; createdAt: number; lastActiveAt: number }
/** 激活态唯一真源：会话 chatId ｜ 助手 ｜ 空态（关到零）；历史是浮层不占激活态（D13） */
type AiActiveTab = string /* chatId */ | 'assistant' | 'empty'

interface UseAiConversations {
  /** 当前打开的会话（tab 顺序 = openIds 顺序） */
  open: AiConversationMeta[]
  /** 历史列表（= 全量 - open） */
  closed: AiConversationMeta[]
  /** 激活 tab（含 'empty' 虚拟态），tab 行高亮与 body 渲染的唯一依据 */
  activeTab: AiActiveTab
  setActiveTab(tab: AiActiveTab): void
  /** 正在流式运行的会话 id 集合（驱动 tab 圆点） */
  runningIds: ReadonlySet<string>
  create(): void                    // 新建并激活
  /** 关闭（进历史）。运行中的会话由调用方先 handle.stop()（§4.3）再 close */
  close(id: string): void
  /** 历史还原成 tab 并激活 */
  restore(chatId: string): void
  removeClosed(chatId: string): void
  removeAllClosed(): void
  /** 实例上报：标题（首条用户消息，或懒加载回填）、每轮结束、运行态变化 */
  reportTitle(chatId: string, title: string): void
  touch(chatId: string): void
  setRunning(chatId: string, running: boolean): void
}
function useAiConversations(filePath: string | null): UseAiConversations
```

- **激活态仲裁（单一真源，消除双源冲突）**：`activeTab` 由本 hook 独有；
  `setActiveTab('assistant')` 时写入既有 `usePanelTab` localStorage 键（值域收窄为 `'assistant'` 单值）；
  `setActiveTab(chatId)` 时**不写**该键、由 `conversationsOpenSet` 持久化。
  mount 仲裁顺序：① `conversationsList` 返回的 `activeId` ∈ openIds → 用之；
  ② 否则 localStorage 存值 === `'assistant'` → 用之（**存量残留 `'chat'`/`'history'` 一律视为无效**）；
  ③ 否则 openIds 非空 → `openIds[0]`；④ openIds 为空 → `'empty'`（空态）。
- 持久化：openIds/activeId 变化防抖 300ms 调 `conversationsOpenSet`；`create/close/restore/remove*`
  即时各调对应 API；`projectApi` 缺失时全内存降级（§2.1 末条）。
- 文件换绑：端上既有 `rebindChat` 生效处（如 docs :560-585 的 effect）**同点追加** `conversationsRebind` 调用。

**`packages/ui/src/PanelTabs.tsx` 扩展**（B 区，随 D7 直接改）：

- `PanelTabItem` 增加可选 `onClose?: () => void` 与 `running?: boolean`；有 `onClose` 渲染 ✕
  （`stopPropagation`，点 ✕ 不触发切换），`running` 渲染小圆点
- 现有 `usePanelTab` 签名不变（§4.2 hook 内部按上述仲裁使用）

**新文件 `packages/ui/src/AiHistoryList.tsx`**（B 区）：历史**列表体**，六端共用。
props：`items`、`labels`（{ deleteOne, deleteAll, empty }，端从 local i18n 取词注入）、`onRestore`、`onDelete`、`onDeleteAll`。
条目 = 标题 + 相对时间（格式化内置），hover 显删除，底部「全部删除」；**items 只含非空会话（D12，由 hook 的 `closed` 保证）**。

**新文件 `packages/ui/src/AiHistoryPopover.tsx`**（B 区，D13）：🕘 图标触发的下拉浮层——
锚定图标下方弹出、点外部关闭、max-height 内滚动（交互模式照 `DockShell` 的 `dockshell-menu`），
内部渲染 `AiHistoryList`；点条目 = `restore(chatId)` 并收起浮层。

**新文件 `packages/ui/src/AiTabConfirm.tsx`**（B 区）：轻量确认气泡（仓库无通用 confirm 组件）。
props 含 `labels`；三处使用：关闭运行中会话（「停止并关闭/取消」）、历史单删、历史全删。

**新文件 `packages/ui/src/AiConversationsEmpty.tsx`**（B 区）：空态引导，props 含 `labels` + `onCreate` + `onOpenHistory`。

**新文件 `packages/ui/src/aiContinuation.ts`**（B 区）：通用续作指令常量
`AI_CONTINUE_INSTRUCTION`（措辞沿用 docs `continuation.ts` 的 `DOCS_CONTINUE_INSTRUCTION`）。
「继续」机制现状只有 docs 有（`continueRun` :1120）；其余五端的续作入口在各自 `AiConversationBody`
内实现（B 区），全部统一引用此常量；docs 端接入时改引新常量或保留本地文件均可（二选一，不双份维护）。

**样式**：新选择器（`.ai-tab-close`、`.ai-tab-dot`、`.ai-history-*`、`.ai-conv-empty-*`）追加进
`packages/ui/src/dock.css`（B 区）。禁止写进上游 `styles.css`（制度 §3.4）。

> P1 阶段各端 local 词条尚不存在：单测一律传字面 labels，不依赖词条。

### 4.3 六端接入模式（每端固定的 4 个整块替换 hunk + 1 个新文件）

以 docs 为模板（P2 先行），其余端同构：

1. **tab 定义 hunk**：`aiTabs` 常量 → 由会话池派生
   `[ ...open.map(c => ({ id: c.chatId, label: c.title || t('aiConvUntitled'), onClose: () => closeFlow(c.chatId), running: runningIds.has(c.chatId) })), { id:'assistant', label: t('aiTabAssistant') } ]`；
   `activeId={conv.activeTab}`；localStorage 键只承载 `'assistant'` 单值（§4.2 仲裁）。
2. **newChat 函数 hunk**：整函数删除；`+` 按钮 onClick = `conv.create()`；原清空逻辑经 §4.5 分类后拆入实例卸载与面板级（见该节）。
   > 台账同步登记「弃用 newChat」裁定（制度 §5.2：本地删除上游导出/行为，理由 = 语义被多会话模型替换）。
3. **body 渲染 hunk**：把现有「对话体 JSX（消息流 + 输入区/composer + 附件条）」原样搬进**新 B 区组件**
   `apps/<app>/src/renderer/ai/AiConversationBody.tsx`（每端一个，接收该端原有 props：editor/ops/tools/editQueue 等）；
   渲染处改为：

   ```tsx
   {conv.open.map(c => (
     <div key={c.chatId} style={c.chatId === conv.activeTab ? undefined : { display: 'none' }}>
       <AiConversationBody chatId={c.chatId}
         onRunningChange={r => conv.setRunning(c.chatId, r)}
         onFirstMessage={text => conv.reportTitle(c.chatId, shorten(text, 14))}
         onTurnEnd={() => conv.touch(c.chatId)}
         onRegister={(handle: { stop(): void }) => { bodyHandles.current.set(c.chatId, handle) }}
         onUnregister={() => { bodyHandles.current.delete(c.chatId) }}
         {…原有 props} />
     </div>
   ))}
   {conv.activeTab === 'empty' && <AiConversationsEmpty …/>}
   ```

   **实例内部职责**：
   - 懒加载本会话 jsonl（**`loadChat limit: 10_000` 全量装载，D11**——store 上限 `MAX_CHAT_LIMIT = 10_000`
     即实际全量（store.ts:69），六端原为 200 是长会话开头丢失的根源，本功能随接入一并上调）→ `loop.restore`；
     **加载后若该会话 title 为空且 transcript 存在首条 user 消息 → 按 §4.7 规则调 `reportTitle` 回填**（存量迁移会话由此获得标题）
   - **懒加载与惰性 loop 的上下文衔接（D10 硬性要求）**：历史在实例挂载时加载，而 loop 是首次 runWith
     才构造的——加载到的消息必须**先缓冲、在 loop 构造时、发送首条消息前**灌入
     （`loop.restore(msgs.map(m => ({role, text})))`，含 interrupted 半截文本）；
     禁止「loop 不存在就把 restore 结果丢弃」的实现——那是「继续时模型失忆」的直接根源
   - **中断落盘（D10）**：`onDone({cancelled})` 时，`cancelled && (半截文本 || 工具活动非空)` →
     照常 `appendChat`（`interrupted: true`）；全空则不落盘（此时断点 = 任务起点，任务指令本身就是断点标记）。
     落盘时机在实例存活期内完成（见下方关闭流程的 stop 返回 Promise 保证时序）
   - 自带 loop 实例（**首次 runWith 才构造**，避免挂载即建 N 个循环）
   - 向父级注册命令句柄 `handle.stop(): Promise<void>`（中止本会话在途请求/流式，**resolve 于该轮
     interrupted 落盘发起之后**）；父级以 `Map<chatId, handle>` 持有
   - 卸载时执行**经 §4.5 分类判定为实例私有**的清理（在途请求中止、QC/澄清等）；`handle.stop()` 与卸载清理互为兜底
   - 助手 tab 体**不在**本组件范围，保持面板级原样（§4.5）
4. **按钮条件 hunk**：`actions` 槽改为常驻两个图标 `[+] [🕘]`（删掉 `tab==='chat' && …` 条件）：
   `+` → `conv.create()`；`🕘` → `<AiHistoryPopover …/>`（D13）。

**关闭分流（D12 前置）**：✕ → 该会话 transcript 为空（0 条记录）→ 直接 `conv.close(id)`，
hook 内部按空会话**丢弃**（删元数据、不产生历史条目、不弹任何确认）；非空才走下方确认/落盘流程。

**关闭运行中会话的完整流程（D5 + D10）**：✕ → `AiTabConfirm`（「对话正在进行，关闭将停止该次运行」）→ 确认 →
`await bodyHandles.get(id).stop()`（该轮半截文本+工具活动以 `interrupted: true` 落盘）→ `conv.close(id)`（实例卸载兜底清理）。
数据语义：**半截轮次落盘且带中断标记（D10）；后续从历史还原可见、可续作**。

### 4.8 断点续作与上下文保真（D10 + D11）

**目标**：任何时刻问「总结以上」或说「继续」，模型都立刻拿到当前会话的**全部问答**；任务中断后「继续」知道断在哪、接着做完、不重复已完成步骤。

**中断的三种情形与上下文去向**：

| 情形 | 上下文在哪 | 断点痕迹 |
|---|---|---|
| 切走 tab，后台继续跑（不中断） | 实例常驻内存，天然连贯 | 无需任何处理 |
| 关闭 tab / 关文件 / 停止按钮 | 实例（或面板）卸载，内存上下文销毁 | 半截轮次 `interrupted:true` 落盘（§4.3）；还原/重开时随 transcript 懒加载 → 缓冲 → 建 loop 时 restore 灌回 |
| 轮次达上限 / 被截断（run 未死） | loop 上下文完整 | 既有 `turnLimit/truncated` 场景，「继续」入口沿用 |

**「继续」入口**：`AI_CONTINUE_INSTRUCTION`（`packages/ui/src/aiContinuation.ts`，措辞 = docs 现版：
"Continue the current task… Finish only the outstanding work. Do not repeat edits or steps that are already complete."）。
显示条件（body 内判定）：最后一轮为 `interrupted`，或既有 turnLimit/truncated 场景。
六端均须有此入口（现状仅 docs 有，其余五端在 `AiConversationBody` 内新增，B 区）。

**转录渲染**：带 `interrupted` 的历史条目显示「已中断」角标（`ChatEntry` 加 `interrupted?: boolean`，
形态照既有 `turnLimit?: boolean`，docs :115-127）；活动会话内刚停止的轮次沿用现有「已停止」展示，
落盘后成为历史条目时按角标渲染。

**上下文口径（如实声明）**：restore 只喂 `{role, text}` 对（含半截文本），工具输出不回喂——与全应用现状一致，
不是本功能引入的缺口；模型对断点的感知来自半截文本叙述 + 文档实际状态。

**全量装载（D11）**：恢复路径（重开文件、历史还原、关闭后还原）一律 `loadChat limit: 10_000`
（= store `MAX_CHAT_LIMIT`，即实际全量；六端原 200 上调，随各端接入落地）。链路三硬性点：
①六端渲染端 limit 上调（一行 ×6）；②§4.3 的「缓冲 → 建 loop → restore 灌回」衔接链不得丢数据；
③D10 的 interrupted 半截轮次在同一链路自然在场。

**成本口径（为何全量装载不会拖慢/烧 token）**：装载量与请求量是两回事——
loop 既有预算机制（`agent-core/src/loop.ts`，默认开启）决定每条请求真正发多少：
`restore()` 对超出预算的老历史做**机械折叠成摘要、零 LLM 请求、零延迟**（loop.ts:342-348），
保留最近 ~96KB 逐字（用户边界切分）；运行中超 256KB 预算才触发一次摘要压缩（失败也照常继续，只是贵一点），
另有 40 条历史上限在用户轮边界修剪。因此 D11 的真实增量仅为：**超长会话（>100 轮）恢复后，
开头内容以摘要形态在场**（而非被 200 条上限整段丢弃），单请求成本上限与今天的超长活会话完全相同。
不做任何自定义窗口/限流设计——既有机制已兜住。

每处 hunk 顶部按**制度 §4**的 D 区登记格式标记（要素：时间、基点 commit、改了什么、上游同意图的动向、收敛条件），例：

```ts
// LOCAL(2026-09-21, <实施时 base commit>): 多会话改造——aiTabs 由会话池派生；
// 上游暂无同类实现（基点至 09485f8 无多会话动向）；下次同步若上游原生实现多会话/会话列表，
// 评估取上游并删除此块（收敛条件）。
```

并在 `docs/upstream-sync.md` 台账登记六端改写 + newChat 弃用裁定。

### 4.4 历史对话：🕘 图标与下拉浮层（D13）

tab 行**没有**历史 tab。🕘 图标常驻 `actions` 槽 `[+] [🕘]`，点击弹出 `AiHistoryPopover`（§4.2），
内部渲染 `<AiHistoryList items={conv.closed} labels={…} …/>`（全端同构）。
点条目 → `conv.restore(chatId)` 并收起浮层；单删/全删 → `AiTabConfirm` 确认 → `removeClosed` / `removeAllClosed`。
空历史显示 `labels.empty` 文案。**`closed` 只含非空会话（D12）**。

### 4.5 资源归属分类（全端硬性前置步骤，docs 在 P2 也必须做）

「新对话」旧清单（§1.2）里的每一项，动手前先归入三类，结论落成代码注释：

| 类 | 判定 | 归宿 |
|---|---|---|
| 实例私有 | 只服务于单个会话的转录/流式/输入（如 slides 的 `clarifyAnswers`、`qcAbortRef`，html 的 `receipts`，各端 `attachments`/`sentAttachmentsRef`） | 搬进 `AiConversationBody`，卸载时清理 |
| 面板级共享 | 跨会话/跨 tab 共用（如 docs/markdown 的 **writer**——对话体 write 工具与助手体 `AssistantBrowser` 共用（docs AiPanel :1552-1559 onRun 走 runDocWriter）、sheets 的 `preview`/`aiRunScope`） | 留在面板级；**实例卸载绝不清理**；其旧「newChat 时清理」职责改挂到对应业务动作上 |
| 全局/UI | 语言、主题、设置等 | 原地不动 |

> **writer 特别说明**：`abandonWriter()` **不进**实例卸载清单——关闭任一会话 tab 不得误杀共享写作会话；
> 会话关闭时只中止该会话自己在途的请求（`handle.stop()`）。writer 的收尾由其业务流程自理（现状语义不变）。

### 4.6 i18n（遵循制度 §3.1：本地词条物理分离，禁止改上游 shard）

**新键清单（约 15 键）**：`aiHistoryTooltip`（🕘 图标 tooltip，D13；原 `aiTabHistory` 键作废——历史不再是 tab）、
`aiConvUntitled`、`aiHistoryEmpty`、`aiHistoryDelete`、
`aiHistoryDeleteAll`、`aiHistoryDeleteOneConfirm`、`aiHistoryDeleteAllConfirm`、
`aiConvCloseRunningTitle`、`aiConvCloseRunningBody`、`aiConvStopClose`、
`aiConvEmptyTitle`、`aiConvEmptyBody`、`aiConvNewTooltip`（`+` 提示，可复用既有 `aiNewChat`/`aiNewChatTitle` 则不新增）、
`aiTurnInterrupted`（D10「已中断」角标）、`aiContinue`（D10「继续」入口；docs 既有同名键，其余五端进 local）。

- **词条文件（B 区）**：docs/sheets/slides/html 建 `apps/<app>/src/renderer/i18n/local/ai-local.ts`；
  pdf/markdown 建 `apps/<app>/src/renderer/i18n/strings-local.ts`。
  **每端接入 PR 内即含全 20 语言**（zh 为基准先写，同 PR 补齐其余 19 语言，不留半截）。
- **挂载行（C 区，限一行 import + 一行 spread，带 LOCAL 标记，纳入 P5 台账）**：
  - docs/sheets/slides/html：`apps/<app>/src/renderer/i18n/strings-ai.ts` 装配处
  - pdf/markdown：`apps/<app>/src/renderer/i18n/strings.ts` 装配处
  - 写法照制度 §3.1 试点模板（`apps/shell/src/renderer/src/strings.ts:7244-7250` 的 spread 合并）

### 4.7 标题与时间

- 首条用户消息（及懒加载回填，§4.3）：`title = text.replace(/\s+/g, ' ').trim().slice(0, 14)`；空串回退「新对话」
- `lastActiveAt`：每轮 `onTurnCompleted` 时 `touch`（docs App 已有该回调链，其余端在 body 内联）
- 历史条目时间显示：相对时间（分钟/小时/天），格式化工具放 `AiHistoryList` 内

---

## 5. 测试计划

| 层 | 文件 | 覆盖 |
|---|---|---|
| project-store | `packages/project-store/tests/conversations.test.ts`（新） | 播种迁移（老文件首查生成单会话且 openIds=[旧chatId]）、create/meta/openSet 持久化、delete 删 jsonl、deleteAll 跳过 openIds、**rebind 键迁移（打开集合与标题保留）**、**interrupted 字段回环（appendChat 带 interrupted → loadChat 原样返回；旧记录无字段读为 false）**、safe-id 拒绝、并发写不丢单 |
| packages/ui | `packages/ui/tests/ai-conversations.test.tsx`（新） | create/close/restore/activate 状态机；**activeTab 仲裁四序**（activeId 有效 / localStorage 残留 'chat'/'history' 视无效 / openIds[0] 兜底 / 'empty'）；runningIds 传播到 tab 圆点；首条消息置标题 + 懒加载回填空标题；关到零进入 'empty' 空态；**关闭空会话不产生历史条目且元数据被删（D12）**；无 projectApi 降级内存态 |
| packages/ui | `packages/ui/tests/ai-history-popover.test.tsx`（新，D13） | 图标点击开浮层、点外部关闭；条目点击 restore 并收起；空历史显示 empty 文案；单删/全删走确认 |
| packages/ui | `packages/ui/tests/panel-tabs.test.ts`（扩展既有或新增） | ✕ 点击不切 tab；running 圆点渲染；onClose 后 tab 消失 |
| 回归 | 既有 `dock-shell.test` / `dock-shell-drag.test` / `store.test` / `traversal-limit.test` 及六端构建 | 全绿（`npm test -w @chatoffice/project-store`、`npm test -w @chatoffice/ui`、根 `npm test`） |
| 手动冒烟 | 六端 `dev:desktop` 各跑一遍 §7 清单 | 逐项勾选 |

---

## 6. 实施顺序（每阶段有硬性验收，不达标不进下一阶段）

| 阶段 | 内容 | 验收 |
|---|---|---|
| **P0** | project-store `conversations.ts`（含 `conversationsRebind`）+ ipc/preload/env.d.ts 接线 + 单测 | P0 单测全绿；`store.test`/`traversal-limit.test` 不回归 |
| **P1** | `useAiConversations`（含 activeTab 仲裁与 'empty' 态）+ `PanelTabs` 扩展 + `AiHistoryList` + `AiTabConfirm` + `AiConversationsEmpty` + CSS + 单测 | P1 单测全绿（labels 传字面）；既有 ui 测试不回归 |
| **P2** | docs 端：**先做 §4.5 资源归属分类（落注释）**，再按 §4.3 四 hunk 接入 + `AiConversationBody` 抽取 + i18n local（全 20 语言）+ D 区标记 | docs 跑完 §7 清单全过；单会话老文件打开行为与改造前一致；关闭会话不误杀 writer |
| **P3** | sheets：§4.5 分类（App 级 preview/aiRunScope/message 与聊天级状态的归属结论落注释）→ 接入（hook 挂 App.tsx）+ i18n local | sheets 跑完 §7 清单 + preview/runScope 在切换关闭时被正确清理 |
| **P4** | slides / markdown / html / pdf 依 §4.3 接入（每端先 §4.5 分类）+ 各端 i18n local | 每端冒烟 §7 清单全过 |
| **P5** | 全量核对：20 语言 key parity 补缺；`docs/upstream-sync.md` 台账登记（六端 D 区改写 + i18n 挂载行 C 区条目 + **newChat 弃用裁定（入拒绝清单，同步时对上游 newChat 相关改动逐个裁决）**）；单会话等价性自检（对比改造前单一会话路径的渲染/持久化 diff 审查） | 台账条目齐全；等价性自检记录在 PR 描述 |

> i18n/CSS 实际随各端接入同步落地（P2–P4 每端 PR 即含全 20 语言），P5 只做 parity 核对与补缺。

---

## 7. 验收清单（产品行为，逐端过）

1. 对话栏可同时打开多个对话，tab 在对话栏上方横向排列；超出可横向滚动
2. 「+」与「🕘」两个图标常驻右上方、面板布局按钮左侧（顺序 `[+] [🕘]`）；任何 tab 激活时都可见；点击 + 新建并自动切换
3. tab ✕ 可关闭；关闭运行中的会话弹「停止并关闭」确认；确认后流式中止，半截轮次以「已中断」标记落盘（D10）、会话进历史
4. 🕘 图标点开下拉浮层：列出当前文档所有**非空**未打开会话（标题 + 最后活跃时间）
5. 浮层点条目还原为 tab 并收起；单个删除、全部删除均有确认；全部删除不影响打开中的 tab
6. 标题 = 首条用户消息前 ~14 字；未发言显示「新对话」；存量迁移会话在懒加载后补出标题
7. 切走会话后台继续流式，非激活 tab 显示运行中圆点，切回可见完整流式过程
8. 重开文件：上次打开的 tab 集合与激活项原样恢复；历史列表是其余会话
9. 存量老文件首次打开：自动迁移为一个 tab，历史内容与升级前一致
10. 新文档：空开一个「新对话」tab
11. 未保存文档发起对话后首次保存：会话 jsonl 与索引（打开集合、标题、激活项）一并换绑到新路径
12. 关光所有 tab：tab 行「助手」无高亮，对话体显示空态引导（新建 / 点 🕘 从历史还原）；新建或还原后离开空态
13. 无 `projectApi` 环境：功能可用（内存态），不报错
14. 助手 tab 行为与改造前完全一致（体不实例化、共享 writer 不受会话关闭影响）
15. 断点续作（D10）：任务运行中关闭 tab → 从历史还原 → 转录含半截消息带「已中断」角标 → 说「继续」→ 模型接着做、不重复已完成步骤；轮次达上限/截断场景的「继续」行为与改造前一致
16. 上下文保真（D11）：制造一个超过 200 条消息的会话 → 重开文件 → 问「总结以上」，答案覆盖会话**开头**的结论（全量装载生效）
17. 关闭空会话（从未发送消息）直接消失：不出现在历史浮层、不弹确认（D12）

---

## 8. 风险与注意事项

- **sheets 状态归属是最大未知**：P3 的 §4.5 分类是硬性前置，若发现 App 级耦合比预期深，
  允许 sheets 晚于其他端交付，但接口不得偏离公共层
- **共享资源误杀**：实例卸载清单必须以 §4.5 分类结论为准；writer/预览等面板级共享资源严禁进实例清理
  （docs writer 被对话体与助手体共用，docs AiPanel :1552-1559 为证）
- **激活态双源**：严格按 §4.2 仲裁实现，禁止两处同时可写；存量 localStorage `'chat'` 残留视为无效
- **loop 实例成本**：必须惰性构造（首次发消息才建），防止打开 N 个 tab 即建 N 个循环
- **`conversations.json` 写竞争**：单窗口单渲染端写（桌面端有单实例锁，见 commit 0dca6f02）；仍需防抖合并写
- **上游同步**：六端面板 hunk 必须带制度 §4 五要素 D 区标记；收敛条件统一为
  「上游若原生实现多会话，评估取上游并删除本地会话池」；newChat 弃用入拒绝清单（制度 §5.2/§5.3），
  每轮同步检查上游是否把 newChat 接进新代码
- **行号漂移**：本文所有行号是 2026-09-21 基线，实施时以符号名检索定位
- **恢复后首条消息的上下文成本（D11 代价）**：已被 loop 既有预算机制兜住（restore 机械折叠零 LLM 请求、
  运行时 256KB 预算压缩、40 条上限，见 §4.8 成本口径）；单请求成本上限与今天的超长活会话相同，无需新增限流
- **恢复链路丢数据 = 「继续失忆」**：「缓冲 → 建 loop → restore」衔接链与 D10 落盘时序是本功能的正确性命门，
  代码评审按 §4.3/§4.8 逐条对照
- **不改上游 `styles.css` / i18n shard**：违者按制度回退

---

## 9. 实施记录（2026-09-21，本文 P0–P5 已执行完毕）

**落点**：P0 → `packages/project-store/src/conversations.ts` + `conversations-ipc.ts` + `types.ts`/`store.ts`/`ipc.ts` 最小 C 区追加 + 三端 main 注册 + 六端 preload 7 方法；P1 → `packages/ui` 的 `useAiConversations`/`PanelTabs` 扩展/`AiHistoryList`/`AiTabConfirm`/`AiConversationsEmpty`/`aiContinuation` + `dock.css` 追加段；P2–P4 → 六端接入（模式见下）。

**接入模式**：docs/markdown/html/pdf/slides =「外壳 + 会话体」——原面板主体改为按会话实例化的 `AiConversationBody`（slides/markdown/html/pdf 在同文件拆分，docs 独立成文件 + `ai-body-types.tsx`），外壳持会话池、tab 行、确认气泡、历史列表、空态、助手 tab（不实例化）；sheets = 会话池挂 App.tsx + 每会话一个隐藏宿主 `AiSheetsConversation`（视图状态上报，AiChatPanel 渲染激活会话）。

**与计划的关键偏差（已核实合理）**：
1. **会话 chatId 一次生成永不换绑**（UUID），未保存→保存只迁移 conversations 索引键（`conversationsRebind`），不再对会话走 `rebindChat`/路径 hash——多会话下多个 jsonl 共属一个文件，单文件 hash 换绑会把多会话合并成一个 jsonl。§7.11 的语义（jsonl 与索引跟随文件）经由索引键迁移达成。
2. **未保存文档播种**：种子 chatId 亦为 UUID（temp id 只是索引键），保证换绑不动 chatId。
3. **loop 惰性构造**落实到六端（首次 send 才建，防止 N 个 tab 建 N 个循环，§8 风险）。
4. **D10 中断落盘**：六端 onDone 的 cancelled 分支改为「半截文本或工具活动非空 → persist(interrupted: true)；全空不落盘」；恢复链路「loadChat 10_000 → 缓冲 → ensureLoop 时 restore 灌回」为硬性衔接，六端一致。
5. **历史渲染**：六端转录含 `interrupted` 角标；markdown/html/pdf 的历史并入 chat 数组（沿用各自既有形状），docs/slides/sheets 走 historic 段。
6. **sheets 面板级共享**（§4.5 结论落点）：preview/lazyPreviewRef、aiRunScope、aiApplyPromises 池、message、autoSave 留 App；运行中会话的 auto-apply 徽章经 `activeRunPatchRef` 路由进运行中的会话。writer 仅 docs 为面板级（markdown 助手体不使用 writer，writer 归实例私有）；两结论均已落代码注释。

**单会话等价性自检**（对比改造前路径）：
- 持久化：种子会话 chatId = `resolveChatForFile` 的既有 chatId（老用户逐字节等价，tests/conversations.test.ts 播种用例护航）；appendChat 载荷形状不变，仅新增可选 `interrupted`。
- 渲染：消息/composer JSX 原样搬迁（docs 逐字节搬入 body；slides/markdown/html/pdf 原地保留）；localStorage `*.aiTab` 键沿用，残留 'chat' 按仲裁规则视为无效。
- 行为差异（均为计划约定）：loadChat limit 200→10_000（D11）；「新对话」语义替换（§5.2 裁定，已入拒绝清单）；历史还原后可「继续」（D10 新能力）。

**i18n**：六端 local 词条文件各 15 键 × 20 语言（slides/markdown/html/pdf 另补 `aiContinue`；aiNewChat/aiNewChatTitle 复用上游键）。

---

## 10. 待实施增量：D12/D13（2026-09-22 补充需求）

> §9 的 P0–P5 实现按「历史对话为 tab」的旧设计落地；D12/D13 是实现完成后的补充需求，需在既有代码上做一次增量改造。
> 改动清单（对应本文已更新的 §2/§4.2/§4.3/§4.4/§4.6/§7）：

1. **D13 历史 tab → 图标下拉**：
   - 六端移除 tab 行的 `history` 项；`actions` 槽改为常驻 `[+] [🕘]`
   - 新增 B 区组件 `packages/ui/src/AiHistoryPopover.tsx`（下拉浮层，交互照 `dockshell-menu`），内部复用既有 `AiHistoryList`
   - hook：`AiActiveTab` 收窄为 `chatId | 'assistant' | 'empty'`；仲裁 ② 的 localStorage 有效值收窄为 `'assistant'`（残留 `'history'` 视为无效）
   - i18n：`aiTabHistory` 作废，新增 `aiHistoryTooltip`（20 语言 × 六端 local 文件）
2. **D12 空会话不进历史**：hook 的 `close(id)` 前置分流——transcript 为空（0 条记录）→ 直接丢弃（删元数据、不产生历史条目、无确认）；非空才走既有确认/落盘流程。`closed` 列表因此天然只含非空会话
3. **验收复验**：§7 清单第 2/3/4/5/12/17 项；既有单测按 §5 新增的 D12/D13 用例补齐
4. **D 区标记**：六端 hunk1/hunk4 复访处按制度 §4 追加增量标记；台账补记

### 10.1 实施记录（2026-09-22，D12/D13 已执行完毕）

**落点**：
- `packages/ui/src/useAiConversations.ts`：`AiActiveTab` 收窄（删 `'history'`）；仲裁 ② 仅认 `'assistant'`；`setActiveTab` 只对 `'assistant'` 写 localStorage。D12 分流落在 hook 内——「空」的判定 = `meta.title === '' && 本挂载期内无「已发言」信号`，信号取既有上报链（`reportTitle` 首条用户消息/懒加载回填、`touch` 轮次完成、`setRunning(true)` 运行开始，**零会话体改动**）；空会话 close = 删元数据（`conversationDelete`，jsonl 惰性未建/为空，删除容错）+ 不产生历史条目；`restore()` 即标记已发言（历史条目本就只含非空会话）；`closed` memo 过滤空会话（存量迁移的空历史条目不可见）。
- `packages/ui/src/AiHistoryPopover.tsx`（新 B 区文件）：🕘 触发按钮 + 下拉浮层一体组件；受控 `open`（空态引导的「从历史还原」可从外部打开）；fixed 定位照 `dockshell-menu`，`useDismissablePopover` 点外/失焦/chrome 按压关闭；确认气泡（AiTabConfirm）内嵌浮层内。`dock.css` 追加 `.ai-history-anchor` / `.ai-history-popover` 段（B 区）。
- 六端面板：tab 行删 `history` 项；actions 槽常驻 `[+] [🕘]`；删各自 history tab 体与 `historyConfirm` 状态（docs/slides/markdown/html/pdf 面板级，sheets 的在 App.tsx）；空态引导 `onOpenHistory` 改开浮层。sheets 特有：`AiChatPanel` 自持 `historyOpen` 状态，`conversations` prop 删 `onEmptyOpenHistory`、`history.onDelete/onDeleteAll` 改传 `conv.removeClosed/removeAllClosed` 直调（确认在浮层内完成）。
- i18n：六端 local 文件键改名 `aiTabHistory` → `aiHistoryTooltip`（20 语言 × 6 文件；值沿用原「历史对话」翻译）。
- 测试：`packages/ui/tests/ai-conversations.test.tsx` 补 D12 五用例（空会话丢弃+元数据删除 / 首条消息后进历史 / setRunning、touch 标记已发言 / 存量空历史条目不可见 / restore 后 close 回历史）+ 仲裁 ② 'history' 残留无效用例；新文件 `packages/ui/tests/ai-history-popover.test.tsx`（开关/点外关闭/条目还原收起/空文案/单删全删确认）；docs 两处旧断言（tab 数 4→3）随 D13 语义更新。
- 验证：`@chatoffice/ui` 140、`@chatoffice/project-store` 95、docs 2663、sheets 2850、slides 890、pdf 778、markdown 464、html 186、shell 638 测试全绿；ui/project-store/docs/sheets/slides/pdf/markdown/html/shell typecheck 全过。
- 台账：`docs/upstream-sync.md` §11 已补 D12/D13 条目；六端 hunk 处 LOCAL 标记已追加增量段。

**判定实现说明（与计划措辞的偏差）**：计划写「close(id) 前置分流」，本实现把「空」的判定放在 hook（通过既有上报链累积「已发言」信号），不新增会话体回调/句柄方法——因为会话体懒加载失败或未完成时无法可靠回答「transcript 是否为空」，而上报链信号是运行态事实，误判面更小；`restore()` 直接标记已发言，杜绝「还原后立即关闭误丢」的竞态。语义与 D12 决策一致。

**真机验证记录（2026-09-22，dev:desktop + CDP 驱动，docs 端）**：
- §7.2 `[+][🕘]` 常驻、顺序正确（actions 在布局按钮左侧）、无 history tab ✓
- §7.3 运行中关闭弹「对话正在进行/关闭将停止该次运行…/停止并关闭」；取消会话保留；确认后停止落盘进历史（重试确认：中断轮次两条均出现在浮层）✓
- §7.4 浮层列出非空历史（标题+相对时间「<1m」）+ 底部「全部删除」✓
- §7.5 条目点击还原成 tab 并收起浮层（转录在场）；单删/全删均有确认，取消不删、浮层不关；确认后条目消失→「暂无历史对话」✓
- §7.6 标题=首条消息前 14 字（「用一句话描写春天」「调整文档格式 使用正常的文档」）✓
- §7.8 重开文件恢复打开集合+激活项+标题懒加载回填（大美中国.docx 恢复 2 tab；大美中国-2 恢复用户会话 tab）✓
- §7.10/§7.12 新建文档空开「新对话」tab；关光所有会话→tab 行只剩「助手」无高亮+空态引导；空态「新建」离开空态、「从历史还原」打开 🕘 浮层；浮层点外关闭 ✓
- §7.17 关闭从未发言的会话：无确认、直接消失、浮层无条目（D12）✓
- §7.7 后台续跑圆点实证（running dot 出现）；切回完整流式由 display:none 常挂架构保证（D9）
- 其余项（9 存量迁移/11 换绑/13 内存降级/15 断点续作中断标记/16 全量装载）由单测覆盖：conversations.test.ts 播种与 rebind 用例、ai-conversations.test.ts 降级与 restore 用例、picture-svg-blip 之外的中断回环用例
- 截图：docs/screenshots/d13-01…03（后续帧因 dev 实例中断未截，DOM 级断言已覆盖对应行为）
