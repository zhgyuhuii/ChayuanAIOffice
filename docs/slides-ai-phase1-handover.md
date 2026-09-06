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

## 3. 未完成 / 需要人工实测的清单（下一会话从这里接）

### A. 必须真实 key 实测（代码完成但无线上验证）
1. **DeepSeek 全链路**：配 deepseek key → ① deepseek-reasoner 应触发"兼容模式"徽标并可完成生成（降级 JSON 协议）；② deepseek-chat 长任务不再被 8192 截断（max_tokens 65536 生效）。若极旧版模型报 400 Invalid max_tokens → 调低 capabilities.ts `MAX_OUTPUT_TOKENS.deepseek`。
2. **generate_video 全链路**：设置里配 videoGeneration 默认模型（如百炼 wanx2.1-t2v-turbo / 智谱 cogvideox-3 / kling）→ AI 面板要求生成视频 → 确认对话框 → 轮询 → 视频落页可放映。注意 `ai:generate-video` 从 `getAiRuntime().getSettingsView()` 的 `raw` 字段读 modelDefaults（`(view as any).raw`）——**若该字段不存在会自动退回"扫描有 key 的视频模型"分支（功能可用但角色选择不生效）**，实测时确认这条路径。
3. **音视频附件理解**：gemini 模型传本地视频/音频附件；openai 系传音频；anthropic 传音视频应见明确报错文案。
4. **厂商视频 API 字段漂移**：7 个适配器字段做了多路径 fallback 但均未实测；任一家 400/字段变更 → 只修 media-jobs.ts 对应 adapter。
5. **generate_deck 版式骨架 + notes**：本地（BYOK 无云）生成时看页面是否出现骨架结构、备注栏是否有讲稿。

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
