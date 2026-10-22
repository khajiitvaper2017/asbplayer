import { embeddedTrackLanguageDisplayName } from '@project/common/settings/embedded-track-languages';
import { asbInfo } from '@project/common/util/log';
import { isAndroid } from 'react-device-detect';

export interface ByteSource {
    size: number;
    read(offset: number, length: number): Promise<Uint8Array>;
    readRanges(ranges: readonly { start: number; end: number }[]): Promise<Uint8Array>;
    stream(offset: number): AsyncGenerator<Uint8Array, void>;
}

export interface SubtitleTrack {
    number: number;
    language: string;
    name: string;
    type: 'srt' | 'ass' | 'vtt' | 'sup';
    header: string;
}

export interface SubtitleCue {
    start: number;
    end: number;
    text: string;
    ass?: string[];
    data?: Uint8Array;
    vttMetadata?: string[];
    order: number;
}

export interface ExtractedTrack extends SubtitleTrack {
    cues: SubtitleCue[];
}

type Element = { id: number; data: number; end: number; size: number };
type Cue = {
    track: number;
    time: number;
    duration?: number;
    cluster: number;
    relative: number;
};
const decoder = new TextDecoder();
const CLUSTER = 0x1f43b675;
const TRACKS = 0x1654ae6b;
const INFO = 0x1549a966;
const CUES = 0x1c53bb6b;
const SEEK_HEAD = 0x114d9b74;
const BATCH_SIZE = 1024 * 1024;
const READ_GAP = 16 * 1024;
const BLOCK_PROBE = 512;
const RANGES_PER_READ = 32;
const IN_FLIGHT = 4;
const STREAM_CHUNK_SIZE = 16 * 1024 * 1024;

function width(first: number) {
    if (!first) throw new Error('Invalid EBML integer');
    return 8 - Math.floor(Math.log2(first));
}

function uint(data: Uint8Array, start: number, end: number) {
    let value = 0;
    for (let i = start; i < end; i++) value = value * 256 + data[i];
    if (!Number.isSafeInteger(value)) throw new Error('EBML integer exceeds JavaScript precision');
    return value;
}

function element(data: Uint8Array, start: number): Element {
    const idWidth = width(data[start]);
    const sizeWidth = width(data[start + idWidth]);
    const body = start + idWidth + sizeWidth;
    if (idWidth > 4 || body > data.length) throw new Error('Truncated EBML header');
    const mask = (1 << (8 - sizeWidth)) - 1;
    let size = data[start + idWidth] & mask;
    let unknown = size === mask;
    for (let i = start + idWidth + 1; i < body; i++) {
        size = size * 256 + data[i];
        unknown = unknown && data[i] === 255;
    }
    if (!unknown && !Number.isSafeInteger(size)) throw new Error('Invalid EBML element size');
    return {
        id: uint(data, start, start + idWidth),
        data: body,
        size: unknown ? Infinity : size,
        end: unknown ? Infinity : body + size,
    };
}

function* children(data: Uint8Array, start = 0, end = data.length): Generator<Element> {
    for (let offset = start; offset < end; ) {
        const item = element(data, offset);
        if (item.end > end) throw new Error('Truncated EBML element');
        yield item;
        offset = item.end;
    }
}

function text(data: Uint8Array, item: Element) {
    return decoder.decode(data.subarray(item.data, item.end));
}

class Reader {
    source: ByteSource;
    cached: Uint8Array<ArrayBufferLike> = new Uint8Array();
    cacheOffset = 0;

    constructor(source: ByteSource) {
        this.source = source;
    }

