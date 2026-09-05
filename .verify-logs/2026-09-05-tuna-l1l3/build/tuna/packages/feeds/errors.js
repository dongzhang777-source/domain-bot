"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FeedsError = void 0;
/**
 * 外部源归一化错误。
 *
 * 与 @tuna/content 的 NormalizationError 语义不同：内置包错误要中止入库（整包不放水），
 * 外部源错误由 normalizeAll 静默跳过（坏 item 不中断整源）——故独立成类，
 * 且 @tuna/feeds 保持零运行时跨包依赖（模拟编译产物无需解析 @tuna/content 运行时代码）。
 */
class FeedsError extends Error {
    constructor(message) {
        super(message);
        this.name = 'FeedsError';
    }
}
exports.FeedsError = FeedsError;
