---
id: O39
title: Agent Skill 安装器
entry: `chaoffice skill install`；设置▸集成
level: P1
tags: [Agent Skill, Claude Code, Codex, Cursor, 安装器]
status: draft
---

## 一句话说明

察元AI Office 自带一份 agent skill（教会 AI 编码智能体使用 `chaoffice` 命令行的说明书），并一键把它安装进本机检测到的 7 家智能体的技能目录——CLI 用 `chaoffice skill`，图形界面在设置▸集成。每次写入都需要你点一下或敲一条命令，没有任何静默安装。

## 适用场景

- 在用 Claude Code / Codex / Cursor 等 AI 编码智能体，想让它们「开箱就会」操作 Office 文件（生成 PPT、转 PDF、改 Word），而不是你每次手写 chaoffice 命令；
- 装了新的察元AI Office 版本，skill 有更新，想一键同步到所有在用的智能体；
- 用的智能体不在 7 家之列，想手动把 skill 文件放进它的技能目录。

典型提问（chabot 语料视角）：

- 「怎么把 chaoffice 技能装进 Claude Code / Codex / Cursor？」
- 「skill 装到哪个目录？怎么卸载？」
- 「升级察元AI Office 后 skill 要不要重装？」

## 前置条件

- 已安装察元AI Office（skill 随应用附带，见 [O36](./O36-CLI-chaoffice总览.md)）。
- skill 只是指挥手册：智能体真正干活仍要能调到 `chaoffice` 命令行（上 PATH 或用 `~/.chaoffice/launcher`，见 O36 第 2-3 步）。
- CLI 形态的台账与图形界面共用同一个文件，两边互通状态。

## 操作步骤

**方式 A · 终端 CLI：`chaoffice skill`**

1. 先看本机情况：`chaoffice skill list`。输出列出 7 家目标智能体（Claude Code、Codex、Cursor、Gemini CLI、GitHub Copilot、OpenCode、Windsurf），每行带：是否检测到（以其配置目录存在为准）、技能目录绝对路径、安装状态与已装版本；`detail` 里还有随附 skill 的版本号与 SKILL.md 路径；
2. 安装：`chaoffice skill install <agent|all> [--dir <路径>] [--force]`
   - `install all` 只装**检测到**的智能体；一家都没检测到时报错，让你改用 `--dir`；
   - `--dir <路径>`：装进任意目录（目标就是 `<路径>/chaoffice/SKILL.md`），适合 7 家之外的助手；
   - 不加 `--force` 时的保护：目标智能体未检测到（拒绝并提示加 `--force` 才会新建目录）、已装的 skill 比随附的**新**（拒绝降级）、或**被手工改过**（拒绝覆盖，提示加 `--force`）、或目录被别的内容占用（报 `occupied`）。所有目标先全量检查再动手，一次拒绝不会留下装了一半的现场；
   - 示例：`chaoffice skill install claude-code`；`chaoffice skill install all`；
3. 看随附文件：`chaoffice skill path` 打印内置 SKILL.md 的绝对路径与版本号；
4. 7 家目标与技能目录（CLI 与界面一致）：

| 智能体 | 技能目录 |
|---|---|
| Claude Code | `$CLAUDE_CONFIG_DIR` 或 `~/.claude/skills` |
| Codex | `$CODEX_HOME` 或 `~/.codex/skills` |
| Cursor | `~/.cursor/skills` |
| Gemini CLI | `~/.gemini/skills` |
| GitHub Copilot | `~/.copilot/skills` |
| OpenCode | `$XDG_CONFIG_HOME/opencode/skills` 或 `~/.config/opencode/skills` |
| Windsurf | `~/.codeium/windsurf/skills` |

**方式 B · 图形界面：设置 → 集成**

1. 打开察元AI Office → **设置 → 集成**，顶部说明「在 AI 助手里使用 察元AIOffice」，第一部分即「**把 skill 安装到你的助手**」（右上角显示随附版本「skill <版本>」）；
2. 界面**只列出本机检测到的助手**，每行右侧按状态给按钮：
   - 「skill 未安装」→「**安装**」；
   - 「已安装 <版本>，可更新到 <新版本>」或非本应用装的旧版 →「**更新**」；
   - 「已安装 <版本>（已被修改）」→「更新」（确认块会提示「会覆盖你对该文件的修改。」）；
   - 「已安装 <版本>（比本应用附带的新）」→「重新安装为 <版本>」；
   - 「目录已被占用」→「覆盖」（确认块提示「会替换该目录中现有的 SKILL.md。」）；
   - 已装的三种正常态都有「**卸载**」；
3. 点按钮后出现确认块「**将写入：<SKILL.md 绝对路径>**」（卸载为「将删除：…」），点「**确认**」执行；成功显示「**已安装。新开一个会话后生效。**」；
4. 「**没有列出我的助手**」折叠区提供三条通用路（装的都是同一份 skill，任选其一）：**A「安装到其他目录…」**（弹出「选择 skills 目录」选择器）、**B「下载 skill（zip）」**（保存 zip 后交给助手自装，完成后提示「已保存到 <路径>」）、**C 用 skills 命令安装**（终端运行 `npx skills add zhgyuhuii/ChayuanAIOffice`，需 Node.js）；
5. 同页「试一试」区给出三句可直接复制的示例提问（「把 ~/Downloads/report.md 转成 Word 文档」「做一份 6 页的幻灯片，介绍我们第三季度的业绩」「把 budget.xlsx 转成 PDF，并在 察元AIOffice 里打开」）；
6. 卸载只删本应用写入并记录在案的文件（按台账判定）；目录里若有其他文件会保留。

