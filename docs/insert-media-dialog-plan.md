# 插入媒体窗口改造共识计划

> 状态：共识达成（2026-09-06，9 轮问答收敛），未开工。
> 范围：`packages/ui/src/InsertImageDialog.tsx` 及其三个宿主（docs / sheets / slides）+
> `packages/ai-search`、`packages/ai-provider`、`packages/ai-host`。
> 代码约束：本文档落盘前未写任何实现代码。

## 背景与问题

用户对"插入图片窗口"提出三项完善：

1. **网页搜索无内容**：根因是三后端全灭——chatoffice 要登录+开云工具；Serper 只认
   环境变量 `SERPER_API_KEY`，设置页无配置入口；DuckDuckGo 国内不可达且图片链路的
   vqd token 两步抓取极脆弱。全灭时 `imageSearch()` 返回空列表，UI 只显示"无结果"。
2. **Pexels / Pixabay 密钥**：现状点 ⚙ 在搜索 tab 内嵌展开一个面板，两家的 key 输入框
   并排同屏（`InsertImageDialog.tsx:265-308`），要求分开、弹出设置。
3. **AI 生成图像**：现状无模型选择（后端固定 `pickImageModel()`：显式默认图模或第一个
   启用的图像生成模型）；尺寸为写死三枚 chip；参数仅 prompt/尺寸/数量。要求模型清单
   加载图像生成、视频生成等类型模型，并按模型动态生成参数输入框。

现状关键代码事实：

- 对话框为共享组件 `packages/ui/src/InsertImageDialog.tsx`（412 行，三 tab：本地/网络图片/AI 生成），
  宿主为 docs、sheets、slides（各接自己的 bridge/IPC）。
- `packages/ai-provider` 已有分型基础：`inferModelType`、`DEFAULT_KIND_TYPES`、
  `resolveDefaultModel`、`capabilityBlockers(role)`；但**视频生成只有类型标记与能力门
  （`VIDEO_GEN_VENDOR_IDS`），无任何调用实现**（仅 `imagegen.ts`）。
- `VIDEO_GEN_VENDOR_IDS` 门了 13 家 vendor，其中 **kling / runway / luma / vidu /
  pixverse / fal 六家在 `vendor-catalog.ts` 无供应商档案**（无 baseUrl、无 keyUrl、
  设置页无凭证入口）。
- `runtime.generateImage(req)` 签名内不含模型选择（内部 `pickImageModel()`）。
- 共享主进程逻辑位于 `packages/ai-host`（`ai:web-image-search`、`ai:stock-image-search`
  等 IPC handler 已在此）。
- chatoffice 图像生成走代理标准化的 `/images/generations`；**无任何视频端点证据**。

## 决策记录（问答链）

| # | 问题 | 决定 |
|---|------|------|
| 1 | 视频生成模型生成出的视频在"插入图片"窗口怎么处理 | 完整支持生成并插入视频（最大范围） |
| 2 | "插入视频"在三个编辑器各做到什么程度 | slides 真插入；docs 封面帧+链接；sheets 报错 |
| 3 | 视频适配器第一波接几家 | 13 家全部一次做完 |
| 4 | 6 家缺失 vendor 档案是否本次新建 | 一并新建（含 kling 双字段凭证 UI） |
| 5 | 动态参数 schema 单一事实源放哪 | 适配器自声明 ParamSpec |
| 6 | 分钟级视频任务的生命周期 | 后台存活+完成通知 |
| 7 | 后台任务并发语义 | 多任务并发，上限 3 |
| 8 | 搜索修复方向 | 换 Openverse 兜底 + Serper key 进设置页 + 自建 Bing 抓取源 + 逐层诊断 |
| 9 | 搜索兜底链顺序 | chatoffice→Serper→Bing→Openverse；删 DuckDuckGo 图片链路 |
| 10 | 图库密钥交互形态 | 每家独立模态小窗+测试连接 |
| 11 | 模型选择器加载与记忆 | 分组下拉+会话级记忆（不写回全局默认） |
| 12 | 窗口改名与视频归属 | 改名"插入媒体"；视频放 AI tab 内，不拆 tab |

## 方案

### 1. 网页搜索修复（需求 1）

