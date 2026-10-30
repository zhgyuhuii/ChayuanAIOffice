---
id: O36
title: CLI chaoffice 总览
entry: 终端 `chaoffice --help`
level: P0
tags: [CLI, 命令行, 智能体, 自动化]
status: draft
---

## 一句话说明

察元AI Office 自带命令行工具 `chaoffice`：17 个子命令覆盖文档的转换、创建、结构化读写、渲染、检索与定位，全部在本机引擎上无界面运行，供你在终端手工调用，也供 Claude Code、Codex、Cursor 等 AI 智能体直接驱动。

## 适用场景

- 想在终端或脚本里批量转换/生成/读取 Office 文件，不想打开界面；
- 在用 Claude Code、Codex、Cursor 等编码智能体，希望它们能直接操作你的 Word/Excel/PPT/PDF 文件（配合 [O39](./O39-Agent-Skill安装器.md) 安装 skill、[O38](./O38-MCP-Server.md) 接 MCP）；
- 装完察元AI Office 后终端里输入 `chaoffice` 提示「命令未找到」，想知道怎么找到它、怎么上 PATH。

典型提问（chabot 语料视角）：

- 「chaoffice 命令怎么装？终端里找不到 chaoffice」
- 「chaoffice 一共有哪些命令？能做什么？」
- 「怎么让 Claude Code 生成 PPT / 转 PDF？」

## 前置条件

- 已安装察元AI Office（CLI 随应用附带；逐命令详解见 [O37](./O37-CLI文档操作命令详解.md)，MCP 形态见 [O38](./O38-MCP-Server.md)）。
- 部分命令（凡涉及排版的：`→pdf` 转换、`render` 逐页渲染、`create --type pdf`、`open`）会以隐藏模式拉起察元AI Office 自身进程，需要应用已安装；其余命令（`info`、`docs`/`sheet`/`slides` 读写等）不依赖界面进程。

## 操作步骤

**1. 确认 CLI 可用：终端运行 `chaoffice --version`**

- 看到版本号即就绪；版本行形如 `chaoffice <版本>`（源码里版本为构建时内联的 `@chaoffice/cli` 包版本）。

**2. 命令找不到时：读启动器指针文件 `~/.chaoffice/launcher`**

- 察元AI Office 每次启动都会把 CLI 启动器所在目录写入 `~/.chaoffice/launcher`（Windows：`%USERPROFILE%\.chaoffice\launcher`，一行一个目录）。终端执行 `cat ~/.chaoffice/launcher` 得到目录后，用引号包住运行其中的启动器：bash 里 `"<目录>/chaoffice"`，PowerShell/cmd 里 `"<目录>\chaoffice.cmd"`；
- 早期（改名前）安装可能只带 `chaoffice` / `chaoffice.cmd` 同名文件，用那个名字即可；
- 指针文件缺失时的默认位置（macOS `/Applications/ChaAI Office.app/Contents/Resources/cli`，Windows `%LOCALAPPDATA%\Programs\ChaAI Office\resources\cli`，Linux `/opt/ChaAI Office/resources/cli`）。

**3. 上 PATH：运行一次 `chaoffice install-cli`**

- 该命令把启动器软链到 `/usr/local/bin` 或 `~/.local/bin`（Windows 写用户 PATH）。结果有三种：成功显示「now linked…」，已存在显示「already on the PATH」，目标位置被其他程序占用或不可写时报错并给出手工命令（如 `sudo mkdir -p /usr/local/bin && sudo ln -sf "<启动器>" /usr/local/bin/chaoffice`），照抄执行即可。

**4. 查看全部命令：`chaoffice --help`（或 `chaoffice help`）**

- 打印 17 个子命令清单、全局选项和退出码表。17 个命令（按 `--help` 输出顺序）：

