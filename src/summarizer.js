import { CHAT_STATUS, SUMMARY_SYSTEM_PROMPT } from './constants.js';
import {
    countPendingRounds,
    fingerprintRange,
    formatTranscript,
    selectNextSummaryBatch,
    validateCheckpoints,
} from './messages.js';
import {
    ensureChatState,
    ensureSettings,
    getChatKey,
    restoreStateFromCheckpoints,
} from './state.js';

export function buildSummaryPrompt(previousSummary, batchMessages, targetWords) {
    const previous = previousSummary.trim() || '（暂无，这是第一批对话）';
    const transcript = formatTranscript(batchMessages);

    return `目标长度：约 ${targetWords} 个中文字符或等量信息；内容较多时以信息完整为先。

【已有长期摘要】
${previous}

【本批新增对话】
${transcript}

请输出合并、去重、纠错后的完整长期摘要：`;
}

export function cleanSummaryOutput(value) {
    return String(value ?? '')
        .replace(/^```(?:markdown|text)?\s*/i, '')
        .replace(/\s*```$/i, '')
        .replace(/^(?:摘要|更新后的摘要|长期摘要)\s*[:：]\s*/i, '')
        .trim();
}

export function isUsableSummary(value) {
    if (typeof value !== 'string' || value.trim().length < 20) {
        return false;
    }
    return !/^(?:error|错误|undefined|null|无法生成)/i.test(value.trim());
}

export class SummaryCoordinator {
    constructor(options) {
        this.getContext = options.getContext;
        this.onUpdate = options.onUpdate ?? (() => {});
        this.notify = options.notify ?? (() => {});
        this.activeJob = null;
        this.activeChatKey = null;
        this.rebuildRequested = false;
    }

    getActiveJob(chatKey) {
        return this.activeChatKey === chatKey ? this.activeJob : null;
    }

    async waitForActiveJob(chatKey) {
        const job = this.getActiveJob(chatKey);
        if (job) {
            await job.catch(() => {});
        }
    }

    async validateCurrentChat({ repair = true } = {}) {
        const context = this.getContext();
        const state = ensureChatState(context);
        if (!state) {
            return { valid: false, changed: false, reason: 'no-chat' };
        }

        const validation = validateCheckpoints(context.chat, state.checkpoints);
        if (validation.valid || !repair) {
            return { ...validation, changed: false };
        }

        state.checkpoints = state.checkpoints.slice(0, validation.validCount);
        restoreStateFromCheckpoints(state);
        state.status = CHAT_STATUS.STALE;
        state.lastError = '检测到已总结楼层发生变化，正在重建摘要。';
        await context.saveMetadata?.();
        this.onUpdate();
        return { ...validation, changed: true };
    }

    schedule(options = {}) {
        const context = this.getContext();
        const settings = ensureSettings(context);
        const state = ensureChatState(context);
        const chatKey = getChatKey(context);

        if (!chatKey || !state || !settings.enabled || state.paused) {
            return null;
        }
        if (!options.force && !settings.autoSummarize) {
            return null;
        }
        if (this.activeJob) {
            if (options.rebuild) {
                this.rebuildRequested = true;
            }
            return this.activeJob;
        }

        const pending = countPendingRounds(context.chat, state.summarizedThrough);
        if (!options.force && pending < settings.summaryIntervalRounds) {
            return null;
        }

        const lastAttempt = state.lastAttemptAt ? Date.parse(state.lastAttemptAt) : 0;
        if (
            !options.force
            && state.status === CHAT_STATUS.ERROR
            && Date.now() - lastAttempt < settings.retryDelayMs
        ) {
            return null;
        }

        this.activeChatKey = chatKey;
        this.activeJob = this.run(chatKey, options)
            .catch(error => {
                console.error('[Smooth Chat] Summary task failed.', error);
            })
            .finally(() => {
                this.activeJob = null;
                this.activeChatKey = null;
                this.onUpdate();
                if (this.rebuildRequested) {
                    this.rebuildRequested = false;
                    this.schedule({ force: true, rebuild: true });
                }
            });
        return this.activeJob;
    }

