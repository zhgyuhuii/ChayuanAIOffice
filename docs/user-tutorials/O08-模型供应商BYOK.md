---
id: O08
title: 模型供应商 BYOK（94 家目录 × 5 种协议 × 28 个适配器）
entry: 主页左下角账号行的齿轮按钮「设置」▸「模型设置」
level: P0
tags: [模型, BYOK, API 密钥, 供应商, 连接测试]
status: draft
---

## 一句话说明

「模型设置」是把各家大模型接进察元AI Office 的总入口（BYOK = Bring Your Own Key，自带密钥）：内置 **94 家**供应商目录（国内平台 / 国际平台 / 本地与自建 / API 聚合四组），填上 API 地址与密钥、勾选模型即可启用；多家可同时启用，AI 面板顶部随时切换。模型列表一律从供应商接口实时拉取，不在产品里预置。

## 适用场景

- 第一次配置 AI：手上有 DeepSeek / 智谱 / OpenAI 等 API Key，想接进 Office；
- 想同时启用多家（如对话用 DeepSeek、生图用可灵、搜索用 Tavily），按用途各选各的默认模型；
- 换了新 Key、某个模型被厂商下架，需要更新或改选。

典型提问（chabot 语料视角）：

- 「怎么填 DeepSeek 的 Key？」
- 「连接测试在哪里？测试通过但保存失败怎么办？」
- 「我的 API Key 存在哪里，安全吗？」

## 前置条件

- 主页可打开设置弹窗（入口见第 1 步）；不指定落点时弹窗默认停在「模型设置」区。
- 至少一家供应商的 API Key（在供应商控制台生成——目录里带「需 Key」徽标的厂商，表单里有「获取密钥」直达链接）；本地免 Key 服务见 O10，不配 Key 的内置账号见 O09（当前版本登录入口未开放）。
- 机器需联网（本地与自建分组除外，见 O10）。

## 操作步骤

**第 1 步 · 打开「模型设置」**

- 主页左下角账号行上有一个齿轮按钮（悬停提示「**设置**」），点击打开设置弹窗；左栏共十个分区：**模型设置 / 默认模型 / 生图、媒体与搜索 / 本机文件搜索 / 远程存储 / 通用 / 集成 / MCP 管理 / 技能 / 关于**，本篇用前三区（AI 按能力各选各的模型，三区各管一段）。
- 右栏初次进入是说明页：上半「**国内常用模型**」卡片墙（DeepSeek、智谱、阿里百炼、月之暗面 Kimi 等 11 家）、下半「**国外常用模型**」（OpenAI、Anthropic、Gemini 等 10 家），已启用的卡片带「**已启用**」角标；页尾提示更多服务走左侧完整目录。

**第 2 步 · 认识左栏供应商目录**

- 顶部：筛选下拉（「**全部** / 免费 / 需 Key / 无需 Key / 免费额度」）+「**搜索供应商…**」搜索框。
- 目录分组（可折叠）：「**已启用** · N」（有已启用厂商时才出现，行尾 ▾ 可展开看该厂商勾选的模型）+ 四个固定分组：**国内平台 / 国际平台 / 本地与自建 / API 聚合**，合计 94 家；每家带徽标（「需 Key」「无需 Key」「免费」「免费额度」）。
- 左下角按钮「**＋ 自定义供应商**」：接任意 OpenAI 兼容接口，可自起名。

**第 3 步 · 配置一家供应商（以 DeepSeek 为例）**

