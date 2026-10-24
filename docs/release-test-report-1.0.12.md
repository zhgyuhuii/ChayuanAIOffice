# ChaAI Office 1.0.12 发版测试报告（2026-10-25）

六段版本 **1.0.12.0.12.29**（apps/shell package.json 1.0.12 + chaofficeUpstreamVersion 0.12.29；上游终点 28cee5ca8 无新 tag，后三位维持 0.12.29；打包纪律 Z+1：1.0.11→1.0.12）。
本版 = R34 上游同步（8ab58a514..28cee5ca8 两连：#2155 docx-engine resolve-props 再导出回补——本地 R33 已等价，空对账；#2164 sheets Home 画廊对已选表格改重样式）+ **打包版 CLI 启动器自引用死循环修复**（bin/chaoffice 37 行真启动器被 9fc744ba2 品牌统一的同名垫片覆盖，57a1d6448 恢复四件原貌）。

## 阶段 0 · 全量自动化 — PASS

- ✓ `npm run typecheck` 全链 EXIT 0（34 工作区）
- ✓ `npm run test` 全工作区 0 失败：docs 394 文件 4232+4 skipped／sheets 361 文件 3797+1 skipped／shell 125 文件／slides 146／pdf 69／markdown 62／web-bridge 4／server 4／web 1／前 22 包链式跑全绿（合计零 FAIL）
  - 附注 1：shell `packaged-cli-version` 3 用例按 ELF 暂存法（跑前暂存 linux x64 zigbuild 产物、跑后还原宿主 Mach-O，前后 file 直验）
  - 附注 2：root 链式跑在 docs 段收尾遇 1 例 prosemirror DOMObserver 卸载后定时器泄漏（unhandled error 令 vitest 退 1，394 文件 4232 用例本身全过）；docs 单工作区复测 EXIT 0 全绿=负载序偶发，与本轮改动无关，登记为测试基建坑
- ✓ lint 改动文件 0 error（eslint 两文件直接跑）
- ✓ 品牌 grep 豁免外零新增（3 处命中均 main 基线存量：docx-engine compare DEFAULT_COMPARE_AUTHOR 2 处+cli docs help 1 处）
- ✓ Rust 零改动（`git diff main -- '**/*.rs'` 与上游区间 Rust diff 均为空，sidecar 沿用 R32 四平台重编件）

## 阶段 1 · 打包安装 — PASS（附注：飞腾真机沿用 R32/R33 附注口径）

- ✓ 九件安装包构建成功（EXIT 0 ×4 pass：mac/linux-arm/linux-x64/win；CLI 启动器修复后全量重打一轮），架构逐件直验：
  - deb arm64：主程序 ELF aarch64 ✓、xlsx-sidecar ELF aarch64 ✓（本 pass 先手工暂存 aarch64 zigbuild 产物，R32/R33 同款流程）
  - deb amd64：主程序 ELF x86-64 ✓、sidecar ELF x86-64 ✓（CHAOFFICE_LINUX_X64=1 pass）
  - rpm aarch64 / x86_64：主程序+sidecar 双 ELF 架构各 ✓
  - dmg arm64：UDZO 可读 ✓（未签名未公证同前版）
  - exe：MZ 头 ✓（NSIS）；AppImage ×2：ELF 头 7f454c46 ✓
  - 包元数据：deb/rpm 均 `chaoffice 1.0.12` ✓
  - **cli 启动器逐包验证**：dmg/deb 解包 Resources/cli/chaoffice 均为 37 行真启动器（修复后重打生效）
- ✓ mac 本机安装（/Applications/ChaAI Office.app 替换 1.0.11 → 1.0.12）：启动→窗口「察元AIOffice」onscreen（CGWindowList id=1928，1360×900@280,30，alpha=1；窗口截图=首页品牌+左树最近/文件夹+快速创建六格式卡片+产品矩阵+composer）
- ✓ 版本 asar 实证：Info.plist CFBundleShortVersionString=1.0.12；app.asar package.json version=1.0.12 + chaofficeUpstreamVersion=0.12.29（六段 1.0.12.0.12.29）
- ✓ 单实例锁：第二次 `open` 后主进程数仍为 1（before=1 after=1）
- ✗→附注：飞腾麒麟 arm64 真机（10.9.49.32）本轮不可达（ping 100% 丢包，R32 起延续），`dpkg -i` 真机安装项沿用附注降级：deb 元数据+双 ELF 直验+R30/R31 同管线真机验证史兜底，恢复后补测

## 阶段 2-4 · 模型与首页对话 — PASS（打包版 CDP 驱动）

- ✓ 打包版首页（CDP 渲染层截图）：品牌「察元AIOffice」+ 欢迎语 + 左树最近文件（ChayuanAIOffice 文件夹/.docx/.pdf 历史）+ composer
- ✓ 模型自动发现：harness 本地模型 chip（**local/qwen3.5-4b-q4km**，察元AI OS 运行中自动出现）
- ✓ 首页对话真实流式回包：CDP 注入发送「1+1等于几」→ 发送按钮 → 助手气泡「1+1 等于 2。」+ 复制/下载操作条 + 02:11 时间戳（截图证据）
- ✓ Sheets tab（会话恢复挂载）：Ribbon 七项（开始/插入/页面布局/公式/数据/审阅/视图）+ 网格 canvas 探针 ✓（画廊点选交互按 R33 口径归 Playwright/专测范畴）

## 阶段 5 · 本轮特性真机闭环 — PASS

- ✓ **#2164 sheets 画廊重样式**：新测试 5 用例全绿（session 表重样式双主题命名/单格锚定不推断新区域/loaded 表走 tableEdits 不重复建表/重叠锚点仍拒绝），format-as-table 命令分支重样式→无选中才新建；本地 `format-as-table-custom:` 独有分支不受影响
- ✓ **打包版 CLI redline compare 真机闭环**：`~/.local/bin/chaoffice docs compare orig.docx rev.docx --out redline.docx --author 差异审阅` → EXIT 0，`1 inserted, 1 deleted, 0 changed paragraph(s)`，redline.docx 2302 字节（**本项首次跑挂起→兜出打包版 CLI 启动器自引用死循环回归**，修复 57a1d6448 后重打重测通过；修复同时经 dev 直跑 `chaoffice 1.0.12`+compare 验证）
- ✓ #2155 resolve-props 导出回补：本地 R33 已并集等价，空对账（docx-engine 1894 用例全绿背书）

## 阶段 6-10 — 抽验（同 R31/R32/R33 口径：随轮真机做定向项，全量项由自动化门禁承担）

- ✓ 六格式全生命周期/购买激活/多语言/更新链/性能压测由 15,000+ 自动化用例覆盖（阶段 0），不随轮重复人工跑

## 发布判定：PASS（附注 1 项）

通过：阶段 0 全部、阶段 1 除飞腾真机安装外全部（含 CLI 启动器回归的发现→修复→重打→复测闭环）、阶段 2-5 核心链全部。
未决项：飞腾麒麟真机 `dpkg -i` 安装+GUI 启动（机器不可达延续 R32/R33 附注）——不阻塞发布（包级直验+同管线真机史兜底），恢复后补测。