    async read(offset: number, length: number) {
        if (
            !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(length) ||
            offset < 0 ||
            length < 0 ||
            offset + length > this.source.size
        ) {
            throw new Error(`Read outside MKV: ${offset}+${length}`);
        }
        if (offset >= this.cacheOffset && offset + length <= this.cacheOffset + this.cached.length) {
            return this.cached.subarray(offset - this.cacheOffset, offset - this.cacheOffset + length);
        }
        this.cached = await this.source.read(offset, Math.min(this.source.size - offset, Math.max(length, 64 * 1024)));
        this.cacheOffset = offset;
        return this.cached.subarray(0, length);
    }

    async header(offset: number) {
        const item = element(await this.read(offset, Math.min(16, this.source.size - offset)), 0);
        return {
            ...item,
            data: item.data + offset,
            end: Math.min(this.source.size, item.end + offset),
        };
    }

    async body(offset: number) {
        const item = await this.header(offset);
        return this.read(item.data, item.end - item.data);
    }
}

function readTrackEntry(data: Uint8Array, entry: Element) {
    let number = 0,
        kind = 0,
        codec = '',
        language = 'eng',
        ietf = '',
        name = '',
        header = '',
        compressed = false;

    if (entry.id === 0xae) {
        for (const field of children(data, entry.data, entry.end)) {
            switch (field.id) {
                case 0xd7:
                    number = uint(data, field.data, field.end);
                    break;
                case 0x83:
                    kind = uint(data, field.data, field.end);
                    break;
                case 0x86:
                    codec = text(data, field);
                    break;
                case 0x22b59c:
                    language = text(data, field);
                    break;
                case 0x22b59d:
                    ietf = text(data, field);
                    break;
                case 0x536e:
                    name = text(data, field);
                    break;
                case 0x63a2:
                    header = text(data, field);
                    break;
                case 0x6d80:
                    compressed = true;
                    break;
            }
        }
    }
    return { number, kind, codec, language: ietf || language, name, header, compressed };
}

function readTracks(data: Uint8Array) {
    const tracks: SubtitleTrack[] = [];
    for (const entry of children(data)) {
        const { number, kind, codec, language, name, header, compressed } = readTrackEntry(data, entry);
        const type =
            codec === 'S_TEXT/UTF8' || codec === 'S_TEXT/ASCII'
                ? 'srt'
                : codec === 'S_TEXT/ASS' || codec === 'S_TEXT/SSA'
                  ? 'ass'
                  : codec === 'S_TEXT/WEBVTT' || codec.startsWith('D_WEBVTT/')
                    ? 'vtt'
                    : codec === 'S_HDMV/PGS'
                      ? 'sup'
                      : undefined;
        if (kind !== 17 || type === undefined || compressed) continue;
        tracks.push({
            number,
            language,
            name,
            type,
            header,
        });
    }
    return tracks;
}

function readCues(data: Uint8Array, selected: Set<number>, scale: number) {
    const cues: Cue[] = [];
    for (const point of children(data)) {
        if (point.id !== 0xbb) continue;
        let time = 0;
        const positions: Omit<Cue, 'time'>[] = [];
        for (const field of children(data, point.data, point.end)) {
            if (field.id === 0xb3) time = uint(data, field.data, field.end) * scale;
            if (field.id !== 0xb7) continue;
            let track = 0,
                cluster = 0,
                relative = -1,
                duration: number | undefined;
            for (const position of children(data, field.data, field.end)) {
                switch (position.id) {
                    case 0xf7:
                        track = uint(data, position.data, position.end);
                        break;
                    case 0xf1:
                        cluster = uint(data, position.data, position.end);
                        break;
                    case 0xf0:
                        relative = uint(data, position.data, position.end);
                        break;
                    case 0xb2:
                        duration = uint(data, position.data, position.end) * scale;
                        break;
                }
            }
            if (selected.has(track)) {
                if (relative < 0) throw new Error('Subtitle index has no relative block positions');
                positions.push({ track, cluster, relative, duration });
            }
        }
        for (const position of positions) cues.push({ ...position, time });
    }
    return cues;
}

