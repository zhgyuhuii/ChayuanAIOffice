/**
 * LOCAL(2026-09-21, d8201ad0): 通用续作指令常量(B 区)。
 * 措辞沿用 docs continuation.ts 的 DOCS_CONTINUE_INSTRUCTION(D10 断点续作);
 * 六端「继续」入口统一引用此常量(docs 端接入时改引新常量,不双份维护)。
 * 上游无此文件;收敛条件:上游若实现统一续作指令,评估取上游。
 */
export const AI_CONTINUE_INSTRUCTION =
  'Continue the current task using the existing conversation and document state. Finish only the outstanding work. Do not repeat edits or steps that are already complete.'
