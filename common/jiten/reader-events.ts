import type { SubtitleModel } from '@project/common';
import { isJitenTarget, jitenSurfaceForm, stripJitenMarkers } from '@project/common/jiten/jiten';
import type { JitenTarget, JitenWordState } from '@project/common/jiten/jiten';

const wordStates = new WeakMap<Window, Map<string, JitenWordState>>();

export const readJitenWordState = (wordId: number, readingIndex: number, targetWindow: Window = window) =>
    wordStates.get(targetWindow)?.get(`${wordId}/${readingIndex}`);

export function listenJitenTarget(onTarget: (target: JitenTarget) => void, targetWindow: Window = window) {
    const activeWords = new Map<string, JitenTarget>();
    const states = wordStates.get(targetWindow) ?? new Map<string, JitenWordState>();
    wordStates.set(targetWindow, states);
    const receive = (event: MessageEvent) => {
        const data = event.data;
        const type = data?.type;
        if (
            event.source !== targetWindow ||
            event.origin !== targetWindow.origin ||
            data?.source !== 'jiten-reader' ||
            data.version !== 1 ||
            !['active-word-changed', 'card-mined', 'card-state-changed'].includes(type) ||
            !Number.isInteger(data.wordId) ||
            data.wordId <= 0 ||
            !Number.isInteger(data.readingIndex) ||
            data.readingIndex < 0 ||
            data.readingIndex > 255
        )
            return;
        const key = `${data.wordId}/${data.readingIndex}`;
        if (
            Array.isArray(data.cardState) &&
            data.cardState.length > 0 &&
            data.cardState.every((state: unknown) => typeof state === 'string') &&
            Array.isArray(data.deckIds) &&
            data.deckIds.every((id: unknown) => typeof id === 'number' && Number.isInteger(id) && id > 0)
        ) {
            const state = states.get(key) ?? { isNew: false, deckIds: [], updatedAt: 0 };
            state.isNew = data.cardState.length === 1 && data.cardState[0] === 'new';
            state.deckIds = [...data.deckIds];
            state.updatedAt = Date.now();
            states.set(key, state);
        }
        const state = states.get(key);
        if (type === 'card-mined' && state && Number.isInteger(data.deckId) && data.deckId > 0) {
            if (!state.deckIds.includes(data.deckId)) state.deckIds.push(data.deckId);
        }
        if (type === 'card-state-changed' || !isJitenTarget(data)) return;
        if (type === 'active-word-changed') {
            activeWords.set(key, data);
            return;
        }
        if (type !== 'card-mined') return;
        // Mining-deck events omit markers; the matching active event supplies the inflected form.
        const active = activeWords.get(key);
        const context =
            active &&
            (data.sentence === undefined ||
                stripJitenMarkers(data.sentence) === stripJitenMarkers(active.sentence ?? ''))
                ? active
                : undefined;
        const target: JitenTarget = {
            wordId: data.wordId,
            readingIndex: data.readingIndex,
            spelling: data.spelling,
            reading: data.reading,
            sentence: data.sentence ?? context?.sentence,
            surfaceForm: jitenSurfaceForm(data) ?? active?.surfaceForm,
            sourceTitle: data.sourceTitle,
            state,
        };
        onTarget(target);
    };
    targetWindow.addEventListener('message', receive);
    return () => targetWindow.removeEventListener('message', receive);
}

export function findJitenSubtitle<T extends SubtitleModel>(target: JitenTarget, subtitles: T[], timestamp: number) {
    const sentence = stripJitenMarkers(target.sentence ?? '').trim();
    const matching = sentence ? subtitles.filter((subtitle) => subtitle.text.trim() === sentence) : [];
    if (matching.length === 1) return matching[0];
    const surface = jitenSurfaceForm(target) || target.spelling;
    return (matching.length ? matching : subtitles).find(
        (subtitle) => subtitle.start <= timestamp && timestamp < subtitle.end && subtitle.text.includes(surface)
    );
}
