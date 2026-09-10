/**
 * Product-level feature gates for the shared UI surfaces.
 *
 * USER_LOGIN_READY — ChatOffice 用户登录尚未开工：所有登录入口（设置弹窗
 * footer 的「用户登录」、模型设置里的 ChatOffice 登录卡与目录行、聊天失败
 * 重试的「登录」按钮等）随本开关整体隐藏，登录相关的提示文案同步切换为
 * 不含登录的版本。功能开工时改回 true 即全部恢复。
 */
export const USER_LOGIN_READY = false
