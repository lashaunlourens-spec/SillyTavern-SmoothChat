export function applyMessageLimit(context, settings) {
    if (!settings.limitRenderedMessages) {
        return { changed: false, reason: 'disabled' };
    }

    const powerUserSettings = context.powerUserSettings;
    if (!powerUserSettings || typeof powerUserSettings !== 'object') {
        return { changed: false, reason: 'unavailable' };
    }

    const current = Number(powerUserSettings.chat_truncation) || 0;
    const next = Number(settings.visibleMessageLimit);

    if (!Number.isFinite(settings.originalChatTruncation)) {
        settings.originalChatTruncation = current;
    }
    settings.appliedChatTruncation = next;

    if (current === next) {
        return { changed: false, reason: 'unchanged', previous: current, next };
    }

    powerUserSettings.chat_truncation = next;
    context.saveSettingsDebounced?.();
    syncNativeControl(next);
    return { changed: true, reason: 'applied', previous: current, next };
}

export function restoreMessageLimit(context, settings) {
    const powerUserSettings = context.powerUserSettings;
    if (!powerUserSettings || !Number.isFinite(settings.originalChatTruncation)) {
        return { changed: false, reason: 'no-original-value' };
    }

    const current = Number(powerUserSettings.chat_truncation) || 0;
    const original = Number(settings.originalChatTruncation);
    powerUserSettings.chat_truncation = original;
    settings.limitRenderedMessages = false;
    settings.appliedChatTruncation = null;
    context.saveSettingsDebounced?.();
    syncNativeControl(original);
    return {
        changed: current !== original,
        reason: 'restored',
        previous: current,
        next: original,
    };
}

function syncNativeControl(value) {
    if (typeof document === 'undefined') {
        return;
    }

    const input = document.getElementById('chat_truncation');
    const counter = document.getElementById('chat_truncation_counter');
    if (input) {
        input.value = String(value);
    }
    if (counter) {
        counter.value = String(value);
    }
}
