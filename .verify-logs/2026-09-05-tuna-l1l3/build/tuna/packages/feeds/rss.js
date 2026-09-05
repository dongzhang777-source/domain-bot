"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RSS_MAX_BODY_BYTES = exports.RSS_MAX_ITEMS = exports.RSS_MAX_POSTS_PER_RUN = exports.RSS_FETCH_TIMEOUT_MS = void 0;
exports.isPrivateHost = isPrivateHost;
exports.parseRss = parseRss;
exports.feedIdFromUrl = feedIdFromUrl;
exports.fetchRssFeed = fetchRssFeed;
/**
 * RSS 2.0 抓取与解析（内容三源之一：「关注的创作者更新」）。
 *
 * 手写轻量解析器（零第三方依赖，施工红线「不装任何第三方依赖」）：
 * 支持 channel title/link/description + item[{title,link,description,pubDate,guid}]，
 * CDATA 与标签属性容忍，坏 item 跳过不中断。
 *
 * 抓取：fetch 超时 10s；任何失败（网络/超时/解析）静默跳过该源——
 * RSS 挂了不阻断简报，降级=只有内置包（任务书验收线：全部失败静默）。
 */
/** RSS 抓取超时（任务书：10s） */
exports.RSS_FETCH_TIMEOUT_MS = 10000;
/** 单个简报候选池最多收纳的 RSS 新帖数（防 prompt 爆炸，brief 按篇数线性变长） */
exports.RSS_MAX_POSTS_PER_RUN = 15;
/** L-1：单源最多解析条目数——恶意巨型 feed 不得触发十万次正则+sanitize */
exports.RSS_MAX_ITEMS = 200;
/** M-4：响应体字节上限（RSS 合理体积远小于此；防恶意源倾泻致移动端 OOM） */
exports.RSS_MAX_BODY_BYTES = 2 * 1024 * 1024;
/**
 * H-1：私网/元数据地址黑名单——feed URL 由用户添加，不得指向内网：
 * loopback / RFC1918 / link-local（含云元数据 169.254.169.254）/ IPv6 ULA。
 * 响应体会经 parseRss 反射为 Post 展示，内网地址 = 内容回读信道 + 端口探测。
 */
