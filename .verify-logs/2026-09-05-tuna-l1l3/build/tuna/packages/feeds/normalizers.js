"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LocalBriefNormalizer = exports.LOCAL_BRIEF_SCHEMA = exports.SearchNormalizer = exports.RssNormalizer = exports.SUMMARY_LIMITS = exports.HOOK_LIMITS = void 0;
exports.placeholderHooks = placeholderHooks;
exports.buildSummary = buildSummary;
exports.isLocalBriefDoc = isLocalBriefDoc;
const errors_1 = require("./errors");
const sanitize_1 = require("./sanitize");
const rss_1 = require("./rss");
/**
 * L1 标题/钩子长度规定：
 * 中文 ≤70 码点、英文 ≤95 码点（2026-09-04 老张放宽——L1 卡两行显示，原 X26 单行规格
 * zh35/en50 导致第二行只剩残字，空间浪费；新值 = 两行满容量留余量）。
 */
exports.HOOK_LIMITS = { zh: 70, en: 95 };
/**
 * L2 概要长度规定（老张 2026-08-07 拍板两次修订，X26）：
 * 中文 200–300 码点、英文 300–450 码点（含下限）。
 * 上限即 RSS 归一化首句截断的目标长度；下限用于区间取句补足。
 */
exports.SUMMARY_LIMITS = {
    zh: { min: 200, max: 300 },
    en: { min: 300, max: 450 },
};
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function readString(raw, field) {
    const value = raw[field];
    return typeof value === 'string' ? value : undefined;
}
/** djb2 短哈希（base36）：把任意字符串压成 id 安全的稳定短串 */
function djb2(text) {
    let hash = 5381;
    for (let i = 0; i < text.length; i += 1) {
        hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}
/** 清洗后仅保留 http(s) 链接；其余（javascript: 等）丢弃 */
function sanitizeUrl(raw) {
    if (raw === undefined)
        return undefined;
    const trimmed = (0, sanitize_1.sanitizeTitle)(raw, 2000).trim();
    if (!/^https?:\/\//i.test(trimmed))
        return undefined;
    return trimmed;
}
/**
 * 占位钩子生成（任务书：title 截断 + summary 首句，视角不必精妙，安全性为先）。
 * 永不返回空数组，恒 3 条互不相同、各 ≤ 该语言钩子上限（zh 35 / en 50）码点。
 */
function placeholderHooks(title, summary, prefix, lang = 'en') {
    const maxHook = exports.HOOK_LIMITS[lang];
    const titlePart = (0, sanitize_1.truncateChars)(title, maxHook);
    const sentence = (0, sanitize_1.firstSentence)(summary, maxHook);
    const candidates = [];
    if (titlePart.length > 0)
        candidates.push(titlePart);
    if (sentence.length > 0 && sentence !== titlePart)
        candidates.push(sentence);
    // 组合视角：标题前缀 + 首句
    const combo = (0, sanitize_1.truncateChars)(`${(0, sanitize_1.truncateChars)(title, 16)}｜${(0, sanitize_1.firstSentence)(summary, 21)}`, maxHook);
    if (combo.length > 0)
        candidates.push(combo);
    // 前缀模板兜底（保证恒有 3 条互不相同）
    candidates.push((0, sanitize_1.truncateChars)(`${prefix}：${(0, sanitize_1.truncateChars)(title, maxHook - prefix.length - 2)}`, maxHook));
    candidates.push((0, sanitize_1.truncateChars)(`最新更新·${(0, sanitize_1.truncateChars)(title, maxHook - 6)}`, maxHook));
    const hooks = [];
    for (const c of candidates) {
        const cleaned = c.trim();
        if (cleaned.length === 0 || hooks.includes(cleaned))
            continue;
        hooks.push(cleaned);
        if (hooks.length === 3)
            break;
    }
    // 理论上不可达（候选恒 ≥3 且互异）；兜底防极端输入
    while (hooks.length < 3) {
        hooks.push((0, sanitize_1.truncateChars)(`${prefix} ${hooks.length + 1}`, maxHook));
    }
    return hooks;
}
/** 按句切分：在 。！？.!? 处分句，保留标点；空白折叠为单空格（尊重英文词距）。 */
function splitSentences(text) {
    const clean = text.replace(/\s+/g, ' ').trim();
    if (clean.length === 0)
        return [];
    const parts = clean
        .split(/(?<=[。！？.!?])/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    return parts.length > 0 ? parts : [clean];
}
/**
 * 区间取句（X26 概要加厚）：取 body 句子循环累加直到 ≥ 下限，
 * 或 body 取尽为止；随后截断到 ≤ 上限。
 *
 * 与首句截断的差异：首句太短时（RSS description 常只有半句）补后续句子，
 * 保证 L2 展开的概要达到规定下限（zh 200 / en 300），不再是一句空泛导语。
 */
function buildSummary(body, lang) {
    const { min, max } = exports.SUMMARY_LIMITS[lang];
    const sentences = splitSentences(body);
    const parts = [];
    let len = 0;
    for (const sentence of sentences) {
        parts.push(sentence);
        len += Array.from(sentence).length;
        if (len >= min)
            break;
    }
    // 自带空格拼接（尊重英文词距；中文句间距 1 空格无碍）
    const joined = parts.join(' ');
    // body 取尽也照样返回（下限达不到时原样截断，保证确定性不虚构）
    return (0, sanitize_1.truncateChars)(joined, max);
}
/**
 * RSS 条目归一化器（每个 feed 一个实例，携带 feedId 与 feed 标题）。
 * raw 形状：RssRawItem（{title?, link?, description?, pubDate?, guid?}）。
 */
class RssNormalizer {
    constructor(feedUrl, feedTitle) {
        this.feedId = (0, rss_1.feedIdFromUrl)(feedUrl);
        this.feedTitle = feedTitle.trim().length > 0 ? (0, sanitize_1.sanitizeTitle)(feedTitle, 60) : `RSS ${this.feedId}`;
        this.source = {
            id: `rss:${this.feedId}`,
            kind: 'rss',
            label: this.feedTitle,
        };
    }
    canHandle(raw) {
        if (!isRecord(raw))
            return false;
        return (typeof raw.title === 'string' || typeof raw.link === 'string' || typeof raw.description === 'string');
    }
    /** 单条归一化：清洗后 title/body 双缺或违反硬约束 → 抛 FeedsError（批量层跳过） */
    normalize(raw) {
        if (!isRecord(raw))
            throw new errors_1.FeedsError('RSS item 必须是对象');
        const item = raw;
        const title = (0, sanitize_1.sanitizeTitle)(item.title ?? '');
        const body = (0, sanitize_1.sanitizeBody)(item.description ?? '') || title;
        // 空串拒绝：清洗后无任何有效文本
        if (title.length === 0 || body.length === 0) {
            throw new errors_1.FeedsError('RSS item 清洗后为空，拒绝入库');
        }
        const itemId = djb2((item.guid ?? item.link ?? title).trim());
        // X26：语言先行（钩子分档 + 概要区间都按 lang），再区间取句
        const lang = (0, sanitize_1.detectLang)(`${title}\n${body}`);
        const summary = buildSummary(body, lang);
        // createdAt：原文 pubDate 优先（RFC 822 可被 Date.parse 识别），非法/缺失用归一化时刻
        let createdAt = new Date().toISOString();
        if (item.pubDate !== undefined) {
            const parsed = Date.parse(item.pubDate);
            if (!Number.isNaN(parsed))
                createdAt = new Date(parsed).toISOString();
        }
        const post = {
            id: `rss:${this.feedId}:${itemId}`,
            title,
            hooks: placeholderHooks(title, summary, 'RSS 订阅', lang),
            summary,
            body,
            lang,
            author: { id: `rss:${this.feedId}`, name: this.feedTitle, kind: 'user' },
            provenance: 'human',
            epistemic: 'inference',
            signer: null,
            schemaVersion: 1,
            createdAt,
        };
        const sourceUrl = sanitizeUrl(item.link);
        if (sourceUrl !== undefined)
            post.sourceUrl = sourceUrl;
        return post;
    }
    /** 外部源语义：坏 item 跳过不中断（区别于内置包整包中止） */
    normalizeAll(raws) {
        const posts = [];
        const seen = new Set();
        for (const raw of raws) {
            try {
                const post = this.normalize(raw);
                // 去重依赖 id（同源重复条目只留一条）
                if (seen.has(post.id))
                    continue;
                seen.add(post.id);
                posts.push(post);
            }
            catch {
                // 静默跳过：单条损坏不阻断整源
            }
        }
        return posts;
    }
}
exports.RssNormalizer = RssNormalizer;
/**
 * BYO 搜索结果归一化器（每个查询词一个实例）。
 * raw 形状：SearchRawResult（{id?, title?, snippet?, content?, url?}）。
 */
class SearchNormalizer {
    constructor(query) {
        this.query = (0, sanitize_1.sanitizeTitle)(query, 60);
        this.source = {
            id: `byo-search:${djb2(this.query)}`,
            kind: 'byo-search',
            label: `BYO 搜索：${(0, sanitize_1.truncateChars)(this.query, 24)}`,
        };
    }
    canHandle(raw) {
        if (!isRecord(raw))
            return false;
        return (typeof raw.title === 'string' ||
            typeof raw.snippet === 'string' ||
            typeof raw.content === 'string');
    }
    normalize(raw) {
        if (!isRecord(raw))
            throw new errors_1.FeedsError('搜索结果必须是对象');
        const result = raw;
        const title = (0, sanitize_1.sanitizeTitle)(result.title ?? '');
        const body = (0, sanitize_1.sanitizeBody)(result.content ?? result.snippet ?? '') || title;
        if (title.length === 0 || body.length === 0) {
            throw new errors_1.FeedsError('搜索结果清洗后为空，拒绝入库');
        }
        const resultId = djb2((result.id ?? result.url ?? title).trim());
        // X26：语言先行 + 区间取句（同 RSS）
        const lang = (0, sanitize_1.detectLang)(`${title}\n${body}`);
        const summary = buildSummary(body, lang);
        const queryTag = (0, sanitize_1.truncateChars)(this.query, 24);
        const post = {
            id: `search:${djb2(this.query)}:${resultId}`,
            title,
            hooks: placeholderHooks(title, summary, '搜索发现', lang),
            summary,
            body,
            lang,
            author: { id: `search:${djb2(this.query)}`, name: `BYO 搜索 · ${queryTag}`, kind: 'user' },
            provenance: 'human',
            epistemic: 'inference',
            signer: null,
            schemaVersion: 1,
            createdAt: new Date().toISOString(),
        };
        const sourceUrl = sanitizeUrl(result.url);
        if (sourceUrl !== undefined)
            post.sourceUrl = sourceUrl;
        return post;
    }
    /** 外部源语义：坏条目跳过不中断 */
    normalizeAll(raws) {
        const posts = [];
        const seen = new Set();
        for (const raw of raws) {
            try {
                const post = this.normalize(raw);
                if (seen.has(post.id))
                    continue;
                seen.add(post.id);
                posts.push(post);
            }
            catch {
                // 静默跳过
            }
        }
        return posts;
    }
}
exports.SearchNormalizer = SearchNormalizer;
const SUMMARY_MAX = { zh: exports.SUMMARY_LIMITS.zh.max, en: exports.SUMMARY_LIMITS.en.max };
const WHY_MAX = 40;
exports.LOCAL_BRIEF_SCHEMA = 'tuna-brief-v1';
/** 文档级判定：一份 JSON 是否为 domain-bot v1 brief（文件读取层用，拆出 posts[] 逐条喂 normalize）。 */
function isLocalBriefDoc(raw) {
    return (typeof raw === 'object' && raw !== null && !Array.isArray(raw) &&
        raw.schema === exports.LOCAL_BRIEF_SCHEMA &&
        Array.isArray(raw.posts));
}
class LocalBriefNormalizer {
    constructor(sourceId = 'domain-bot') {
        this.source = { id: `local-brief:${sourceId}`, kind: 'local-brief', label: 'domain-bot 探针' };
    }
    /** post 候选判定：稳定 id + 标题 + 3 钩子 + 概要 + 底料（缺一不收） */
    canHandle(raw) {
        if (!this.isCandidate(raw))
            return false;
        const p = raw;
        return Array.isArray(p.hooks) && p.hooks.length === 3;
    }
    isCandidate(raw) {
        if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
            return false;
        const p = raw;
        return (typeof p['id'] === 'string' &&
            typeof p['title'] === 'string' &&
            typeof p['summary'] === 'string' &&
            typeof p['body'] === 'string' &&
            Array.isArray(p['hooks']));
    }
    normalize(raw) {
        if (!this.isCandidate(raw))
            throw new errors_1.FeedsError('local-brief 候选必须是 domain-bot v1 post 对象');
        const p = raw;
        if (!/^[a-z0-9-]+:[a-z0-9]+:\d+$/.test(p.id)) {
            throw new errors_1.FeedsError(`local-brief 稳定 id 非法: ${p.id}`);
        }
        const lang = p.lang === 'zh' ? 'zh' : p.lang === 'en' ? 'en' : (0, sanitize_1.detectLang)(`${p.title}\n${p.summary}`);
        const hooks = p.hooks.map((h) => (0, sanitize_1.truncateChars)(String(h), exports.HOOK_LIMITS[lang]));
        if (hooks.length !== 3 || new Set(hooks).size !== 3) {
            throw new errors_1.FeedsError(`local-brief hooks 必须恒 3 条互异: ${p.id}`);
        }
        if (p.summary.trim().length === 0 || p.body.trim().length === 0) {
            throw new errors_1.FeedsError(`local-brief 清洗后为空，拒绝入库: ${p.id}`);
        }
        const summary = (0, sanitize_1.truncateChars)(p.summary.trim(), SUMMARY_MAX[lang]);
        const createdAt = Number.isNaN(Date.parse(p.createdAt)) ? new Date().toISOString() : new Date(p.createdAt).toISOString();
        const post = {
            id: p.id,
            title: (0, sanitize_1.truncateChars)(p.title.trim(), 200),
            hooks,
            summary,
            body: p.body.trim() || p.title,
            lang,
            author: {
                id: typeof p.author?.id === 'string' ? p.author.id : 'domain-bot',
                name: typeof p.author?.name === 'string' ? p.author.name : 'domain-bot 探针',
                kind: 'user',
            },
            provenance: 'human',
            epistemic: 'inference',
            signer: null,
            schemaVersion: 1,
            createdAt,
        };
        if (typeof p.sourceUrl === 'string' && p.sourceUrl.length > 0)
            post.sourceUrl = p.sourceUrl;
        return post;
    }
    /** 外部源语义：坏候选跳过不中断（对齐 RssNormalizer.normalizeAll）。 */
    normalizeAll(candidates) {
        const posts = [];
        for (const c of candidates) {
            if (!this.canHandle(c))
                continue;
            try {
                posts.push(this.normalize(c));
            }
            catch {
                /* 坏候选跳过（外部源不中断整源，D2 同族语义） */
            }
        }
        return posts;
    }
}
exports.LocalBriefNormalizer = LocalBriefNormalizer;
