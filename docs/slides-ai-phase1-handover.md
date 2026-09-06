# Slides AI 一期（13 项）· 交接与剩余工作

> 用途：新会话从这里立即恢复上下文。读完本文 + [slides-ai-capability-roadmap.md](./slides-ai-capability-roadmap.md)（总路线图共识 v3）即可继续工作。
> 状态：一期 13 项代码全部落地；测试 981 项全绿（agent-core 80 / ai-provider 173 / ai-search 51 / ui 69 / slides 608+8skip）；agent-core、ai-provider、ai-search、slides、ui 五包 tsc 无错误。
> 提交：见 git log 中「一期」commit；本文档同 commit 落盘。

---

## 1. 十三项完成状态

| # | 事项 | 状态 | 核心落点 | 验证 |
|---|---|---|---|---|
| 1 | 能力矩阵（含 FC 维度） | ✅ | packages/ai-provider/src/capabilities.ts（新）；index.ts 导出 | tests/capabilities.test.ts（9 测试） |
| 2 | FC 动态兜底 | ✅ | packages/agent-core/src/loop.ts（silentTurns 计数跨 run 持久 + 试探轮） | tests/degraded-mode.test.ts |
| 3 | 无 FC 自动降级 | ✅ | loop.ts `degrade()`/`degradedProbe`/`parseDegradedToolCalls`；AgentSkill.degradedFallback；工具结果以 user 文本回喂 | 同上（4 用例） |
| 4 | 降级工具集（10 个） | ✅ | apps/slides/src/renderer/ai/slides-skill.ts `DEGRADED_TOOL_NAMES` + `degradedFallback()`；AiPanel 静态 gate（loop 创建处）+ onDone `degraded` 徽标（i18n `aiDegradedMode` 19 语言） | tsc |
| 5 | maxTokens 按 vendor | ✅ | capabilities.ts `MAX_OUTPUT_TOKENS`（deepseek 65536）+ runtime.ts 接线（`resolveModelCall` 新增 vendorId 字段）；generate_deck 描述强制 ≤4 页/批；截断文案指引 | tsc |
| 6 | 音视频附件直通 | ✅ | agent-core types（AgentAudio/AgentVideo）+ 四协议 converter + loop.run 第三参；apps/slides attachments-ipc（`slides:files-read-media`，≤14MB）+ AiPanel `collectMediaAttachments`（能力拦截，i18n `aiMediaUnsupported`） | tsc + 既有 160 ai-provider 测试 |
| 7 | MediaJobClient | ✅ | packages/ai-provider/src/media-jobs.ts（新）：submit/poll/cancel + 7 适配器（百炼/智谱/MiniMax/火山/可灵 JWT/Luma/fal 队列） | tests/media-jobs.test.ts（6 测试） |
| 8 | 视频生成通道 | ✅ | ai-ipc.ts `ai:generate-video`（videoGeneration 角色解析模型 → **原生确认对话框**（费用提示 + 本会话免问）→ runMediaJob → 下载 ≤40MB）；slides-skill `generate_video` 工具 → addMedia op（op-docs 已解锁 aiCallable）；vendor 条目 kling/luma/fal | tsc |
| 9 | read_url | ✅ | packages/ai-search/src/index.ts `readUrlContent`/`htmlToText`；ai-ipc `ai:read-url`；slides-skill read_url 工具（已进降级工具集） | tsc |
| 10 | 模型角色化 | ✅ | settings-v2 `AiDefaultKind` 新增 generation/qc；ui ModelDefaultsPage KINDS + 双语 label；AiPanel `selectionForGen()` 优先 generation 角色；QC transport 消费 qc 角色 | tsc + ui 14 测试 |
| 11 | 版式骨架 | ✅ | page-spec.ts `LAYOUT_SKELETONS`（titleSlide/titleContent/twoCol/fullImage/statement/sectionHeader）+ `resolvedSpecElements`（骨架垫底、模型元素叠层）；AiPanel generatePageLocal prompt 教词汇 | tsc |
| 12 | 自动讲稿 | ✅ | page-spec `notes` 字段（同一次 LLM 调用产出）→ buildPagePptx `setSlideNotes` 写入；spec prompt 已告知 | tsc |
| 13 | 跨页一致性审计 | ✅ | layout-audit.ts `auditDeckConsistency()`（标题字号节奏 ±35% / 正文字号离散 / 文本配色漂移）；generate_deck 成功输出附加 findings | tsc |