- **兜底链重排**：`chatoffice → Serper → Bing 抓取（新增） → Openverse（新增）`。
  - 删除 DuckDuckGo **图片**链路（vqd 两步跳脆弱、国内不可达）；web **文本**搜索的
    DuckDuckGo 链路保持不动。
  - Bing 抓取：国内可达、相关性好；解析失败静默降级到下一层。
  - Openverse：CC 授权图库、无 key 匿名可用、专为 API 设计；合法兜底。
  - `COPYRIGHT_HOSTS` 版权域过滤逻辑对所有层保留。
- **Serper key 进设置页**：ai-settings 新增 `searchApiKeys.serper`（与 `stockApiKeys`
  同层、同 `KEEP_KEY` 脱敏模式）；设置页新增"搜索服务"区块；读取顺序为设置页优先、
  环境变量兜底。
- **逐层诊断**：`imageSearch` 返回 `{ images, attempts: [{ backend, status:
  'skipped-no-auth'|'skipped-no-key'|'error'|'ok', detail?, count }] }`；UI 空结果时
  逐层展示诊断与配置指引，不再一句"无结果"。

### 2. 图库密钥独立设置（需求 2）

- 每家图库 ⚙ 弹**独立模态小窗**：标题=图库名，仅含该家 key 输入框+申请链接+保存。
  废除两框并排的内嵌面板。
- 新增**测试连接**：保存前发一次轻量请求（`searchStockImages`，query='test'，max=1），
  当场区分 key 无效 / 额度超限 / 网络失败。
- 未配置 key 时点击图库 chip 主动引导弹出设置窗。

### 3. AI 生成：模型选择+动态参数（需求 3）

- **模型选择器**：分组下拉（图像生成 / 视频生成两组），列出已启用 profile 中类型匹配
  且 **vendor 有实装适配器** 的模型（避免选中即报错）；预选全局默认图模
  （`resolveDefaultModel('image')`）；**手动切换仅会话级记忆，不写回全局默认**
  （`settings.imageModel` 不受对话框影响）。
- **参数 spec 单一事实源**：ai-provider 新增 media-params 模块——
  - 适配器自声明 `ParamSpec`：字段 id/label/类型（text|select|number|boolean）/
    枚举/默认/必填，按 vendor+modelId 正则细化（如百炼下 qwen-image 与 wanx 参数不同）；
  - 导出 `mediaParamSpec(profileId, modelId)` 供对话框动态渲染输入框；
  - 现有写死的 size/n 纳入 spec 体系（各模型尺寸枚举本就不同）；
  - `bridge.generate` 请求改形为 `{ profileId, modelId, prompt, params:
    Record<string, unknown> }`，适配器自取值自校验；
  - 对话框保持 vendor 无关的共享组件身份。
- **视频结果放 AI tab 内**，不拆 tab；选中视频模型时顶部按宿主 app 显示插入能力提示
  （幻灯片真插入 / 文档封面帧 / 表格不支持）。

### 4. 视频生成链路（全新工程）

- **适配器**：13 家一次做完——百炼 / 智谱 / 火山 / minimax / gemini / openai /
  chatoffice（已有档案）+ kling / runway / luma / vidu / pixverse / fal（新建档案）。
  统一"提交异步任务+轮询取结果"模式，各家参数走 ParamSpec。
- **vendor 档案补齐**：6 家新建条目（id、displayName、baseUrl、keyUrl、分组归属），
  设置页新增凭证入口；kling 鉴权为 accessKey+secretKey 签名 JWT，凭证 UI 支持
  双字段形态。
- **chatoffice 视频通道**：实装时验证——仅当代理模型列表真实返回视频型模型时才在
  选择器展示，否则隐藏。
- **后台任务注册表**：
  - 位置：`ai-host` 新增 video-tasks 模块（每 app 主进程一份，内存态，不跨重启）；
  - 并发：多任务并发上限 3，超出拒收；不同 vendor 互不阻塞；
  - 生命周期：对话框关闭**不杀任务**；完成后 app 内通知（toast），重开对话框在任务
    列表取结果；
  - 状态：进行中（排队/生成中+已耗时）/ 已完成 / 失败（429 标失败可重试）；
  - abort 语义：取消轮询，支持取消的 vendor 连带取消远端任务，不支持的置之不理；
  - 轮询在主进程执行，IPC 回报进度；渲染进程不自轮询。
