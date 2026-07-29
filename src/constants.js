export const MODULE_ID = 'smooth_chat';
export const METADATA_KEY = 'smooth_chat';
export const SCHEMA_VERSION = 1;

export const CHAT_STATUS = Object.freeze({
    IDLE: 'idle',
    SUMMARIZING: 'summarizing',
    STALE: 'stale',
    ERROR: 'error',
    PAUSED: 'paused',
});

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    autoSummarize: true,
    summaryIntervalRounds: 15,
    limitRenderedMessages: true,
    visibleMessageLimit: 60,
    recentRawRounds: 6,
    summaryTargetWords: 800,
    nonBlocking: true,
    retryDelayMs: 30_000,
    originalChatTruncation: null,
    appliedChatTruncation: null,
});

export const SUMMARY_SYSTEM_PROMPT = `你是长篇角色扮演对话的记忆整理器。
请把已有摘要与本批新增对话合并为一份完整、准确、可供后续角色继续对话的长期记忆。

必须保留：
- 人物身份、关系、称谓、性格边界与明确偏好；
- 已确认的事实、重要事件及其因果；
- 当前时间、地点、物品、资源、身体状态与世界状态；
- 尚未解决的目标、承诺、冲突、伏笔与秘密；
- 会影响后续回复的语气、规则和约束。

不要续写剧情，不要评价角色，不要虚构未出现的信息，不要输出解释或开场白。
如果新对话纠正了旧摘要，以新对话为准。
只输出更新后的摘要正文。`;
