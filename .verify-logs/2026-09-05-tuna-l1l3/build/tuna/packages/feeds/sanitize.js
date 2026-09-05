"use strict";
/**
 * 清洗闸门（安全红线，REVIEW-TUNA-FULL-2026-08-03 L182）。
 *
 * 外部内容（RSS / BYO 搜索）的 title/body 会进入 chat/prompts.ts 的 system prompt，
 * 注入面从「模型跑偏」升级为「对抗性注入」。一切外部文本进 Post 之前必须过本闸门：
 * 1. 剥 HTML 标签（script/style 连内容整体剥除）；
 * 2. 解码常见 HTML 实体；
 * 3. 去控制字符；
 * 4. 长度截断（title ≤200、body ≤2000，按码点计）；
 * 5. 空串拒绝（返回 ''，由 normalizer 拒绝入库）。
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.MAX_BODY_CHARS = exports.MAX_TITLE_CHARS = void 0;
exports.decodeEntities = decodeEntities;
exports.stripHtml = stripHtml;
exports.truncateChars = truncateChars;
exports.sanitizeTitle = sanitizeTitle;
exports.sanitizeBody = sanitizeBody;
exports.detectLang = detectLang;
exports.firstSentence = firstSentence;
/** title 长度上限（码点） */
exports.MAX_TITLE_CHARS = 200;
/** body 长度上限（码点） */
exports.MAX_BODY_CHARS = 2000;
/** 实体解码表：只覆盖最常见子集，未知实体保留原文（不引入完整 HTML 解析器） */
const NAMED_ENTITIES = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    hellip: '…',
    mdash: '—',
    ndash: '–',
};
/** C0/C1 控制字符（保留 \t \n \r，交给空白折叠） */
const CONTROL_CHARS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
/** 解码 HTML 实体（&amp; &#60; &#x3C; 等） */
function decodeEntities(text) {
    return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body) => {
        // M-3：码点必须在 [1, 0x10FFFF] 内——超界值使 String.fromCodePoint 抛 RangeError，
        // channel 标题路径会把异常抛到最外层，整轮摄取瘫痪（违反「永不抛错」契约）
        if (body.startsWith('#x') || body.startsWith('#X')) {
            const code = parseInt(body.slice(2), 16);
            return Number.isFinite(code) && code > 0 && code <= 0x10FFFF
                ? String.fromCodePoint(code)
                : match;
        }
        if (body.startsWith('#')) {
            const code = parseInt(body.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10FFFF
                ? String.fromCodePoint(code)
                : match;
        }
        return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    });
}
/** 单次标签剥离（script/style 连内容整体删 + 块级结束转空格 + 其余标签删除） */
function stripTagsOnce(text) {
    let out = text.replace(/<(script|style|iframe|object|embed)\b[\s\S]*?<\/\1\s*>/gi, ' ');
    out = out.replace(/<(script|style|iframe|object|embed)\b[\s\S]*$/gi, ' ');
    out = out.replace(/<\/(p|div|li|h[1-6]|tr|blockquote|section|article)\s*>/gi, ' ');
    out = out.replace(/<br\s*\/?>/gi, ' ');
    out = out.replace(/<[^>]*>/g, '');
    return out;
}
/**
 * 剥 HTML 标签：
 * - script/style/iframe/object/embed 标签连同内容整体删除（纯标签剥离会留下脚本正文）；
 * - 未闭合的危险标签块：从标签起到文本末尾整体丢弃（宁缺毋滥）；
 * - 块级结束标签与 <br> 转换为空格，避免词被粘连；
 * - 其余标签整体删除；
 * - 解码实体后再剥一遍：防「&lt;script&gt; 编码绕过」——解码释放出的标签仍是注入载体；
 * - 去控制字符。
 */
function stripHtml(text) {
    let out = stripTagsOnce(text);
    out = decodeEntities(out);
    if (/<[a-zA-Z/!]/.test(out)) {
        out = stripTagsOnce(out);
    }
    return out.replace(CONTROL_CHARS_RE, '');
}
/** 按码点截断（与 @tuna/content charCount 同口径），超长补省略号 */
function truncateChars(text, maxChars) {
    const chars = Array.from(text);
    if (chars.length <= maxChars)
        return text;
    return `${chars.slice(0, maxChars - 1).join('')}…`;
}
/**
 * 清洗短文本（title 用）：剥 HTML → 全部空白折叠为单空格 → 截断 ≤maxChars。
 * 结果为空（原文无有效文本）返回 ''，调用方拒绝入库。
 */
function sanitizeTitle(text, maxChars = exports.MAX_TITLE_CHARS) {
    const stripped = stripHtml(text).replace(/\s+/g, ' ').trim();
    return truncateChars(stripped, maxChars);
}
/**
 * 清洗长文本（body 用）：剥 HTML → 行内空白折叠、保留换行结构 → 截断 ≤maxChars。
 * 连续空行压成一行；结果为空返回 ''。
 */
function sanitizeBody(text, maxChars = exports.MAX_BODY_CHARS) {
    const stripped = stripHtml(text)
        .split('\n')
        .map((line) => line.replace(/[ \t\u00A0]+/g, ' ').trim())
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return truncateChars(stripped, maxChars);
}
/**
 * 启发式语言检测：CJK 字符占比判 zh/en。
 * 取前 400 码点采样（长文不遍历），CJK 占比 >10% 判 zh（混排内容以中文阅读体验为先）。
 */
function detectLang(text) {
    const sample = Array.from(text).slice(0, 400);
    if (sample.length === 0)
        return 'en';
    let cjk = 0;
    for (const ch of sample) {
        const code = ch.codePointAt(0) ?? 0;
        if ((code >= 0x4e00 && code <= 0x9fff) || // CJK 基本区
            (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
            (code >= 0xf900 && code <= 0xfaff) // 兼容区
        ) {
            cjk += 1;
        }
    }
    return cjk / sample.length > 0.1 ? 'zh' : 'en';
}
/**
 * 取首句（摘要/钩子用）：在 。！？.!? 处断句；无句点则用全文。
 * 空白折叠后截断到 ≤maxChars 码点。
 */
function firstSentence(text, maxChars) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length === 0)
        return '';
    const match = clean.match(/^[^。！？.!?]*[。！？.!?]/);
    const sentence = match ? match[0] : clean;
    return truncateChars(sentence.trim(), maxChars);
}
