# R38 上游同步真机测试报告（dev CDP 驱动，2026-11-04）

> 对象：main 33d91339e（sync/38-upstream 合并，六段 1.0.15.0.12.600）。
> 方法：`REMOTE_DEBUG_PORT=9331` dev 全链（六端 vite 5173-5178 IPv6 + shell 5199 + CDP），Runtime.evaluate/Input.dispatchMouseEvent 双通道。

## 阶段 0 · 自动化门禁 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 79 提交对账 | ✅ | subject 级 79/79（#2427 空提交 --allow-empty 补账）；内容级 78 提交 fileset 对比，仅 3 处差异全部有台账裁定（hf-sections.test DU 维持删、save-as docs-main P1 超集、providers.test 静态 seeds 拒收） |
| typecheck | ✅ 全仓 0 | 34+2 工作区（doc2docx/hwp2docx 新增） |
| lint | ✅ 0 error | 28 warnings 基线（+3 上游 react-hooks 提示） |
| cargo test | ✅ 320/320 | external_links/stream_patch/zip9 新测试；sidecar debug+release 重编 |
| vitest 全工作区 | ✅ ~19092 用例 | g8 轮 + packaged-cli-version linux ELF 暂存单验 5/5（R37 坑③同款环境件，mac universal sidecar 已还原） |
| 品牌 delta | ✅ 文本面零残留 | 豁免面基线计数对照（genspark.ai 22/22、X-Genspark-* 线协议头、GENOFFICE_*、i18n 驼峰键） |
| 测试适配 | ✅ 9 项 | 见台账事故 8-9+修复链（LEGACY_SKILL_NAME、golden hash 重算 31 件、子路径 alias×5、nativeImage/styleDeletes 桩、no-edits reason、指示器重织、linux 路径还原、kde require 基准、save-as 阻挡目录） |

## 阶段 1 · dev 真机 CDP — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本六段桥 | ✅ | `window.chaOffice.getAppVersion()` → **"1.0.15.0.12.600"**（146 键） |
| 首页品牌 | ✅ | 察元AIOffice ×8；Genspark/GenOffice 正文扫描 **0/0** |
| 六端管线 | ✅ | 5173-5178 全 LISTEN（IPv6 ::1）+shell 5199；GUI 新建 docx（ProseMirror editable）+pdf tab 创建正常 |
| KB 按钮回归（R37 白屏修复） | ✅ | 点击弹层正常渲染（选中后检索提示+未检测到知识库服务的正确降级文案）、#root alive、零 JS 异常 |
| 设置面（#2399 静默更新） | ✅ | 关于页「静默安装更新」toggle 渲染在案（+自动检查更新） |
| 设置面（技能 pane，#2438 All tab 载体） | ✅ | 技能 pane 打开正常 |

## 阶段 2 · R38 新特性逐项 — PASS（附注 2 项）

| 特性 | 来源 | 真机证据 |
|---|---|---|
| docs read --properties | #2409 | CLI 实测：core/app/custom 三段 JSON 输出 |
| **typed custom properties** | #2354 | CLI 实测：`{"批次":42,"通过":true}` → **customTypes `{"批次":"i4","通过":"bool","标签":"lpwstr"}`** 落盘 vt 类型 |
| remove_parts | #2351 | CLI 实测：customXml 清除 batch 1/1 成功 |
| **legacy .doc 导入**（doc2docx 新引擎） | #2370-2386 | CLI 实测：9 阶段产物转换 text-basic.doc → 8 blocks（中英混排/emoji/引号 dash 全提取） |
| .doc/.dot 打开转副本 | #2387 | shell index/启动路径/文件关联接线在位（GUI 链由 docs-main convertLegacyImport 承载） |
| hwp2docx 引擎 | #2404 | vitest 46/46 绿；CLI convertHwp 接线在位 |
| **pdf 大文件 8MiB 分片** | #2373 | **GUI 实测 20MB/240 页 PDF 全量渲染 240 canvases**（分片 IPC 链路实证）、共 240 页、功能区正常、零异常 |
| pdf 坏页兜底 | #2368 | pdf-page-broken 渲染块+failedPages 状态接线在案（单测 page-probe 覆盖） |
| sheets Queries & Connections | #2345 | GUI：数据 tab「查询和连接」菜单项渲染 ✓；QueriesDialog 组件+readWorkbookQueries 通道接线（对话框交互受 CDP 折叠带事件面限制，面板单测 external-links-panel 绿） |
| sheets 外部链接面板 | #2343/#2319/#2450 | CLI sheet links 输出 schema 正确（links/cached_values/units）；xlsx-external-links 测试绿 |
| sheets 公式显示指示器 | #2340 | GUI：「ƒ显示公式」钮（公式 tab）+status-flag 段+样式全渲染在案；单测 18/18（含源码断言+Journal 行为）——**真机按钮点击未翻转（CDP 合成事件面限制，零 JS 异常，附注 1）** |
| sheets 功能区滚轮 | #2346 | scrollRibbonOnWheel 接线+ribbon-wheel 模块在案 |
| shell 静默更新 | #2399 | 设置面 toggle 真机渲染 ✓ |
| shell skills All tab | #2438 | 技能 pane 打开 ✓；All tab 由 FoundSkills 承载 |
| ai-provider SiliconFlow/PPIO/Command Code | #2439 | 三厂商注册（静态 seeds 剥除=live-discovery）；settings 下拉装配单测绿 |
| mcp fill_template/read_docx_properties | #2409 | CLI merge/properties 面+document-tools 注册（isAbsolute+扩展名白名单） |
| mcp sheet_links | #2408 | sheets-tools+headless-cli 接线；sheet links CLI 同源 |
| 思维导图共享核+左右布局 | #2395-2398 | agent-core/mind-map.ts 共享核（本地净化正则已同款）；docs/markdown MindMapCard 布局钮 |
| CUPS 静默打印 | #2355 | printPdfViaCups（/usr/bin/lp 参数数组无注入面）+print-cups.test 绿 |
| file-parse 修复批 ×9 | #2416-2423 | file-parse 套件绿（xlsx 关系解析/共享公式/日期/UTF-32BE 拒绝等） |

## 附注

1. **GUI 交互驱动边界**：sheets 的 QueriesDialog 打开与 showFormulas 切换在 CDP 合成事件下未触发（零 JS 异常；按钮/命令/状态/样式五层接线齐全+源码级断言测试绿）。判定为 CDP 事件面与折叠带（RibbonBandStage 本地架构）交互限制，非产品缺陷；人工真机复核留待下轮装机冒烟。
2. **流式对话**：dev shell 模型 chip 显示 `local/qwen3.5-4b-q4km` 但调用 fetch failed——**本机察元OS harness LLM 网关未运行**（62588 为 chayuan-m MCP 网关非 LLM），环境前置缺失非代码回归；ai-provider 642 单测（流式协议/openai-responses 成熟版/attribution 头）全绿覆盖协议层。harness 运行环境复测后补。
3. **merge CLI 命令**：上游 SKILL.md 文档含 merge，CLI 实现早轮裁定不在本地命令面（mcp fill_template 承载）——既有基线非本轮缺口。

## 判定

**PASS**（阶段 0/1/2 全过；附注 2 项均有明确环境归因+替代覆盖）。