function parseBlock(data: Uint8Array, item: Element, cue: Cue, track: ExtractedTrack, scale: number) {
    let block: Element | undefined;
    let duration = cue.duration ?? 0;
    let vttMetadata: string[] | undefined;
    if (item.id === 0xa3) block = item;
    else if (item.id === 0xa0) {
        for (const child of children(data, item.data, item.end)) {
            if (child.id === 0xa1) block = child;
            if (child.id === 0x9b) duration = uint(data, child.data, child.end) * scale;
            if (child.id === 0x75a1) {
                for (const more of children(data, child.data, child.end)) {
                    if (more.id !== 0xa6) continue;
                    const addition = [...children(data, more.data, more.end)];
                    if (addition.some((field) => field.id === 0xee && uint(data, field.data, field.end) === 1)) {
                        const additional = addition.find((field) => field.id === 0xa5);
                        if (additional)
                            vttMetadata = decoder.decode(data.subarray(additional.data, additional.end)).split('\n');
                    }
                }
            }
        }
    }
    if (!block) throw new Error('Subtitle index does not point to a block');
    const trackWidth = width(data[block.data]);
    const number =
        (data[block.data] & ((1 << (8 - trackWidth)) - 1)) * 256 ** (trackWidth - 1) +
        uint(data, block.data + 1, block.data + trackWidth);
    if (number !== cue.track) throw new Error(`Subtitle index track mismatch: ${number} != ${cue.track}`);
    if (data[block.data + trackWidth + 2] & 0x06) throw new Error('Laced subtitle blocks are not supported');
    const bytes = data.subarray(block.data + trackWidth + 3, block.end);
    const payload = track.type === 'sup' ? '' : decoder.decode(bytes).replace(/^(?:\r?\n)+/, '');
    const result: SubtitleCue = {
        start: cue.time,
        end: cue.time + duration,
        text: payload,
        order: track.cues.length,
    };
    if (track.type === 'ass') {
        const fields: string[] = [];
        let offset = 0;
        for (let i = 0; i < 8; i++) {
            const comma = payload.indexOf(',', offset);
            if (comma < 0) throw new Error('Invalid ASS subtitle packet');
            fields.push(payload.slice(offset, comma));
            offset = comma + 1;
        }
        result.order = Number(fields[0]);
        result.ass = fields.slice(1);
        result.text = payload.slice(offset);
    } else if (track.type === 'sup') {
        result.data = bytes.slice();
    } else if (track.type === 'vtt') {
        result.vttMetadata = vttMetadata;
    }
    track.cues.push(result);
}

type Request = { start: number; end: number; cluster: number; cue?: Cue };
type Batch = { start: number; end: number; requests: Request[] };

function batches(requests: Request[]) {
    requests.sort((a, b) => a.start - b.start);
    const result: Batch[] = [];
    for (const request of requests) {
        const previous = result[result.length - 1];
        if (previous && request.start <= previous.end + READ_GAP && request.end - previous.start <= BATCH_SIZE) {
            previous.end = Math.max(previous.end, request.end);
            previous.requests.push(request);
        } else
            result.push({
                start: request.start,
                end: request.end,
                requests: [request],
            });
    }
    return result;
}

async function* readBatches(source: ByteSource, queue: Batch[]) {
    const groups: Batch[][] = [];
    let bytes = 0;
    for (const batch of queue) {
        let group = groups[groups.length - 1];
        if (!group || group.length === RANGES_PER_READ || bytes + batch.end - batch.start > BATCH_SIZE) {
            groups.push((group = []));
            bytes = 0;
        }
        group.push(batch);
        bytes += batch.end - batch.start;
    }
    const read = (i: number) => {
        return source.readRanges(groups[i]).then(
            (data) => ({ data, error: undefined }),
            (error) => ({ data: undefined, error })
        );
    };
    const pending = groups.slice(0, IN_FLIGHT).map((_, i) => read(i));
    for (let i = 0; i < groups.length; i++) {
        const slot = i % IN_FLIGHT;
        const result = await pending[slot];
        if (!result.data) throw result.error;
        if (i + IN_FLIGHT < groups.length) pending[slot] = read(i + IN_FLIGHT);
        let offset = 0;
        for (const batch of groups[i]) {
            const length = batch.end - batch.start;
            yield { batch, data: result.data.subarray(offset, offset + length) };
            offset += length;
        }
    }
}