## 2. 新会话如何验证（跑起来）

```bash
cd packages/agent-core && npx vitest run      # 80
cd packages/ai-provider && npx vitest run     # 173（含 capabilities 9 + media-jobs 6）
cd packages/ai-search && npx vitest run       # 51
cd packages/ui && npx vitest run              # 69
cd apps/slides && npx vitest run              # 608 passed + 8 skipped（原有 skip）
cd apps/slides && npx tsc --noEmit            # 干净（仅存量 tsconfig baseUrl 弃用警告）
```

## 3. 未完成 / 需要人工实测的清单（2026-09-06 已用真实 key 实测，见 §5）

### A. 必须真实 key 实测（代码完成但无线上验证）
1. **DeepSeek 全链路**：✅ 已实测通过（§5.1）。
2. **generate_video 全链路**：✅ 百炼端到端通过；⚠️ 智谱/可灵卡在账户余额（§5.2）。
3. **音视频附件理解**：⚠️ 无法线上验证——百炼 qwen-vl/omni 全系欠费（Arrearage）、智谱视频理解需付费资源包（glm-4v-flash 免费档不支持视频，返回 1234 网络错误）。转换器格式已有单测覆盖，线上验证需充值后进行。
4. **厂商视频 API 字段漂移**：百炼/智谱/可灵三家已实测（智谱/可灵到计费层，字段被接受）；MiniMax/火山/Luma/fal 无 key 未测。
5. **generate_deck 版式骨架 + notes**：✅ 已实测通过（§5.3）。

### B. 已知限制（设计内，非 bug）
- kling/luma/fal 仅是媒体 key 容器：chat 不路由（设置页它们的对话模型不可用是预期）。
- openai 系视频**输入**仅支持公网 URL（dashscope/智谱不收 base64 视频）；本地视频附件理解只有 gemini 可走——capability matrix 已按此声明。
- 降级模式限定 10 工具；样式/动画/图表精修类工具在兼容模式不可用（工具集见 slides-skill `DEGRADED_TOOL_NAMES`）。
- slide-qc 在无视觉模型时只做几何审计（原行为）。

### C. 路线图后续（尚未开工）
- **二期（SVG 线）**：svgBlip 双 part 插入 / LLM 直写 SVG + 渲染审稿闭环 / 动画 op 解锁（setAnimations 引擎已实现，仅 aiCallable:false）/ **SVG 导出与缩略图路径**（export-render/SlideThumb，勿忘）/ WordArt 生成 op。开工前按共识 v3 §8 的 Q2~Q7 逐题与用户确认。
- **三期**：公式 OMML 三端、音频/旁白整链、素材版式转换、整册多版本、3D 开放（详见 roadmap §9）。
- 二期可复用：Recraft（原生 SVG 生成）vendor 条目尚未加；VIDEO_GEN_VENDOR_IDS 与 media-jobs 适配器注册必须保持同步（capabilities.ts 有注释）。

## 4. 并行工作注意

工作区同时存在另一条线「**插入媒体窗口改造**」（docs/insert-media-dialog-plan.md，共识达成未开工状态可能已变化）及其配套（packages/ai-provider/src/media-params.ts、packages/ai-search/src/{bing,openverse}.ts、各 app 的 UI 改动）。本 commit 已将其余改动单独提交（见 git log「并行线」commit）。两条线都动 ai-provider / ai-search / slides，新会话开工前先 `git log --oneline -10` 对齐最新状态，避免与该线冲突。
**2026-09-06 更新**：该线已在本工作区活跃开发（video-tasks 后台注册表、ribbon tab-strip、media-jobs params/cancel/downloadHeaders 扩展等），同文件混合改动时必须按 hunk 精确提交。

## 5. 真实 key 实测记录（2026-09-06）

### 5.1 DeepSeek 全链路 ✅

