import {
    JitenClient,
    JitenTargetStore,
    isJitenPageEvent,
    jitenSentenceContainsWordForm,
    targetFromJitenEvent,
} from '@project/common/jiten/jiten';
import type { JitenPageEvent } from '@project/common/jiten/jiten';

describe('Jiten page events', () => {
    it('matches the last mined form and not an unrelated sentence marker', () => {
        expect(jitenSentenceContainsWordForm('昨日は**見る**。', '食べる', 'たべる')).toBe(false);
        expect(jitenSentenceContainsWordForm('昨日は**見る**。', '食べる', 'たべる', '**食べました**')).toBe(false);
        expect(jitenSentenceContainsWordForm('昨日は食べる。', '食べる', 'たべる')).toBe(true);
        expect(jitenSentenceContainsWordForm('昨日は食べました。', '食べる', 'たべる', '**食べました**')).toBe(true);
    });

    it('accepts only versioned Jiten events and extracts mined targets', () => {
        expect(isJitenPageEvent({ source: 'other', version: 1, type: 'card-mined' })).toBe(false);
        const event: JitenPageEvent = {
            source: 'jiten-reader',
            version: 1,
            type: 'card-mined',
            wordId: 10,
            readingIndex: 2,
            spelling: '食べる',
            reading: 'たべる',
            sentence: '食べる。',
            sourceTitle: 'Episode 1',
        };
        expect(targetFromJitenEvent(event)).toEqual({
            wordId: 10,
            readingIndex: 2,
            spelling: '食べる',
            reading: 'たべる',
            sentence: '食べる。',
            source: 'Episode 1',
        });
    });

    it('persists the last mined target', () => {
        const storage = new Map<string, string>();
        const fakeStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        } as unknown as Storage;
        const store = new JitenTargetStore(fakeStorage);
        const target = { wordId: 1, readingIndex: 0, spelling: '見る', reading: 'みる' };
        store.set(target);
        expect(new JitenTargetStore(fakeStorage).current).toEqual(target);
    });

    it('refreshes the target when another store instance mines a newer word', () => {
        const storage = new Map<string, string>();
        const fakeStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        } as unknown as Storage;
        const eventStore = new JitenTargetStore(fakeStorage);
        const attachStore = new JitenTargetStore(fakeStorage);
        eventStore.set({ wordId: 1109690, readingIndex: 0, spelling: 'フェイク', reading: 'フェイク' });
        eventStore.set({ wordId: 2546060, readingIndex: 1, spelling: '帷', reading: '帷[とばり]' });

        expect(attachStore.current).toEqual({
            wordId: 2546060,
            readingIndex: 1,
            spelling: '帷',
            reading: '帷[とばり]',
        });
    });
});

