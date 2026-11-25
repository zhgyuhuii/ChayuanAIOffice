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