async function* readStreamedBatches(source: ByteSource, queue: Batch[]) {
    if (!queue.length) return;
    const stream = source.stream(queue[0].start);
    let offset = queue[0].start;
    let data: Uint8Array = new Uint8Array();
    const next = async () => {
        const result = await stream.next();
        if (result.done) throw new Error('Unexpected end of MKV stream');
        return result.value;
    };
    try {
        for (const batch of queue) {
            while (offset + data.length <= batch.start) {
                offset += data.length;
                data = await next();
            }
            data = data.subarray(batch.start - offset);
            offset = batch.start;
            const parts = [data];
            let length = data.length;
            while (offset + length < batch.end) {
                const part = await next();
                parts.push(part);
                length += part.length;
            }
            if (parts.length > 1) {
                data = new Uint8Array(length);
                let copied = 0;
                for (const part of parts) {
                    data.set(part, copied);
                    copied += part.length;
                }
            }
            yield { batch, data };
        }
    } finally {
        await stream.return(undefined);
    }
}

async function matroskaMetadata(source: ByteSource) {
    const reader = new Reader(source);
    let segment = await reader.header(0);
    if (segment.id !== 0x1a45dfa3) throw new Error('Not an EBML file');
    segment = await reader.header(segment.end);
    if (segment.id !== 0x18538067) throw new Error('No Matroska segment');
    const locations = new Map<number, number>();
    const pendingHeads: number[] = [];
    let offset = segment.data;
    while (offset < segment.end) {
        const item = await reader.header(offset);
        locations.set(item.id, offset);
        if (item.id === SEEK_HEAD) {
            pendingHeads.push(offset);
            break;
        }
        if (item.id === CLUSTER) break;
        offset = item.end;
    }
    const seenHeads = new Set<number>();
    for (let i = 0; i < pendingHeads.length; i++) {
        const head = pendingHeads[i];
        if (seenHeads.has(head)) continue;
        seenHeads.add(head);
        const data = await reader.body(head);
        for (const entry of children(data)) {
            if (entry.id !== 0x4dbb) continue;
            let id = 0,
                position = 0;
            for (const field of children(data, entry.data, entry.end)) {
                if (field.id === 0x53ab) id = uint(data, field.data, field.end);
                if (field.id === 0x53ac) position = uint(data, field.data, field.end);
            }
            locations.set(id, segment.data + position);
            if (id === SEEK_HEAD) pendingHeads.push(segment.data + position);
        }
    }
    return { reader, segment, locations };
}

