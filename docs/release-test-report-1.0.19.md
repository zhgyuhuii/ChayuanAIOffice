# 发版测试报告 — ChaAI Office 1.0.19（六段 1.0.19.0.13.18）

> 2026-11-21。R44 随轮发版（上游单件巨件 Sync snapshot #2872 全吸收：docs 编辑器大重构 836 文件——commands 命令域/组件族大扩/对比功能重构 CompareDocumentsDialog+docx-engine compare/AiPanel 拆分/ppt2pptx 升级/docs-icon-library+hyphen；复审品牌补收六件）+ 本地 shell 五件（右侧文件树面板遮挡链修复+doc-active hide 方案、查看文件图标恒显+点图标开栏语义简化、新建项目空名兜底）。
> 判定：**PASS**（发版前测试全绿：门禁四件+web 真机 smoke+桌面 CDP 回归含 OS 合成截图验收；四 pass 打包+装机冒烟）。

## 阶段 0 · 发版前置检查 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 仓库状态 | ✅ | 干净树起版；R44 终链 af6f2834d 已推 origin + 本地五件（96f8a576e…2508c68d2）在位 |
| 误装依赖清理 | ✅ | 工作区残留未提交 `electron-debug@^5.0.0`（全仓零引用）→ 还原 package.json/lock |
| 工具链 | ✅ | node v24.21.0（R44 门禁口径）；cargo-zigbuild/zig/mingw 在位 |
| sidecar 现势核对（1.0.17 坑沿例） | ✅ | R44 快照 da865da90 触碰 .rs（xls_styles.rs +427/xls_biff.rs +16）；mac 双架 Nov 20 已新；**linux x64/arm64/win 三枚 Nov 15 过期 → 全量重编**；win-clipboard-helper 源码 11-15 后未动免重编 |

## 发版前测试（功能点清单制）— PASS

### D · 门禁四件 — 全绿

typecheck=0 / lint=0 error（warnings 基线类）/ vitest 38 工作区全绿 / build:web=0。

### A · shell 本地五件（桌面真机 CDP）— 23/23

| # | 功能点 | 结果 |
|---|---|---|
| A1 | 编辑器激活时右侧文件树面板可显示（双侧 inset 链） | ✅ doc-active 态 `.home-files-pane` flex 280px 贴右缘 |
| A2 | doc-active hide 方案 | ✅ 13/13 断言：clip-path=none/.home 透明/.sidebar surface/.chat-pane visibility:hidden/shell-modal 例外/回 Home 全恢复 |
| A2 视觉 | 截图验收（evenodd 教训） | ✅ shell 面截图（左树完整无沙漏+右面板完整）+编辑器面截图（ribbon 察元 AI+画布）+**OS 合成窗口截图**（三段并存） |
| A3 | 查看文件图标恒显 | ✅ 5 项目 5 图标一一对应（含无 rootPath 项目） |
| A4 | 钉根/全根双态 | ✅ 全根形态标题=「文件」；点图标开栏回归过 |
| A5 | 新建项目空名兜底 | ✅ 6/6：placeholder 动态=ChayuanAIOffice/主按钮放宽/空名真 IPC 落库 name=文件夹名/对话框自关/deleteProject 清理（用户目录不动） |

### B/C · R44 大重构面（web 5180 + 服务栈 5199）— PASS

| # | 功能点 | 结果 |
|---|---|---|
| B1 | 对比功能重构 | ✅ 审阅→比较→比较文档…：CompareDocumentsDialog 完整打开（原文档/修订的文档/修订者显示为/选项/确定，截图） |
| B2 | commands 命令域 | ✅ compare-documents 命令链 + text-direction 下拉（纵横混排/合并字符/双行合一/调整宽度） |
| B3 | AiPanel 拆分 | ✅ AI 面板+AI 总结/润色/排版/思维导图菜单族在位 |
| C1 | ppt2pptx 升级 | ✅ 服务栈（server+static 5199）slides boot 过/引擎接线确认/引擎 vitest 绿 |
| C2 | 品牌 | ✅ 首页/docs/slides 三面 Genspark/GenOffice=0；Ribbon「察元 AI」 |
| 回归 | 1.0.18 永挂修复保持 | ✅ 新建表格撤屏正常（sheets iframe boot、无挂屏） |

### 测试坑记录

