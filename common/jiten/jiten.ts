import type AudioClip from '@project/common/audio-clip/audio-clip';
import type MediaFragment from '@project/common/src/media-fragment';
import type { JitenSettings, JitenMinedWord } from '@project/common/settings';
import { asbInfo, asbWarn } from '@project/common/util';

export interface JitenPageEvent {
    source: 'jiten-reader';
    version: 1;
    type: 'active-word-changed' | 'card-mined' | 'review-graded' | 'card-state-changed' | 'page-parsed';
    wordId?: number;
    readingIndex?: number;
    spelling?: string;
    reading?: string;
    sentence?: string;
    sourceTitle?: string;
}

export interface JitenAttachmentResult {
    sentenceSaved: boolean;
    imageSaved: boolean;
    audioSaved: boolean;
    errors: string[];
}

export interface JitenPlusStatus {
    tier?: string;
    quota?: {
        usedBytes?: number;
        maxBytes?: number;
    };
}

export interface JitenVocabularyResult {
    wordId: number;
    readingIndex: number;
    originalText?: string;
}

export interface JitenWordForm {
    text?: string;
    readingIndex: number;
    frequencyPercentage?: number;
}

export interface JitenVocabularyEntry {
    wordId: number;
    mainReading?: JitenWordForm;
    alternativeReadings?: JitenWordForm[];
    knownStates?: number[];
}

export interface JitenCardMediaStatus {
    image: boolean;
    audio: boolean;
}

export interface JitenStudyDeck {
    id: number;
    name?: string;
}

const JITEN_API = 'https://api.jiten.moe';
const TARGET_STORAGE_KEY = 'asbplayer.jiten.target';
const VOCABULARY_INFO_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;

export class JitenClient {
    constructor(
        private readonly settings: Pick<JitenSettings, 'jitenApiKey'>,
        private readonly fetcher: typeof fetch = fetch
    ) {}

    async ping() {
        const response = await this.request('/api/reader/ping', { method: 'POST', body: '{}' });
        return response.ok;
    }

    async plusStatus(): Promise<JitenPlusStatus> {
        const response = await this.request('/api/jiten-plus/status', { method: 'GET' });
        if (!response.ok) throw new Error((await response.text()) || `Jiten+ status failed (${response.status})`);
        return (await response.json()) as JitenPlusStatus;
    }

    async parseNormalised(text: string): Promise<JitenVocabularyResult[]> {
        const response = await this.request(`/api/vocabulary/parse-normalised?text=${encodeURIComponent(text)}`, {
            method: 'GET',
        });
        if (!response.ok) throw new Error((await response.text()) || `Jiten parsing failed (${response.status})`);
        const body = (await response.json()) as { words?: JitenVocabularyResult[] };
        return (body.words ?? []).filter(({ wordId, readingIndex }) => isValidVocabularyKey(wordId, readingIndex));
    }

    async vocabularyInfo(wordId: number, readingIndex: number): Promise<JitenVocabularyEntry> {
        assertValidVocabularyKey(wordId, readingIndex);
        const cacheKey = `asbplayer.jiten.vocabulary-info.${wordId}.${readingIndex}`;
        try {
            const cached = globalThis.localStorage?.getItem(cacheKey);
            if (cached) {
                const entry = JSON.parse(cached) as { expiresAt?: number; value?: JitenVocabularyEntry };
                if (entry.expiresAt && entry.expiresAt > Date.now() && entry.value) return entry.value;
                globalThis.localStorage?.removeItem(cacheKey);
            }
        } catch {
            // Ignore unavailable or malformed browser storage.
        }
        const response = await this.request(`/api/vocabulary/${wordId}/${readingIndex}/info`, { method: 'GET' });
        if (!response.ok)
            throw new Error((await response.text()) || `Jiten vocabulary info lookup failed (${response.status})`);
        const value = (await response.json()) as JitenVocabularyEntry;
        try {
            globalThis.localStorage?.setItem(
                cacheKey,
                JSON.stringify({ expiresAt: Date.now() + VOCABULARY_INFO_CACHE_TTL, value })
            );
        } catch {
            // Ignore unavailable or full browser storage.
        }
        return value;
    }

