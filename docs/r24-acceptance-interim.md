# 第二十四轮真机验收报告（2026-10-16）

> 被测对象：察元AI Office 1.0.5（六段 1.0.5.0.11.0，上游 a08c842f..4dc4b7b3 全吸收，main=0c1dd259）。
> 测试技能：chatop-test（T-O 察元AI Office 线 + 本轮新增 T-O-08~12，技能文件已更新 version 2026.10.16.1）。
> 口径说明：本仓为 office 独立打包线（ChaAIOffice dmg）；chatop-test 的整 OS 发版闸门（T-A~T-I）属察元OS 桌面仓范围，不在本轮逐项面内。

## 0. 已完成项（有证据）

| 项 | 结果 | 证据 |
|---|---|---|
| 打包产物 | ✅ | apps/shell/release/ChaAIOffice-1.0.5-arm64.dmg（218MB）；app.asar 内 package.json version=1.0.5 / chaofficeUpstreamVersion=0.11.0；Resources/{cli/chaoffice.cjs, docs, sheets, slides, pdf, markdown, html} 七件齐 |
| build:all | ✅ exit 0 | /tmp/r24-buildall.log |
| typecheck | ✅ 全仓 0 错误 | npm run typecheck 全链 exit 0 |
| vitest 全工作区 | ✅ 全绿 | docs 3494 / shell 1034（112 文件）/ ai-provider 606 / ai-search 106 / sheets 3437+ / slides 1475+ / cli 313 …（终态 run：除本次修复项外零失败） |
| lint | ✅ 零新增 | 159 error / 23 warning，低于 main 基线（164/21） |
| 品牌 grep | ✅ 豁免外零残留 | 终检命令+豁免清单见台账 §R24 门禁段 |
| 台账回写 | ✅ | docs/upstream-sync.md 第二十四轮 + §11 LOCAL 挂载 + §12 拒绝清单 |
| 提交/推送 | ✅ | main 0c1dd259（merge 3c9d31af）+ sync/24-upstream 已推 origin |

## 1. e2e（初步跑批，数据被污染需重跑）

07:53 首轮 e2e（103 文件/176 测试）与 dist:mac 构建并行导致资源争用 + 后见 §2 系统级 GUI 故障，已见 5 失败（_home-shot/_narrow-repro/_ai-panel-open-in-new-docs×2/ai-panel-side-settings）且通过数为 0——**全部为「应用窗口无法创建」的系统级故障所致，非测试内容失败**。系统恢复后需干净重跑。

## 2. ⛔ 系统级阻断：本机 GUI 会话无法创建任何新窗口（非合并回归）

**现象**：合并完成后进行真机测试期间，本机（macOS 27.0.1）**所有新启动的 GUI 应用都无法创建窗口**——包括与本合并无关的系统自带应用（TextEdit `open -a TextEdit file` → 0 窗口）、node_modules 原版 Electron 默认应用（进程存活但不注册为 GUI 应用）、打包版 ChaAI Office（进程存活、读入 app.asar、进入 NSEventThread 后 mach_msg 永久等待，0 窗口、无 CDP、--version 也挂起）。CGWindowList 全量 138 窗口中无任何新进程窗口。正在运行的察元AI OS 桌面（启动于故障前）显示正常。

**取证链**：
1. 本轮 dist:mac 全量构建期间数据卷打满至 0 字节（460GB 卷，峰值需求 ~13G；构建后 0.1GB free），swap 用量 9.2/10GB。
2. 已清理可再生缓存与产物（e2e 视频/报告、多余 release 解包目录、cargo target、electron/electron-builder/updater/Google 缓存、旧 sidecar tgz）→ 现 6.1GB free。
3. 排除项：内存压力 normal（74% free / level 1）；打包主二进制与 node_modules Electron 逐字节相同（md5 439e447c…）；签名=adhoc/linker-signed 且构建日志确认「skipped macOS code signing」（与前几轮一致）；代码合并本身经全量门禁（typecheck 0 / vitest 全绿）。
4. 结论：磁盘打满事件致 macOS 窗口会话（WindowServer/会话级窗口管理）损坏，**任何新 GUI 应用都无法建窗**——属机器状态问题，标准恢复手段为注销/重启。

**待办（GUI 恢复后立即执行）**：
- [ ] 注销/重启 → `screencapture` 验证 GUI 会话恢复（TextEdit 能开窗）
- [ ] 干净重跑 `npm run test:e2e`（无并行构建）
- [ ] 按 chatop-test T-O-01~12 逐项真机测试：六格式新建/打开/保存/双击接管、左对话右编辑布局、对话框拖动停放悬浮五态、对话产出文档、逐页截图+四查视觉审查、上游回退哨兵、本地模型联动（察元AI OS 正在运行，52601 管理面已探活）
- [ ] 每页截图落 docs/r24-acceptance/，本报告补全结果表

## 3. 已加入测试技能的新要点（chatop-test 2026.10.16.1）

- T-O-08 编辑器布局契约（左对话右编辑，六端一致，⛔）
- T-O-09 对话框停靠五态与拖拽（左/右/上/下/悬浮+最大化/收起+持久化，⛔）
- T-O-10 对话产出文档（AI 生成整篇写入文档）
- T-O-11 逐页截图与视觉审查纪律（错位/文字换行/界面被改错/回退上游四查，⛔）
- T-O-12 上游回退哨兵（品牌/DockShell 骨架/模型选择器样式/GensparkMark 星标）
