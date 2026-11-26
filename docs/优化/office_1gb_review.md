# 评审：`office_1gb.md` 大文件（1GB+）优化方案

- 评审日期：2026-11-25
- 评审对象：[office_1gb.md](./office_1gb.md)
- 评审方式：文档论断逐条对照真实代码（四路并行代码核查，全部结论带 `file:line` 证据）
- 总评：**方向大体合理，痛点定性一半属实；但文档对现状的描述有大量错位（把已做的当成待做、把模块张冠李戴），个别数字存在内在矛盾，工作量估计严重乐观。可作为「架构愿景书」，不能直接当施工图。**

---

## 一、痛点定性：哪些属实（有代码证据）

| 文档论断 | 核实结果 |
| :--- | :--- |
| docx 解析全量内存驻留、块带原始 XML 切片 | ✅ 属实。`document.xml` 整体读成 string（`packages/docx-engine/src/parse.ts:424`）；每块带 `originalXml` 切片与 `docxIndex` 补丁锚点（`packages/docx-engine/src/types.ts:2069-2107`）；保存时全量内存重建 ZIP、单次 `generateAsync` 出整包 Uint8Array（`packages/docx-engine/src/patch.ts:2360,2811,2952-2956`）。1GB 文档必然触碰 V8 字符串极限，「生死线」定性成立 |
| docs 全量 DOM、无虚拟化 | ✅ 属实。单 ProseMirror EditorState 全量装块；渐进挂载只是分帧 append（`apps/docs/src/renderer/phased-content.ts:40-44`，先 64 块每帧 +128），不是虚拟滚动。现状对超大文档是降级而非虚拟化：权重 >115k 只读、>230k 拒开（`apps/docs/src/renderer/large-document.ts:17-18`）。今天 1GB 文档根本打不开 |
| PDF 全量字节 + pdf-lib 全量保存、无增量更新 | ✅ 属实。渲染进程分片 IPC 但最终拼成完整 Uint8Array（`apps/pdf/src/renderer/file-bytes.ts:30-33`）；保存全量 load + 全量 save（`apps/pdf/src/main/save-pdf.ts:1485-1497,1591,1723`）；增量更新仅数字签名路径手工实现过（`apps/pdf/src/main/pdf-sign.ts:381` 起） |
| sheets sharedStrings 全量实例化 | ✅ 属实（但在 Rust 侧）：open 时一次性解析进 `Arc<Vec<SharedString>>`（`apps/sheets/native/xlsx-engine/src/workbook.rs:507`、`src/lib.rs:686`） |
| slides 音视频 base64 全量过 IPC | ✅ 属实：`slides:media-data` 返回 `data:${mime};base64,...`（`apps/slides/src/main/slides-main.ts:4357-4376`）；EMF 栅格化 ~40MB base64 预算，代码注释记录过 2.7GB 内存事故（`apps/slides/src/renderer/image-loader.ts:24-28`） |
| mmap / SQLite / LMDB / DEFLATE 检查点均不存在 | ✅ 属实，全仓 grep 零命中，确为待建能力 |

## 二、与现状不符之处（影响路线图取舍）

1. **「slides 媒体 base64 全量内联 → 需新建 `chaoffice-media://` 协议」——这条已经做了。**
   slides 图片主路径早已走 `chaoffice-slide-media://` 自定义协议，字节留主进程按需供给（`apps/slides/src/main/slides-main.ts:1442-1453`、`session-state.ts:588`）；docs 对可解码媒体 ≥1MB 的文档早已走 `chaoffice-docx-media://` 懒加载（`apps/docs/src/main/lazy-media.ts:21-24`）。
   **第一阶段第 1 项约 60% 是存量能力。** 真实剩余缺口：无 `?maxW` 按需降采样、无磁盘缩略图池、图片缓存 Map 只增不减（`image-loader.ts:103-111`）、AV 仍走 base64。
2. **「xlsx-gateway (Rust) 全量 JSON 传输工作簿 → 必然爆炸」——早已分块。**
   Rust 引擎是 `apps/sheets/native/xlsx-engine` 的 stdin/stdout JSON 行协议 sidecar（非 HTTP）；open 只回元数据，单元格按 100k 上限 `read_range` 按需拉（`apps/sheets/src/shared/desktop-api.ts:61`）；sidecar 已按 **256 行 chunk** 流式索引落盘（`native/xlsx-engine/src/lib.rs:59` `CHUNK_ROW_COUNT=256`——文档 §4.4 提议的「256 行瓦片」字面上已存在）；前端 Univer canvas + 可见窗口加载、旧窗口驱逐、内存不随簿大小线性增长（`apps/sheets/src/renderer/univer-sync.ts:4171-4183`、`apps/sheets/docs/architecture.md:43`）。
   §4.4 真实增量只剩：二进制传输替代 JSON、sharedStrings mmap 化、IronCalc 依赖图后台常驻。