    async lookupVocabulary(words: Array<[number, number]>): Promise<Map<string, number[]>> {
        const response = await this.json('/api/reader/lookup-vocabulary', { words });
        const result = Array.isArray(response?.result) ? response.result : [];
        return new Map(words.map((word, index) => [`${word[0]}/${word[1]}`, result[index] ?? []]));
    }

    async readerStudyDecks(): Promise<JitenStudyDeck[]> {
        const response = await this.request('/api/srs/reader-study-decks', { method: 'POST', body: '{}' });
        if (!response.ok) throw new Error((await response.text()) || `Jiten decks failed (${response.status})`);
        const body = await response.json();
        const decks = Array.isArray(body) ? body : (body?.decks ?? body?.studyDecks ?? body?.items ?? body?.data ?? []);
        if (Array.isArray(decks)) {
            return decks.flatMap((deck) => {
                const id = deck.userStudyDeckId ?? deck.id ?? deck.deckId ?? deck.studyDeckId;
                return typeof id === 'number' ? [{ id, name: deck.name ?? deck.title ?? deck.deckName }] : [];
            });
        }
        return [];
    }

    async addToStudyDeck(deckId: number, target: JitenMinedWord, sentence: string, source?: string) {
        await this.json(`/api/srs/study-decks/${deckId}/words`, {
            wordId: target.wordId,
            readingIndex: target.readingIndex,
            occurrences: 1,
            sentence: sentence.slice(0, 150),
            source: source?.slice(0, 150),
        });
    }

    async studyDeckWordKeys(deckId: number): Promise<Set<string>> {
        const response = await this.request(`/api/srs/study-decks/${deckId}/word-keys`, { method: 'GET' });
        if (!response.ok) return new Set();
        const body = await response.json();
        const keys = Array.isArray(body) ? body : (body?.wordKeys ?? body?.items ?? body?.data ?? []);
        return new Set(
            Array.isArray(keys)
                ? keys.map((key) => `${Number(key?.wordId ?? key?.id)}/${Number(key?.readingIndex ?? -1)}`)
                : []
        );
    }

    async cardMediaStatus(wordText: string, wordId: number, readingIndex: number): Promise<JitenCardMediaStatus> {
        const query = new URLSearchParams({ page: '1', pageSize: '50', search: wordText });
        const response = await this.request(`/api/srs/card-media/manage?${query.toString()}`, { method: 'GET' });
        if (!response.ok) throw new Error((await response.text()) || `Jiten media lookup failed (${response.status})`);
        const body = await response.json();
        const item = (body?.items ?? []).find(
            (value: { wordId?: number; readingIndex?: number }) =>
                value.wordId === wordId && value.readingIndex === readingIndex
        );
        return { image: Boolean(item?.image), audio: Boolean(item?.audio) };
    }

    async cardMediaBatchStatus(words: Array<[number, number]>): Promise<Map<string, JitenCardMediaStatus>> {
        const response = await this.json('/api/srs/card-media/batch', {
            items: words.map(([wordId, readingIndex]) => ({ wordId, readingIndex })),
        });
        const items = Array.isArray(response) ? response : (response?.items ?? response?.data ?? []);
        return new Map(
            Array.isArray(items)
                ? items.map((item) => [
                      `${item.wordId}/${item.readingIndex}`,
                      { image: Boolean(item.image), audio: Boolean(item.audio) },
                  ])
                : []
        );
    }

