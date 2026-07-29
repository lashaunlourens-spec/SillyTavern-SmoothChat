import { CHAT_STATUS } from './src/constants.js';
import { applySummaryToPrompt } from './src/context-manager.js';
import { countPendingRounds } from './src/messages.js';
import { applyMessageLimit, restoreMessageLimit } from './src/performance.js';
import { SummaryCoordinator } from './src/summarizer.js';
import {
    ensureChatState,
    ensureSettings,
    getChatKey,
} from './src/state.js';

const LOG_PREFIX = '[Smooth Chat]';
let initialized = false;
let coordinator;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function notify(level, message) {
    const toastr = globalThis.toastr;
    if (toastr && typeof toastr[level] === 'function') {
        toastr[level](message, '流畅聊天');
        return;
    }
    console[level === 'error' ? 'error' : 'info'](`${LOG_PREFIX} ${message}`);
}

function byId(id) {
    return document.getElementById(id);
}

function setBusy(isBusy) {
    for (const id of ['smooth_chat_summarize_now', 'smooth_chat_rebuild']) {
        const element = byId(id);
        if (element) {
            element.disabled = isBusy;
        }
    }
}

function statusText(context, settings, state) {
    if (!getChatKey(context) || !state) {
        return '尚未打开聊天。';
    }

    const pending = countPendingRounds(context.chat, state.summarizedThrough);
    const remaining = Math.max(0, settings.summaryIntervalRounds - pending);
    const summarizedLayer = state.summarizedThrough >= 0
        ? `已总结到第 ${state.summarizedThrough + 1} 层`
        : '尚未生成摘要';
    const labels = {
        [CHAT_STATUS.IDLE]: '空闲',
        [CHAT_STATUS.SUMMARIZING]: '正在总结',
        [CHAT_STATUS.STALE]: '摘要待重建',
        [CHAT_STATUS.ERROR]: '上次总结失败',
        [CHAT_STATUS.PAUSED]: '当前聊天已暂停',
    };
    const activity = state.paused ? labels.paused : (labels[state.status] ?? labels.idle);
    const next = settings.autoSummarize
        ? `距下次自动总结还差 ${remaining} 轮`
        : '自动总结已关闭';
    const error = state.lastError ? `；${state.lastError}` : '';
    return `${summarizedLayer}；${next}；状态：${activity}${error}`;
}

function refreshUi() {
    if (typeof document === 'undefined') {
        return;
    }

    const context = getContext();
    if (!context) {
        return;
    }
    const settings = ensureSettings(context);
    const state = ensureChatState(context);

    const values = {
        smooth_chat_enabled: settings.enabled,
        smooth_chat_auto_summarize: settings.autoSummarize,
        smooth_chat_limit_rendered: settings.limitRenderedMessages,
        smooth_chat_interval: settings.summaryIntervalRounds,
        smooth_chat_recent_rounds: settings.recentRawRounds,
        smooth_chat_visible_limit: settings.visibleMessageLimit,
        smooth_chat_target_words: settings.summaryTargetWords,
    };
    for (const [id, value] of Object.entries(values)) {
        const element = byId(id);
        if (!element) {
            continue;
        }
        if (element.type === 'checkbox') {
            element.checked = Boolean(value);
        } else if (document.activeElement !== element) {
            element.value = String(value);
        }
    }

    const status = byId('smooth_chat_status');
    if (status) {
        status.textContent = statusText(context, settings, state);
    }

    const summaryEditor = byId('smooth_chat_summary_text');
    if (summaryEditor && document.activeElement !== summaryEditor) {
        summaryEditor.value = state?.summary ?? '';
    }

    const pauseButton = byId('smooth_chat_pause');
    if (pauseButton) {
        pauseButton.textContent = state?.paused ? '继续当前聊天' : '暂停当前聊天';
    }

    const conflict = byId('smooth_chat_conflict');
    if (conflict) {
        conflict.hidden = !Boolean(context.extensionPrompts?.['1_memory']?.value);
    }

    setBusy(Boolean(coordinator?.getActiveJob(getChatKey(context))));
}

function saveSettingsFromUi() {
    const context = getContext();
    const settings = ensureSettings(context);
    settings.enabled = byId('smooth_chat_enabled').checked;
    settings.autoSummarize = byId('smooth_chat_auto_summarize').checked;
    settings.limitRenderedMessages = byId('smooth_chat_limit_rendered').checked;
    settings.summaryIntervalRounds = byId('smooth_chat_interval').value;
    settings.recentRawRounds = byId('smooth_chat_recent_rounds').value;
    settings.visibleMessageLimit = byId('smooth_chat_visible_limit').value;
    settings.summaryTargetWords = byId('smooth_chat_target_words').value;

    const normalized = ensureSettings(context);
    Object.assign(settings, normalized);
    context.saveSettingsDebounced?.();
    if (settings.limitRenderedMessages) {
        applyMessageLimit(context, settings);
    } else {
        restoreMessageLimit(context, settings);
    }
    refreshUi();
    coordinator.schedule();
}

