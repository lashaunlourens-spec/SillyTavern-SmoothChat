import { findRecentRawStart, validateCheckpoints } from './messages.js';

export function createSummaryPromptMessage(summary) {
    return {
        name: 'System',
        is_user: false,
        is_name: true,
        is_system: true,
        mes: `[长期对话记忆]\n${summary}\n[/长期对话记忆]`,
        index: -1,
        extra: {
            smooth_chat_summary: true,
        },
    };
}

export function applySummaryToPrompt(promptChat, sourceChat, state, settings) {
    if (!Array.isArray(promptChat) || !Array.isArray(sourceChat)) {
        return { applied: false, reason: 'missing-chat', removed: 0 };
    }
    if (!settings.enabled || state.paused) {
        return { applied: false, reason: 'disabled', removed: 0 };
    }
    if (['stale', 'error', 'summarizing'].includes(state.status)) {
        return { applied: false, reason: state.status, removed: 0 };
    }
    if (!state.summary.trim() || state.summarizedThrough < 0 || !state.checkpoints.length) {
        return { applied: false, reason: 'no-summary', removed: 0 };
    }

    const validation = validateCheckpoints(sourceChat, state.checkpoints);
    if (!validation.valid) {
        return { applied: false, reason: 'stale', removed: 0 };
    }

    const keepFrom = findRecentRawStart(
        sourceChat,
        state.summarizedThrough,
        settings.recentRawRounds,
    );
    const retained = promptChat.filter(message => {
        const index = Number.isInteger(message?.index) ? message.index : null;
        if (index === null) {
            return true;
        }
        return index >= keepFrom || index > state.summarizedThrough;
    });
    const removed = promptChat.length - retained.length;

    if (removed <= 0) {
        return { applied: false, reason: 'nothing-to-trim', removed: 0 };
    }

    promptChat.splice(0, promptChat.length, createSummaryPromptMessage(state.summary), ...retained);
    return {
        applied: true,
        reason: 'applied',
        removed,
        keepFrom,
    };
}