    async attach(
        target: JitenMinedWord,
        sentence: string,
        image?: MediaFragment,
        audio?: AudioClip,
        source?: string
    ): Promise<JitenAttachmentResult> {
        asbInfo('jiten/api', 'Attach started', {
            wordId: target.wordId,
            readingIndex: target.readingIndex,
            spelling: target.spelling,
            hasImage: Boolean(image),
            hasAudio: Boolean(audio),
            source,
        });
        const result: JitenAttachmentResult = {
            sentenceSaved: false,
            imageSaved: false,
            audioSaved: false,
            errors: [],
        };
        const markedSentence = addWordMarker(sentence, target.spelling, target.reading, target.sentence);
        try {
            await this.removeSentenceDuplicate(target, target.sentence);
        } catch (error) {
            asbWarn('jiten/api', 'Duplicate sentence cleanup failed; continuing', {
                wordId: target.wordId,
                readingIndex: target.readingIndex,
                error,
            });
        }
        try {
            await this.json(`/api/user/example-sentences/${target.wordId}/${target.readingIndex}`, {
                text: markedSentence,
                source: source ?? target.source,
            });
            result.sentenceSaved = true;
        } catch (error) {
            result.errors.push(errorMessage(error));
        }
        const media = [
            image && { clip: image, name: 'image', filename: `asbplayer-image.${image.extension}` },
            audio && { clip: audio, name: 'audio', filename: `asbplayer-audio.${audio.extension}` },
        ].filter(Boolean) as { clip: MediaFragment | AudioClip; name: string; filename: string }[];
        for (const { clip, name, filename } of media) {
            if (clip.error !== undefined) {
                result.errors.push(`${name[0].toUpperCase()}${name.slice(1)} capture failed: ${clip.error}`);
                continue;
            }
            try {
                await this.upload(target, await clip.blob(), filename);
                result[`${name}Saved` as 'imageSaved' | 'audioSaved'] = true;
            } catch (error) {
                result.errors.push(errorMessage(error));
            }
        }
        asbInfo('jiten/api', 'Attach finished', {
            wordId: target.wordId,
            readingIndex: target.readingIndex,
            sentenceSaved: result.sentenceSaved,
            imageSaved: result.imageSaved,
            audioSaved: result.audioSaved,
            errors: result.errors,
        });
        return result;
    }

    private async upload(target: JitenMinedWord, blob: Blob, filename: string) {
        asbInfo('jiten/api', 'Uploading media', {
            wordId: target.wordId,
            readingIndex: target.readingIndex,
            filename,
            size: blob.size,
            type: blob.type,
        });
        const form = new FormData();
        form.append('file', blob, filename);
        const response = await this.request(`/api/srs/card-media/${target.wordId}/${target.readingIndex}`, {
            method: 'POST',
            body: form,
        });
        if (!response.ok) throw new Error((await response.text()) || `Jiten media upload failed (${response.status})`);
    }

    private async json(path: string, body: unknown) {
        const response = await this.request(path, { method: 'POST', body: JSON.stringify(body) });
        if (!response.ok) throw new Error((await response.text()) || `Jiten request failed (${response.status})`);
        return response.json();
    }

    private async removeSentenceDuplicate(target: JitenMinedWord, sentence?: string) {
        const path = `/api/user/example-sentences/${target.wordId}/${target.readingIndex}`;
        const response = await this.request(path, { method: 'GET' });
        if (!response.ok) return;
        const sentences = (await response.json()) as {
            userExampleSentenceId?: number;
            text?: string;
            source?: string;
        }[];
        const normalized = sentence ? stripSentenceMarkers(sentence) : undefined;
        for (const existing of sentences) {
            const isReaderSentence = existing.source === 'asbplayer';
            const isExactDuplicate =
                normalized !== undefined && stripSentenceMarkers(existing.text ?? '') === normalized;
            if (existing.userExampleSentenceId && (isReaderSentence || isExactDuplicate)) {
                const deletion = await this.request(`/api/user/example-sentences/${existing.userExampleSentenceId}`, {
                    method: 'DELETE',
                });
                if (!deletion.ok)
                    asbWarn('jiten/api', 'Could not remove duplicate Reader sentence', {
                        wordId: target.wordId,
                        readingIndex: target.readingIndex,
                        sentenceId: existing.userExampleSentenceId,
                        status: deletion.status,
                    });
            }
        }
    }

    private async request(path: string, init: RequestInit) {
        const headers = new Headers(init.headers);
        headers.set('X-Api-Key', this.settings.jitenApiKey);
        if (!(init.body instanceof FormData)) headers.set('Content-Type', 'application/json');
        const method = init.method ?? 'GET';
        asbInfo('jiten/api', 'Request', { method, path });
        try {
            const response = await this.fetcher(`${JITEN_API}${path}`, { ...init, headers });
            asbInfo('jiten/api', 'Response', { method, path, status: response.status, ok: response.ok });
            return response;
        } catch (error) {
            asbWarn('jiten/api', 'Request failed', { method, path, error });
            throw error;
        }
    }
}