| 命令 | 干什么 |
|---|---|
| `info` | 打印文件元数据与结构摘要 |
| `convert` | 格式转换（PDF→Word/PPT/Excel 等，矩阵见 O37） |
| `create` | 从结构化内容新建 pptx/xlsx/docx/pdf |
| `slides` | 读取/编辑/审计/渲染 .pptx |
| `sheet` | 读取/编辑 .xlsx |
| `docs` | 读取/编辑/校验/比对 .docx |
| `render` | 文档逐页渲染成 PNG |
| `guide` | 打印各领域的 ops 参考手册（写 ops 前先读） |
| `search` | 联网搜索（走察元AI Office 里配置的搜索源） |
| `image` | AI 生图并存盘 |
| `media` | 让模型描述/解答图片、视频、音频 |
| `open` | 在察元AI Office 里打开文件（可定位到某页/某块） |
| `selection` | 读取用户在编辑器里当前选中的内容 |
| `capabilities` | 报告本机云能力（搜索/生图/媒体解析）是否已配置 |
| `install-cli` | 把 chaoffice 软链上 PATH |
| `mcp` | 以 MCP 服务器形态提供全部能力（见 O38） |
| `skill` | 把随附的 agent skill 装进各家智能体（见 O39） |

**5. 看单个命令的用法：`chaoffice help <命令>` 或 `chaoffice <命令> --help`**

- 打印该命令的 usage、每个选项的说明。

**6. 记住三条通用契约（每个命令都一样）**

- **`--json`**：加在任意命令上，stdout 输出一个 JSON 对象。成功为 `{ "status": "ok", "command", "summary", "output_path"?, "warnings"?, "detail"? }`（批量编辑部分失败时 `status` 为 `"partial"`）；失败为 `{ "status": "error", "command", "code", "error", "message", "suggestion"?, "detail"? }`——`error` 是稳定错误名，程序据此分支，`message` 给人读，`suggestion` 告诉你下一步。
- **退出码**：`0` 成功；`1` 用法错误或 ops 被拒；`2` 文件不存在或输出文件已存在（含「文件正被编辑器打开」「越出允许目录」）；`3` 转换失败；`4` 应用不可用。
- **稳定错误名**（`--json` 的 `error` 字段）：`unknown_command`、`unknown_option`、`missing_argument`、`invalid_argument`、`invalid_json`、`unsupported`、`unknown_op`、`op_rejected`、`target_not_found`、`out_of_range`、`sheet_not_found`、`file_not_found`、`resource_limit`、`output_exists`、`file_open_in_gui`、`file_not_open_in_gui`、`outside_allowed_roots`、`conversion_failed`、`app_unavailable`、`invalid_usage`。未知选项一律拒绝（退出码 1），不会静默忽略。

**7.（可选）三个环境变量与一条安全护栏**

- `GENOFFICE_ALLOWED_ROOTS`：设成 PATH 风格的目录列表后，chaoffice 只在这些目录内读写，越界报 `outside_allowed_roots`（退出码 2）；
- `GENOFFICE_USER_DATA`：让 chaoffice 指向一个非默认的察元AI Office 用户数据目录（影响 open-documents 注册表与 AI 设置的读取）；
- `GENOFFICE_APP_BIN`：应用没装在默认位置时，指向应用可执行文件；
- **审计日志**：每条执行过的命令都追加一行 JSON 到 `~/.chaoffice/cli-audit.jsonl`（记录命令、参数、结果码、耗时、目录；密码/密钥类参数会打码为 `***`）。`GENOFFICE_AUDIT_LOG=<路径>` 改位置，设为 `off` 关闭。

### 验证

1. 终端运行 `chaoffice --version`：输出 `chaoffice <版本号>`；
2. `chaoffice --help`：能看到上表 17 个命令与「Exit codes: 0 ok, 1 usage, 2 file, 3 conversion failed, 4 app not available」一行；
3. `chaoffice info <任意一个 .docx 路径>`：打印该文件的块数/标题数摘要；
4. 上 PATH 后新开终端直接输入 `chaoffice` 不再报「command not found」；或 `cat ~/.chaoffice/launcher` 能得到一行目录。

## 常见问题