1. **TabBar 左右两个 `.tab-pane-toggle` 同名 class**（左树开合/右栏开合）——CDP 断言 querySelector 首匹配取到左树钮，必须用 `button[title="展开/隐藏文件栏"]` 定位右栏开关；测试假红两轮后修正（应用无缺陷）。
2. **shell 页 CDP 截图不含编辑器 WebContentsView**（独立合成面）——doc-active 截图中间黑区=透明像素采集伪影非 bug；视觉验收须 shell 面+编辑器面分别 CDP 截图+OS 级 `screencapture -R` 合成截图三方取证。
3. **slides 直连 URL/静态 preview 卡「正在打开」**——slides newBlank 走 bridge shim→server 管线（1.0.18 治理），无 server 环境挂屏是缺位不是缺陷；web 形态冒烟必须带 `CHAOFFICE_STATIC_DIR=dist/web` 的 server 栈。

## 阶段 1 · 版本 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本 Z+1 | ✅ | 1.0.18→1.0.19（root/shell/dsh-plugin+双 lock 五文件；f0e3e8a2b） |
| 上游口径 | ✅ | chaofficeUpstreamVersion 0.13.18 不动（R44 快照无新 tag）；六段 **1.0.19.0.13.18** |

## 阶段 2 · sidecar 重编与九件打包 — PASS（五 pass：四 pass+arm64 修复重打）

| 项 | 结果 | 证据 |
|---|---|---|
| linux x64/aarch64 zigbuild（glibc 2.28） | ✅ | 10.8M/9.8M（Nov 21，含 R44 Rust 变更 xls_styles.rs） |
| win x64 mingw | ✅ | xlsx-sidecar.exe 17.0M（Nov 21）+ win-clipboard-helper.exe 1.5M（源码未动沿 11-15 件） |
| mac universal | ✅ | dist:mac 内 lipo（native:build:universal 双架构断言） |
| pass 1 mac | ✅ EXIT 0 | dmg 230.8M + zip 231.3M（arm64，未签名沿例）；sha256 前缀 dmg 7fe3f1d24a0ab0e4 / zip 49a7f6b58682929b |
| pass 2 win | ✅ EXIT 0 | ChaAIOffice-Setup-1.0.19.exe（PE32 NSIS 32 位桩） |
| pass 3 linux x64（CHAOFFICE_LINUX_X64=1） | ✅ EXIT 0 | deb/rpm/AppImage x64；deb sidecar e_machine=0x3e ✓ |
| pass 4 arm64 → **兜出打包缺陷** | ⚠→✅ | 首轮 arm64 包内 sidecar 为 **x86-64**（字节数与 x64 triple 构建完全一致 10823216）——装机直验 e_machine 兜出，ELF 守卫未拦（见下） |
| pass 4b 修复重打 | ✅ EXIT 0 | deb/unpacked/AppImage 三处 sidecar 复验 **0xb7 aarch64** ✓ |
| 架构逐件直验 | ✅ | dmg UDZO（zlib）；exe PE32；deb 双架 sidecar 0x3e/0xb7 对位；AppImage 双架 ELF；rpm `rpm -qp` chaoffice 1.0.19 x86_64+aarch64 |

### 治理记录：linux 打包架构双口径分裂（本轮兜出修复，c5a712711）

> arm64 宿主裸 `dist:linux` 打出 arm64 包却装入 **x64 sidecar**：`linuxArm64`（sidecar 口径）原仅认 `GENOFFICE_LINUX_ARM64` 环境变量，与 `linuxArch`（打包架构口径，`GENOFFICE_LINUX_ARM64=1 || process.arch==='arm64'`）是两个独立变量——宿主 arch 派生只进了打包口径没进 sidecar 口径。**ELF 守卫（assertLinuxSidecarArch）按同一错误期望校验（want=x86_64）全绿放行**——守卫防住了「源文件错」防不住「期望错」。1.0.18 及之前未触发是因为 arm64 pass 显式带了 env（报告简写未记）。
> 修复=linuxArm64 单源化（CHAOFFICE_LINUX_X64 强制 x64，否则 env 或宿主 arch），linuxArch 从其派生；consumer 测试 22 用例过。若不修复，arm64 Linux 三件（deb/rpm/AppImage）装机后 Sheets 全部静默失效。
> **教训：守卫的「期望」与「产物来源」必须同源；跨口径派生（arch 判定出现两处）就是洞。**