- key 全部有效；`/models` 显示当前模型线为 **V4**（deepseek-v4-flash / v4-pro / v4-flash-vision-exp），`deepseek-chat`/`deepseek-reasoner` 是仍可用的别名（reasoner → v4-flash 带思考）。
- **max_tokens 65536 被接受**（chat/reasoner/v4-* 均生效），截断根因②确认修复。
- **重大事实修正：`deepseek-reasoner` 现已支持 function calling**（官方文档的"思考模式不支持工具"描述的是 R1 时代）。用本仓库真实线格式（registry 注入 thinking:disabled）实测 AgentLoop 工具往返，chat 与 reasoner 均完整走通 FC 循环、无降级。据此把 reasoner 移出 capabilities.ts `NO_FUNCTION_CALLING`（保留 r1 遗留名单），AiPanel 静态 gate 相应放行；loop 的静默轮探测仍是动态兜底。
- ai-settings.json 的 deepseek profile 已补 v4 线模型。

### 5.2 generate_video / 视频适配器 ✅（百炼）/ ⚠️（智谱、可灵）

- **百炼 wanx2.1-t2v-turbo 端到端通过**：runMediaJob 提交 → 轮询（~84s）→ 产出签名 OSS mp4（GET 验证 206 video/mp4；OSS 签名不含 HEAD 动词，勿用 HEAD 探测）。
- **可灵：发现并修复适配器 bug**——AK/SK 按站点签发（国际站 api.klingai.com vs 国内站 api-beijing.klingai.com），适配器硬编码国际站导致用户 key 401 Auth failed。修法：`MediaJobRequest.baseUrl` 由 profile 透传（ai-ipc 已带出），kling 适配器优先用之（附单测）；用户的 key 属国内站，已把其 profile baseUrl 指到 api-beijing。JWT 签名本身正确（国内站 GET 200）。
- **智谱 cogvideox-3、可灵生成均卡账户余额**（智谱 1113 余额不足 / 可灵 1102 Account balance not enough）——请求到达计费层，字段与鉴权路径已被厂商接受；充值后即可全链路。cogvideox（无版本号后缀）模型 id 不存在（1211），勿用。
- MiniMax/火山/Luma/fal 无 key，未测。

### 5.3 generate_deck 本地管线（骨架 + notes）✅

真实 deepseek-chat 按generatePageLocal 同款 prompt 写 spec：`layout: titleSlide` + `layoutContent` + 60-120 字中文讲稿一次产出；parsePageSpec → buildPagePptx → 重新打开 pptx，`getSlideNotes` 回读与 spec.notes 完全一致。骨架/讲稿链路验证通过。注意：模型不总是自选骨架（prompt 里是"recommended"），deck 大纲层已给每页 layout 时遵循良好。

### 5.4 其余 key 状态

- **pexels/pixabay** ✅：stock.ts 双通道实测各返回 12 条；key 已配到 ai-settings.json `stockApiKeys`。
- **百度千帆** ✅：v2 chat（ernie-4.5-turbo-128k）正常，key 为 bce-v3 格式直接 Bearer。
- **NVIDIA NIM** ⚠️：key 有效，但账户仅能调用部分模型——`openai/gpt-oss-20b` 可用；`moonshotai/kimi-k3`/`deepseek-ai/deepseek-v4-flash-0731` 列出但首字极慢（>100s 超时）；kimi-k2.6/nemotron-ultra/mistral-large-2 已 EOL 或对该账户 404。profile 模型列表已按实测结果收敛。
- **ai:generate-video 的 raw bug**（交接 §3.A.2 预警项）确认存在并已修：`getSettingsView()` 返回 redact 视图、无 `raw` 字段，videoGeneration 角色选择从未生效。改用 `readRawSettings()`。

### 5.5 顺带修复（一期提交的存量 tsc 错误，10 处）

970e803 自述"五包 tsc 无错误"与实际不符（vitest 不做类型检查）：apps/slides 有 10 处 tsc 错误，全部修复——ai-ipc 缺 `readUrlContent` 导入；agent-core index 未导出 `AgentAudio`/`AgentVideo`；AiPanel 缺 `resolveModelCapabilities` 导入且调错对象（`window.slidesApi.readAttachmentMedia` → 实际在 `window.desktop`）；slides-skill generate_video 落页代码把 `getCurrent()`（返回页索引 number）当 RenderSlide 用。修复后 slides/agent-core tsc 全清，五包测试全绿（agent-core 80 / ai-provider 176 / ai-search 51 / ui 69 / slides 608+8skip）。