export class JitenTargetStore {
    private target?: JitenMinedWord;

    constructor(
        private readonly storage: Storage | undefined = typeof localStorage === 'undefined' ? undefined : localStorage
    ) {
        try {
            const value = this.storage?.getItem(TARGET_STORAGE_KEY);
            if (value) this.target = JSON.parse(value);
        } catch {
            this.target = undefined;
        }
    }

    get current() {
        try {
            const value = this.storage?.getItem(TARGET_STORAGE_KEY);
            if (value) this.target = JSON.parse(value) as JitenMinedWord;
        } catch {
            this.target = undefined;
        }
        return this.target;
    }

    set(target: JitenMinedWord) {
        this.target = target;
        this.storage?.setItem(TARGET_STORAGE_KEY, JSON.stringify(target));
    }
}

export const isJitenPageEvent = (value: unknown): value is JitenPageEvent => {
    if (!value || typeof value !== 'object') return false;
    const event = value as Partial<JitenPageEvent>;
    return event.source === 'jiten-reader' && event.version === 1 && typeof event.type === 'string';
};

export const targetFromJitenEvent = (event: JitenPageEvent): JitenMinedWord | undefined => {
    if (!isValidVocabularyKey(event.wordId, event.readingIndex) || !event.spelling || !event.reading) {
        return undefined;
    }
    return {
        wordId: event.wordId!,
        readingIndex: event.readingIndex!,
        spelling: event.spelling,
        reading: event.reading,
        source: event.sourceTitle,
        sentence: event.sentence,
    };
};

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));
const isValidVocabularyKey = (wordId?: number, readingIndex?: number) =>
    typeof wordId === 'number' &&
    Number.isInteger(wordId) &&
    wordId > 0 &&
    typeof readingIndex === 'number' &&
    Number.isInteger(readingIndex) &&
    readingIndex >= 0;
const assertValidVocabularyKey = (wordId: number, readingIndex: number) => {
    if (!isValidVocabularyKey(wordId, readingIndex)) throw new Error('Invalid Jiten vocabulary key');
};
const stripSentenceMarkers = (text: string) => text.replaceAll('**', '').trim();

export const jitenSentenceContainsWordForm = (
    sentence: string,
    spelling: string,
    reading: string,
    minedSentence?: string
) => {
    return sentence.includes('**') || findWordMarker(sentence, spelling, reading, minedSentence) !== undefined;
};

const addWordMarker = (sentence: string, spelling: string, reading: string, minedSentence?: string) => {
    if (sentence.includes('**')) return sentence;
    const marker = findWordMarker(sentence, spelling, reading, minedSentence);
    if (!marker) return `**${sentence}**`;
    const index = sentence.indexOf(marker);
    return `${sentence.slice(0, index)}**${marker}**${sentence.slice(index + marker.length)}`;
};

const findWordMarker = (sentence: string, spelling: string, reading: string, minedSentence?: string) => {
    const minedForm = minedSentence?.match(/\*\*([^*]+)\*\*/)?.[1];
    return [minedForm, spelling, reading]
        .filter((value): value is string => typeof value === 'string')
        .flatMap((value) => kanaVariants(value))
        .find((value) => value.length > 0 && sentence.includes(value));
};

const kanaVariants = (value: string) => [value, convertKana(value, 'hiragana'), convertKana(value, 'katakana')];

const convertKana = (value: string, target: 'hiragana' | 'katakana') =>
    [...value]
        .map((character) => {
            const code = character.codePointAt(0) ?? 0;
            if (target === 'hiragana' && code >= 0x30a1 && code <= 0x30f6) return String.fromCodePoint(code - 0x60);
            if (target === 'katakana' && code >= 0x3041 && code <= 0x3096) return String.fromCodePoint(code + 0x60);
            return character;
        })
        .join('');