- **视频结果存储**：结果统一先落盘（app data 目录）；URL 结果记录原 URL。

### 5. 三端插入管线

| 宿主 | 行为 |
|------|------|
| slides (pptx) | 真嵌入视频：media part + poster（优先 API 封面帧，缺省占位图） |
| docs (docx) | 封面帧图片 + 视频超链接（URL 直用；data URL 结果链接落盘副本） |
| sheets (xlsx) | 格式硬天花板不支持嵌入视频：选视频模型时即内联提示，不执行插入 |

### 6. 窗口身份与文案

- 窗口改名**"插入媒体"**；`insert-image-strings.ts` 全量文案更新，i18n 各语言同步；
  各宿主调用点的 aria/无障碍文案同步。
- 三个 tab 名不变（本地 / 网络图片 / AI 生成）；本地 tab 本期仍仅允许图片文件。
- 组件/文件是否物理改名（InsertImageDialog → InsertMediaDialog）随 P1 实施一并处理。

## P1 实施补遗（开工前复查发现）

- **【既有 bug】`normalizeV2` 丢弃 `stockApiKeys`**：`writeSettings` 走
  `migrateSettingsV2`，v2 blob 经 `normalizeV2` 重建 next 时不透传 `stockApiKeys`，
  即当前 Pexels/Pixabay key 保存后读回即丢、从未真正落盘。P1 连带修复：
  `normalizeV2` 透传 `stockApiKeys` 与新增的 `searchApiKeys`。
- **【既有死 UI】宿主 generate 桥只解构 `{prompt}`**：三宿主（Ribbon.tsx:527 /
  ExcelShell.tsx:522 / App.tsx:1446）均丢弃 size/n，UI 上的尺寸/数量 chip 从未生效。
  改形后参数经 `params` 真正下传。
- **ImageGenResult 单张限制**：现有 `generateImageWithModel` 只取第一张
  （`json.data?.[0]`），n>1 语义不存在。改为返回 `{ urls: string[] }`，
  runtime 返回 `{ url?, urls?, error? }` 兼容旧调用方（AI 工具链仍读 url）。
- **ParamSpec 双语**：字段 label 采用 vendor-catalog 的 `label`/`labelZh` 模式；
  对话框按 lang 取。
- **listMediaModels 桥接**：一次 IPC 返回 `[{kind, profileId, modelId, label,
  vendorId, spec}]`（spec 主进程侧算好内嵌，渲染层保持 vendor 无关）。
  过滤：profile.enabled + 类型 image-generation + `vendorId ∈ IMAGE_GEN_VENDOR_IDS`。
- **会话级记忆**：对话框模块级变量实现（关窗保留、重启丢失），不进 storage。
- **模型下拉底部**加"打开模型设置…"入口，复用 `bridge.openModelSettings`。
- **生成通道**：新增共享 IPC `ai:media-models` / `ai:media-generate`（ai-host 注册，
  三 app 自动可用），generate 的 URL→dataUrl 下载收敛在主进程侧完成。
- **i18n 范围修正**：本对话框实际只有 zh/en 双语（insert-image-strings.ts），
  非 19 语言；改名照做，范围以实际为准。
- **图模过滤口径**：vendorId 缺省的自定义 profile 暂不进选择器（P1 口径，后续放宽）。

## 分期交付

| 期 | 内容 | 验收口径 |
|----|------|----------|
| P1 | 对话框改造（改名/独立密钥弹窗+测试连接/模型选择器/动态参数渲染/bridge 重构）+ 搜索修复（Bing/Openverse/Serper 设置页/逐层诊断） | 三 app 搜索开箱能搜；图库 key 分窗配置可测试；AI tab 可选图像生成模型并按模型出参数框 |
| P2 | 视频生成链路（6 家 vendor 档案+13 家适配器+ParamSpec 对齐+ai-host 任务注册表+完成通知） | 已配置 key 的 vendor 可提交视频任务，关窗后台存活、完成有通知、重开取结果 |
| P3 | 三端插入管线（pptx 真嵌 / docx 封面帧+链接 / xlsx 报错） | 幻灯片可插入可播放；文档出封面帧+链接；表格内联提示不支持 |

每期完成后对下一期细节再确认。