async function mountSettings() {
    if (byId('smooth_chat_enabled')) {
        return;
    }

    const container = document.getElementById('extensions_settings2')
        ?? document.getElementById('extensions_settings');
    if (!container) {
        throw new Error('Extensions settings container was not found.');
    }

    const response = await fetch(new URL('./settings.html', import.meta.url));
    if (!response.ok) {
        throw new Error(`Unable to load settings UI (${response.status}).`);
    }
    container.insertAdjacentHTML('beforeend', await response.text());

    for (const id of [
        'smooth_chat_enabled',
        'smooth_chat_auto_summarize',
        'smooth_chat_limit_rendered',
        'smooth_chat_interval',
        'smooth_chat_recent_rounds',
        'smooth_chat_visible_limit',
        'smooth_chat_target_words',
    ]) {
        byId(id)?.addEventListener('change', saveSettingsFromUi);
    }

    byId('smooth_chat_summarize_now')?.addEventListener('click', () => {
        coordinator.schedule({ force: true });
        refreshUi();
    });

    byId('smooth_chat_toggle_editor')?.addEventListener('click', () => {
        const editor = byId('smooth_chat_editor');
        editor.hidden = !editor.hidden;
        if (!editor.hidden) {
            const state = ensureChatState(getContext());
            byId('smooth_chat_summary_text').value = state?.summary ?? '';
        }
    });

    byId('smooth_chat_save_summary')?.addEventListener('click', async () => {
        const context = getContext();
        const state = ensureChatState(context);
        if (!state) {
            return;
        }
        state.summary = byId('smooth_chat_summary_text').value.trim();
        if (state.checkpoints.length) {
            state.checkpoints.at(-1).summary = state.summary;
        }
        state.status = CHAT_STATUS.IDLE;
        state.lastError = null;
        state.updatedAt = new Date().toISOString();
        await context.saveMetadata?.();
        notify('success', '摘要已保存。');
        refreshUi();
    });

    byId('smooth_chat_rebuild')?.addEventListener('click', async () => {
        if (!globalThis.confirm('重建摘要会重新调用当前模型并产生 token 消耗，但不会修改原聊天记录。继续吗？')) {
            return;
        }
        await coordinator.rebuild();
        refreshUi();
    });

    byId('smooth_chat_pause')?.addEventListener('click', async () => {
        const context = getContext();
        const state = ensureChatState(context);
        if (!state) {
            return;
        }
        state.paused = !state.paused;
        state.status = state.paused ? CHAT_STATUS.PAUSED : CHAT_STATUS.IDLE;
        await context.saveMetadata?.();
        refreshUi();
        if (!state.paused) {
            coordinator.schedule();
        }
    });

    byId('smooth_chat_restore_limit')?.addEventListener('click', () => {
        const context = getContext();
        const settings = ensureSettings(context);
        const result = restoreMessageLimit(context, settings);
        context.saveSettingsDebounced?.();
        notify(
            result.reason === 'restored' ? 'success' : 'info',
            result.reason === 'restored'
                ? `已恢复为 ${result.next} 条，切换聊天或刷新后完全生效。`
                : '没有可恢复的原始消息加载数。',
        );
        refreshUi();
    });

    refreshUi();
}

async function handleHistoryChange() {
    const result = await coordinator.validateCurrentChat();
    refreshUi();
    if (result.changed) {
        coordinator.schedule({ force: true, rebuild: true });
    } else {
        coordinator.schedule();
    }
}

function subscribeEvents(context) {
    const { eventSource, event_types: legacyTypes, eventTypes } = context;
    const types = eventTypes ?? legacyTypes;
    if (!eventSource || !types) {
        throw new Error('SillyTavern event API is unavailable.');
    }

    const schedule = () => {
        refreshUi();
        coordinator.schedule();
    };
    const refresh = () => {
        refreshUi();
        void coordinator.validateCurrentChat().then(() => coordinator.schedule());
    };

    const on = (type, handler) => {
        if (type) {
            eventSource.on(type, handler);
        }
    };

    on(types.CHARACTER_MESSAGE_RENDERED, schedule);
    on(types.GENERATION_ENDED, schedule);
    on(types.CHAT_CHANGED, refresh);
    on(types.MESSAGE_EDITED, handleHistoryChange);
    on(types.MESSAGE_DELETED, handleHistoryChange);
    on(types.MESSAGE_SWIPED, handleHistoryChange);
}

async function initialize() {
    if (initialized) {
        return;
    }
    const context = getContext();
    if (!context) {
        return;
    }

    initialized = true;
    coordinator = new SummaryCoordinator({
        getContext,
        onUpdate: refreshUi,
        notify,
    });

    const settings = ensureSettings(context);
    applyMessageLimit(context, settings);
    subscribeEvents(context);
    await mountSettings();
    await coordinator.validateCurrentChat();
    coordinator.schedule();
    console.info(`${LOG_PREFIX} Loaded without modifying chat theme styles.`);
}

globalThis.smoothChatPromptInterceptor = async function smoothChatPromptInterceptor(
    promptChat,
    _contextSize,
    _abort,
    type,
) {
    if (type === 'quiet') {
        return;
    }

    const context = getContext();
    if (!context) {
        return;
    }
    const settings = ensureSettings(context);
    const state = ensureChatState(context);
    const chatKey = getChatKey(context);
    if (!state || !chatKey) {
        return;
    }

    if (!settings.nonBlocking) {
        await coordinator?.waitForActiveJob(chatKey);
    }

    const result = applySummaryToPrompt(promptChat, context.chat, state, settings);
    if (result.reason === 'stale') {
        state.status = CHAT_STATUS.STALE;
        state.lastError = '已总结楼层发生变化，重建完成前不会裁剪上下文。';
        void context.saveMetadata?.();
        coordinator?.schedule({ force: true, rebuild: true });
    }
};

if (globalThis.SillyTavern?.getContext) {
    const context = getContext();
    const types = context?.eventTypes ?? context?.event_types;
    if (context?.eventSource && types?.APP_READY) {
        context.eventSource.on(types.APP_READY, initialize);
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => void initialize(), { once: true });
    } else {
        void initialize();
    }
}
