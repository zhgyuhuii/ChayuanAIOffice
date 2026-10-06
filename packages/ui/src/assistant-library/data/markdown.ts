// generated 助手库数据(markdown) — 整体要求: 每类 ≥100 助手 — do not edit by hand
import type { AssistantDomain } from '../types'

export const MARKDOWN_ASSISTANT_DOMAINS: AssistantDomain[] = [
 {
  "key": "techdoc",
  "label": "技术文档",
  "icon": "🛠️",
  "items": [
   {
    "id": "markdown.techdoc.1",
    "label": "API 文档",
    "icon": "🔌",
    "description": "为代码生成 API 参考文档骨架",
    "prompt": "请为当前文档中的代码接口生成 API 参考文档:每个接口含签名、参数表、返回值、示例与错误码。"
   },
   {
    "id": "markdown.techdoc.2",
    "label": "README 生成",
    "icon": "📖",
    "description": "生成项目 README(简介/安装/用法/许可)",
    "prompt": "请为当前项目生成 README:一句话简介、特性列表、安装步骤、快速上手示例、目录结构、许可。"
   },
   {
    "id": "markdown.techdoc.3",
    "label": "架构说明",
    "icon": "🏗️",
    "description": "生成架构说明文档(组件+数据流)",
    "prompt": "请生成架构说明:组件清单、依赖关系、数据流说明与关键设计决策(ADR 风格)。"
   },
   {
    "id": "markdown.techdoc.4",
    "label": "CHANGELOG",
    "icon": "📋",
    "description": "按提交内容整理 CHANGELOG",
    "prompt": "请按 Keep a Changelog 规范整理变更日志:Added/Changed/Fixed/Removed 分组,版本号与日期占位。"
   },
   {
    "id": "markdown.techdoc.5",
    "label": "故障排查指南",
    "icon": "🚨",
    "description": "生成常见问题排查指南",
    "prompt": "请生成排查指南:常见症状→原因→处置步骤,按出现频率排序。"
   },
   {
    "id": "markdown.techdoc.6",
    "label": "配置参考",
    "icon": "⚙️",
    "description": "生成配置项参考表",
    "prompt": "请生成配置参考表:配置项/类型/默认值/说明/示例,表格呈现。"
   },
   {
    "id": "markdown.techdoc.7",
    "label": "迁移指南",
    "icon": "🚚",
    "description": "生成版本迁移指南",
    "prompt": "请生成迁移指南:破坏性变更清单、迁移步骤、兼容性说明与回滚。"
   },
   {
    "id": "markdown.techdoc.8",
    "label": "贡献指南",
    "icon": "🤝",
    "description": "生成 CONTRIBUTING 指南",
    "prompt": "请生成贡献指南:环境搭建、分支与提交规范、PR 流程、代码风格要求。"
   },
   {
    "id": "markdown.techdoc.9",
    "label": "术语表",
    "icon": "📚",
    "description": "整理术语中英对照表",
    "prompt": "请整理文档术语中英对照表并附一句话定义。"
   },
   {
    "id": "markdown.techdoc.10",
    "label": "部署手册",
    "icon": "🚀",
    "description": "生成部署手册(环境/步骤/验证)",
    "prompt": "请生成部署手册:环境要求、部署步骤、验证方法、常见部署问题。"
   }
  ]
 },
 {
  "key": "blog",
  "label": "博客创作",
  "icon": "✍️",
  "items": [
   {
    "id": "markdown.blog.1",
    "label": "选题策划",
    "icon": "💡",
    "description": "生成 10 个博客选题(含角度)",
    "prompt": "请基于当前笔记生成 10 个博客选题,每个附切入角度与目标读者。"
   },
   {
    "id": "markdown.blog.2",
    "label": "大纲生成",
    "icon": "🧭",
    "description": "生成博客大纲(钩子/主体/CTA)",
    "prompt": "请生成博客大纲:开头钩子、3-5 个小节(每节要点)、结尾 CTA。"
   },
   {
    "id": "markdown.blog.3",
    "label": "初稿撰写",
    "icon": "📝",
    "description": "按大纲写 1500 字初稿",
    "prompt": "请按大纲撰写 1500 字初稿,口语化、有个人观点、避免 AI 腔。"
   },
   {
    "id": "markdown.blog.4",
    "label": "标题优化",
    "icon": "🏷️",
    "description": "生成 10 个候选标题并推荐",
    "prompt": "请生成 10 个候选标题(疑问式/数字式/对比式),标注推荐与理由。"
   },
   {
    "id": "markdown.blog.5",
    "label": "SEO 优化",
    "icon": "🔍",
    "description": "为文章做 SEO 检查与关键词布局",
    "prompt": "请对文章做 SEO 检查:关键词密度、标题层级、meta 描述建议、内链锚点建议。"
   },
   {
    "id": "markdown.blog.6",
    "label": "开头重写",
    "icon": "🎬",
    "description": "生成 3 版开头(故事/提问/数据)",
    "prompt": "请用故事式、提问式、数据式三种写法重写文章开头,各 100 字。"
   },
   {
    "id": "markdown.blog.7",
    "label": "案例补充",
    "icon": "🧩",
    "description": "为论点补充案例与数据占位",
    "prompt": "请为文中 3 个论点各补充一个案例与数据占位,标注需核实。"
   },
   {
    "id": "markdown.blog.8",
    "label": "删减精简",
    "icon": "✂️",
    "description": "删减 30% 字数不损信息",
    "prompt": "请将文章精简 30%:删除重复表达与冗词,保留全部信息点。"
   },
   {
    "id": "markdown.blog.9",
    "label": "系列规划",
    "icon": "📚",
    "description": "把长文拆分为系列文章规划",
    "prompt": "请把当前内容拆为 4 篇系列文章,给出每篇主题/衔接点/发布节奏。"
   },
   {
    "id": "markdown.blog.10",
    "label": "评论区 FAQ",
    "icon": "💬",
    "description": "预测读者问题生成 FAQ 段落",
    "prompt": "请预测读者可能提出的 5 个问题,生成文末 FAQ 段落。"
   }
  ]
 },
 {
  "key": "notes",
  "label": "知识管理",
  "icon": "🧠",
  "items": [
   {
    "id": "markdown.notes.1",
    "label": "笔记重构",
    "icon": "🧹",
    "description": "把流水笔记重构为结构化笔记",
    "prompt": "请把当前笔记重构为:结论前置、要点分层、行动项独立,删除口水话。"
   },
   {
    "id": "markdown.notes.2",
    "label": "Zettelkasten 卡片",
    "icon": "🃏",
    "description": "拆分为原子化卡片笔记",
    "prompt": "请把笔记拆分为原子化卡片,每卡一个观点+来源+关联卡片建议。"
   },
   {
    "id": "markdown.notes.3",
    "label": "周回顾",
    "icon": "🗓️",
    "description": "生成每周知识回顾摘要",
    "prompt": "请生成周回顾:本周新增知识点、关联、待深入问题 3 个。"
   },
   {
    "id": "markdown.notes.4",
    "label": "概念地图",
    "icon": "🗺️",
    "description": "生成概念关联文本地图",
    "prompt": "请梳理笔记中的概念关联,生成缩进式概念地图(中心→分支)。"
   },
   {
    "id": "markdown.notes.5",
    "label": "摘要与标签",
    "icon": "🏷️",
    "description": "为笔记生成摘要与标签体系",
    "prompt": "请为笔记生成一句话摘要与 5 个标签,并建议归档目录。"
   },
   {
    "id": "markdown.notes.6",
    "label": "读书笔记",
    "icon": "📖",
    "description": "按好书笔记模板整理读书要点",
    "prompt": "请按\"核心观点/关键案例/行动启发/金句\"模板整理当前读书内容。"
   },
   {
    "id": "markdown.notes.7",
    "label": "会议纪要",
    "icon": "🗒️",
    "description": "把会议录音文字稿整理成纪要",
    "prompt": "请把当前文字稿整理为纪要:议题/讨论要点/决议/行动项(负责人)。"
   },
   {
    "id": "markdown.notes.8",
    "label": "待办提取",
    "icon": "✅",
    "description": "从笔记提取行动项清单",
    "prompt": "请从笔记提取所有行动项,生成清单(事项/截止/负责人占位)。"
   },
   {
    "id": "markdown.notes.9",
    "label": "知识问答集",
    "icon": "❓",
    "description": "把笔记转为自测问答集",
    "prompt": "请把笔记转为 10 条问答卡(问/答),用于自测记忆。"
   },
   {
    "id": "markdown.notes.10",
    "label": "过时清理",
    "icon": "🗑️",
    "description": "识别过时内容并标注",
    "prompt": "请识别笔记中可能过时的信息(日期/版本/事实),标注需核实。"
   }
  ]
 },
 {
  "key": "product",
  "label": "产品文档",
  "icon": "📦",
  "items": [
   {
    "id": "markdown.product.1",
    "label": "PRD 骨架",
    "icon": "📑",
    "description": "生成 PRD 骨架(背景/需求/验收)",
    "prompt": "请生成 PRD 骨架:背景与目标、用户故事、功能需求(含优先级)、非功能需求、验收标准、里程碑。"
   },
   {
    "id": "markdown.product.2",
    "label": "用户故事",
    "icon": "🎫",
    "description": "把需求转为用户故事(As a…I want…So that)",
    "prompt": "请把当前需求转为用户故事,每条含验收标准(Given/When/Then)。"
   },
   {
    "id": "markdown.product.3",
    "label": "功能说明文档",
    "icon": "📘",
    "description": "生成面向用户的功能说明",
    "prompt": "请生成面向用户的功能说明:功能入口、操作步骤、注意事项、常见问题。"
   },
   {
    "id": "markdown.product.4",
    "label": "需求评审清单",
    "icon": "🔍",
    "description": "生成需求评审检查清单",
    "prompt": "请生成评审清单:完整性/一致性/可测性/边界条件/依赖项各 3-5 条检查项。"
   },
   {
    "id": "markdown.product.5",
    "label": "版本发布公告",
    "icon": "📢",
    "description": "生成版本发布公告",
    "prompt": "请生成本版本发布公告:新功能亮点、优化项、修复项、升级注意事项。"
   },
   {
    "id": "markdown.product.6",
    "label": "交互说明",
    "icon": "🖱️",
    "description": "为界面补交互说明(状态/异常)",
    "prompt": "请为每个界面补交互说明:各状态(默认/加载/空/错误)的表现与流转。"
   },
   {
    "id": "markdown.product.7",
    "label": "数据埋点说明",
    "icon": "📊",
    "description": "生成埋点需求文档",
    "prompt": "请生成埋点文档:事件名/触发时机/属性/用途,表格呈现。"
   },
   {
    "id": "markdown.product.8",
    "label": "竞品功能对比",
    "icon": "⚔️",
    "description": "生成功能对比表",
    "prompt": "请生成与两款竞品的功能对比矩阵(有/无/弱),并标注差异优先级。"
   },
   {
    "id": "markdown.product.9",
    "label": "FAQ 文档",
    "icon": "❓",
    "description": "整理产品 FAQ",
    "prompt": "请整理 10 条高频问题与标准答案,按主题分组。"
   },
   {
    "id": "markdown.product.10",
    "label": "灰度发布方案",
    "icon": "🚦",
    "description": "生成灰度发布方案",
    "prompt": "请生成灰度方案:灰度比例节奏、观察指标、回滚条件。"
   }
  ]
 },
 {
  "key": "writing",
  "label": "长文写作",
  "icon": "📜",
  "items": [
   {
    "id": "markdown.writing.1",
    "label": "选题论证",
    "icon": "🧭",
    "description": "论证选题价值与切入角度",
    "prompt": "请论证当前选题的价值:读者需求、差异化角度、预期收获,并给出大纲。"
   },
   {
    "id": "markdown.writing.2",
    "label": "结构重组",
    "icon": "🧱",
    "description": "诊断文章结构并重组",
    "prompt": "请诊断当前文章结构问题,给出重组后的目录与各节作用。"
   },
   {
    "id": "markdown.writing.3",
    "label": "论据增强",
    "icon": "🧷",
    "description": "为论点补充论据(数据/案例/权威引用)",
    "prompt": "请为文中 3 个论点各补充论据(数据占位/案例/权威观点),标注需核实来源。"
   },
   {
    "id": "markdown.writing.4",
    "label": "风格统一",
    "icon": "🎨",
    "description": "统一全文语气与风格",
    "prompt": "请统一全文语气(专业但不生硬),修正风格漂移的段落,列出改动。"
   },
   {
    "id": "markdown.writing.5",
    "label": "金句打磨",
    "icon": "✨",
    "description": "为核心观点打磨金句",
    "prompt": "请为 3 个核心观点各打磨 2 句金句(对仗/比喻/数字),供选择。"
   },
   {
    "id": "markdown.writing.6",
    "label": "过渡衔接",
    "icon": "🔗",
    "description": "修补段落间过渡",
    "prompt": "请为每个章节间补写过过渡句,使全文逻辑连贯。"
   },
   {
    "id": "markdown.writing.7",
    "label": "结尾升华",
    "icon": "🎬",
    "description": "生成结尾段(总结+行动+升华)",
    "prompt": "请生成结尾段:总结全文、给出行动建议、一句升华收尾。"
   },
   {
    "id": "markdown.writing.8",
    "label": "事实核查清单",
    "icon": "🔍",
    "description": "生成事实核查清单",
    "prompt": "请列出文中所有可核查陈述,生成核查清单(陈述/来源/状态)。"
   },
   {
    "id": "markdown.writing.9",
    "label": "朗读润色",
    "icon": "🎙️",
    "description": "按朗读节奏润色",
    "prompt": "请按朗读节奏润色全文:长句拆短、删口读拗口处,标注停顿建议。"
   },
   {
    "id": "markdown.writing.10",
    "label": "缩写版本",
    "icon": "📉",
    "description": "生成 500 字缩写版与 100 字超短版",
    "prompt": "请生成 500 字摘要版与 100 字社交媒体版,保留核心论点。"
   }
  ]
 },
 {
  "key": "meet",
  "label": "会议协作",
  "icon": "🗓️",
  "items": [
   {
    "id": "markdown.meet.1",
    "label": "会前议程",
    "icon": "📋",
    "description": "生成会议议程",
    "prompt": "请生成会议议程:议题/时长/汇报人/预期产出,控制在 45 分钟。"
   },
   {
    "id": "markdown.meet.2",
    "label": "会议纪要",
    "icon": "🗒️",
    "description": "整理会议纪要(决议/行动项)",
    "prompt": "请把当前内容整理为纪要:结论、行动项(负责人/期限)、遗留问题。"
   },
   {
    "id": "markdown.meet.3",
    "label": "行动项跟踪",
    "icon": "✅",
    "description": "生成行动项跟踪表",
    "prompt": "请提取所有行动项生成跟踪表(事项/负责人/期限/状态),按期限排序。"
   },
   {
    "id": "markdown.meet.4",
    "label": "决策记录",
    "icon": "⚖️",
    "description": "整理决策记录(ADR 风格)",
    "prompt": "请把会议决策整理为决策记录:背景/选项/决定/理由/影响。"
   },
   {
    "id": "markdown.meet.5",
    "label": "会议邮件",
    "icon": "✉️",
    "description": "生成会后跟进邮件",
    "prompt": "请生成会后跟进邮件:感谢参与、纪要摘要、行动项确认请求。"
   },
   {
    "id": "markdown.meet.6",
    "label": "头脑风暴整理",
    "icon": "🧠",
    "description": "把头脑风暴聚类为主题",
    "prompt": "请把头脑风暴内容聚类为 4-6 个主题,每主题归纳要点并列代表想法。"
   },
   {
    "id": "markdown.meet.7",
    "label": "复盘会议页",
    "icon": "🔁",
    "description": "生成项目复盘会材料",
    "prompt": "请生成复盘材料:目标回顾、亮点、不足、根因、改进行动。"
   },
   {
    "id": "markdown.meet.8",
    "label": "站会日报",
    "icon": "🌅",
    "description": "生成团队站会日报模板",
    "prompt": "请生成站会日报模板:昨日完成/今日计划/阻塞项,按成员分组。"
   },
   {
    "id": "markdown.meet.9",
    "label": "跨时区会议注意",
    "icon": "🌍",
    "description": "生成跨时区会议安排说明",
    "prompt": "请生成跨时区会议说明:各时区对应时间、轮换规则、录播与纪要约定。"
   },
   {
    "id": "markdown.meet.10",
    "label": "升级沟通",
    "icon": " escal ",
    "description": "生成问题升级沟通稿",
    "prompt": "请生成问题升级沟通稿:问题影响、已尝试措施、需要的决策与支持。"
   }
  ]
 },
 {
  "key": "study",
  "label": "学习笔记",
  "icon": "📚",
  "items": [
   {
    "id": "markdown.study.1",
    "label": "费曼笔记",
    "icon": "🎯",
    "description": "用费曼技巧重构学习笔记",
    "prompt": "请用费曼技巧重构当前笔记:用最通俗的语言讲清楚概念,标出讲不清的部分(即薄弱点)。"
   },
   {
    "id": "markdown.study.2",
    "label": "考试重点",
    "icon": "🎯",
    "description": "提炼考试重点与题型预测",
    "prompt": "请提炼学习材料的考试重点,按题型(选择/简答/论述)整理并附答题框架。"
   },
   {
    "id": "markdown.study.3",
    "label": "错题本",
    "icon": "📕",
    "description": "整理错题为错题本格式",
    "prompt": "请把错题整理为错题本:题目/错解/正解/错因/知识点,按知识点分组。"
   },
   {
    "id": "markdown.study.4",
    "label": "学习计划",
    "icon": "🗓️",
    "description": "生成备考学习计划",
    "prompt": "请生成备考计划:剩余天数倒排,每日任务(章节/习题/复习),含休息日。"
   },
   {
    "id": "markdown.study.5",
    "label": "概念对比",
    "icon": "⚖️",
    "description": "生成易混概念对比表",
    "prompt": "请找出材料中的易混概念,生成对比表(维度/概念A/概念B)。"
   },
   {
    "id": "markdown.study.6",
    "label": "记忆口诀",
    "icon": "🧠",
    "description": "为知识要点编记忆口诀",
    "prompt": "请为核心要点编记忆口诀或首字联想,便于快速记忆。"
   },
   {
    "id": "markdown.study.7",
    "label": "思维导图",
    "icon": "🗺️",
    "description": "生成章节思维导图文本",
    "prompt": "请把章节内容转为思维导图文本结构(主干→分支→叶子),缩进表达。"
   },
   {
    "id": "markdown.study.8",
    "label": "延伸资源",
    "icon": "🔗",
    "description": "推荐延伸学习资源",
    "prompt": "请按学习路径推荐延伸资源(书/课/文章),说明每步解决什么问题。"
   },
   {
    "id": "markdown.study.9",
    "label": "公式手册",
    "icon": "🧮",
    "description": "整理公式速查手册",
    "prompt": "请整理材料中的公式为速查手册(公式/变量含义/适用条件/例题)。"
   },
   {
    "id": "markdown.study.10",
    "label": "输出倒逼输入",
    "icon": "📤",
    "description": "生成教学式输出练习",
    "prompt": "请生成教学式输出练习:把学到的内容讲给外行的 300 字讲解稿任务与自评清单。"
   }
  ]
 },
 {
  "key": "trans",
  "label": "翻译本地化",
  "icon": "🌐",
  "items": [
   {
    "id": "markdown.trans.1",
    "label": "技术翻译",
    "icon": "🌐",
    "description": "技术文档中译英",
    "prompt": "请将当前技术文档翻译为英文,保持代码块与命令不译,术语首次附原文。"
   },
   {
    "id": "markdown.trans.2",
    "label": "英译中润色",
    "icon": "🇨🇳",
    "description": "英文资料中译并润色",
    "prompt": "请将英文资料翻译为流畅中文,长句拆短,术语对照表附文末。"
   },
   {
    "id": "markdown.trans.3",
    "label": "日文资料翻译",
    "icon": "🇯🇵",
    "description": "日文资料中译",
    "prompt": "请将日文资料翻译为中文,IT 术语保留片假名对照。"
   },
   {
    "id": "markdown.trans.4",
    "label": "字幕翻译",
    "icon": "🎬",
    "description": "SRT 字幕翻译",
    "prompt": "请按 SRT 时间轴格式翻译字幕,每条不超过两个屏幕行。"
   },
   {
    "id": "markdown.trans.5",
    "label": "游戏本地化",
    "icon": "🎮",
    "description": "游戏文案本地化",
    "prompt": "请翻译游戏文案(界面/对话/物品),保持简短与风格统一。"
   },
   {
    "id": "markdown.trans.6",
    "label": "法律翻译审校",
    "icon": "⚖️",
    "description": "法律文件翻译审校",
    "prompt": "请审校法律文件译文:术语一致、条款编号对应、无明显误译。"
   },
   {
    "id": "markdown.trans.7",
    "label": "医学翻译",
    "icon": "⚕️",
    "description": "医学资料翻译",
    "prompt": "请翻译医学资料, drug 名称用通用名,剂量单位严格核对。"
   },
   {
    "id": "markdown.trans.8",
    "label": "营销文案翻译",
    "icon": "📣",
    "description": "营销文案本地化",
    "prompt": "请翻译营销文案,按目标市场重写而非直译,保留号召力。"
   },
   {
    "id": "markdown.trans.9",
    "label": "多语术语库",
    "icon": "📚",
    "description": "建设中英术语库",
    "prompt": "请从双语文档提取术语对,生成 CSV 术语库(英/中/备注)。"
   },
   {
    "id": "markdown.trans.10",
    "label": "译文质量评估",
    "icon": "📊",
    "description": "按 MQM 框架评估译文",
    "prompt": "请按准确/流畅/术语/风格四维评估译文,给出评分与修改清单。"
   }
  ]
 },
 {
  "key": "life",
  "label": "生活方式",
  "icon": "🏡",
  "items": [
   {
    "id": "markdown.life.1",
    "label": "旅行攻略",
    "icon": "✈️",
    "description": "生成目的地旅行攻略",
    "prompt": "请生成目的地旅行攻略:行程安排(3 天)、交通住宿建议、美食清单、预算估算。"
   },
   {
    "id": "markdown.life.2",
    "label": "健身计划",
    "icon": "🏋️",
    "description": "生成每周健身计划",
    "prompt": "请生成每周健身计划:力量/有氧/休息日安排,动作组次与循序渐进说明。"
   },
   {
    "id": "markdown.life.3",
    "label": "食谱规划",
    "icon": "🍳",
    "description": "生成一周食谱与采购清单",
    "prompt": "请生成一周晚餐食谱(荤素搭配)与汇总采购清单,按超市分区排列。"
   },
   {
    "id": "markdown.life.4",
    "label": "搬家清单",
    "icon": "📦",
    "description": "生成搬家打包清单与时间表",
    "prompt": "请生成搬家清单:按房间分类打包顺序、易碎品处理、时间表与检查项。"
   },
   {
    "id": "markdown.life.5",
    "label": "装修进度",
    "icon": "🔨",
    "description": "生成装修流程与验收要点",
    "prompt": "请生成装修流程:各阶段工期/主材进场时间/验收要点,附增项陷阱提醒。"
   },
   {
    "id": "markdown.life.6",
    "label": "育儿记录",
    "icon": "👶",
    "description": "生成育儿成长记录模板",
    "prompt": "请生成成长记录模板:月龄里程碑/喂养/疫苗/趣事,便于长期记录。"
   },
   {
    "id": "markdown.life.7",
    "label": "宠物养护",
    "icon": "🐾",
    "description": "生成宠物养护日历",
    "prompt": "请生成养护日历:疫苗驱虫时间表、日常饮食、常见症状观察要点。"
   },
   {
    "id": "markdown.life.8",
    "label": "节日筹备",
    "icon": "🎊",
    "description": "生成节日筹备清单",
    "prompt": "请生成节日筹备清单:采购/家务/送礼/日程,倒排时间。"
   },
   {
    "id": "markdown.life.9",
    "label": "阅读挑战",
    "icon": "📚",
    "description": "生成年度阅读挑战计划",
    "prompt": "请生成年阅读计划:12 个月书单主题搭配、笔记方法、进度追踪表。"
   },
   {
    "id": "markdown.life.10",
    "label": "习惯养成",
    "icon": "🌱",
    "description": "生成 21 天习惯养成打卡计划",
    "prompt": "请生成习惯养成计划:目标拆解、每日最小行动、复盘问题、奖励机制。"
   }
  ]
 },
 {
  "key": "prompt",
  "label": "提示词工程",
  "icon": "🤖",
  "items": [
   {
    "id": "markdown.prompt.1",
    "label": "提示词改写",
    "icon": "✏️",
    "description": "把模糊需求改写为结构化提示词",
    "prompt": "请把当前模糊的需求描述改写为结构化提示词(角色/任务/约束/输出格式),前后对照。"
   },
   {
    "id": "markdown.prompt.2",
    "label": "系统提示词设计",
    "icon": "🧭",
    "description": "为智能体设计系统提示词",
    "prompt": "请为指定场景的智能体设计系统提示词:角色定位/能力边界/语气规范/异常处理。"
   },
   {
    "id": "markdown.prompt.3",
    "label": "Few-shot 示例构造",
    "icon": "🧩",
    "description": "构造少样本示例集",
    "prompt": "请为任务构造 3 组 few-shot 示例(输入/输出),覆盖典型与边界情况。"
   },
   {
    "id": "markdown.prompt.4",
    "label": "思维链提示",
    "icon": "🔗",
    "description": "把直接问答改为思维链提示",
    "prompt": "请把当前提示词改为思维链版本(分步推理),并对比两种写法的适用场景。"
   },
   {
    "id": "markdown.prompt.5",
    "label": "提示词测试集",
    "icon": "🧪",
    "description": "生成提示词回归测试用例",
    "prompt": "请为当前提示词生成 10 条回归测试用例(输入/期望输出要点)。"
   },
   {
    "id": "markdown.prompt.6",
    "label": "提示词压缩",
    "icon": "📉",
    "description": "在保留效果前提下压缩提示词",
    "prompt": "请压缩当前提示词:删除冗余、合并约束,Token 数减半,效果要点不变。"
   },
   {
    "id": "markdown.prompt.7",
    "label": "防注入加固",
    "icon": "🛡️",
    "description": "为提示词加入注入防护",
    "prompt": "请为处理用户输入的提示词加入注入防护(角色锚定/输出约束/敏感指令拒绝)。"
   },
   {
    "id": "markdown.prompt.8",
    "label": "输出格式约束",
    "icon": "📐",
    "description": "为提示词加 JSON Schema 输出约束",
    "prompt": "请为提示词加严格的 JSON 输出约束(schema 定义+示例+违规重试指令)。"
   },
   {
    "id": "markdown.prompt.9",
    "label": "多模态提示",
    "icon": "🖼️",
    "description": "编写图像生成提示词",
    "prompt": "请为指定画面编写图像生成提示词(主体/风格/构图/光线/负面词),中英双版。"
   },
   {
    "id": "markdown.prompt.10",
    "label": "提示词版本管理",
    "icon": "🗂️",
    "description": "建立提示词版本记录规范",
    "prompt": "请为当前提示词建立版本记录表(版本/改动/效果对比/回滚点)。"
   }
  ]
 }
]

export const MARKDOWN_ASSISTANT_TOTAL = 100