1. 左栏「国内平台」组点「深度求索 DeepSeek」，右栏出现配置表单，头部有状态（「已启用，模型出现在选择器中」/「未启用」）和启用开关。
2. **API 地址**：已预填厂商默认值（DeepSeek 为 `https://api.deepseek.com`）；自建/反代地址直接改写。
3. **协议**：下拉四选——「Anthropic Messages（直连，不转换格式）」「Chat（OpenAI Chat Completions）」「Responses（OpenAI Responses API）」「Gemini Native（generateContent）」，页脚注明「四种协议均为原生直连，无需格式转换」。目录厂商已按其原生协议预选，一般不用改（内部适配共 5 种协议，第 5 种 codex-app-server 由 Codex CLI 适配器内部使用，不出现在下拉里）。
4. **API 密钥**：粘贴密钥（输入框旁「**显示密钥 / 隐藏密钥**」切换明文）；已保存过时标注「已配置（留空保持不变）」——留空重新保存不会清掉旧 Key。可灵（Kling）这类 AK/SK 双字段厂商会各给一个输入框，保存时按声明折叠成一个密钥。表单旁「**获取密钥**」直达该厂商控制台。
5. 点「**获取模型列表**」：从该厂商 `/models` 类接口实时拉取（本地服务型厂商先走 Ollama 风格 `/api/tags`，失败自动回退 OpenAI 风格清单）；成功提示「获取到 N 个模型」，失败提示「获取失败：<原因>」——产品不预置名单，接口给什么列什么。
6. 在模型清单里勾选要启用的模型（按「对话 / 视觉 / 向量 / 生图 / 视频生成 / 语音合成 / 语音识别 / 音频理解 / 视频理解」类型分组，组头可整组「全选 / 全不选」、可折叠）；至少勾一个。
7. 点「**保存并启用**」（已启用厂商为「**保存更改**」）。保存前会自动用当前协议再验证一次模型列表接口，失败则提示「协议验证失败，未保存：<原因>」，错误协议不会落盘。

**第 4 步 · 连接测试**

- 表单动作区点「**测试连接**」：对同一地址、协议、密钥发起一次模型列表调用，成功显示绿色「**连接成功**」，失败显示红色「测试失败：<原因>」（密钥错、地址错、网络不通都会在这里现形）。

**第 5 步 · 三区分工：按能力选默认模型**

- **「模型设置」区**（本篇第 3-4 步）：管「哪家供应商 + 勾了哪些模型」。
- **「默认模型」区**：七类默认各一个下拉——对话 / 页面生成 / 质检（视觉审稿）/ 生图 / 视频生成 / 语音合成 / 语音识别，未设置时「自动（使用识别到的第一个可用模型）」；另有「图片来源默认」（自动/网络图片搜索/AI 生图模型/本地图片文件夹/矢量图形）与「单次输出上限（tokens）」（默认 32768，范围 1024–131072）。
- **「生图、媒体与搜索」区**：左侧能力树八组——网络搜索 / AI 生图 / 视频生成 / 图片解析 / 视频解析 / 语音合成 / 语音识别 / SVG 图像生成。模型类组从已启用厂商里投影出「支持该能力的模型」，可「刷新模型列表」、点选一个「设为默认」（或「恢复自动」）；「网络搜索」组按平台配 API Key（带「测试」按钮，主进程执行、Key 未保存也可测）。未启用的厂商给「**去模型设置启用**」直达链接。

**第 6 步 · 密钥存哪、怎么更安全**

- Key 明文保存在本机应用数据目录的 `ai-settings.json`（macOS 为 `~/Library/Application Support/ChaAI Office/ai-settings.json`），**不上传**；界面回显用占位符（`__keep__`），重存不会泄旧值。
- 写入前经主进程 schema 校验：密钥截断到 8192 字符、模型名 256、Base URL 必须是合法 http(s)，非法字段丢弃而不是整包拒绝。
- 安全替代（进阶）：自定义端点的 profile 支持 `apiKeyEnv`——设置文件只存**环境变量名**，真实密钥放在启动应用的环境里（内联 Key 优先，二者都无则不注入），适合需要同步/共享配置文件的场景。
- 厂商停止服务的旧模型 id 会自动改写：加载设置时按内置退役表替换（如 DeepSeek `deepseek-chat`/`deepseek-reasoner`→`deepseek-flash`，智谱 `glm-5-turbo`→`glm-5.3-flash`，内置账号的 gemini 系旧 id→claude 系），旧配置文件直接可用。

### 验证

1. 左栏「已启用」组出现该厂商（带徽标），行尾点 ▾ 能展开看到勾选的模型名。
2. 打开任一编辑器 AI 面板顶部的模型选择器：勾选的对话模型应出现在列表里（生图模型进入绘画工具通道）。
3. 「测试连接」显示「连接成功」；或重开设置弹窗回该厂商，密钥栏显示「已配置（留空保持不变）」。
4. （进阶）打开 `ai-settings.json`，对应厂商 profile 的 `enabled: true`、`models` 数组与勾选一致。