    async run(chatKey, options) {
        let allowPartial = Boolean(options.force);

        while (true) {
            const context = this.getContext();
            if (getChatKey(context) !== chatKey) {
                return;
            }

            const settings = ensureSettings(context);
            const state = ensureChatState(context);
            if (!state || state.paused || !settings.enabled) {
                return;
            }

            const batch = selectNextSummaryBatch(context.chat, {
                afterIndex: state.summarizedThrough,
                intervalRounds: settings.summaryIntervalRounds,
                allowPartial,
            });
            if (!batch) {
                if (state.status === CHAT_STATUS.STALE) {
                    state.status = CHAT_STATUS.IDLE;
                    state.lastError = null;
                    await context.saveMetadata?.();
                }
                return;
            }

            state.status = CHAT_STATUS.SUMMARIZING;
            state.lastError = null;
            state.lastAttemptAt = new Date().toISOString();
            await context.saveMetadata?.();
            this.onUpdate();

            const expectedFingerprint = fingerprintRange(
                context.chat,
                batch.startIndex,
                batch.endIndex,
            );
            const baseState = {
                checkpointCount: state.checkpoints.length,
                summarizedThrough: state.summarizedThrough,
                summary: state.summary,
            };
            const prompt = buildSummaryPrompt(
                state.summary,
                batch.messages,
                settings.summaryTargetWords,
            );

            try {
                const raw = await context.generateRaw({
                    systemPrompt: SUMMARY_SYSTEM_PROMPT,
                    prompt,
                });
                const summary = cleanSummaryOutput(raw);
                if (!isUsableSummary(summary)) {
                    throw new Error('模型返回的摘要为空或格式异常。');
                }

                const latest = this.getContext();
                if (getChatKey(latest) !== chatKey) {
                    return;
                }

                const latestState = ensureChatState(latest);
                const actualFingerprint = fingerprintRange(
                    latest.chat,
                    batch.startIndex,
                    batch.endIndex,
                );
                const baseChanged = (
                    latestState.checkpoints.length !== baseState.checkpointCount
                    || latestState.summarizedThrough !== baseState.summarizedThrough
                    || latestState.summary !== baseState.summary
                );
                if (actualFingerprint !== expectedFingerprint || baseChanged) {
                    latestState.status = CHAT_STATUS.STALE;
                    latestState.lastError = '总结期间聊天或摘要基线发生变化，已放弃本次结果。';
                    await latest.saveMetadata?.();
                    return;
                }

                latestState.summary = summary;
                latestState.summarizedThrough = batch.endIndex;
                latestState.updatedAt = new Date().toISOString();
                latestState.status = CHAT_STATUS.IDLE;
                latestState.lastError = null;
                latestState.checkpoints.push({
                    startIndex: batch.startIndex,
                    endIndex: batch.endIndex,
                    roundCount: batch.roundCount,
                    fingerprint: expectedFingerprint,
                    summary,
                    createdAt: latestState.updatedAt,
                });
                await latest.saveMetadata?.();
                this.onUpdate();
            } catch (error) {
                const latest = this.getContext();
                if (getChatKey(latest) !== chatKey) {
                    return;
                }
                const latestState = ensureChatState(latest);
                latestState.status = CHAT_STATUS.ERROR;
                latestState.lastError = error instanceof Error ? error.message : String(error);
                await latest.saveMetadata?.();
                this.notify('error', `自动总结失败：${latestState.lastError}`);
                return;
            }

            allowPartial = Boolean(options.force);
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    async rebuild() {
        const context = this.getContext();
        const state = ensureChatState(context);
        if (!state) {
            return null;
        }

        state.summary = '';
        state.summarizedThrough = -1;
        state.checkpoints = [];
        state.updatedAt = null;
        state.status = CHAT_STATUS.STALE;
        state.lastError = null;
        await context.saveMetadata?.();
        this.onUpdate();
        return this.schedule({ force: true, rebuild: true });
    }
}