3. **「写回前在内存中克隆 1GB 快照 → 2× 放大」——不存在。**
   docs 保存不备份原文件；xlsx 写前备份走 `fs.copyFile`（内核拷贝不进 V8，`packages/xlsx-gateway/src/gateway/xlsx-package-io.ts:459-462`）；pptx 保存早已流式（`generateNodeStream`，`packages/pptx-engine/src/index.ts:816-828`）；原子写是 temp+fsync+rename（`packages/electron-utils/src/atomic-write.ts:126-155`）。
   §4.7 的 CoW clonefile 是对「已经是内核拷贝」的路径锦上添花，收益远小于文档暗示的「翻倍→零」。
4. **「HarfBuzz wasm 排版度量叠加放大」——张冠李戴。**
   `packages/font-metrics` 是主进程 sfnt 竖向度量 IPC 预取（`src/metrics.ts:121`）；正文测宽是 renderer canvas `measureText`（`apps/docs/src/renderer/line-metrics.ts:180`）；HarfBuzz wasm 只在 apps/pdf 做字体子集化（`apps/pdf/src/main/wasm-path.ts:22-38`）。
5. **模块错位。**
   块模型 + `originalXml` 在 **docx-engine** 不在 file-parse（file-parse 只做 AI 附件抽文本，`packages/file-parse/src/docx.ts:20-69`）；zip-gate 是零依赖「zip 炸弹门禁」（只校验不供给 entry，显式拒绝 ZIP64，`packages/zip-gate/src/index.ts:156-164`）。§2 表格的模块归因需重写。
6. **ZIP64 现状。**
   zip-gate 与 zip-splice 都硬拒 ZIP64（`packages/docx-engine/src/zip-splice.ts:89-97,120-122`）——文档提了 ZIP64 支持但没点破「今天部分大文件直接被门禁拒绝」。

## 三、技术方案逐项评审

| 方案 | 评审 |
| :--- | :--- |
| §4.1 DEFLATE 检查点索引（zran 式） | ✅ 成熟技法（zlib gzran / indexed_gzip 同源），数学成立：2000 检查点 × 8KB ≈ 16MB。「2ms 内提取」偏乐观（inflate 2MB 实际约 5-15ms），量级可接受。注意 `estimated_height_px: u16` 上限 65535px，巨型表格块会溢出，应升 u32 |
| §4.2 流式补丁保存 | ✅ 方向正确，是现有 `patch.ts` 字节保真拼接设计的自然延伸——`zip-splice.ts:2-4` 注释已写明「entries 按 stored bytes 拷贝，1GB 文档只花 XML 部分的读取」，基础设施种子已在。**但有一处内在矛盾，见第四节** |
| §4.3 PM 滑动窗口 | ⚠️ 概念成立、全案最高风险项。示例代码过于天真：整文档 `replaceWith` 不保留选区/滚动锚点；150 块 JSON 每次换页 `nodeFromJSON` 有 GC 抖动；真正难点是跨窗口 Undo 栈重写（现有 `addToHistory:false` 分帧 append + `resetEditorHistory` 只是先例，不是方案）。且窗口化编辑器 ≠ 窗口化保存：现保存契约要求 renderer 持有完整 `parsed`（含 `internal.originalBytes` 全包字节 + `documentXml` 全文，`packages/docx-engine/src/types.ts:3101-3110`），必须与 §4.2 联动改造，文档没有明说这个耦合 |
| §4.4 sheets 二进制 IPC | ⚠️ 收益真实但有界。现协议是行 JSON + 100k 上限分块，瓶颈已约束；换 Arrow/二进制需要 sidecar 协议 v2（长度前缀帧替代行协议）+ 前端 DataView 渲染对接，是对一套已工作系统的重写。「60/120 FPS」是愿景数字 |
| §4.5 媒体降采样 | ✅ 剩余缺口真实（降采样、AV Range 流播、缓存驱逐、缩略图低清化），但缩略图已用 IntersectionObserver 窗口化修过 409 页 9GB 事故（`apps/slides/src/renderer/use-visible-thumbs.ts:4-6`）；「Rust 离屏 WebP 缩略图」会丢现渲染管线的 EMF 栅格化/主题重着色一致性，替换前要权衡 |
| §4.6 PDF Range + 增量保存 | ✅ 技术站得住（ISO 32000 增量更新 + `PDFDataRangeTransport` 是正路），且 `pdf-sign.ts` 已有增量修订拼装先例。漏一个坑：增量更新让文件反复保存持续变大，需要 eventual compaction 策略 |
| §4.7 CoW 快照 + FTS5 | CoW 部分收益被高估（现状已是内核拷贝）；FTS5 核外检索是真增量，且与 agent-core 现有 `captureSnapshot` 大纲快照机制（`packages/agent-core/src/loop.ts:1567`）衔接自然 |

