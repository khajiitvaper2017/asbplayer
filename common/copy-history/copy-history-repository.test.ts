import 'core-js/stable/structured-clone'; // fake-indexeddb requires structured clone polyfill
import 'fake-indexeddb/auto';
import { IndexedDBCopyHistoryRepository } from './copy-history-repository';
import Dexie from 'dexie';

beforeEach(async () => {
    const repository = new IndexedDBCopyHistoryRepository(1);
    await repository.clear();
});

it('saves and fetches', async () => {
    const repository = new IndexedDBCopyHistoryRepository(1);
    const item = {
        subtitle: { text: 'text', start: 0, end: 1, originalStart: 0, originalEnd: 1, track: 0 },
        id: 'id',
        timestamp: 1234,
        surroundingSubtitles: [],
        subtitleFileName: 'subtitle-file',
        mediaTimestamp: 5678,
    };
    await repository.save(item);
    const records = await repository.fetch(1);
    expect(records.length).toEqual(1);
    expect(records[0]).toMatchObject(item);
});

it('attempts to update existing record same ID', async () => {
    const repository = new IndexedDBCopyHistoryRepository(1);
    const item = {
        subtitle: { text: 'text1', start: 0, end: 1, originalStart: 0, originalEnd: 1, track: 0 },
        id: 'id',
        timestamp: 1234,
        surroundingSubtitles: [],
        subtitleFileName: 'subtitle-file',
        mediaTimestamp: 5678,
    };
    await repository.save(item);
    await repository.save({ ...item, subtitle: { ...item.subtitle, text: 'text2' } });

    const records = await repository.fetch(2);
    expect(records.length).toEqual(1);
    expect(records[0]).toMatchObject({ ...item, subtitle: { ...item.subtitle, text: 'text2' } });
});

it('respects table size limit', async () => {
    const repository = new IndexedDBCopyHistoryRepository(1);
    const item = {
        subtitle: { text: 'text', start: 0, end: 1, originalStart: 0, originalEnd: 1, track: 0 },
        id: 'id',
        timestamp: 1234,
        mediaTimestamp: 56789,
        surroundingSubtitles: [],
        subtitleFileName: 'subtitle-file',
    };
    await repository.save({ ...item, id: 'id1' });
    await repository.save({ ...item, id: 'id2' });
    const records = await repository.fetch(2);
    expect(records.length).toEqual(1);
    expect(records[0]).toMatchObject({ ...item, id: 'id2' });
});

it('respects fetch limit', async () => {
    const repository = new IndexedDBCopyHistoryRepository(3);
    const item = {
        subtitle: { text: 'text', start: 0, end: 1, originalStart: 0, originalEnd: 1, track: 0 },
        id: 'id',
        timestamp: 1234,
        mediaTimestamp: 5678,
        surroundingSubtitles: [],
        subtitleFileName: 'subtitle-file',
    };
    await repository.save({ ...item, id: 'id1' });
    await repository.save({ ...item, id: 'id2' });
    await repository.save({ ...item, id: 'id3' });
    const records = await repository.fetch(2);
    expect(records.length).toEqual(2);
    expect(records[0]).toMatchObject({ ...item, id: 'id2' });
    expect(records[1]).toMatchObject({ ...item, id: 'id3' });
});

it('migrates legacy image records to media fragments', async () => {
    await Dexie.delete('CopyHistoryDatabase');

    class LegacyCopyHistoryDatabase extends Dexie {
        copyHistoryItems!: Dexie.Table<any, number>;

        constructor() {
            super('CopyHistoryDatabase');
            this.version(2).stores({
                copyHistoryItems: '++index,id,timestamp',
            });
        }
    }

    const legacyDb = new LegacyCopyHistoryDatabase();
    await legacyDb.open();
    await legacyDb.table('copyHistoryItems').add({
        subtitle: { text: 'text', start: 0, end: 1, originalStart: 0, originalEnd: 1, track: 0 },
        id: 'legacy-id',
        timestamp: 1234,
        surroundingSubtitles: [],
        subtitleFileName: 'subtitle-file',
        mediaTimestamp: 5678,
        image: {
            base64: 'legacy-image-base64',
            extension: 'jpeg',
        },
    });
    legacyDb.close();

    const repository = new IndexedDBCopyHistoryRepository(10);
    const records = await repository.fetch(10);

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
        id: 'legacy-id',
        mediaFragment: {
            base64: 'legacy-image-base64',
            extension: 'jpeg',
        },
    });
    expect((records[0] as any).image).toBeUndefined();
});
