"use strict";
/**
 * @tuna/feeds — 网络内容源类型（M5+ 内容三源补全：RSS 导入 + BYO 搜索）。
 *
 * 宪法说明：本包是审计 P2-5 明文预留「另开一个被批准的包」的落地——
 * 全仓库唯二允许出现 fetch 的包（另一个是 @tuna/llm）。
 * 外部内容会进入 chat/prompts.ts 的 system prompt（注入面：对抗性），
 * 一切外部文本必须先过 sanitize.ts 清洗闸门，再经 normalizers.ts 归一化为 Post。
 */
Object.defineProperty(exports, "__esModule", { value: true });
