// generated 助手库数据(slides) — 整体要求: 每类 ≥100 助手 — do not edit by hand
import type { AssistantDomain } from '../types'

export const SLIDES_ASSISTANT_DOMAINS: AssistantDomain[] = [
 {
  "key": "report",
  "label": "工作汇报",
  "icon": "📋",
  "items": [
   {
    "id": "slides.report.1",
    "label": "周报大纲",
    "icon": "📅",
    "description": "生成周汇报 5 页大纲(本周/数据/问题/计划)",
    "prompt": "请为本周工作生成 5 页周报大纲:封面(标题+日期)、本周成果(3 点带数据)、数据看板页、问题与风险、下周计划。逐页给出标题与要点。"
   },
   {
    "id": "slides.report.2",
    "label": "月度总结",
    "icon": "🗓️",
    "description": "生成月度总结 8 页结构并填充要点",
    "prompt": "请生成月度总结演示 8 页结构:封面/概览/关键成果×3/数据页/问题反思/下月计划,每页给标题、3 条要点与建议图表类型。"
   },
   {
    "id": "slides.report.3",
    "label": "数据看板页",
    "icon": "📊",
    "description": "把 KPI 数据做成看板页(大数字+趋势)",
    "prompt": "请把当前文档中的 KPI 数据整理成 1 页数据看板:4 个大数字指标卡+1 个趋势条形图,给出排版建议与配色。"
   },
   {
    "id": "slides.report.4",
    "label": "问题复盘",
    "icon": "🔁",
    "description": "生成问题复盘页(现象/原因/对策)",
    "prompt": "请就当前汇报中的问题生成复盘页:问题描述、根因分析(5Why 简版)、对策与责任人占位、时间线。"
   },
   {
    "id": "slides.report.5",
    "label": "计划甘特页",
    "icon": "🗓️",
    "description": "生成下月计划甘特示意页",
    "prompt": "请生成下月工作计划页:按周分 4 列,列 6-8 项任务条(名称/起止周/负责角色),并给出在幻灯片中的排版方式。"
   },
   {
    "id": "slides.report.6",
    "label": "亮点提炼",
    "icon": "✨",
    "description": "从工作内容提炼 3 个亮点并配金句",
    "prompt": "请从当前文档提炼 3 个工作亮点,每个一句数据化表达+一句金句总结,用于汇报开场。"
   },
   {
    "id": "slides.report.7",
    "label": "风险预案页",
    "icon": "⚠️",
    "description": "生成风险与预案页(风险矩阵)",
    "prompt": "请生成风险页:列出 4 个风险(概率×影响矩阵定位),每个配应对预案,排版为 2×2 卡片。"
   },
   {
    "id": "slides.report.8",
    "label": "跨部门协作页",
    "icon": "🤝",
    "description": "生成协作事项与需求页",
    "prompt": "请生成跨部门协作页:需要协同的事项、对接部门、需要的支持与时间点,表格化呈现。"
   },
   {
    "id": "slides.report.9",
    "label": "汇报开场",
    "icon": "🎬",
    "description": "生成 30 秒开场白与结论先行页",
    "prompt": "请生成汇报开场:一句结论先行的总述+三个支撑点预告,控制在 30 秒口播量。"
   },
   {
    "id": "slides.report.10",
    "label": "问答准备",
    "icon": "❓",
    "description": "预测领导可能追问的 8 个问题与答法",
    "prompt": "请基于当前汇报内容,预测听众可能追问的 8 个问题,每个给出应答要点与数据支撑位置。"
   }
  ]
 },
 {
  "key": "launch",
  "label": "产品发布",
  "icon": "🚀",
  "items": [
   {
    "id": "slides.launch.1",
    "label": "发布会大纲",
    "icon": "🎤",
    "description": "生成产品发布会 12 页大纲",
    "prompt": "请生成产品发布会 12 页大纲:开场悬念、市场痛点、产品亮相、核心功能×3、对比、场景、口碑、价格、权益、CTA。逐页给标题与视觉建议。"
   },
   {
    "id": "slides.launch.2",
    "label": "卖点提炼",
    "icon": "💎",
    "description": "从功能清单提炼 3 大卖点(FAB 法)",
    "prompt": "请读取产品功能清单,用 FAB 法提炼 3 大卖点(特性-优势-利益),每条一句话+一个场景。"
   },
   {
    "id": "slides.launch.3",
    "label": "竞品对比页",
    "icon": "⚔️",
    "description": "生成与我方有利的对比页",
    "prompt": "请生成竞品对比页:选取 5 个我方占优的维度做对比表,注意客观但突出优势,附免责小字建议。"
   },
   {
    "id": "slides.launch.4",
    "label": "场景故事页",
    "icon": "📖",
    "description": "生成用户场景故事页(痛点剧情感的)",
    "prompt": "请生成一个用户场景故事页:人物+困境+产品介入+改变,用画面感文案,配图建议 1 张。"
   },
   {
    "id": "slides.launch.5",
    "label": "价格页",
    "icon": "🏷️",
    "description": "生成价格与版本对比页",
    "prompt": "请生成价格页:3 个版本(基础/专业/旗舰)对比表,中间版本高亮\"最受欢迎\",附促销钩子。"
   },
   {
    "id": "slides.launch.6",
    "label": " Demo 演示页",
    "icon": "🖥️",
    "description": "生成 Demo 演示环节的引导页",
    "prompt": "请生成 Demo 演示引导页:演示脚本 3 步(做什么/看到什么/亮点是什么),以及演示失败的备用截图方案。"
   },
   {
    "id": "slides.launch.7",
    "label": "技术架构页",
    "icon": "🏗️",
    "description": "生成面向 B 端的技术架构页要点",
    "prompt": "请生成技术架构页:分层架构(接入/服务/数据)、安全合规要点、性能指标,简洁图形化表达。"
   },
   {
    "id": "slides.launch.8",
    "label": "路线图页",
    "icon": "🗺️",
    "description": "生成产品路线图页(现在/90 天/一年)",
    "prompt": "请生成路线图页:三阶段(已上线/90 天内/长期愿景),每阶段 3 个里程碑,时间轴排版。"
   },
   {
    "id": "slides.launch.9",
    "label": "客户证言页",
    "icon": "💬",
    "description": "生成客户证言页版式与占位",
    "prompt": "请生成客户证言页:3 条证言卡(客户 logo 位/引言/姓名职位),排版建议与真实感文案占位。"
   },
   {
    "id": "slides.launch.10",
    "label": "发布会结尾",
    "icon": "🎬",
    "description": "生成结尾 CTA 页与金句",
    "prompt": "请生成结尾页:一句产品金句+购买渠道/联系方式+二维码占位,风格与开场呼应。"
   }
  ]
 },
 {
  "key": "train",
  "label": "培训教学",
  "icon": "🎓",
  "items": [
   {
    "id": "slides.train.1",
    "label": "课程大纲",
    "icon": "📚",
    "description": "生成培训课程大纲(目标/章节/时长)",
    "prompt": "请生成培训课程大纲:培训目标 3 条、6 个章节(每章要点与时长)、考核方式,总计 2 小时。"
   },
   {
    "id": "slides.train.2",
    "label": "知识点页",
    "icon": "💡",
    "description": "生成知识点讲解页(概念+示例+练习)",
    "prompt": "请生成知识点页模板:概念定义、图解示意、正反示例、随堂练习 1 题,适合投屏阅读。"
   },
   {
    "id": "slides.train.3",
    "label": "操作演示页",
    "icon": "🖥️",
    "description": "生成软件操作演示分步页",
    "prompt": "请为软件操作生成分步演示页:每步一张截图占位+操作说明+常见错误提示。"
   },
   {
    "id": "slides.train.4",
    "label": "案例研讨页",
    "icon": "🧩",
    "description": "生成案例研讨页(案例+问题+讨论)",
    "prompt": "请生成案例研讨页:案例背景 100 字、3 个讨论问题、讨论时间与分组方式。"
   },
   {
    "id": "slides.train.5",
    "label": "随堂测验页",
    "icon": "📝",
    "description": "生成 3 道选择题测验页(含答案动画建议)",
    "prompt": "请生成 3 道单选题测验页,每页一题+四个选项,备注正确答案与讲解要点。"
   },
   {
    "id": "slides.train.6",
    "label": "课程总结页",
    "icon": "🧾",
    "description": "生成课程总结页(回顾+行动项)",
    "prompt": "请生成课程总结页:3 个核心要点回顾、课后行动项 3 条、参考资料。"
   },
   {
    "id": "slides.train.7",
    "label": "分层教学页",
    "icon": "🪜",
    "description": "生成基础版与进阶版双轨内容页",
    "prompt": "请把同一知识点拆成基础版(是什么)与进阶版(为什么+怎么变通)两页,标注适用对象。"
   },
   {
    "id": "slides.train.8",
    "label": "破冰互动页",
    "icon": "🧊",
    "description": "生成开场破冰互动页",
    "prompt": "请生成破冰互动页:1 个快速问卷或举手问题+互动规则说明,营造参与感。"
   },
   {
    "id": "slides.train.9",
    "label": "讲师备注页",
    "icon": "🗒️",
    "description": "为每页生成讲师口播备注",
    "prompt": "请为当前大纲的每一页生成 60 秒内讲师口播备注,口语化、带过渡句。"
   },
   {
    "id": "slides.train.10",
    "label": "考核评估页",
    "icon": "✅",
    "description": "生成培训效果评估页(四级评估)",
    "prompt": "请生成培训效果评估页:反应/学习/行为/结果四层评估方式与指标占位。"
   }
  ]
 },
 {
  "key": "pitch",
  "label": "融资路演",
  "icon": "💼",
  "items": [
   {
    "id": "slides.pitch.1",
    "label": "路演 10 页大纲",
    "icon": "🎯",
    "description": "生成投资人路演 10 页经典结构",
    "prompt": "请生成融资路演 10 页:痛点、方案、市场规模、产品、商业模式、竞争、团队、数据、融资计划、愿景。每页一句话核心信息。"
   },
   {
    "id": "slides.pitch.2",
    "label": "市场规模页",
    "icon": "📈",
    "description": "生成 TAM/SAM/SOM 三层市场页",
    "prompt": "请生成市场规模页:TAM/SAM/SOM 三层漏斗,数据占位+测算口径说明,避免拍脑袋表述。"
   },
   {
    "id": "slides.pitch.3",
    "label": "商业模式页",
    "icon": "💹",
    "description": "生成商业模式画布精简页",
    "prompt": "请生成商业模式页:价值主张、客户分段、收入模式、成本结构四象限,一页讲清怎么赚钱。"
   },
   {
    "id": "slides.pitch.4",
    "label": "竞争格局页",
    "icon": "⚔️",
    "description": "生成竞争定位四象限页",
    "prompt": "请生成竞争格局页:2×2 四象限(维度可自定义),我方位于右上,竞品按定位摆放,附一句护城河说明。"
   },
   {
    "id": "slides.pitch.5",
    "label": "财务预测页",
    "icon": "🧾",
    "description": "生成三年财务预测页(收入/成本/毛利)",
    "prompt": "请生成三年财务预测页:收入、成本、毛利、关键假设三条,柱线组合图占位。"
   },
   {
    "id": "slides.pitch.6",
    "label": "融资计划页",
    "icon": "💰",
    "description": "生成融资计划页(金额/用途/里程碑)",
    "prompt": "请生成融资计划页:本轮金额、出让比例、资金用途四块(研发/市场/运营/储备)占比、12 个月里程碑。"
   },
   {
    "id": "slides.pitch.7",
    "label": "团队页",
    "icon": "👥",
    "description": "生成团队介绍页(创始人+核心成员)",
    "prompt": "请生成团队页:创始人(一句话背景+过往成绩)+核心成员 3 人(职能+亮点),突出团队与事情的匹配。"
   },
   {
    "id": "slides.pitch.8",
    "label": "里程碑页",
    "icon": "🚩",
    "description": "生成已达成里程碑页(时间轴)",
    "prompt": "请生成里程碑页:时间轴列出产品/数据/合作三类关键节点,体现节奏与执行力。"
   },
   {
    "id": "slides.pitch.9",
    "label": "退出逻辑页",
    "icon": "🚪",
    "description": "生成投资退出逻辑页",
    "prompt": "请生成退出逻辑页:并购方向、IPO 路径、可比公司估值参考,给投资人退出想象。"
   },
   {
    "id": "slides.pitch.10",
    "label": "一页纸摘要",
    "icon": "📄",
    "description": "把路演浓缩成一页纸摘要",
    "prompt": "请把整个路演浓缩为一页纸摘要:一句话定位+3 组关键数据+融资要素,可发微信长度。"
   }
  ]
 },
 {
  "key": "defense",
  "label": "答辩学术",
  "icon": "🎓",
  "items": [
   {
    "id": "slides.defense.1",
    "label": "答辩大纲",
    "icon": "📜",
    "description": "生成毕业答辩 10 页结构(含时间分配)",
    "prompt": "请生成毕业答辩 10 页:选题背景与意义、文献综述、研究方法、数据/实验、结论、创新点、不足与展望,标注每页建议讲述时长(共 10 分钟)。"
   },
   {
    "id": "slides.defense.2",
    "label": "文献综述页",
    "icon": "📚",
    "description": "生成文献综述页(流派+演进+缺口)",
    "prompt": "请生成文献综述页:按流派或时间线梳理 3-5 支代表性研究,指出研究缺口引出本文工作。"
   },
   {
    "id": "slides.defense.3",
    "label": "研究方法页",
    "icon": "🔬",
    "description": "生成研究方法页(设计/样本/工具)",
    "prompt": "请生成研究方法页:研究设计、样本与数据来源、测量工具与分析方法,一张流程图表达。"
   },
   {
    "id": "slides.defense.4",
    "label": "结果展示页",
    "icon": "📊",
    "description": "生成研究结果页(图表为主少文字)",
    "prompt": "请生成结果页:主结果 1 图+关键数值 3 个,图注规范,避免整段文字。"
   },
   {
    "id": "slides.defense.5",
    "label": "创新点页",
    "icon": "💡",
    "description": "生成创新点页(3 条逐条论证)",
    "prompt": "请生成创新点页:3 条创新点,每条一句创新陈述+一句与现有工作的差异证据。"
   },
   {
    "id": "slides.defense.6",
    "label": "问题预设页",
    "icon": "❓",
    "description": "生成答辩委员可能提问的 10 问与应答",
    "prompt": "请基于论文内容预测答辩委员 10 个问题(方法/数据/结论/推广),每问给应答要点。"
   },
   {
    "id": "slides.defense.7",
    "label": "局限与展望页",
    "icon": "🔭",
    "description": "生成研究局限与未来展望页",
    "prompt": "请生成局限页:2 条诚实局限(样本/方法)+2 条未来研究方向,措辞谦逊但自信。"
   },
   {
    "id": "slides.defense.8",
    "label": "致谢页",
    "icon": "🙏",
    "description": "生成致谢页(导师/评委/家人)",
    "prompt": "请生成致谢页:对导师、评委、同学家人的致谢,简洁真诚,字号宜大。"
   },
   {
    "id": "slides.defense.9",
    "label": "英文摘要页",
    "icon": "🌐",
    "description": "生成英文摘要页(答辩国际场)",
    "prompt": "请生成英文摘要页:Title/Background/Methods/Results/Conclusion 各一句,术语准确。"
   },
   {
    "id": "slides.defense.10",
    "label": "开题报告页",
    "icon": "📝",
    "description": "生成开题报告 8 页(选题依据+方案)",
    "prompt": "请生成开题报告 8 页:选题背景、研究问题、文献初步综述、研究内容、方法、创新构想、进度安排、参考文献。"
   }
  ]
 },
 {
  "key": "market",
  "label": "营销方案",
  "icon": "📣",
  "items": [
   {
    "id": "slides.market.1",
    "label": "整合营销大纲",
    "icon": "🧭",
    "description": "生成 IMC 整合营销方案 10 页",
    "prompt": "请生成整合营销方案 10 页:背景与洞察、策略主线、人群定位、创意概念、渠道组合、内容矩阵、排期、预算、KPI、风险。"
   },
   {
    "id": "slides.market.2",
    "label": "人群画像页",
    "icon": "🎯",
    "description": "生成目标人群画像页(3 类典型人群)",
    "prompt": "请生成人群画像页:3 类典型用户(姓名化角色),含年龄/城市/媒介习惯/核心痛点/触发场景。"
   },
   {
    "id": "slides.market.3",
    "label": "创意概念页",
    "icon": "💡",
    "description": "生成创意概念页(Big Idea)",
    "prompt": "请生成创意概念页:一句 Big Idea、创意阐释、延展方向 3 个、示例画面描述。"
   },
   {
    "id": "slides.market.4",
    "label": "渠道矩阵页",
    "icon": "📡",
    "description": "生成渠道组合与预算分配页",
    "prompt": "请生成渠道矩阵页:各渠道(抖音/小红书/微信/线下)角色、内容形态、预算占比,并说明投放节奏。"
   },
   {
    "id": "slides.market.5",
    "label": "内容日历页",
    "icon": "🗓️",
    "description": "生成 30 天内容日历页",
    "prompt": "请生成 30 天内容日历:按周分 4 组,每天一条内容(主题/形式/渠道),热点节点标注。"
   },
   {
    "id": "slides.market.6",
    "label": " KPI 指标页",
    "icon": "📊",
    "description": "生成营销 KPI 体系页(曝光到转化)",
    "prompt": "请生成 KPI 页:曝光-互动-留资-转化四层指标+目标值+监测工具,一页表格式。"
   },
   {
    "id": "slides.market.7",
    "label": "竞品营销分析",
    "icon": "🔍",
    "description": "生成竞品营销动作拆解页",
    "prompt": "请生成竞品分析页:3 个竞品近期的 campaign 拆解(主题/渠道/声量/可借鉴点)。"
   },
   {
    "id": "slides.market.8",
    "label": "预算分配页",
    "icon": "💰",
    "description": "生成预算分配与费比页",
    "prompt": "请生成预算页:总预算按渠道/按月双维度分配表,费比对照行业值。"
   },
   {
    "id": "slides.market.9",
    "label": "效果复盘页",
    "icon": "🔁",
    "description": "生成 campaign 复盘页(目标 vs 实际)",
    "prompt": "请生成复盘页:目标 vs 实际对照、亮点 2 条、不足 2 条、Next Step。"
   },
   {
    "id": "slides.market.10",
    "label": "品牌联名页",
    "icon": "🤝",
    "description": "生成联名合作提案页",
    "prompt": "请生成联名提案页:双方资源、联名概念、权益互换、分成模式。"
   }
  ]
 },
 {
  "key": "brand",
  "label": "品牌介绍",
  "icon": "🏷️",
  "items": [
   {
    "id": "slides.brand.1",
    "label": "公司介绍",
    "icon": "🏢",
    "description": "生成公司介绍 6 页(历程/业务/荣誉)",
    "prompt": "请生成公司介绍 6 页:封面、公司概览、发展历程时间轴、核心业务、荣誉资质、联系方式。"
   },
   {
    "id": "slides.brand.2",
    "label": "企业文化页",
    "icon": "🧭",
    "description": "生成使命愿景价值观页",
    "prompt": "请生成企业文化页:使命/愿景/价值观三条,每条一句阐释,排版居中大字。"
   },
   {
    "id": "slides.brand.3",
    "label": "产品矩阵页",
    "icon": "🧱",
    "description": "生成产品矩阵总览页",
    "prompt": "请生成产品矩阵页:按产品线分列,每产品一句话定位+适用客户,矩阵图表达。"
   },
   {
    "id": "slides.brand.4",
    "label": "里程碑时间轴",
    "icon": "🕰️",
    "description": "生成公司大事记时间轴页",
    "prompt": "请生成大事记时间轴:成立/融资/产品发布/规模里程碑 6-8 个节点,横向时间轴。"
   },
   {
    "id": "slides.brand.5",
    "label": "创始人故事页",
    "icon": "👤",
    "description": "生成创始人故事页",
    "prompt": "请生成创始人故事页:初心(为什么做)+关键转折+一句话信条,叙事性文案。"
   },
   {
    "id": "slides.brand.6",
    "label": "荣誉墙页",
    "icon": "🏆",
    "description": "生成荣誉资质墙页",
    "prompt": "请生成荣誉墙页:资质证书/奖项/专利数量统计+logo 墙占位。"
   },
   {
    "id": "slides.brand.7",
    "label": "社会责任页",
    "icon": "🌱",
    "description": "生成 ESG/社会责任页",
    "prompt": "请生成社会责任页:环保/公益/员工关怀三块,各 1-2 个具体事例与数据。"
   },
   {
    "id": "slides.brand.8",
    "label": "组织架构页",
    "icon": "🗂️",
    "description": "生成组织架构页",
    "prompt": "请生成组织架构页:层级树状图(部门+负责人占位),简洁线条风。"
   },
   {
    "id": "slides.brand.9",
    "label": "合作生态页",
    "icon": "🔗",
    "description": "生成合作伙伴生态页",
    "prompt": "请生成合作生态页:客户 logo 墙(按行业分组)+生态伙伴分类。"
   },
   {
    "id": "slides.brand.10",
    "label": "招聘品牌页",
    "icon": "📢",
    "description": "生成雇主品牌招聘页",
    "prompt": "请生成招聘页:为什么加入我们(3 个理由)+在招岗位方向+联系方式。"
   }
  ]
 },
 {
  "key": "event",
  "label": "活动策划",
  "icon": "🎪",
  "items": [
   {
    "id": "slides.event.1",
    "label": "活动总方案",
    "icon": "🎪",
    "description": "生成活动总方案 10 页(目标/流程/分工/预算)",
    "prompt": "请生成活动总方案 10 页:活动目标、主题创意、时间地点、流程安排、嘉宾邀请、传播计划、物料清单、分工表、预算、应急预案。"
   },
   {
    "id": "slides.event.2",
    "label": "主题创意页",
    "icon": "💡",
    "description": "生成活动主题与口号页",
    "prompt": "请生成活动主题页:1 个主主题+2 个备选,各配口号与立意说明。"
   },
   {
    "id": "slides.event.3",
    "label": "流程编排页",
    "icon": "⏱️",
    "description": "生成分钟级流程编排表",
    "prompt": "请生成分钟级流程表:时间段/环节/内容/负责人/物料/备注,从签到到散场。"
   },
   {
    "id": "slides.event.4",
    "label": "嘉宾邀请页",
    "icon": "🎤",
    "description": "生成嘉宾邀请与日程页",
    "prompt": "请生成嘉宾页:拟邀嘉宾清单(姓名/头衔/邀请状态)、分享主题、接待安排。"
   },
   {
    "id": "slides.event.5",
    "label": "传播计划页",
    "icon": "📢",
    "description": "生成活动前中后传播计划页",
    "prompt": "请生成传播页:预热期/进行期/发酵期三阶段,各渠道内容与时间点。"
   },
   {
    "id": "slides.event.6",
    "label": "物料清单页",
    "icon": "📦",
    "description": "生成物料清单与到位时间页",
    "prompt": "请生成物料清单:主视觉/背景板/手册/礼品等,数量/负责人/到位时间/验收状态。"
   },
   {
    "id": "slides.event.7",
    "label": "预算明细页",
    "icon": "💰",
    "description": "生成活动预算明细页",
    "prompt": "请生成预算页:场地/搭建/嘉宾/传播/物料/应急六类明细与占比,总计与费比。"
   },
   {
    "id": "slides.event.8",
    "label": "应急预案页",
    "icon": "🚨",
    "description": "生成应急预案页(天气/设备/人数/舆情)",
    "prompt": "请生成应急页:四类风险的触发条件与处置动作,责任到人。"
   },
   {
    "id": "slides.event.9",
    "label": "效果评估页",
    "icon": "📊",
    "description": "生成活动效果评估页(到场/传播/转化)",
    "prompt": "请生成评估页:报名与到场率、传播曝光、线索转化三组指标对照目标。"
   },
   {
    "id": "slides.event.10",
    "label": "复盘归档页",
    "icon": "🗃️",
    "description": "生成活动复盘归档页",
    "prompt": "请生成复盘页:亮点/问题/改进项/归档资料清单。"
   }
  ]
 },
 {
  "key": "gov",
  "label": "党建政务",
  "icon": "🏛️",
  "items": [
   {
    "id": "slides.gov.1",
    "label": "工作汇报",
    "icon": "🏛️",
    "description": "生成党政机关工作汇报 8 页",
    "prompt": "请生成工作汇报 8 页:总体情况、主要做法(3 条)、工作成效(数据)、存在问题、下一步打算,语体庄重规范。"
   },
   {
    "id": "slides.gov.2",
    "label": "主题教育页",
    "icon": "📖",
    "description": "生成主题教育开展情况页",
    "prompt": "请生成主题教育页:学习教育/调查研究/检视整改三块开展情况与成效。"
   },
   {
    "id": "slides.gov.3",
    "label": "党建工作页",
    "icon": "_flag",
    "description": "生成党建工作总结页",
    "prompt": "请生成党建页:组织建设、党员发展、理论学习、党建+业务融合四块要点。"
   },
   {
    "id": "slides.gov.4",
    "label": "政策解读页",
    "icon": "📜",
    "description": "生成政策解读页(背景/要点/落实)",
    "prompt": "请生成政策解读页:政策出台背景、核心条款 3 条图解、本地落实举措。"
   },
   {
    "id": "slides.gov.5",
    "label": "年度总结页",
    "icon": "📅",
    "description": "生成年度工作总结页",
    "prompt": "请生成本年度工作总结页:指导思想、重点工作 4 项(每项做法+成效)、数据亮点。"
   },
   {
    "id": "slides.gov.6",
    "label": "民生实事页",
    "icon": "民生",
    "description": "生成民生实事项目进展页",
    "prompt": "请生成民生实事页:项目清单(名称/进展/完成率/受益群众),进展用进度条表达。"
   },
   {
    "id": "slides.gov.7",
    "label": "安全隐患排查页",
    "icon": "🦺",
    "description": "生成安全排查整治页",
    "prompt": "请生成安全排查页:排查范围、发现问题分类、整改闭环情况(已整改/限期整改)。"
   },
   {
    "id": "slides.gov.8",
    "label": "数据发布页",
    "icon": "📊",
    "description": "生成统计数据发布页",
    "prompt": "请生成数据发布页:核心指标 4 个(同比标注)+趋势图占位,口径注释在页脚。"
   },
   {
    "id": "slides.gov.9",
    "label": "创建达标页",
    "icon": "🏅",
    "description": "生成创建达标(文明城/卫生城)页",
    "prompt": "请生成创建页:创建目标、任务分解、当前短板、攻坚举措。"
   },
   {
    "id": "slides.gov.10",
    "label": "述职报告页",
    "icon": "📝",
    "description": "生成个人述职报告页",
    "prompt": "请生成个人述职页:政治学习、履职情况(3 项)、廉洁自律、不足与改进。"
   }
  ]
 },
 {
  "key": "design",
  "label": "设计排版",
  "icon": "🎨",
  "items": [
   {
    "id": "slides.design.1",
    "label": "统一配色",
    "icon": "🎨",
    "description": "为全篇统一配色方案(主色+辅色+强调)",
    "prompt": "请为当前演示统一配色:给主色、辅色、强调色三个色值与使用规则,并说明如何批量应用到所有页。"
   },
   {
    "id": "slides.design.2",
    "label": "字体规范",
    "icon": "🔤",
    "description": "设定标题/正文字体字号规范",
    "prompt": "请设定字体规范:中文标题(字号/字重)、正文、注释,中西文搭配建议,并列出逐页检查清单。"
   },
   {
    "id": "slides.design.3",
    "label": "对齐修正",
    "icon": "📐",
    "description": "审查并修正元素对齐问题",
    "prompt": "请审查每页元素的对齐(左对齐/等距/栅格),列出不对齐的页与元素,并给出修正后的布局参数。"
   },
   {
    "id": "slides.design.4",
    "label": "留白优化",
    "icon": " whitespace ",
    "description": "压缩文字增加留白",
    "prompt": "请对文字过密的页面做减法:每页保留不超过 5 行,删除冗余修饰词,剩余内容分级排版。"
   },
   {
    "id": "slides.design.5",
    "label": "图表美化",
    "icon": "📊",
    "description": "统一图表样式(色板/坐标轴/数据标签)",
    "prompt": "请统一所有图表样式:同一色板、去网格杂线、数据标签只保留关键值,给出逐图修改清单。"
   },
   {
    "id": "slides.design.6",
    "label": "图文混排",
    "icon": "🖼️",
    "description": "优化图文混排版式",
    "prompt": "请为带图的页面优化版式:图占 60% 右置、文字左对齐纵排,并给替代布局 1 种。"
   },
   {
    "id": "slides.design.7",
    "label": "过渡页设计",
    "icon": "🧭",
    "description": "为章节间生成过渡页",
    "prompt": "请为每个章节生成过渡页:章节序号大字+章节标题+一句引导语,风格统一。"
   },
   {
    "id": "slides.design.8",
    "label": "logo 规范页脚",
    "icon": "🏷️",
    "description": "统一页脚(logo+页码+机密标注)",
    "prompt": "请为所有页统一页脚:左 logo、右页码,机密文件加标注,说明批量做法。"
   },
   {
    "id": "slides.design.9",
    "label": "图标风格统一",
    "icon": "🧩",
    "description": "统一图标为线性/面性同一风格",
    "prompt": "请审查所有图标,统一为线性风格(同粗细/圆角),列出需要替换的图标与替代建议。"
   },
   {
    "id": "slides.design.10",
    "label": "深色版适配",
    "icon": "🌙",
    "description": "生成深色背景适配版配色",
    "prompt": "请为深色会场生成适配配色:背景深灰、正文浅色、图表换深色友好色板,并列出需要反色的元素。"
   }
  ]
 }
]

export const SLIDES_ASSISTANT_TOTAL = 100