export async function openMatroskaSubtitles(source: ByteSource) {
    const { reader, segment, locations } = await matroskaMetadata(source);
    const tracksPosition = locations.get(TRACKS);
    if (tracksPosition === undefined) throw new Error('No indexed subtitle track metadata');
    const tracks = readTracks(await reader.body(tracksPosition));
    let scale = 1;
    const infoPosition = locations.get(INFO);
    if (infoPosition !== undefined) {
        const data = await reader.body(infoPosition);
        for (const field of children(data)) if (field.id === 0x2ad7b1) scale = uint(data, field.data, field.end) / 1e6;
    }

    return {
        tracks,
        async extract(
            trackNumbers = tracks.map((t) => t.number),
            onProgress?: (progress: number) => void
        ): Promise<ExtractedTrack[]> {
            onProgress?.(0);
            const selected = new Set(trackNumbers);
            const result = tracks
                .filter((t) => selected.has(t.number))
                .map((t) => ({ ...t, cues: [] as SubtitleCue[] }));
            if (!result.length) return result;
            const cuesPosition = locations.get(CUES);
            // shortcut: Matroska files without subtitle CuePoints are skipped; scan Clusters if those files need support.
            if (cuesPosition === undefined) throw new Error('Matroska file has no subtitle Cues index');
            const cues = readCues(await reader.body(cuesPosition), selected, scale);
            const byTrack = new Map(result.map((t) => [t.number, t]));
            const clusters = new Map<number, number>();
            const requests: Request[] = [];
            for (const cue of cues) {
                const cluster = segment.data + cue.cluster;
                if (!clusters.has(cluster)) {
                    clusters.set(cluster, 0);
                    requests.push({
                        start: cluster,
                        end: Math.min(cluster + 16, source.size),
                        cluster,
                    });
                }
                // A Cluster header is 5–12 bytes. Schedule it and the bounded block probe together.
                const start = cluster + cue.relative + 5;
                requests.push({
                    start,
                    end: Math.min(source.size, start + BLOCK_PROBE + 7),
                    cluster,
                    cue,
                });
            }
            const queue = batches(requests);
            const oversized: Request[] = [];
            // Android file-provider opens are expensive; desktop indexed reads avoid scanning video data.
            const read = isAndroid ? readStreamedBatches : readBatches;
            let completed = 0;
            for await (const { batch, data } of read(source, queue)) {
                for (const request of batch.requests) {
                    if (!request.cue) {
                        const item = element(data, request.cluster - batch.start);
                        if (item.id !== CLUSTER) throw new Error('Subtitle index references an invalid cluster');
                        clusters.set(request.cluster, item.data + batch.start);
                        continue;
                    }
                    const cue = request.cue;
                    const start = clusters.get(request.cluster)! + cue.relative;
                    const item = element(data, start - batch.start);
                    if (item.id !== 0xa0 && item.id !== 0xa3)
                        throw new Error('Index does not point to a subtitle block');
                    if (batch.start + item.end > source.size) throw new Error('Subtitle block extends past EOF');
                    if (item.end > data.length)
                        oversized.push({
                            start,
                            end: batch.start + item.end,
                            cluster: request.cluster,
                            cue,
                        });
                    else parseBlock(data, item, cue, byTrack.get(cue.track)!, scale);
                }
                onProgress?.(++completed / queue.length);
            }
            // Re-read only subtitle packets that exceed the initial probe, in file order.
            for await (const { batch, data } of readBatches(source, batches(oversized))) {
                for (const extra of batch.requests) {
                    const cue = extra.cue!;
                    parseBlock(data, element(data, extra.start - batch.start), cue, byTrack.get(cue.track)!, scale);
                }
            }
            for (const track of result)
                track.cues.sort((a, b) => (track.type === 'ass' ? a.order - b.order : a.start - b.start));
            return result;
        },
    };
}

function timestamp(ms: number, format: 'srt' | 'ass' | 'vtt' = 'srt') {
    const ass = format === 'ass';
    const units = Math.max(0, Math.floor(ms / (ass ? 10 : 1)));
    const fraction = units % (ass ? 100 : 1000);
    const seconds = Math.floor(units / (ass ? 100 : 1000));
    const hours = Math.floor(seconds / 3600);
    return `${ass ? hours : String(hours).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}${format === 'srt' ? ',' : '.'}${String(fraction).padStart(ass ? 2 : 3, '0')}`;
}

