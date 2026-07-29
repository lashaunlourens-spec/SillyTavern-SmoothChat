import test from 'node:test';
import assert from 'node:assert/strict';

test('loads the extension entry without a browser context', async () => {
    await import('../index.js');
    assert.equal(typeof globalThis.smoothChatPromptInterceptor, 'function');
});
