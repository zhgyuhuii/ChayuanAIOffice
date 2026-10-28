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
| dsh 产物 | ✅ | dist:chatop → dist/chatop-chaoffice-1.0.14（410M）；package:plugin → dist/chaoffice-1.0.14.tgz（160M）；历史 1.0.13 dsh 产物已清理 |
| tag | ✅ | `1.0.14` 推 origin（github zhgyuhuii/chayuan-office，main 494b36bc3+tag）+gitee（cloudshd/chayuan-ai-office，main+tag）+pubmirror（ChayuanAIOffice，tag 5724ca5ed 与本地一致；该仓为独立历史公开镜像沿例只推 tag） |
| GitHub Release | ✅ | **426250125** 九资产服务器中继全 201 uploaded（scp /data/installers/chaoffice-1.0.14 → nohup node fetch stream；sha256 前 16 位本地↔服务器逐件对齐） |
| mac 装机 | ✅ | dmg 装机 → /Applications/ChaAI Office.app（Info.plist **1.0.14**）；启动窗口上屏（System Events 进程表实证）；察元AIOffice 品牌首页零上游品牌 |
| 单实例锁 | ✅ | 二次 `open` 后主进程数仍 1 |
| asar 版本实证 | ✅ | asar extract-file → version=**1.0.14**、chaofficeUpstreamVersion=**0.12.115**（容器外根目录执行后即 rm，R33 坑②已防：本轮仍误覆盖 root package.json 一次，git checkout 即复） |
| 打包版 CLI compare 闭环 | ✅ | cli/chaoffice create --from a.md/b.md ×2 → `docs compare` → `docs read --revisions`：r1 insertion(Beta)+r2 deletion(Alpha)，author=**ChaAI Office** |
| 飞腾真机（Linux/ARM64 deb） | ⚠️ 附注降级 | 沿 R32 起不可达附注（包级直验兜底，恢复后补测） |

### aidooo.com 发布（R34/R35 流程复刻）

- 宿主侧硬链接十槽位入库（exe 同文件双平台槽位）→ 容器内按正确形状写 DB（`office['1.0.14'][platform]`=数组，channel='installer'，variant 沿惯例：默认版/zip 包/rpm 包/AppImage 免安装版）×10 + `publish=true` + `publishManifest()`
- 自检 OK=10 BAD=0（sha256/size 与磁盘逐件一致）
- **存量故障发现与顺带修复**：发布前 DB `products.office` 为**空段**（releases-admin.json mtime 停在 9-20，manifest/卷内 1.0.13 文件为残量）——即 1.0.13 客户端升级链此前已静默断裂（update/check latest:null）。本次 1.0.14 入库顺带修复升级链：四发货平台 1.0.13→1.0.14 updateAvailable=true 且 url=https 公网域名（mac-x64 沿例无条目）
- 验收：Range 请求 **206**；1MB 区段下载 sha256 字节级一致（982a7db0… 双侧同）；旧 1.0.13 卷内文件 10 件清理（staging 目录留底）+旧 URL **404**；公网 manifest office 段仅含 1.0.14 十槽位
- 备份：office-entries-backup-20261028.json + office-manifest-backup-20261028.json（/data/backups/）
- 网络附注：当日本地→服务器直连 SSH 出现持续上行限速窗口（实测 21-37KB/s，约 40 分钟后自愈至 1.3MB/s+）——大文件传输遇此形态时先测吞吐再重试，勿僵等

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
