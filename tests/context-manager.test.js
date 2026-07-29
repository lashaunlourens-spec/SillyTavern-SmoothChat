import test from 'node:test';
import assert from 'node:assert/strict';

import { applySummaryToPrompt } from '../src/context-manager.js';
import { fingerprintRange } from '../src/messages.js';

function makeChat(rounds) {
    const chat = [];
    for (let index = 0; index < rounds; index += 1) {
        chat.push(
            { is_user: true, is_system: false, name: 'User', mes: `u${index}` },
            { is_user: false, is_system: false, name: 'Char', mes: `b${index}` },
        );
    }
    return chat;
}

test('injects summary and trims only the temporary prompt array', () => {
    const source = makeChat(15);
    const prompt = source.map((message, index) => ({ ...message, index }));
    const original = structuredClone(source);
    const state = {
        summary: 'Important long-term memory that is long enough.',
        summarizedThrough: 29,
        status: 'idle',
        paused: false,
        checkpoints: [{
            startIndex: 0,
            endIndex: 29,
            fingerprint: fingerprintRange(source, 0, 29),
            summary: 'Important long-term memory that is long enough.',
        }],
    };
    const settings = { enabled: true, recentRawRounds: 6 };

    const result = applySummaryToPrompt(prompt, source, state, settings);

    assert.equal(result.applied, true);
    assert.equal(result.removed, 18);
    assert.equal(prompt[0].extra.smooth_chat_summary, true);
    assert.equal(prompt.length, 13);
    assert.deepEqual(source, original);
});

test('does not trim when a checkpoint is stale', () => {
    const source = makeChat(15);
    const prompt = source.map((message, index) => ({ ...message, index }));
    const state = {
        summary: 'Important long-term memory that is long enough.',
        summarizedThrough: 29,
        status: 'idle',
        paused: false,
        checkpoints: [{
            startIndex: 0,
            endIndex: 29,
            fingerprint: 'bad-hash',
            summary: 'Important long-term memory that is long enough.',
        }],
    };

    const result = applySummaryToPrompt(prompt, source, state, {
        enabled: true,
        recentRawRounds: 6,
    });

    assert.equal(result.applied, false);
    assert.equal(result.reason, 'stale');
    assert.equal(prompt.length, 30);
});

test('does not trim during an error state', () => {
    const source = makeChat(15);
    const prompt = source.map((message, index) => ({ ...message, index }));
    const state = {
        summary: 'Important long-term memory that is long enough.',
        summarizedThrough: 29,
        status: 'error',
        paused: false,
        checkpoints: [],
    };

    const result = applySummaryToPrompt(prompt, source, state, {
        enabled: true,
        recentRawRounds: 6,
    });

    assert.equal(result.applied, false);
    assert.equal(result.reason, 'error');
});
