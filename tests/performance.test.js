import test from 'node:test';
import assert from 'node:assert/strict';

import { applyMessageLimit, restoreMessageLimit } from '../src/performance.js';

test('changes only the native message loading limit and restores it', () => {
    let saves = 0;
    const context = {
        powerUserSettings: {
            chat_truncation: 100,
            fast_ui_mode: false,
            custom_css: 'user-theme',
        },
        saveSettingsDebounced: () => {
            saves += 1;
        },
    };
    const settings = {
        limitRenderedMessages: true,
        visibleMessageLimit: 60,
        originalChatTruncation: null,
        appliedChatTruncation: null,
    };

    const applied = applyMessageLimit(context, settings);
    assert.equal(applied.changed, true);
    assert.equal(context.powerUserSettings.chat_truncation, 60);
    assert.equal(context.powerUserSettings.fast_ui_mode, false);
    assert.equal(context.powerUserSettings.custom_css, 'user-theme');

    const restored = restoreMessageLimit(context, settings);
    assert.equal(restored.changed, true);
    assert.equal(context.powerUserSettings.chat_truncation, 100);
    assert.equal(settings.limitRenderedMessages, false);
    assert.equal(saves, 2);
});
