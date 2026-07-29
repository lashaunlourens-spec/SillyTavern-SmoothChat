import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeSettings } from '../src/state.js';

test('normalizes settings and clamps unsafe numeric values', () => {
    const settings = normalizeSettings({
        summaryIntervalRounds: '0',
        visibleMessageLimit: '9999',
        recentRawRounds: '-2',
        summaryTargetWords: 'not-a-number',
    });

    assert.equal(settings.summaryIntervalRounds, 1);
    assert.equal(settings.visibleMessageLimit, 500);
    assert.equal(settings.recentRawRounds, 0);
    assert.equal(settings.summaryTargetWords, 800);
    assert.equal(settings.limitRenderedMessages, true);
});