## 四、内在矛盾：保存 20× 提速的数字与自己的方案打架

§5 声称 1.2GB 文档保存 **0.8~2.5s**，但 §4.2 的写法是「未修改区间**从原解压流**管道拷贝字节到新 ZIP **压缩流**」——即 inflate→再 deflate 全量 `document.xml`（样本自述解压后 1.8GB）。按常规 deflate ~50-150MB/s 算，仅重压缩就要 **12~36s**，2.5s 不可能达成。

要让数字成立只有一条路：**压缩域比特级拼接**——利用检查点记录的 `bit_offset`，未脏区间直接复用原 DEFLATE 压缩比特，脏区间插入 stored（未压缩）DEFLATE block 后从下一检查点续接。`DeflateCheckpoint` 带 `bit_offset` 字段暗示作者知道这条路，但通篇没有明说，且 §4.2 的文字描述恰好是达不了标的那条。这是全文最需要澄清的设计点。

## 五、路线图与遗漏约束

- **工作量严重低估。** 第一阶段「1 周」实际剩余工作约几天（AV 流播 + 降采样 + 缓存驱逐）；**第二阶段「2~3 周」是重灾区**：`patch.ts` 单文件 ~3000 行，承载表格补丁、`rawPPr` 复用、懒媒体占位符、多种 SaveBlock kind，用 Rust 流式状态机重写整条字节保真管线并保持全部特性回归，是月级工程；第三阶段跨窗口 Undo 同理。
- **web/server 形态完全没提。** 本仓同时出 web 构建（`build:web`）和 server Docker；mmap / Rust sidecar / SQLite / FTS5 在浏览器全部不可用，核外架构是 desktop-only 决策，web 端策略（维持现有阈值降级？wasm 子集？）必须写进方案。
- **消费方爆炸半径。** docx-engine 同时服务 CLI 与多个转换包（doc2docx 等），换 parse/patch 管线是全仓回归，不止 apps/docs。
- **双模式阈值提案合理**，但要跟现存阈值体系对齐：懒媒体 1MB（`lazy-media.ts:21`）、sheets auto 全载 ≤50 万格（`apps/sheets/src/renderer/load-budget.ts:53-71`）、docs 只读 11.5 万 / 拒开 23 万权重（`large-document.ts:17-18`）。文档的「<15MB」是拍脑袋数。

## 六、修正后的落地建议（按「真实剩余缺口 × 风险」排序）

1. **PDF 流式打开 + 增量保存**——先例代码在手（`pdf-sign.ts`），收益立现，风险低。
2. **slides AV 去 base64 + 图片降采样 / 缓存驱逐**——现场事故有案底（2.7GB EMF 事件），缺口明确。
3. **sharedStrings mmap 化**——sidecar 内小改，独立可交付。
4. **zip-gate-rs 检查点索引 + docx 锚点核外化**——大工程，立项前先做比特级压缩域拼接的技术验证（第四节）。
5. **PM 滑动窗口**——最高风险，放最后，先做原型验证跨窗口 Undo 方案再动主线。

---

## 七、增补（2026-11-25）：目标收窄为「打开优先」后的重新排序

用户澄清：实际要解的是**打开大文件非常慢 / 打不开**；保存路径未验证、不是本轮目标。按此收窄，第六节的排序作废，重排如下。

### 7.1 今天的「打不开」是哪几堵墙（按 docs 打开链路顺序）

