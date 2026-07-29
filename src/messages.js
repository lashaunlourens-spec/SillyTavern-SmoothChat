function messageText(message) {
    return typeof message?.mes === 'string' ? message.mes.trim() : '';
}

export function isSummarizableMessage(message) {
    return Boolean(
        message
        && !message.is_system
        && typeof message.is_user === 'boolean'
        && messageText(message),
    );
}

export function collectCompleteRounds(messages, options = {}) {
    const afterIndex = Number.isInteger(options.afterIndex) ? options.afterIndex : -1;
    const beforeIndex = Number.isInteger(options.beforeIndex)
        ? Math.min(options.beforeIndex, messages.length - 1)
        : messages.length - 1;
    const rounds = [];
    let current = null;

    const finalize = () => {
        if (current?.assistantIndices.length) {
            current.endIndex = current.assistantIndices.at(-1);
            rounds.push(current);
        }
        current = null;
    };

    for (let index = Math.max(0, afterIndex + 1); index <= beforeIndex; index += 1) {
        const message = messages[index];
        if (!isSummarizableMessage(message)) {
            continue;
        }

        if (message.is_user) {
            finalize();
            current = {
                startIndex: index,
                endIndex: null,
                userIndex: index,
                assistantIndices: [],
            };
            continue;
        }

        if (current) {
            current.assistantIndices.push(index);
        }
    }

    finalize();
    return rounds;
}

export function countPendingRounds(messages, afterIndex = -1) {
    return collectCompleteRounds(messages, { afterIndex }).length;
}

export function selectNextSummaryBatch(messages, options) {
    const afterIndex = Number.isInteger(options.afterIndex) ? options.afterIndex : -1;
    const intervalRounds = Math.max(1, Number.parseInt(options.intervalRounds, 10) || 1);
    const allowPartial = Boolean(options.allowPartial);
    const rounds = collectCompleteRounds(messages, { afterIndex });

    if (!rounds.length || (!allowPartial && rounds.length < intervalRounds)) {
        return null;
    }

    const selectedRounds = rounds.slice(0, Math.min(intervalRounds, rounds.length));
    const endIndex = selectedRounds.at(-1).endIndex;
    const startIndex = afterIndex + 1;

    return {
        startIndex,
        endIndex,
        roundCount: selectedRounds.length,
        messages: messages.slice(startIndex, endIndex + 1),
    };
}

function canonicalMessage(message) {
    return JSON.stringify({
        role: message?.is_system ? 'system' : message?.is_user ? 'user' : 'assistant',
        name: typeof message?.name === 'string' ? message.name : '',
        text: typeof message?.mes === 'string' ? message.mes : '',
        swipe: Number.isInteger(message?.swipe_id) ? message.swipe_id : null,
    });
}

function fnv1a(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function fingerprintRange(messages, startIndex, endIndex) {
    if (
        !Number.isInteger(startIndex)
        || !Number.isInteger(endIndex)
        || startIndex < 0
        || endIndex < startIndex
        || endIndex >= messages.length
    ) {
        return null;
    }

    const value = messages
        .slice(startIndex, endIndex + 1)
        .map(canonicalMessage)
        .join('\u241e');
    return fnv1a(value);
}

export function validateCheckpoints(messages, checkpoints) {
    for (let index = 0; index < checkpoints.length; index += 1) {
        const checkpoint = checkpoints[index];
        const actual = fingerprintRange(messages, checkpoint.startIndex, checkpoint.endIndex);
        if (!actual || actual !== checkpoint.fingerprint) {
            return {
                valid: false,
                validCount: index,
                invalidIndex: index,
            };
        }
    }

    return {
        valid: true,
        validCount: checkpoints.length,
        invalidIndex: -1,
    };
}

export function findRecentRawStart(messages, summarizedThrough, recentRawRounds) {
    if (recentRawRounds <= 0) {
        return summarizedThrough + 1;
    }

    const rounds = collectCompleteRounds(messages, {
        afterIndex: -1,
        beforeIndex: summarizedThrough,
    });
    if (!rounds.length) {
        return summarizedThrough + 1;
    }

    const retained = rounds.slice(-recentRawRounds);
    return retained[0].startIndex;
}

export function formatTranscript(messages) {
    return messages
        .filter(isSummarizableMessage)
        .map(message => {
            const role = message.is_user ? '用户' : (message.name || '角色');
            return `${role}：${messageText(message)}`;
        })
        .join('\n\n');
}
