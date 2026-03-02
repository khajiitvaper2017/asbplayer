import { CardModel, FileModel, MediaFragmentErrorCode } from './model';
import { download } from '../util/util';
import {
    Base64MediaFragmentData,
    CancelledMediaFragmentDataRenderingError,
    FileMediaFragmentData,
    makeMediaFragmentFileName,
    type MediaFragmentData,
    type MediaFragmentFormat,
    WebmFileMediaFragmentData,
} from './media-fragment-data';

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
        mediaFragmentFormat: MediaFragmentFormat = 'jpeg'
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
                return MediaFragment.fromWebmFile(
                    card.file,
                    card.subtitle.start,
                    card.subtitle.end,
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
        return new MediaFragment(new FileMediaFragmentData(file, timestamp, maxWidth, maxHeight));
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

export { CancelledMediaFragmentDataRenderingError };