1. **zip 炸弹门禁先拒（文档未提的第一堵墙）**：`DEFAULT_ZIP_LIMITS` 硬编码 `maxPartBytes: 512MB`（单 entry 解压上限）、`maxTotalBytes: 1.5GB`（`packages/zip-gate/src/index.ts:38-39`）；open 时逐 entry 膨胀校验（`packages/docx-engine/src/zip-load.ts:135`）。**document.xml 解压后超 512MB 的文件（约对应 200-400MB 的 docx）在解析开始前就被拒。**
2. **V8 字符串墙**：`document.xml` 全量 `async('string')`（`parse.ts:424`）在渲染进程 Worker 内执行，GB 级 XML 直接 `RangeError`。
3. **全量挂载墙**：全块进单棵 ProseMirror 树 + 全量 DOM。
4. **产品降级墙**：权重 >115k 只读、>230k 拒开（`large-document.ts:17-18`）；代码注释自标定「6 万短块 ≈ 1.1GB 源文件」——今天最好的情况也只是只读勉强打开，而门禁在第 1 步已把大部分这类文件挡掉。

其他 app 定位：pdf 属「非常慢」而非「打不开」（全量字节 + worker 拷贝，Range 传输一处改造收益直接）；sheets 架构方向已对（256 行 chunk + 窗口化 + 驱逐），大概率已能开，**不要按 §4.4 重写**，先实测；slides 剩余打开成本是主进程全量 archive 字节 + 全 deck RenderTree 构建，中等。

### 7.2 文档各章对「打开」的作用与处置

| 章节 | 对打开的作用 | 处置 |
| :--- | :--- | :--- |
| §4.1 检查点索引 + §4.2 阶段 1/2（首屏 60 块 + 后台锚点） | 打开路径核心 | 保留；**Rust 不是第一阶段必要条件**（Node 流式可先行，`zip-splice.ts` 已有文件句柄随机读先例） |
| §4.3 PM 窗口化 | 需要 | **只读先行**：只读虚拟滚动绕开 Undo/选区/补丁保存全部深水区，复杂度砍约七成 |
| §4.2.3 流式补丁保存 / §4.6.3 PDF 增量保存 | 与打开无关 | 整体推迟（与「保存未验证」现状一致；超大文档模式先禁编辑或走主进程重物化慢路径） |
| §4.4 sheets 二进制 IPC | 打开大概率已达标 | 不做，实测验证替代 |
| §4.5 媒体降采样 | docs ≥1MB 媒体已懒加载、AV 仅播放时拉取 | 不是打开瓶颈，推迟 |
| §4.7 CoW 快照 / FTS5 | 与打开无关 | 推迟 |
| （缺失）**门禁策略改造** | 第一堵墙 | **新增必做**：per-entry 上限对流式解析路径放行（流式预算替代硬拒） |

### 7.3 修正后落地顺序

1. **M0 体检先行**：造四个样本（document.xml 解压 >512MB 的 docx、1GB PDF、1GB 媒体 PPT、百万行 xlsx），逐个记录今天死在哪堵墙——「非常慢」与「打不开」修法不同，先量化再动手。
2. **docs M1（只读秒开）**：解析移主进程，zlib `createInflateRaw` 流式解压 document.xml 到磁盘临时文件，`scan.ts` 顶层块定位逻辑改在 Buffer 上记 `[byteStart, byteEnd]` 锚点，渲染端只收首屏块 + 只读虚拟滚动；Rust 检查点索引作为二期性能升级，不是解锁项。
3. **pdf Range 打开**：`PDFDataRangeTransport` + 主进程文件句柄伺服，渲染端不再持全量字节。
4. **slides / sheets**：实测确认后按需小改（slides 分批构建 RenderTree；sheets 最多 sharedStrings 延后处理）。
5. **编辑与保存（远期）**：M2 大纲/跳页后台索引 → M3 编辑窗口化 + 慢路径保存（主进程重物化、带进度条）。

---

## 八、二次审查（2026-11-25）：origin v2（dbae0c06f，仅改 office_1gb.md，本地工作区已同步未提交）

**结论：v2 已吸收本文第一轮评审的全部十项勘误，结构上可直接作为立项施工蓝图。剩余 6 项待修，其中 2 项 P1 级（门禁声明上限墙仍未覆盖；P2→P3 中间态缺「只读」验收门）。**

### 8.1 v2 正确吸收的关键点（含对本文第七节建议的修正）

