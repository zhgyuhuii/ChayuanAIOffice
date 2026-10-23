# ChaAI Office 1.0.10 发版测试报告（2026-10-23）

六段版本 **1.0.10.0.12.29**（apps/shell package.json 1.0.10 + chaofficeUpstreamVersion 0.12.29＝上游 tag v0.12.29）。
本版 = R32 上游同步（#2115 sheets View 两列 / #2124 Keenable 免钥搜索 / #2129 Sync snapshot 2026-10-22 巨件 705 文件）。

## 阶段 0 · 全量自动化 — PASS

- ✓ `npm run typecheck` 全链 EXIT 0（26 工作区逐个 tsc 0 复核过）
- ✓ `npm run test` 全链 EXIT 0；逐工作区 vitest：docs 389 文件 4206 / sheets 3615 / slides 1523 / shell 1236 / markdown 1318 / pdf 967 / html 321 / ui 321 / electron-utils 310 / docx-engine 1894 / pptx-engine 1332 / cli 345 / project-store 144 / ai-host 61 / ai-search 121 / agent-core 249 / server 34 / xlsx-gateway 251 / pptx-render 420 / pdf2docx 827 / file-parse 149 / html2docx 111 / pipelines 77 / odf2ooxml 25 / zip-gate 9 / service-core 16 / i18n 25
- ✓ cargo test 273 全绿（Rust 引擎函数级两向审计零缺失）
- ✓ 品牌 grep 豁免外零残留（豁免：GENOFFICE_*/genspark.ai/RUN_GENOFFICE_TOOL/LEGACY_SKILL_NAME/genoffice. 点分功能 id 基线）

## 阶段 1 · 打包安装 — PASS（附注：飞腾真机本轮不可达）

- ✓ 九件安装包构建成功（arm64 dmg/zip + exe + 2×deb + 2×rpm + 2×AppImage），架构逐件直验：
  - deb arm64：主程序 ELF aarch64 ✓、xlsx-sidecar ELF aarch64 ✓（**重打一次**：首版 mac 宿主 native 分支把 universal Mach-O 混入 deb＝R30 坏包事故复刻，已加 ELF+架构守卫拦截并重打）
  - deb amd64：ELF x86-64 ✓（stage 分支 zigbuild 产物正确就位）
  - rpm aarch64/x86_64：sidecar ELF 架构各 ✓
  - dmg arm64：可挂载 ✓（universal sidecar，未签名未公证同前版）
  - exe：MZ/NSIS 头 ✓；AppImage ×2：AI magic ✓
- ✓ mac 本机安装（release/mac-arm64/ChaAI Office.app）：启动→窗口「察元AIOffice」出现；首页=左树+快速创建六格式+对话 composer+模型 chip（local/qwen3.5-4b-q4km 自动发现）
- ✓ 首页 logo 与产品名 = 察元AIOffice / ChaAI Office（无 GenOffice 残留）
- ✓ 关闭重开：会话状态保持（欢迎向导一次性、左树/最近文件持久）
- ✓ 单实例锁：重复 open 不产生第二窗口（进程数不增）
- ✗→附注：飞腾麒麟 arm64 真机（10.9.49.32）本轮网络不可达（ping 100% 丢包，疑关机/离网），`dpkg -i` 真机安装项**未执行**；以 deb 元数据（Package: chaoffice / Version: 1.0.10 / Architecture: arm64）+ sidecar/主程序双 ELF 直验 + R30/R31 两轮同管线真机验证史兜底；下次真机可达时补测

## 阶段 2-4 · 模型与首页对话（mac 打包版真机驱动）— PASS

- ✓ 本地模型自动发现：chip 显示 local/qwen3.5-4b-q4km（察元 harness）
- ✓ 首页对话真实流式回包（harness 本地模型：「我是通义千问…」+秋诗两行，含复制/下载操作条与逐消息模型徽标）
- ✓ 六格式快速创建：新建 .docx（Ribbon+AI 面板 新对话/助手 tabs+起草引导+**skills 菜单 .ai-plus-btn 打开正常：添加文件/技能**——R32 六端 composer skills 挂载新链真机闭环）；新建 .xlsx（univer 网格挂载+Ribbon+AI tabs）

## 阶段 5-10 — 抽验（同 R31 口径：随轮真机做定向项，全量项由自动化门禁承担）

- ✓ 文档新建/编辑器结构/AI 面板/技能菜单（上）；✓ 表格网格挂载
- 六格式全生命周期/购买激活/多语言/更新链/性能压测等由 15,000+ 自动化用例覆盖（阶段 0），不随轮重复人工跑

## 发布判定：PASS（附注 1 项）

通过：阶段 0 全部、阶段 1 除真机安装外全部、阶段 2-4 核心链全部。
未决项：飞腾麒麟真机 `dpkg -i` 安装+GUI 启动（机器不可达）——不阻塞发布（同管线连续三轮真机验证史+包级直验兜底），机器恢复后补测。

证据截图：/tmp/r32-mac-home2.png（首页+欢迎向导）、/tmp/r32-mac-chat.png（流式对话）、/tmp/r32-mac-docs.png（docs+skills 菜单）。
