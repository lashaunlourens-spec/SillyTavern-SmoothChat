import test from 'node:test';
import assert from 'node:assert/strict';

import {
    collectCompleteRounds,
    fingerprintRange,
    selectNextSummaryBatch,
} from '../src/messages.js';

function user(text) {
    return { is_user: true, is_system: false, name: 'User', mes: text };
}

function bot(text, name = 'Char') {
    return { is_user: false, is_system: false, name, mes: text };
}

test('counts one user message and following role replies as one round', () => {
    const chat = [
        bot('Opening'),
        user('One'),
        bot('Reply A', 'A'),
        bot('Reply B', 'B'),
        user('Two'),
        bot('Reply C', 'C'),
    ];

    const rounds = collectCompleteRounds(chat);
    assert.equal(rounds.length, 2);
    assert.deepEqual(rounds[0], {
        startIndex: 1,
        endIndex: 3,
        userIndex: 1,
        assistantIndices: [2, 3],
    });
});

test('selects exactly fifteen complete rounds for an automatic batch', () => {
    const chat = [];
    for (let index = 0; index < 15; index += 1) {
        chat.push(user(`u${index}`), bot(`b${index}`));
    }

    const batch = selectNextSummaryBatch(chat, {
        afterIndex: -1,
        intervalRounds: 15,
        allowPartial: false,
    });

    assert.equal(batch.roundCount, 15);
    assert.equal(batch.startIndex, 0);
    assert.equal(batch.endIndex, 29);
    assert.equal(batch.messages.length, 30);
});

test('fingerprint changes when a summarized message is edited', () => {
    const chat = [user('hello'), bot('world')];
    const before = fingerprintRange(chat, 0, 1);
    chat[1].mes = 'changed';
    const after = fingerprintRange(chat, 0, 1);
    assert.notEqual(before, after);
});