export function subtitleFile(track: ExtractedTrack): string | Uint8Array {
    if (track.type === 'srt')
        return track.cues
            .map((c, i) => `${i + 1}\n${timestamp(c.start)} --> ${timestamp(c.end)}\n${c.text}\n`)
            .join('\n');
    if (track.type === 'vtt') {
        const header = track.header.trim() || 'WEBVTT';
        return `${header}\n\n${track.cues
            .map((c) => {
                const [settings = '', identifier = '', ...comments] = c.vttMetadata ?? [];
                const note = comments.length > 0 ? `${comments.join('\n')}\n\n` : '';
                return `${note}${identifier ? `${identifier}\n` : ''}${timestamp(c.start, 'vtt')} --> ${timestamp(c.end, 'vtt')}${settings ? ` ${settings}` : ''}\n${c.text}`;
            })
            .join('\n\n')}\n`;
    }
    if (track.type === 'sup') {
        const packets = track.cues.flatMap((cue) => {
            const segments: Uint8Array[] = [];
            const data = cue.data!;
            for (let offset = 0; offset + 3 <= data.length; ) {
                const end = offset + 3 + data[offset + 1] * 256 + data[offset + 2];
                if (end > data.length) throw new Error('Invalid PGS segment length');
                const pts = Math.floor(cue.start * 90) >>> 0;
                const packet = new Uint8Array(10 + end - offset);
                packet.set([
                    0x50,
                    0x47,
                    pts >>> 24,
                    pts >>> 16,
                    pts >>> 8,
                    pts,
                    pts >>> 24,
                    pts >>> 16,
                    pts >>> 8,
                    pts,
                ]);
                packet.set(data.subarray(offset, end), 10);
                segments.push(packet);
                offset = end;
            }
            if (segments.length === 0) throw new Error('Empty PGS subtitle block');
            return segments;
        });
        const result = new Uint8Array(packets.reduce((length, packet) => length + packet.length, 0));
        let offset = 0;
        for (const packet of packets) {
            result.set(packet, offset);
            offset += packet.length;
        }
        return result;
    }
    const header = track.header
        .replace(/\r\n/g, '\n')
        .replace(/\[Events\][\s\S]*$/i, '')
        .trimEnd();
    return `${header}\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n${track.cues.map((c) => `Dialogue: ${c.ass![0]},${timestamp(c.start, 'ass')},${timestamp(c.end, 'ass')},${c.ass!.slice(1).join(',')},${c.text}`).join('\n')}\n`;
}

export function matroskaFileSource(file: Blob, signal?: AbortSignal) {
    const stats = { reads: 0, ranges: 0, streams: 0, bytesRead: 0, summedReadMs: 0, slowestReadMs: 0 };
    const measure = async (read: () => Promise<Uint8Array>) => {
        signal?.throwIfAborted();
        const started = performance.now();
        const data = await read();
        signal?.throwIfAborted();
        const elapsed = performance.now() - started;
        stats.bytesRead += data.length;
        stats.summedReadMs += elapsed;
        stats.slowestReadMs = Math.max(stats.slowestReadMs, elapsed);
        return data;
    };
    return {
        size: file.size,
        stats,
        read(offset: number, length: number) {
            stats.reads++;
            stats.ranges++;
            return measure(async () => new Uint8Array(await file.slice(offset, offset + length).arrayBuffer()));
        },
        readRanges(ranges: readonly { start: number; end: number }[]) {
            stats.reads++;
            stats.ranges += ranges.length;
            return measure(
                async () => new Uint8Array(await new Blob(ranges.map((r) => file.slice(r.start, r.end))).arrayBuffer())
            );
        },
        async *stream(offset: number) {
            signal?.throwIfAborted();
            stats.streams++;
            const reader = file.slice(offset).stream().getReader({ mode: 'byob' });
            const cancel = () => void reader.cancel().catch(() => {});
            signal?.addEventListener('abort', cancel, { once: true });
            const read: (view: Uint8Array, options: { min: number }) => Promise<ReadableStreamReadResult<Uint8Array>> =
                reader.read.bind(reader);
            try {
                while (true) {
                    const data = await measure(
                        async () =>
                            (await read(new Uint8Array(STREAM_CHUNK_SIZE), { min: STREAM_CHUNK_SIZE })).value ??
                            new Uint8Array()
                    );
                    if (!data.length) return;
                    yield data;
                }
            } finally {
                signal?.removeEventListener('abort', cancel);
                try {
                    await reader.cancel();
                } finally {
                    reader.releaseLock();
                }
            }
        },
    };
}

