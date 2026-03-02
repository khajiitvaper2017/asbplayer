import { CardModel, FileModel, MediaFragmentErrorCode } from './model';
import { isActiveBlobUrl } from '../blob-url';
import { download } from '../util/util';
import { JpegFileMediaFragmentData } from './jpeg-file-media-fragment-data';
import { WebmFileMediaFragmentData } from './webm-file-media-fragment-data';

const maxPrefixLength = 24;
const videoReadyTimeoutMs = 5_000;

export type MediaFragmentFormat = 'jpeg' | 'webm';

export const makeMediaFragmentFileName = (prefix: string, timestamp: number) => {
    return `${prefix.replaceAll(' ', '_').substring(0, Math.min(prefix.length, maxPrefixLength))}_${Math.floor(
        timestamp
    )}`;
};

const mimeTypeForImageExtension = (extension: string) => {
    if (extension === 'webm') {
        return 'video/webm';
    }

    return `image/${extension}`;
};

export const mediaFragmentErrorForFile = (file: FileModel): MediaFragmentErrorCode | undefined => {
    if (file.blobUrl) {
        return isActiveBlobUrl(file.blobUrl) ? undefined : MediaFragmentErrorCode.fileLinkLost;
    }

    return undefined;
};

export const createVideoElement = async (blobUrl: string): Promise<HTMLVideoElement> =>
    await new Promise((resolve, reject) => {
        const video = document.createElement('video');
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                cleanup();
                resolve(video);
            }
        }, videoReadyTimeoutMs);
        const cleanup = () => {
            clearTimeout(timeout);
            video.onloadedmetadata = null;
            video.oncanplay = null;
            video.onerror = null;
        };
        const done = () => {
            if (!settled) {
                settled = true;
                cleanup();
                resolve(video);
            }
        };
        const fail = () => {
            if (!settled) {
                settled = true;
                cleanup();
                reject(video.error?.message ?? 'Could not initialize video for MediaFragment capture');
            }
        };

        video.onloadedmetadata = done;
        video.oncanplay = done;
        video.onerror = fail;
        video.preload = 'metadata';
        video.autoplay = false;
        video.volume = 0;
        video.controls = false;
        video.pause();
        video.src = blobUrl;
    });

export const disposeVideoElement = (video: HTMLVideoElement | undefined) => {
    if (!video) {
        return;
    }

    video.removeAttribute('src');
    video.load();
    video.remove();
};

export class Base64MediaFragmentData implements MediaFragmentData {
    private readonly _name: string;
    private readonly _timestamp: number;
    private readonly _base64: string;
    private readonly _extension: string;
    private readonly _error?: MediaFragmentErrorCode;

    private cachedBlob?: Blob;

    constructor(name: string, timestamp: number, base64: string, extension: string, error?: MediaFragmentErrorCode) {
        this._name = name;
        this._timestamp = timestamp;
        this._base64 = base64;
        this._extension = extension;
        this._error = error;
    }

    get name() {
        return this._name;
    }

    get timestamp() {
        return this._timestamp;
    }

    get extension() {
        return this._extension;
    }

    get error() {
        return this._error;
    }

    atTimestamp(_: number) {
        return this;
    }

    get canChangeTimestamp() {
        return false;
    }

    async base64() {
        return this._base64;
    }

    async blob() {
        return await this._blob();
    }

    async _blob() {
        if (!this.cachedBlob) {
            this.cachedBlob = await (await fetch(this._dataUrl())).blob();
        }

        return this.cachedBlob;
    }

    async dataUrl() {
        return this._dataUrl();
    }

    private _dataUrl() {
        return `data:${mimeTypeForImageExtension(this.extension)};base64,${this._base64}`;
    }

    dispose() {}
}

export class CancelledMediaFragmentDataRenderingError extends Error {}

export interface MediaFragmentData {
    name: string;
    extension: string;
    timestamp: number;
    base64: () => Promise<string>;
    dataUrl: () => Promise<string>;
    blob: () => Promise<Blob>;
    atTimestamp: (timestamp: number) => MediaFragmentData;
    canChangeTimestamp: boolean;
    error?: MediaFragmentErrorCode;
    dispose: () => void;
}

export default class MediaFragment {
    private readonly data: MediaFragmentData;

    constructor(data: MediaFragmentData) {
        this.data = data;
    }