## 阶段 3 · 装机冒烟 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| Info.plist | ✅ | CFBundleShortVersionString=CFBundleVersion=**1.0.19** |
| asar | ✅ | package.json version=1.0.19、chaofficeUpstreamVersion=0.13.18；modules/ 六编辑器在位 |
| 版本六段桥（CDP） | ✅ | `getAppVersion()` → **1.0.19.0.13.18**（chaOffice 桥 150 键与 1.0.18 同形） |
| 首页品牌 | ✅ | 察元命中；genspark/genoffice 0 |
| CLI 闭环 | ✅ | 装机版 cli `--version` → **chaoffice 1.0.19**；create ×2（md→docx）→ compare **2 ins/2 del** author=ChaAI Office 粒度=word，redline tracked changes 8 条（paraMarkIns/ins/paraMarkDel/del）读回实证 |
| 单实例锁 | ✅ | 二次直启后主进程数仍 1 |
| sidecar 活性 | ✅（间接） | dev/真机全程 xlsx 打开正常；装机包内 ELF 直验对位（本轮新增逐包 e_machine 直验为标准） |

## 阶段 4 · tag 与 GitHub Release — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| tag 三仓 | ✅ | origin/gitee main+tag=1.0.19 → c5a712711（含打包修复）；pubmirror 沿例只 tag（ls-remote 逐仓实证）；顺带补齐 origin 缺失的历史 tag 六枚（无害） |
| GitHub Release | ✅ | release **453217941** 九资产服务器中继（/root/gh-upload-1.0.19.mjs 模式）**全 201、FINAL assets=9 uploaded=9、SIZE_MATCH_ALL: true**（body 覆盖 R44 全量内容） |

## 阶段 5 · aidooo.com 发布 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 旧版双侧清理 | ✅ | DB office['1.0.18'] 删除（备份 office-entries-backup-20261121.json）+ installer 槽位 10 文件删净（find=0） |
| 宿主硬链接十槽位 | ✅ | mac-arm64×2（dmg+zip）/windows-amd64+arm64（exe 复用）/linux-amd64×3/linux-arm64×3 |
| DB 入库（db.js 真函数） | ✅ | office['1.0.19'] 十条目（variant 沿例：默认版/zip 包/rpm 包/AppImage 免安装版；sha256+size 槽位文件真算）+publishManifest |
| 升级链验收 | ✅ | 公网 /api/version/office **latest=1.0.19**；/api/update/check **五平台 1.0.18→1.0.19 updateAvailable=true**；Range **206**；**1MB 段 sha 三方一致**（d7fea964f6e844d7 本地=staging=公网） |
| 服务器 staging 清理 | ✅ | /data/installers/chaoffice-1.0.18 删除（/data 13G free） |

## 阶段 6 · dsh 形态送达（察元AI OS）— PASS

| 项 | 结果 | 证据 |
|---|---|---|
| dsh 产物 | ✅ | dist/chatop-chaoffice-1.0.19 + dist/chaoffice-1.0.19.tgz（175.5M）+ dsh-plugin（package:plugin 全 EXIT 0） |
| harness 重铺 | ✅ | chayuan-harness `build.mjs chatoffice` → desktop/resources/chatoffice **1.0.19**（vendor 剪枝 1494 map+34 test dirs） |
| OS app 原位覆盖 | ✅ | /Applications/察元AI OS.app/Contents/Resources/chatoffice 1.0.18→**1.0.19**（654M，rsync --delete；全程桌面 0 进程） |
| 三方 sha 同源 | ✅ | harness staged = OS app = dsh-plugin 的 dist/host.js sha 一致（26fbf1a24d1b7d88） |
| staged 预期 | ✅ | chatop staged（shared/plugins/bundled/chaoffice）由桌面启动按内容签名自动重铺（1.0.17 起机制，无需手清） |

## 附注

- **新坑记账**：①`npx asar extract-file <asar> package.json` 在仓库根执行会覆盖真 package.json，随后 rm 即真删（R33 坑②再现，git checkout 恢复，版本无漂移）——extract-file 一律在临时目录跑；②TabBar 左右两个 `.tab-pane-toggle` 同名 class，自动化断言须用 title 语义定位；③shell 页 CDP 截图不含编辑器 WebContentsView（独立合成面），层叠类视觉验收须三面取证；④slides 直连/静态 preview 挂「正在打开」=无 server 环境缺位（newBlank 走 shim→server 管线），web 形态冒烟必须带 `CHAOFFICE_STATIC_DIR` 服务栈；⑤`linuxArm64`/`linuxArch` 双口径分裂即本报告阶段 2 治理——**守卫的期望与产物来源必须同源**；⑥vitest `run ... -w <ws>` 的 `-w` 被解析成 watch 挂终端——工作区过滤用 `-w` 前置或 workspace 配置。
- 中继脚本 /root/gh-upload-1.0.19.mjs（1.0.18 版 sed+body 换 R44 内容，日志 /root/gh-upload-1.0.19.log）。
- 飞腾真机（Linux/ARM64 deb）：沿 R32 起不可达附注降级；deb aarch64 主程序+sidecar ELF 字节级直验+同管线真机史兜底。
