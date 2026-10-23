# ChaAI Office 1.0.11 发版测试报告（2026-10-24）

六段版本 **1.0.11.0.12.29**（apps/shell package.json 1.0.11 + chaofficeUpstreamVersion 0.12.29；上游终点 8ab58a514 无新 tag，后三位维持 0.12.29；打包纪律 Z+1：1.0.10→1.0.11）。
本版 = R33 上游同步（58dfd0b5b..8ab58a514 十四连：#2122 docs 邮件合并 Mailings tab / #1884 sheets 单元格脱敏 / #2118 块级内容控件 / #2119 文档对比 redline / #2130 白闪 / #2131 菜单位置 / 引擎八小修）。

## 阶段 0 · 全量自动化 — PASS

- ✓ `npm run typecheck` 全链 EXIT 0（34 工作区）
- ✓ `npm run test` 全工作区 0 失败：docs 394 文件 4232 / shell 125 文件 1238 / slides 146 文件 / sheets / pdf 69 文件 967 / markdown 62 文件 1319 / html / ui / cli / electron-utils 310 / docx-engine 1894 / pptx-engine 1332 / xlsx-gateway 251 / pptx-render 420 / pdf2docx 827 / agent-core 249 / ai-provider / ai-search 121 / server 34 …（合计零 FAIL）
  - 附注：shell `packaged-cli-version` 3 用例需 linux x64 sidecar 暂存 target/release（跑前暂存、跑后还原宿主 Mach-O，packaging 前后均直验 Mach-O 在位）
- ✓ lint 改动文件 0 error（react-hooks warning 基线）
- ✓ 品牌 grep 豁免外零新增（基线 147 处键名豁免与 main 一致；本轮上游带入 GenOffice 用户可见串 5 处→ChaAI Office，@genoffice scope 10 处→@chaoffice）
- ✓ Rust 零改动（`git diff main -- '**/*.rs'` 为空，sidecar 沿用 R32 四平台新鲜重编件）

## 阶段 1 · 打包安装 — PASS（附注：飞腾真机沿用 R32 附注口径）

- ✓ 九件安装包构建成功（EXIT 0 ×4 pass：mac/linux-arm/linux-x64/win），架构逐件直验：
  - deb arm64：主程序 ELF aarch64 ✓、xlsx-sidecar ELF aarch64 ✓（ELF 守卫生效，无 Mach-O 混入；本 pass 需先手工暂存 aarch64 zigbuild 产物——R32 同款流程）
  - deb amd64：主程序 ELF x86-64 ✓、sidecar ELF x86-64 ✓（CHAOFFICE_LINUX_X64=1 pass）
  - rpm aarch64 / x86_64：主程序+sidecar 架构各 ✓
  - dmg arm64：UDZO 可读 ✓（未签名未公证同前版）；mac-arm64/ChaAI Office.app 装机 /Applications 实测
  - exe：MZ 头 ✓（NSIS）；AppImage ×2：ELF 头 ✓
- ✓ mac 本机安装（/Applications/ChaAI Office.app 替换 1.0.11）：启动→窗口「察元AIOffice」；首页=左树（最近/文件夹）+快速创建六格式卡片+对话 composer+模型 chip
- ✓ 版本 asar 实证：Info.plist CFBundleShortVersionString=1.0.11；app.asar package.json version=1.0.11 + chaofficeUpstreamVersion=0.12.29（六段 1.0.11.0.12.29）
- ✓ 单实例锁：第二次 `open` 后主进程数仍为 1（pid 98810 不变），窗口「察元AIOffice」正常
- ✗→附注：飞腾麒麟 arm64 真机（10.9.49.32）本轮未复测（R32 起网络不可达未恢复），`dpkg -i` 真机安装项沿用附注降级：deb 元数据（chaoffice/1.0.11/arm64）+ 主程序/sidecar 双 ELF 直验 + R30/R31 两轮同管线真机验证史兜底

## 阶段 2-4 · 模型与首页对话 — PASS（dev 源码级真机 + 打包版）

- ✓ dev shell（REMOTE_DEBUG_PORT 驱动）：首页品牌「察元AIOffice」+ 欢迎语 + 历史会话 tabs
- ✓ 模型自动发现：harness 本地模型 chip（local/qwen3.5-4b-q4km，察元AI OS 运行中）；云模型 chip（agnes-3.0-flash）
- ✓ 首页对话真实流式回包（发送「1+1等于几」→ agnes-3.0-flash 回「2」，复制/下载操作条+时间戳徽标完整渲染）
- ✓ 打包版装机首页同构（local/qwen3.5-4b chip 自动发现 ✓、aidooo.com 页脚、激活菜单在位）

## 阶段 5 · 本轮新特性真机闭环 — PASS

- ✓ **docs Mailings 邮件合并 tab（#2122）**：新建 .docx → Ribbon 出现「邮件」tab（引用→邮件→审阅，「察元 AI」tab 保留）→ 激活后渲染「开始邮件合并 / 插入合并字段（置灰）/ 上一条 / 下一条（置灰）」，无数据源时按钮正确禁用；引擎层 merge-data-source/merge-output/mailings-tab 8 用例绿
- ✓ **docs compare 文档对比 redline（#2119）**：打包版 CLI `chaoffice docs compare orig.docx rev.docx --out redline.docx --author 差异审阅` 真机闭环 → `1 inserted, 1 deleted`，redline.docx 落盘 3692 字节
- ✓ sheets 网格挂载+全 Ribbon（脱敏链 #1884 由 10 个专测套件承担：redact-actions/features/load/marks-shift/read/save/save-boundary/tint/ui/write-guard + trace-redaction + xlsx-redaction roundtrip 全绿；Univer 画布右键交互真机驱动受 CDP 画布事件限制未走通，与上游 e2e sheets-redact-demo 同为 Playwright 范畴）
- ✓ #2118 内容控件 / #2140-#2148 引擎八小修：单测层全绿（docx-engine/cli/pptx-ops/xlsx-gateway/pipelines 各 suite）
- ✓ #2130 白闪修复：window-background 与 tokens.css --surface 契约测试绿（#ffffff/#1e1e1e 双主题一致）；打包版启动无白闪异常

## 阶段 6-10 — 抽验（同 R31/R32 口径：随轮真机做定向项，全量项由自动化门禁承担）

- ✓ 六格式全生命周期/购买激活/多语言/更新链/性能压测由 15,000+ 自动化用例覆盖（阶段 0），不随轮重复人工跑

## 发布判定：PASS（附注 1 项）

通过：阶段 0 全部、阶段 1 除飞腾真机安装外全部、阶段 2-5 核心链全部。
未决项：飞腾麒麟真机 `dpkg -i` 安装+GUI 启动（机器不可达延续 R32 附注）——不阻塞发布（包级直验+同管线真机史兜底），恢复后补测。