- **LZ77 跨块回溯污染陷阱（v2 §3.4.2 场景 B）**：脏块修改后，直接比特拼接后续原始压缩流会引用错误字典导致文档损坏——这是对本文 7.3「比特级压缩域拼接」的正确收紧。B2 的「32KB 脱敏过渡区」在**续接检查点 ≥ 脏区原尾 +32KB** 条件下成立（窗口内容逐字节对齐原始流），且文档已自要求模糊测试门禁后才可入主线，姿态正确。
- **B1 多核分段 `Z_FULL_FLUSH` + zlib-ng 并行重压缩**为稳健主路径，且二次保存可跳过未脏 4MB 段——吞吐数学成立（8 核 600MB/s~1.1GB/s 聚合合理）。
- **混合补丁管线（v2 §3.4.3）**：未脏区间 Rust 直拷、脏块提取原切片回喂 TS `patch.ts` 单块补丁——把 3000 行特性重写风险降到最低，是全案最聪明的降险设计。
- 切片提取耗时修正为 5~15ms（v1 的 2ms 过于乐观）；多端形态约束（§2.1）、阈值挂钩存量预算（§2.2）、排期含 PoC 周（P2 第 1 周）均已落地。
- `estimated_height_px` 升 u32、EMF 栅格化改落盘协议、缩略图保留 IntersectionObserver 不换 Rust WebP——均按第一轮意见修正。

### 8.2 剩余缺口（按优先级）

1. **[P1] 门禁第一墙仍是盲区。** `DEFAULT_ZIP_LIMITS` 的 `maxPartBytes: 512MB` / `maxTotalBytes: 1.5GB`（`packages/zip-gate/src/index.ts:38-39`）按中央目录**声明尺寸**在膨胀前硬拒（`index.ts:113-118`，注释自述 "honest bombs at ~0 ms"）。1.2GB docx 的 document.xml 解压 1.8GB **<4GB，根本不需要 ZIP64**——今天被拒纯粹是 512MB 声明上限；v2 P1 只打通 ZIP64 不改声明上限，主流大文件场景依然打不开。须补：对流式解析路径按声明尺寸预算放行 + 压缩比门禁替代绝对上限。
2. **[P1] 中段「打开慢」还有第二遍全量解压成本。** 对今日可开 band，`verifiedSize` 把每个条目全量膨胀一遍做声明校验（`index.ts:119-121`），随后 JSZip 解析再膨胀第二遍——校验应与流式解析合并为一遍（边解压边验真），中段文件打开耗时立减近半。
3. **[P1] P2→P3 中间态缺验收门。** P2 完成时渲染端仍全量挂载（窗口化在 P3），v2 §4 的「可打开性/TTI/RSS」目标在 P2 时点并不成立。需明确 **P2 验收 = 只读窗口形态**（无编辑无 Undo），或在 P3 内插「只读先行」里程碑——否则「解决打不开」这一核心目标要等 10~12 周后才兑现。
4. **[P2] 切换阈值信号须为解析前可得。** v2 §2.2 用「权重 >80,000」做双模式切换判据，但权重是解析后产物（循环依赖：不解析完算不出权重）。切换应以中央目录元数据（entry 声明尺寸、条目数、ZIP64 标记）+ 廉价首扫块计数为准。
5. **[P2] PDF 增量保存 <100ms 仅 CoW 文件系统成立。** 非 CoW（NTFS/ext4）下「先整包 `fs.copyFile` 再追加」的拷贝步即 ~1s 起。建议就地追加 + 原尺寸日志回滚，或按文件系统分档给目标数字；另补线性化 PDF 假设说明（非线性化时 pdf.js Range 效率退化）。
6. **[P3] 行号漂移与小项。** 行号校正（结构结论均不受影响，但 v2 自称 file:line 核查版应改）：`parse.ts:424`→445；`types.ts` Block 2069-2107→**2242-2252**；`patch.ts:2360,2952`→**2565/3062/3213**（internal 解构在 patch.ts:1009）；xlsx-engine `lib.rs:59`→**61**、`lib.rs:686`→**704**；`lazy-media.ts:21`→**28**；`slides-main.ts:1442`→**1443**、`4357-4376`→**4362-4379**；`pdf-sign.ts:381`→**387**；`pptx-engine/index.ts:816-828`→**819**；`xlsx-package-io.ts:459-462`→**462**；`save-pdf.ts` 全量 load→**1615**。本文上文引用同样含这些旧行号，一律以本条为准。另：§3.3 `StringSliceMeta`「8 Bytes = offset u64 + 富文本标志位」装不下长度/终点（实际需 16~24B/项，500 万条 ≈80~120MB，或以「下一项 offset」隐式推导但丢失富文本 run 边界）；场景 A「媒体主导型占 90%+」应标注为未验证假设；场景 A 磁盘对拷「<0.5s」按 NVMe 口径标注（SATA SSD ≈2s+）。
