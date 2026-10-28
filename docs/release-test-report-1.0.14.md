# 1.0.14 发版测试报告（R36 · 上游 28e9c100）

- 日期：2026-10-28
- 版本：六段 **1.0.14.0.12.115**（apps/shell/package.json `version`=1.0.14 + `chaofficeUpstreamVersion`=0.12.115；上游终点 28e9c100 无新 tag，describe=v0.12.115-29-g28e9c100，后三位维持 tag 口径 0.12.115）
- 上游区间：c8bfff60..28e9c100，29 提交全吸收（逐个 cherry-pick；无巨件快照）

## 阶段 0 · 全量自动化测试 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| typecheck 全仓 | ✅ 0 错误 | `npm run typecheck` EXIT 0（34 工作区） |
| vitest 全工作区 | ✅ 0 FAIL | `npm run test` 后台链式 EXIT 0；唯一红=packages/cli mcp-http 3 用例——ZCODE_HTTP_PROXY(192.168.1.130:9028) 拦截 localhost HTTP Tunneling（Proxy response 403），`NO_PROXY='*'` 复跑 12/12 绿，环境假败非代码回归；上游 24 个新测试文件全部随源码落位并通过（sheets：data-table-dialog/plan/run、pivot-show-values-as、pivot-chart-source、table-filter-persist、protected-range-password(+save)、copy-animation-idle、xlsx-dv-x14；pdf：bates、heading-outline、outline-locale、save-pdf 扩充；markdown：wiki-tags、block-id、block-ref、wiki-alias、md-asset-vault-root、graph-view；shell：ai-naming、ai-naming-provider、update-resume 扩充；ui：ai-naming-client；xlsx-gateway：dv-x14-write、protected-range-password、pivot-show-values-as、table-filter-persist） |
| lint | ✅ 0 error | 终版 `npm run lint` 0 errors（25 warnings 基线）；期间兜出并修复 4 处本轮引入的 unused-vars（pdf BatesDialog 渲染块/applyBates/batesDlg 大区域裁决丢失织入、sheets useModalDialog 调用点同型） |
| cargo test | ✅ 274/274 | xlsx-engine 274 passed 0 failed（+1 x14 新用例；#2224 worksheet.rs +92 行随轮吸收） |
| git cherry 内容级对账 | ✅ | base=c8bfff60a 区间 29 项全 `+`（pick 品牌重放致 patch-id 必异）——逐一核实：29 个 pick 提交在分支、上游新增 24 个测试文件全部落位、源文件零缺失 |
| 品牌 grep | ✅ 豁免外零新增 | 本轮改动文件全扫：shell ai-naming 注释/测试名去 Genspark 化（登录后端口径）、shell preload 注释 @chaoffice/ui、pdf tr 积分串品牌化（R35 基线遗留顺手清）；豁免保留：键名 appGensparkAccount 族内部标识、genspark.ai URL、注释基线存量 |

### 门禁期间修复（同轮闭环）

1. **大文件 strings 并集脚本两型 bug**：①跳过多行键时续行成孤儿字符串行（pdf strings 173 处+sheets dialogs 17 处，tsc 兜出）；②键存在性判断只看冲突块 ours 侧→zh-TW 块误插无 opener 区（pdf strings 结构塌方一次，回滚后改 drawInk/outline 锚点法重做）。防线：strings 大文件禁用巨型正则 re.S 替换（本次正则回溯挂起 30 分钟强杀），一律行扫描。
2. **冲突标记被提交**（#27 cs/vi shard）：脚本失败但 add -A 先行，cherry-pick --continue 把标记入库；tsc 兜出后 amend。
3. **BatesDialog 渲染块丢失**（#19 大区域取 ours）：lint unused-vars 兜出后织回；同型 #1 Select Data 的 useModalDialog 调用点丢失同法兜出——R20 教训（大文件织入必须编译+全测试再提交）本轮以 lint 前置二次兜底。
4. **品牌 grep 范围修正**：pick 自动合并件（univer-state/data-table/ai-naming 族）带 @genoffice 需全工作区扫描，只扫冲突文件会漏。

## 阶段 1 · 打包与安装 — PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 清理历史产物 | ✅ | apps/shell/release 1.0.13 九件+unpacked 全清；dist/chatop-chaoffice-1.0.13、chaoffice-1.0.13.tgz 清理（发布后复核） |
| sidecar 四平台重编 | ✅ | 本轮 Rust 有改动（#2224 x14 DV）：zigbuild linux x64/aarch64（GLIBC 上限 2.28 实测 strings 验证）+ mingw win-x64 exe + mac universal（lipo x86_64+arm64）全部新鲜产出 |
| 九件安装包 | ✅ 全 EXIT 0 | dmg/zip（mac arm64）、exe（win x64 NSIS）、2×deb（arm64/amd64）、2×rpm（aarch64/x86_64）、2×AppImage（arm64/x86_64）全部 1.0.14 |
| 架构逐件直验 | ✅ | 见下方打包直验记录（deb/rpm 双 ELF、AppImage ELF 头、exe PE、dmg UDZO） |
| dsh 产物 | ✅ | dist:chatop → dist/chatop-chaoffice-1.0.14；package:plugin → dist/chaoffice-1.0.14.tgz |
| mac 装机 | ✅ | dmg 装机 → Info.plist 1.0.14；`open` 启动窗口上屏（终端直启兜底）；察元AIOffice 品牌首页+左树+对话面板零上游品牌 |
| 单实例锁 | ✅ | 二次 open 无新窗口 |
| asar 版本实证 | ✅ | asar extract-file → version=1.0.14、chaofficeUpstreamVersion=0.12.115 |
| 打包版 CLI compare 闭环 | ✅ | create docx ×2 → docs compare → docs read --revisions：insertion+deletion，author=ChaAI Office |
| 飞腾真机（Linux/ARM64 deb） | ⚠️ 附注降级 | 沿 R32 起不可达附注（包级直验兜底，恢复后补测） |

## 阶段 2-4 · 模型与对话（dev 真机，REMOTE_DEBUG_PORT=9331 CDP 驱动）— PASS

| 项 | 结果 | 证据 |
|---|---|---|
| 版本六段桥 | ✅ | window.chaOffice 桥 appVersion → **"1.0.14.0.12.115"** |
| 首页品牌 | ✅ | 察元AIOffice/ChaAI Office 命中，零上游品牌 |
| harness 自动发现 | ✅ | sheets 模型 chip `local/qwen3.5-4b`（察元OS harness 运行中自动发现） |
| CDP 流式对话 | ✅ | 首页发送「请用一句话回答：1+1等于几？」→ chatop-local 流式出字 → 助手气泡「1+1等于2。」（10:21 时间戳） |
| R36 新特性真机活性 | ✅ | sheets Data tab「模拟分析」组渲染在案（What-If 区代码活性；菜单项 appDataTable 已并入 22 语言 zh='数据表'）；新特性功能核心由全量测试套件 24 上游新测试文件覆盖（见阶段 0） |
| 六格式文档管线 | ✅ | 六端 vite 5173-5178 全 200、shell 5199 正常；全量测试含六格式生命周期用例全绿 |

## 发布判定：PASS（自动化+dev 真机+打包直验全过；飞腾真机延续附注降级）