describe('JitenClient', () => {
    it('requests Jiten+ status with the API key', async () => {
        const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            void input;
            void init;
            return {
                ok: true,
                json: async () => ({ tier: 'full', quota: { usedBytes: 1, maxBytes: 2 } }),
            } as Response;
        });
        const client = new JitenClient({ jitenApiKey: 'secret' }, fetcher);
        await expect(client.plusStatus()).resolves.toEqual({ tier: 'full', quota: { usedBytes: 1, maxBytes: 2 } });
        expect(fetcher.mock.calls[0][0]).toContain('/api/jiten-plus/status');
        expect((fetcher.mock.calls[0][1]?.headers as Headers).get('X-Api-Key')).toBe('secret');
    });

    it('parses a word form through Jiten before selecting a vocabulary target', async () => {
        const fetcher = jest.fn(async (input: RequestInfo | URL) => {
            void input;
            return {
                ok: true,
                status: 200,
                json: async () => ({ words: [{ wordId: 1210640, readingIndex: 0, originalText: '勘ぐられて' }] }),
            } as Response;
        });
        const client = new JitenClient({ jitenApiKey: 'secret' }, fetcher);
        await expect(client.parseNormalised('勘ぐられて')).resolves.toEqual([
            { wordId: 1210640, readingIndex: 0, originalText: '勘ぐられて' },
        ]);
        expect(String(fetcher.mock.calls[0][0])).toContain('/api/vocabulary/parse-normalised?text=');
        expect(String(fetcher.mock.calls[0][0])).not.toContain('/api/vocabulary/search');
    });

    it('attaches the sentence to the second of two mined targets', async () => {
        const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
        const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ input, init });
            return { ok: true, status: 200, json: async () => ({}) } as Response;
        });
        const client = new JitenClient({ jitenApiKey: 'secret' }, fetcher);
        const storage = new Map<string, string>();
        const fakeStorage = {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        } as unknown as Storage;
        const store = new JitenTargetStore(fakeStorage);
        store.set({ wordId: 1109690, readingIndex: 0, spelling: 'フェイク', reading: 'フェイク' });
        store.set({ wordId: 2546060, readingIndex: 1, spelling: '帷', reading: '帷[とばり]' });

        await expect(
            client.attach(store.current!, '帷を開く', undefined, undefined, 'episode.mkv (00:12)')
        ).resolves.toMatchObject({
            sentenceSaved: true,
            imageSaved: false,
            audioSaved: false,
        });

        const sentenceRequest = requests.find((request) => request.init?.method === 'POST');
        expect(String(sentenceRequest?.input)).toContain('/api/user/example-sentences/2546060/1');
        expect(JSON.parse(String(sentenceRequest?.init?.body))).toEqual({
            text: '**帷**を開く',
            source: 'episode.mkv (00:12)',
        });
    });

    it('uses the conjugated form marked by Jiten Reader', async () => {
        const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
        const fetcher = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ input, init });
            return { ok: true, status: 200, json: async () => [] } as Response;
        });
        const client = new JitenClient({ jitenApiKey: 'secret' }, fetcher);
        await client.attach(
            {
                wordId: 1210640,
                readingIndex: 0,
                spelling: '勘ぐる',
                reading: '勘[かん]ぐる',
                sentence: '君との関係を**勘ぐられて**は\nよろしくない',
            },
            '君との関係を勘ぐられては よろしくない',
            undefined,
            undefined,
            'episode.mkv'
        );
        const sentenceRequest = requests.find((request) => request.init?.method === 'POST');
        expect(JSON.parse(String(sentenceRequest?.init?.body)).text).toBe('君との関係を**勘ぐられて**は よろしくない');
    });

    it('still adds sentence and media when the target form is absent', async () => {
        const fetcher = jest.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as Response);
        const client = new JitenClient({ jitenApiKey: 'secret' }, fetcher);
        const result = await client.attach(
            { wordId: 1210640, readingIndex: 0, spelling: '勘ぐる', reading: '勘[かん]ぐる' },
            '君との関係を見られてはよろしくない',
            { extension: 'jpeg', blob: async () => new Blob(['image'], { type: 'image/jpeg' }) } as never,
            { extension: 'mp3', blob: async () => new Blob(['audio'], { type: 'audio/mp3' }) } as never
        );
        expect(result.sentenceSaved).toBe(true);
        expect(result.imageSaved).toBe(true);
        expect(result.audioSaved).toBe(true);
        expect(fetcher).toHaveBeenCalled();
    });

    it('removes Reader-owned sentences before adding the edited sentence', async () => {
        const requests: string[] = [];
        const fetcher = jest.fn(async (input: RequestInfo | URL) => {
            const path = String(input);
            requests.push(path);
            if (path.endsWith('/api/user/example-sentences/10/0')) {
                return {
                    ok: true,
                    status: 200,
                    json: async () => [
                        { userExampleSentenceId: 42, text: '万が一近隣住民に', source: 'asbplayer' },
                        { userExampleSentenceId: 43, text: '昨日', source: 'episode.mkv' },
                    ],
                } as Response;
            }
            return { ok: true, status: 200, json: async () => ({}) } as Response;
        });
        const client = new JitenClient({ jitenApiKey: 'secret' }, fetcher);
        await client.attach(
            {
                wordId: 10,
                readingIndex: 0,
                spelling: '近隣住民',
                reading: 'きんりんじゅうみん',
                sentence: '万が一近隣住民に',
            },
            '万が一近隣住民に 君との関係を勘ぐられては よろしくない'
        );
        expect(requests).toEqual([
            'https://api.jiten.moe/api/user/example-sentences/10/0',
            'https://api.jiten.moe/api/user/example-sentences/42',
            'https://api.jiten.moe/api/user/example-sentences/10/0',
        ]);
    });
});