## 常见问题

**Q1：获取模型列表成功，保存却报「协议验证失败」？**
保存动作会用你当前选的协议再探一次接口，两者不一致（比如把 Gemini 原生厂商选成 Chat 协议）就会拦下。按厂商原生协议改回下拉预选项再保存；自定义网关按它实际支持的协议选。

**Q2：模型列表是空的或「未解析到任何模型」？**
产品不内置名单，接口给什么显示什么。先确认服务在线、地址端口正确（云端厂商检查网络与代理；本地服务见 O10 的启动卡），再点「获取模型列表」重试。

**Q3：我的 Key 会被上传吗？**
不会。Key 只存本机 `ai-settings.json`，请求直发你填的 API 地址；匿名统计只收应用事件，不含文档内容与密钥。介意明文落盘就用第 6 步的 `apiKeyEnv` 环境变量间接引用。

**Q4：一家供应商配了一半（只有 Key 没选模型）会怎样？**
不勾选模型就无法通过保存校验（「至少勾选一个模型」）；未保存的草稿不生效，已启用列表不受影响。

**Q5：之前配的模型突然报错说不存在？**
厂商下架的旧 id 会在加载设置时按退役表自动改写到现役 id（见第 6 步末条），多数情况无感；若厂商整条路由变更，重新「获取模型列表」勾选新模型即可。

## 形态差异

- **web/浏览器形态**：模型设置页走 HTTP 桥同一套界面；「察元AIOffice 登录」卡在 web 表单隐藏（登录仅桌面形态）。
- **dsh 插件形态**（挂进察元OS）：模型经察元OS 侧融合——模型代理的本地模型组与厂商路由只读并入本设置页，密钥由宿主解析，本侧零密钥录入（详见 O47）。

## 事实来源

- `packages/ai-provider/src/vendor-catalog.ts`（VENDORS 94 家四分组与逐家默认地址/协议/keyUrl/免 Key 标记；NO_MODELS_API；标题数字来源——00 清单「93 家」写于 codex 供应商入库前，以 main 代码 94 为准）
- `packages/ai-provider/src/registry.ts`（`AiProtocol` 5 种；AI_PROVIDER_ADAPTERS 28 个适配器）
- `packages/ai-provider/src/providers.ts`（AI_PROVIDERS 28 条元数据；RETIRED_MODELS 三家退役改写表；单次输出默认 32768/边界 1024–131072）
- `packages/ai-provider/src/settings-v2.ts`（profile+model 解析、七类默认模型 kind、chaofficeProfile 登录档、模型类型判定）
- `packages/ai-provider/src/discovery.ts`（实时拉取：ollamaLike 先 `/api/tags` 再回退 `/models`；anthropic/gemini/openai 三种清单路径；无内置兜底）
- `packages/ai-provider/src/credential-env.ts`（apiKeyEnv 环境变量间接引用，内联 Key 优先）
- `packages/ai-provider/src/ai-settings-guard.ts`（主进程 schema 校验：apiKey ≤8192、model ≤256、baseUrl http(s) 合法化）
- `packages/ai-provider/src/runtime.ts`（KEEP_KEY 视图占位）
- `packages/ui/src/ModelSettingsPage.tsx` + `packages/ui/src/model-settings-strings.ts`（说明页卡片、目录四组、筛选下拉、表单字段与按钮、保存链路、消息文案）
- `packages/ui/src/ModelDefaultsPage.tsx` + `model-settings-strings.ts` defaultsKind（七类默认与图片来源/输出上限）
- `packages/ui/src/CapabilitySettingsPage.tsx` + `packages/ui/src/capability-settings-strings.ts`（生图、媒体与搜索八组、搜索平台测试、刷新模型列表、设为默认/恢复自动）
- `apps/shell/src/renderer/src/SettingsModal.tsx`（十分区、默认落「模型设置」、bridge 注入）
- `apps/docs/src/main/docs-main.ts`（AI 设置文件 `ai-settings.json` 于 userData）；`apps/shell/package.json`（productName「ChaAI Office」→ macOS 应用数据目录名）
- `packages/ui/src/feature-flags.ts`（USER_LOGIN_READY：登录入口隐藏的开关，O09 详述）