function isPrivateHost(hostname) {
    const h = hostname.toLowerCase().replace(/^\[|\]$/g, '');
    // 本机回环豁免：与 llm isSecureEndpoint / remote-update 同策略（本机自测/本地源合法）
    if (h === 'localhost' || h === '::1' || /^127\./.test(h))
        return false;
    if (h === '0.0.0.0')
        return true; // 通配地址语义不明，保守拒
    if (/^10\./.test(h))
        return true;
    if (/^192\.168\./.test(h))
        return true;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(h))
        return true;
    if (/^169\.254\./.test(h))
        return true; // link-local，含云元数据 169.254.169.254
    if (/^(fc|fd)[0-9a-f]{0,2}:/.test(h) || h.startsWith('fe80'))
        return true;
    return false;
}
/** 提取一个标签的内容：容忍属性（<title type="html">）、CDATA、大小写 */
function extractTag(block, tag) {
    const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}\\s*>`, 'i'));
    if (!match)
        return undefined;
    let content = match[1];
    // CDATA 包裹：<![CDATA[...]]>（可多层/前后带空白）
    const cdata = content.match(/<!\[CDATA\[([\s\S]*?)\]\]>/i);
    if (cdata)
        content = cdata[1];
    const trimmed = content.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
/** 解析单个 <item> 块为原始条目 */
function parseItem(block) {
    const item = {};
    const title = extractTag(block, 'title');
    if (title !== undefined)
        item.title = title;
    const link = extractTag(block, 'link');
    if (link !== undefined)
        item.link = link;
    const description = extractTag(block, 'description');
    if (description !== undefined)
        item.description = description;
    const pubDate = extractTag(block, 'pubDate');
    if (pubDate !== undefined)
        item.pubDate = pubDate;
    const guid = extractTag(block, 'guid');
    if (guid !== undefined)
        item.guid = guid;
    return item;
}
/**
 * 解析 RSS 2.0 XML（宽容模式）。
 * 整体不是 RSS（无 <item> 且无 channel title）→ null；
 * 单个 item 损坏（无 title 且无 link）→ 跳过该 item，不中断。
 */
function parseRss(xml) {
    if (typeof xml !== 'string' || xml.trim().length === 0)
        return null;
    // 取出 <item>...</item> 块（属性容忍；自闭合 <item/> 无内容，天然忽略）
    // L-1：exec 循环 + 封顶 RSS_MAX_ITEMS，超出即停（避免全量归一化十万条目）
    const itemRe = /<item[\s>][\s\S]*?<\/item\s*>/gi;
    const itemBlocks = [];
    let m;
    while ((m = itemRe.exec(xml)) !== null && itemBlocks.length < exports.RSS_MAX_ITEMS) {
        itemBlocks.push(m[0]);
    }
    // channel 级字段：从去掉 item 块的剩余文本里找（避免误取条目内字段）
    const channelXml = xml.replace(/<item[\s>][\s\S]*?<\/item\s*>/gi, ' ');
    const title = extractTag(channelXml, 'title') ?? '';
    const link = extractTag(channelXml, 'link');
    const description = extractTag(channelXml, 'description');
    if (title.length === 0 && itemBlocks.length === 0)
        return null;
    const items = [];
    for (const block of itemBlocks) {
        const item = parseItem(block);
        // 坏 item 判定：title 与 link 双缺 → 无法展示也无法溯源，跳过（不中断整源）
        if (item.title === undefined && item.link === undefined)
            continue;
        items.push(item);
    }
    const feed = { title, items };
    if (link !== undefined)
        feed.link = link;
    if (description !== undefined)
        feed.description = description;
    return feed;
}
/**
 * feedId：URL 的 djb2 短哈希（base36）。
 * 用作 Post id 的稳定前缀（rss:{feedId}:{itemId}）与 author id，
 * 避免把完整 URL 拼进每个 Post id。
 */
function feedIdFromUrl(url) {
    let hash = 5381;
    for (let i = 0; i < url.length; i += 1) {
        hash = ((hash << 5) + hash + url.charCodeAt(i)) | 0;
    }
    return (hash >>> 0).toString(36);
}
/**
 * M-4：响应体限量读取。优先流式（reader 逐块累计，超限 abort）；
 * 宿主无 res.body（部分 RN 环境）时回退 Content-Length 预筛 + text 截断。
 * 超限返回 null（静默弃源，与抓取失败策略一致）。
 */
async function readCappedText(res, maxBytes, signal) {
    const declared = Number(res.headers.get('content-length') ?? 0);
    if (Number.isFinite(declared) && declared > maxBytes)
        return null;
    const body = res.body;
    if (body && typeof body.getReader === 'function') {
        const reader = body.getReader();
        const chunks = [];
        let total = 0;
        try {
            for (;;) {
                const { done, value } = await reader.read();
                if (done)
                    break;
                if (value) {
                    total += value.byteLength;
                    if (total > maxBytes) {
                        await reader.cancel().catch(() => undefined);
                        return null;
                    }
                    chunks.push(value);
                }
            }
        }
        catch {
            return null;
        }
        const merged = new Uint8Array(total);
        let offset = 0;
        for (const c of chunks) {
            merged.set(c, offset);
            offset += c.byteLength;
        }
        return new TextDecoder('utf-8').decode(merged);
    }
    // 回退：无流式能力时靠 Content-Length 预筛 + 读后截断（超时兜底）
    const text = await res.text();
    void signal;
    return text.length > maxBytes ? text.slice(0, maxBytes) : text;
}
/**
 * 抓取并解析一个 RSS 源。
 * 永不抛错：任何失败（非法 URL / 私网地址 / 超时 / 网络错误 / HTTP 非 2xx / 超限 / 解析失败）→ null。
 *
 * @param timeoutMs 超时毫秒数（默认 10s；离线模拟传小值加速）
 */
async function fetchRssFeed(url, timeoutMs = exports.RSS_FETCH_TIMEOUT_MS) {
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    }
    catch {
        return null;
    }
    if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:')
        return null;
    // H-1：私网/元数据地址硬拒（初始 URL 层）
    if (isPrivateHost(parsedUrl.hostname))
        return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        // H-1：redirect: 'error' —— 重定向目标不再经任何校验，跟随即绕过协议/私网白名单
        const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
        if (!res.ok)
            return null;
        const text = await readCappedText(res, exports.RSS_MAX_BODY_BYTES, controller.signal);
        if (text === null)
            return null;
        return parseRss(text);
    }
    catch {
        return null;
    }
    finally {
        clearTimeout(timer);
    }
}
