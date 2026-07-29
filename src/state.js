import {
    CHAT_STATUS,
    DEFAULT_SETTINGS,
    METADATA_KEY,
    MODULE_ID,
    SCHEMA_VERSION,
} from './constants.js';

function asBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
}

function asInteger(value, fallback, min, max) {
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }
    return Math.min(max, Math.max(min, parsed));
}

export function normalizeSettings(value = {}) {
    return {
        ...value,
        enabled: asBoolean(value.enabled, DEFAULT_SETTINGS.enabled),
        autoSummarize: asBoolean(value.autoSummarize, DEFAULT_SETTINGS.autoSummarize),
        limitRenderedMessages: asBoolean(
            value.limitRenderedMessages,
            DEFAULT_SETTINGS.limitRenderedMessages,
        ),
        summaryIntervalRounds: asInteger(
            value.summaryIntervalRounds,
            DEFAULT_SETTINGS.summaryIntervalRounds,
            1,
            100,
        ),
        visibleMessageLimit: asInteger(
            value.visibleMessageLimit,
            DEFAULT_SETTINGS.visibleMessageLimit,
            20,
            500,
        ),
        recentRawRounds: asInteger(
            value.recentRawRounds,
            DEFAULT_SETTINGS.recentRawRounds,
            0,
            50,
        ),
        summaryTargetWords: asInteger(
            value.summaryTargetWords,
            DEFAULT_SETTINGS.summaryTargetWords,
            100,
            3000,
        ),
        nonBlocking: asBoolean(value.nonBlocking, DEFAULT_SETTINGS.nonBlocking),
        retryDelayMs: asInteger(
            value.retryDelayMs,
            DEFAULT_SETTINGS.retryDelayMs,
            5_000,
            300_000,
        ),
        originalChatTruncation: Number.isFinite(value.originalChatTruncation)
            ? Number(value.originalChatTruncation)
            : null,
        appliedChatTruncation: Number.isFinite(value.appliedChatTruncation)
            ? Number(value.appliedChatTruncation)
            : null,
    };
}

export function ensureSettings(context) {
    if (!context.extensionSettings || typeof context.extensionSettings !== 'object') {
        throw new Error('SillyTavern extension settings are unavailable.');
    }

    const settings = normalizeSettings(context.extensionSettings[MODULE_ID]);
    context.extensionSettings[MODULE_ID] = settings;
    return settings;
}

export function createChatState() {
    return {
        schemaVersion: SCHEMA_VERSION,
        summary: '',
        summarizedThrough: -1,
        checkpoints: [],
        updatedAt: null,
        status: CHAT_STATUS.IDLE,
        lastError: null,
        lastAttemptAt: null,
        paused: false,
    };
}

export function normalizeChatState(value = {}) {
    const defaults = createChatState();
    const checkpoints = Array.isArray(value.checkpoints)
        ? value.checkpoints.filter(checkpoint => checkpoint && typeof checkpoint === 'object')
        : [];

    return {
        ...defaults,
        ...value,
        schemaVersion: SCHEMA_VERSION,
        summary: typeof value.summary === 'string' ? value.summary : '',
        summarizedThrough: Number.isInteger(value.summarizedThrough)
            ? value.summarizedThrough
            : -1,
        checkpoints,
        paused: Boolean(value.paused),
        status: Object.values(CHAT_STATUS).includes(value.status)
            ? value.status
            : CHAT_STATUS.IDLE,
    };
}

export function ensureChatState(context) {
    if (!context.chatMetadata || typeof context.chatMetadata !== 'object') {
        return null;
    }

    const state = normalizeChatState(context.chatMetadata[METADATA_KEY]);
    context.chatMetadata[METADATA_KEY] = state;
    return state;
}

export function getChatKey(context) {
    const key = context.getCurrentChatId?.() ?? context.chatId;
    if (key === null || key === undefined || key === '') {
        return null;
    }
    return String(key);
}

export function restoreStateFromCheckpoints(state) {
    const last = state.checkpoints.at(-1);
    state.summary = last?.summary ?? '';
    state.summarizedThrough = Number.isInteger(last?.endIndex) ? last.endIndex : -1;
    return state;
}