    static fromCard(card: CardModel, maxWidth: number, maxHeight: number): MediaFragment | undefined;
    static fromCard(
        card: CardModel,
        maxWidth: number,
        maxHeight: number,
        mediaFragmentFormat: MediaFragmentFormat
    ): MediaFragment | undefined;
    static fromCard(
        card: CardModel,
        maxWidth: number,
        maxHeight: number,
        mediaFragmentFormat: MediaFragmentFormat,
        mediaFragmentTrimStart: number,
        mediaFragmentTrimEnd: number
    ): MediaFragment | undefined;
    static fromCard(
        card: CardModel,
        maxWidth: number,
        maxHeight: number,
        mediaFragmentFormat: MediaFragmentFormat = 'jpeg',
        mediaFragmentTrimStart: number = 0,
        mediaFragmentTrimEnd: number = 0
    ) {
        if (card.mediaFragment) {
            return MediaFragment.fromBase64(
                card.subtitleFileName,
                card.subtitle.start,
                card.mediaFragment.base64,
                card.mediaFragment.extension,
                card.mediaFragment.error
            );
        }

        if (card.file) {
            if (mediaFragmentFormat === 'webm') {
                const resolvedTrimStart = Number.isFinite(mediaFragmentTrimStart) ? mediaFragmentTrimStart : 0;
                const resolvedTrimEnd = Number.isFinite(mediaFragmentTrimEnd) ? mediaFragmentTrimEnd : 0;
                const startTimestamp = Math.max(0, card.subtitle.start + resolvedTrimStart);
                const endTimestamp = Math.max(startTimestamp, card.subtitle.end - resolvedTrimEnd);

                return MediaFragment.fromWebmFile(
                    card.file,
                    startTimestamp,
                    endTimestamp,
                    maxWidth,
                    maxHeight
                );
            }

            return MediaFragment.fromFile(card.file, card.mediaTimestamp ?? card.subtitle.start, maxWidth, maxHeight);
        }

        return undefined;
    }

    static fromBase64(
        subtitleFileName: string,
        timestamp: number,
        base64: string,
        extension: string,
        error: MediaFragmentErrorCode | undefined
    ) {
        const prefix = subtitleFileName.substring(0, subtitleFileName.lastIndexOf('.'));
        const mediaFragmentName = `${makeMediaFragmentFileName(prefix, timestamp)}.${extension}`;
        return new MediaFragment(new Base64MediaFragmentData(mediaFragmentName, timestamp, base64, extension, error));
    }

    static fromFile(file: FileModel, timestamp: number, maxWidth: number, maxHeight: number) {
        return new MediaFragment(new JpegFileMediaFragmentData(file, timestamp, maxWidth, maxHeight));
    }

    static fromWebmFile(
        file: FileModel,
        startTimestamp: number,
        endTimestamp: number,
        maxWidth: number,
        maxHeight: number
    ) {
        return new MediaFragment(
            new WebmFileMediaFragmentData(file, startTimestamp, endTimestamp, maxWidth, maxHeight, undefined, undefined)
        );
    }

    get name() {
        return this.data.name;
    }

    get timestamp() {
        return this.data.timestamp;
    }

    get extension() {
        return this.data.extension;
    }

    get error() {
        return this.data.error;
    }

    async base64() {
        return await this.data.base64();
    }

    async dataUrl() {
        return await this.data.dataUrl();
    }

    async blob() {
        return await this.data.blob();
    }

    async pngBlob() {
        if (this.extension === 'webm') {
            throw new Error('Cannot convert WebM media fragment to PNG');
        }

        return new Promise<Blob>(async (resolve, reject) => {
            try {
                createImageBitmap(await this.blob()).then((bitMap) => {
                    const canvas = document.createElement('canvas');
                    canvas.width = bitMap.width;
                    canvas.height = bitMap.height;
                    canvas.getContext('2d')!.drawImage(bitMap, 0, 0);
                    canvas.toBlob((blob) => {
                        if (blob) {
                            resolve(blob);
                        } else {
                            reject('Failed to convert to PNG');
                        }
                    }, 'image/png');
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    atTimestamp(timestamp: number) {
        return new MediaFragment(this.data.atTimestamp(timestamp));
    }

    get canChangeTimestamp() {
        return this.data.canChangeTimestamp;
    }

    dispose() {
        return this.data.dispose();
    }

    async download() {
        const blob = await this.data.blob();
        download(blob, this.data.name);
    }
}
