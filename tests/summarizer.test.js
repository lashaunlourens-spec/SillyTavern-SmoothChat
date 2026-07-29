import test from 'node:test';
import assert from 'node:assert/strict';

import { SummaryCoordinator } from '../src/summarizer.js';

function addRounds(chat, count, offset = 0) {
    for (let index = 0; index < count; index += 1) {
        chat.push(
            { is_user: true, is_system: false, name: 'User', mes: `u${offset + index}` },
            { is_user: false, is_system: false, name: 'Char', mes: `b${offset + index}` },
        );
    }
}

function createContext() {
    const calls = [];
    const context = {
        chat: [],
        chatId: 'chat-1',
        chatMetadata: {},
        extensionSettings: {},
        getCurrentChatId() {
            return this.chatId;
        },
        saveMetadata: async () => {},
        saveSettingsDebounced: () => {},
        generateRaw: async request => {
            calls.push(request);
            return `摘要版本 ${calls.length}：保留人物关系、事件、地点以及尚未解决的目标。`;
        },
    };
    return { context, calls };
}

test('creates an incremental checkpoint every fifteen rounds', async () => {
    const { context, calls } = createContext();
    addRounds(context.chat, 15);
    const coordinator = new SummaryCoordinator({
        getContext: () => context,
    });

    await coordinator.schedule();
    assert.equal(calls.length, 1);
    assert.equal(context.chatMetadata.smooth_chat.checkpoints.length, 1);
    assert.equal(context.chatMetadata.smooth_chat.summarizedThrough, 29);

    addRounds(context.chat, 15, 15);
    await coordinator.schedule();
    assert.equal(calls.length, 2);
    assert.equal(context.chatMetadata.smooth_chat.checkpoints.length, 2);
    assert.equal(context.chatMetadata.smooth_chat.summarizedThrough, 59);
    assert.match(calls[1].prompt, /摘要版本 1/);
});

test('does not advance a checkpoint when summary generation fails', async () => {
    const { context } = createContext();
    addRounds(context.chat, 15);
    context.generateRaw = async () => {
        throw new Error('backend unavailable');
    };
    const coordinator = new SummaryCoordinator({
        getContext: () => context,
    });

    await coordinator.schedule();
    const state = context.chatMetadata.smooth_chat;
    assert.equal(state.checkpoints.length, 0);
    assert.equal(state.summarizedThrough, -1);
    assert.equal(state.status, 'error');
    assert.match(state.lastError, /backend unavailable/);
});

test('discards a result when the summary baseline changes during generation', async () => {
    const { context } = createContext();
    addRounds(context.chat, 15);
    let release;
    context.generateRaw = () => new Promise(resolve => {
        release = resolve;
    });
    const coordinator = new SummaryCoordinator({
        getContext: () => context,
    });

    const job = coordinator.schedule();
    await new Promise(resolve => setTimeout(resolve, 0));
    context.chatMetadata.smooth_chat.summary = '用户在生成期间手动修改了摘要基线。';
    release('模型返回了一份足够长、但已经基于旧摘要生成的结果，应当被丢弃。');
    await job;

    const state = context.chatMetadata.smooth_chat;
    assert.equal(state.checkpoints.length, 0);
    assert.equal(state.status, 'stale');
    assert.match(state.lastError, /基线发生变化/);
});

test('processes a three-hundred-message backlog in bounded batches', async () => {
    const { context, calls } = createContext();
    addRounds(context.chat, 150);
    const coordinator = new SummaryCoordinator({
        getContext: () => context,
    });

    await coordinator.schedule();

    const state = context.chatMetadata.smooth_chat;
    assert.equal(calls.length, 10);
    assert.equal(state.checkpoints.length, 10);
    assert.equal(state.summarizedThrough, 299);
});