**状态机（两种方式共用，`skill list` 的 `status` 字段即此）**

| 状态 | 含义 |
|---|---|
| `missing` | 技能目录里没有 chaoffice/ |
| `installed` | 本应用写入、版本与字节和随附一致 |
| `outdated` | 本应用写入、版本比随附旧 |
| `modified` | 本应用写入、但文件被改过（与台账里的 sha256 不符） |
| `foreign` | front matter 认得是我们的 skill，但不是本应用写的（别的机器/npx/手工） |
| `newer` | 已装版本比随附还新（谁写的都算） |
| `occupied` | chaoffice/ 目录存在但不是我们的 skill |

- 判定依据：front matter 的 `name` + `metadata.version`、文件 sha256 与台账（userData 的 `app-settings.json` 里 `agentSkillInstalls` 键，记录每次写入的版本/哈希/时间/渠道 app·zip·cli）。

### 验证

1. `chaoffice skill list --json`：目标智能体的 `status` 变为 `installed`，`installed_version` 等于随附版本；
2. 打开对应技能目录确认文件存在，如 `ls ~/.claude/skills/chaoffice/SKILL.md`；
3. 界面复核对应该行状态文字变为「已安装 skill <版本> · 下次对话即可使用」；
4. 在该智能体里**新开一个对话**，问「把桌面上的 xx.md 转成 Word」：它会自己调用 `chaoffice convert`（旧会话不会自动加载新 skill）。

## 常见问题

**Q1：装完之后智能体还是不会用 chaoffice？**
两件事：skill 要**新开会话**才生效（面板提示原文「已安装。新开一个会话后生效。」）；智能体还要能调到命令本身——在智能体环境里跑 `chaoffice --version`，跑不通就按 [O36](./O36-CLI-chaoffice总览.md) 第 2-3 步处理。

**Q2：`skill install` 报「the installed skill was edited by hand; not overwriting」？**
说明你（或别的工具）改过已装的 SKILL.md。确认不再需要那些改动后加 `--force` 覆盖：`chaoffice skill install <agent> --force`；想保留就先备份该文件。

**Q3：报「a newer skill X is installed; not downgrading」？**
机器上的版本比这份随附的还新（比如装过更新版的察元AI Office）。确认要降级才加 `--force`；否则什么都不用做，当前版本继续可用。

**Q4：我的智能体不在 7 家名单里怎么办？**
用「没有列出我的助手」三条路之一：界面「安装到其他目录…」选它的 skills 目录，或 CLI `chaoffice skill install --dir <它的技能目录>`，或「下载 skill（zip）」后交给它自装。任何「能读取 SKILL.md 目录」的助手都可用。

**Q5：界面里显示「已安装（非本应用安装）」，要处理吗？**
`foreign` 状态：文件本身是这份 skill（front matter 可识别），只是不是这台机器的察元AI Office 写的（如另一台机器拷来、npx 装的）。版本比随附旧时界面会给「更新」按钮；不旧则无需处理。

**Q6：升级察元AI Office 后要重装吗？**
随附 skill 版本升级后，已装助手的行会出现「更新」按钮（CLI 里 `skill list` 显示 `outdated`），点一下或 `chaoffice skill install all` 即可；没提示就说明还是最新。

## 事实来源

- `packages/cli/src/agent-skills.ts`（7 家 AgentDef 的探测目录与技能目录、7 态状态机 readInstallState、front matter/版本/sha256/台账判定、installSkill 字节级写入与拒绝软链、legacy genoffice 目录清理、`agentSkillInstalls` LEDGER_KEY）
- `packages/cli/src/commands/skill.ts`（`skill list|install|path` 用法、`--dir/--force`、`all` 只装检测到的、先全检查后写入、newer/modified/occupied 拒绝文案、与 GUI 共用 app-settings.json 台账）
- `apps/shell/src/renderer/src/IntegrationsPane.tsx`（设置→集成第一部分结构、各状态按钮映射、确认块「将写入/将删除」、`npx skills add zhgyuhuii/ChayuanAIOffice`、zip 下载、安装到其他目录）
- `apps/shell/src/renderer/src/strings.ts` + `i18n-local-strings.ts`（「把 skill 安装到你的助手」「skill 未安装」「已安装 skill {v} · 下次对话即可使用」「已安装 {v}，可更新到 {next}」「（已被修改）」「（非本应用安装）」「（比本应用附带的新）」「目录已被占用」「安装」「更新」「卸载」「重新安装为 {v}」「覆盖」「已安装。新开一个会话后生效。」「安装到其他目录…」「下载 skill（zip）」「试一试」三例与「没有列出我的助手」等原文）
- `skills/chaoffice/SKILL.md` v2.7.4（随附 skill 的 front matter `name: chaoffice`、`metadata.version: 2.7.4`，「nothing is installed without this command or a click in Settings → Integrations」）