export async function openMatroskaAudio(file: Blob) {
    const { reader, locations } = await matroskaMetadata(matroskaFileSource(file));
    const position = locations.get(TRACKS);
    if (position === undefined) throw new Error('No Matroska track metadata');
    const header = await reader.header(position);
    const data = await reader.body(position);
    const entries: { start: number; end: number; id?: string; label: string; language: string }[] = [];
    let start = 0;
    for (const entry of children(data)) {
        const { kind, number, language, codec, name: label } = readTrackEntry(data, entry);
        // Reordering invalidates the Tracks checksum; a same-size Void preserves all file offsets.
        if (entry.id === 0xbf) data[start] = 0xec;
        entries.push({
            start,
            end: entry.end,
            id: kind === 2 ? `matroska:${number}` : undefined,
            label: label || `${codec} (${number})`,
            language,
        });
        start = entry.end;
    }
    const tracks = entries
        .filter((entry) => entry.id !== undefined)
        .map((entry) => ({
            id: entry.id!,
            label: entry.label,
            language: entry.language,
        }));
    return {
        tracks,
        select(id: string) {
            const selected = entries.find((entry) => entry.id === id);
            if (!selected) throw new Error(`Unknown Matroska audio track: ${id}`);
            // Chromium plays the first audio TrackEntry when native audio-track selection is unavailable.
            const ordered = [selected, ...entries.filter((entry) => entry !== selected)];
            return new Blob(
                [
                    file.slice(0, header.data),
                    ...ordered.map((entry) => data.slice(entry.start, entry.end)),
                    file.slice(header.end),
                ],
                { type: file.type }
            );
        },
    };
}

export interface MatroskaSubtitleFile {
    file: File;
    language: string;
    name: string;
    type: SubtitleTrack['type'];
}

export async function extractMatroskaSubtitleFiles(
    file: File,
    preferredLanguage?: string,
    options: { signal?: AbortSignal; onProgress?: (progress: number) => void } = {}
): Promise<MatroskaSubtitleFile[]> {
    const started = performance.now();
    const source = matroskaFileSource(file, options.signal);
    const matroska = await openMatroskaSubtitles(source);
    const metadataFinished = performance.now();
    const trackNumbers =
        preferredLanguage === undefined
            ? undefined
            : matroska.tracks
                  .filter(
                      (track) =>
                          embeddedTrackLanguageDisplayName(track.language) ===
                          embeddedTrackLanguageDisplayName(preferredLanguage)
                  )
                  .map((track) => track.number);
    const tracks = await matroska.extract(trackNumbers, options.onProgress);
    options.signal?.throwIfAborted();
    const extractionFinished = performance.now();
    const baseName = file.name.replace(/\.(?:mkv|webm)$/i, '');

    const files = tracks.map((track) => {
        const label = `${track.language}${track.name ? ` - ${track.name}` : ''} (${track.number})`;
        return {
            file: new File([subtitleFile(track)], `${baseName} [${label}].${track.type}`),
            language: track.language,
            name: track.name,
            type: track.type,
        };
    });
    asbInfo('matroska/subtitles', 'Extraction timing', {
        fileBytes: file.size,
        tracks: tracks.length,
        cues: tracks.reduce((count, track) => count + track.cues.length, 0),
        metadataMs: Math.round(metadataFinished - started),
        extractionMs: Math.round(extractionFinished - metadataFinished),
        serializationMs: Math.round(performance.now() - extractionFinished),
        ...source.stats,
        summedReadMs: Math.round(source.stats.summedReadMs),
        slowestReadMs: Math.round(source.stats.slowestReadMs),
    });
    return files;
}