**Q1：终端里 `chaoffice` 找不到，怎么办？**
察元AI Office 每次启动都会把启动器目录写进 `~/.chaoffice/launcher`。按第 2 步用引号运行那个路径；想一劳永逸就再跑一次 `chaoffice install-cli`（第 3 步）。刚装完还没启动过应用时该文件不存在——先启动一次察元AI Office。

**Q2：install-cli 报「is another program; not replacing it」或「is not writable」？**
说明软链目标位置被别的程序占了或没权限写。命令输出里带 `manual` 手工命令，照抄执行（macOS/Linux 需要 sudo）；或换个位置不动它，继续用 `~/.chaoffice/launcher` 里的完整路径调用。

**Q3：`chaoffice convert xx.docx --to pdf` 报应用不可用（退出码 4）？**
凡涉及排版的转换/渲染要拉起察元AI Office 自身的隐藏进程。确认应用已安装；装在非默认位置时设 `GENOFFICE_APP_BIN` 指向应用可执行文件。

**Q4：智能体改文件时报「ChaOffice has this file open」（`file_open_in_gui`，退出码 2）？**
文件正开着标签页时 chaoffice 拒绝改写（防止编辑器下一次保存把改动盖回去）。让用户关掉那个标签，或让智能体用 `--out` 写到别的路径；确要覆盖只能 `--force`，且编辑器下一次保存可能把改动盖回去。

**Q5：如何限制智能体（chaoffice）能碰哪些目录？**
启动智能体前设 `GENOFFICE_ALLOWED_ROOTS`，例如 `GENOFFICE_ALLOWED_ROOTS=/Users/me/docs:/tmp`。越界读写会被拒（`outside_allowed_roots`，退出码 2）。事后查它动过什么：看 `~/.chaoffice/cli-audit.jsonl`。

## 事实来源

- `packages/cli/src/cli.ts`（defaultRegistry 17 命令及顺序、全局选项、退出码表、`--json` 契约说明、未知选项拒绝、审计挂钩）
- `packages/cli/src/result.ts`（EXIT 0/1/2/3/4、ErrorReason 全集、JsonOk/JsonError 结构、`partial` 状态与 warnings）
- `packages/cli/src/commands/install.ts`（命令名 `install-cli`、软链 /usr/local/bin 或 ~/.local/bin、linked/present/occupied/unwritable 四态与 manual 命令）
- `packages/cli/src/install.ts`（软链实现、legacy 名兼容、仅允许替换自家启动器）
- `packages/cli/src/audit.ts`（`~/.chaoffice/cli-audit.jsonl`、`GENOFFICE_AUDIT_LOG` 重定向/`off`、永不因审计失败而失败）
- `packages/cli/src/cli.ts` `redactArgv`（`--password/--api-key/--token/--secret` 参数在审计日志打码）
- `packages/cli/src/fs.ts`（`GENOFFICE_ALLOWED_ROOTS`、`outside_allowed_roots`/`file_not_found`/`output_exists` 退出码 2）
- `packages/cli/src/gui.ts`（`file_open_in_gui`：应用开着该文件时拒绝改写）
- `packages/cli/src/resources.ts` + `packages/cli/src/commands/open.ts`（应用查找默认路径、`GENOFFICE_APP_BIN` 覆盖）
- `apps/shell/src/main/cli-link.ts` + `apps/shell/src/main/index.ts`（应用每次启动写 `~/.chaoffice/launcher` 指针文件并 best-effort 上 PATH）
- `skills/chaoffice/SKILL.md` v2.7.4（launcher 指针文件用法、默认位置三平台、「仅 search/image/media 出网」声明）
- `packages/cli/src/commands/{search,image,media,capabilities}.ts`（出网三命令与 capabilities 无联网探测的实现复核）
- `packages/cli/src/commands/txn.ts`（存在于源码但未在 defaultRegistry 注册，不对外公开——如实说明）
- 口径差异：`README.md`「17 subcommands」清单把该命令写作 `install`，代码注册名是 `install-cli`，本篇以代码为准
