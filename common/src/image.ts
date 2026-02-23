import { resizeCanvas } from './image-transformer';
import { CardModel, FileModel, ImageErrorCode } from './model';
import { download } from '../util/util';
import { isActiveBlobUrl } from '../blob-url';
import { GIFEncoder, applyPalette, quantize } from 'gifenc';

const maxPrefixLength = 24;
const defaultGifDurationMs = 1500;
const minGifDurationMs = 300;
const maxGifDurationMs = 2500;
const gifFps = 10;
const maxGifFrames = 24;
const defaultGifMaxWidth = 480;
const gifPaletteSize = 128;
const gifPaletteFormat = 'rgb444';
const gifPaletteKeyframeCount = 5;
const gifPalettePixelStride = 4;
const gifStartTrimMs = 100;
const gifEndTrimMs = 100;

const makeFileName = (prefix: string, timestamp: number) => {
    return `${prefix.replaceAll(' ', '_').substring(0, Math.min(prefix.length, maxPrefixLength))}_${Math.floor(
        timestamp
    )}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const durationFromInterval = (startTimestamp: number, endTimestamp: number) => {
    const duration = Math.abs(endTimestamp - startTimestamp);
    const resolvedDuration = duration > 0 ? duration : defaultGifDurationMs;
    return clamp(resolvedDuration, minGifDurationMs, maxGifDurationMs);
};

const trimmedGifInterval = (startTimestamp: number, endTimestamp: number) => {
    const trimmedStartTimestamp = startTimestamp + gifStartTrimMs;
    const trimmedEndTimestamp = endTimestamp - gifEndTrimMs;

    if (trimmedEndTimestamp > trimmedStartTimestamp) {
        return {
            startTimestamp: trimmedStartTimestamp,
            endTimestamp: trimmedEndTimestamp,
        };
    }

    return { startTimestamp, endTimestamp };
};

const blobToDataUrl = async (blob: Blob): Promise<string> =>
    await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('Could not read blob as data URL'));
        reader.readAsDataURL(blob);
    });

class Base64ImageData implements ImageData {
    private readonly _name: string;
    private readonly _timestamp: number;
    private readonly _base64: string;
    private readonly _extension: string;
    private readonly _error?: ImageErrorCode;

    private cachedBlob?: Blob;

    constructor(name: string, timestamp: number, base64: string, extension: string, error?: ImageErrorCode) {
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
        return 'data:image/' + this.extension + ';base64,' + this._base64;
    }

    dispose() {}
}

export class CancelledImageDataRenderingError extends Error {}

class FileImageData implements ImageData {
    private readonly _file: FileModel;
    private readonly _timestamp: number;
    private readonly _maxWidth: number;
    private readonly _maxHeight: number;
    private readonly _name: string;
    private _video?: HTMLVideoElement;
    private _canvas?: HTMLCanvasElement;
    private _canvasPromise?: Promise<HTMLCanvasElement>;
    private _canvasPromiseReject?: (error: Error) => void;

    constructor(
        file: FileModel,
        timestamp: number,
        maxWidth: number,
        maxHeight: number,
        video?: HTMLVideoElement,
        canvas?: HTMLCanvasElement
    ) {
        this._file = file;
        this._name = `${makeFileName(file.name, timestamp)}.jpeg`;
        this._timestamp = timestamp;
        this._maxWidth = maxWidth;
        this._maxHeight = maxHeight;
        this._video = video;
        this._canvas = canvas;
    }

    get name() {
        return this._name;
    }

    get timestamp() {
        return this._timestamp;
    }

    get extension() {
        return 'jpeg';
    }

    get error(): ImageErrorCode | undefined {
        if (this._file.blobUrl) {
            return isActiveBlobUrl(this._file.blobUrl) ? undefined : ImageErrorCode.fileLinkLost;
        }

        return undefined;
    }

    atTimestamp(timestamp: number) {
        if (timestamp === this._timestamp) {
            return this;
        }

        this._canvasPromiseReject?.(new CancelledImageDataRenderingError());
        return new FileImageData(this._file, timestamp, this._maxWidth, this._maxHeight, this._video, this._canvas);
    }

    get canChangeTimestamp() {
        return true;
    }

    async base64(): Promise<string> {
        return new Promise((resolve, reject) => {
            this._getCanvas()
                .then((canvas) => {
                    const dataUrl = canvas.toDataURL('image/jpeg');
                    resolve(dataUrl.substring(dataUrl.indexOf(',') + 1));
                })
                .catch(reject);
        });
    }

    async blob(): Promise<Blob> {
        return new Promise((resolve, reject) => {
            this._getCanvas()
                .then((canvas) => {
                    canvas.toBlob((blob) => {
                        if (blob === null) {
                            reject(new Error('Could not obtain blob'));
                        } else {
                            resolve(blob);
                        }
                    }, 'image/jpeg');
                })
                .catch(reject);
        });
    }

    async dataUrl() {
        const canvas = await this._getCanvas();
        return canvas.toDataURL();
    }

    async _getCanvas(): Promise<HTMLCanvasElement> {
        if (this._canvasPromise) {
            return this._canvasPromise;
        }

        this._canvasPromise = new Promise(async (resolve, reject) => {
            this._canvasPromiseReject = reject;
            const video = await this._videoElement(this._file);
            const calculateCurrentTime = () => Math.max(0, Math.min(video.duration, this._timestamp / 1000));

            if (Number.isFinite(video.duration)) {
                video.currentTime = calculateCurrentTime();
            } else {
                video.onloadedmetadata = () => {
                    video.currentTime = calculateCurrentTime();
                    video.onloadedmetadata = null;
                };
            }

            video.onseeked = async () => {
                try {
                    this._canvasPromiseReject = undefined;

                    if (!this._canvas) {
                        this._canvas = document.createElement('canvas');
                    }

                    const canvas = this._canvas;
                    canvas.width = video.videoWidth;
                    canvas.height = video.videoHeight;
                    const ctx = canvas.getContext('2d');
                    ctx!.drawImage(video, 0, 0, canvas.width, canvas.height);
                    video.onseeked = null;

                    if (this._maxWidth > 0 || this._maxHeight > 0) {
                        await resizeCanvas(canvas, ctx!, this._maxWidth, this._maxHeight);
                        resolve(canvas);
                    } else {
                        resolve(canvas);
                    }
                } catch (e) {
                    reject(e);
                }
            };

            video.onerror = () => {
                reject(video.error?.message ?? 'Could not load video to obtain screenshot');
            };
        });

        return this._canvasPromise;
    }

    private async _videoElement(file: FileModel): Promise<HTMLVideoElement> {
        if (this._video) {
            return this._video;
        }

        return new Promise((resolve) => {
            const video = document.createElement('video');
            video.src = file.blobUrl;
            video.preload = 'auto';
            video.autoplay = false;
            video.volume = 0;
            video.controls = false;
            video.pause();
            const t0 = Date.now();
            const interval = setInterval(() => {
                if (
                    (video.seekable.length > 0 && video.seekable.end(0) === video.duration) ||
                    Date.now() - t0 >= 5_000
                ) {
                    this._video = video;
                    clearInterval(interval);
                    resolve(video);
                }
            }, 100);
        });
    }

    dispose() {
        if (!this._video) {
            return;
        }

        this._video.removeAttribute('src');
        this._video.load();
        this._video.remove();
        this._video = undefined;
        this._canvas?.remove();
    }
}

class GifFileImageData implements ImageData {
    private readonly _file: FileModel;
    private readonly _startTimestamp: number;
    private readonly _durationMs: number;
    private readonly _maxWidth: number;
    private readonly _maxHeight: number;
    private readonly _name: string;
    private _video?: HTMLVideoElement;
    private _canvas?: HTMLCanvasElement;
    private _blobPromise?: Promise<Blob>;
    private _blobPromiseReject?: (error: Error) => void;
    private _cachedBlob?: Blob;
    private _cachedDataUrl?: string;

    constructor(
        file: FileModel,
        startTimestamp: number,
        endTimestamp: number,
        maxWidth: number,
        maxHeight: number,
        video?: HTMLVideoElement,
        canvas?: HTMLCanvasElement
    ) {
        this._file = file;
        this._startTimestamp = Math.max(0, startTimestamp);
        this._durationMs = durationFromInterval(startTimestamp, endTimestamp);
        this._maxWidth = maxWidth;
        this._maxHeight = maxHeight;
        this._name = `${makeFileName(file.name, this._startTimestamp)}.gif`;
        this._video = video;
        this._canvas = canvas;
    }

    get name() {
        return this._name;
    }

    get timestamp() {
        return this._startTimestamp;
    }

    get extension() {
        return 'gif';
    }

    get error(): ImageErrorCode | undefined {
        if (this._file.blobUrl) {
            return isActiveBlobUrl(this._file.blobUrl) ? undefined : ImageErrorCode.fileLinkLost;
        }

        return undefined;
    }

    atTimestamp(timestamp: number) {
        if (timestamp === this._startTimestamp) {
            return this;
        }

        this._blobPromiseReject?.(new CancelledImageDataRenderingError());
        return new GifFileImageData(
            this._file,
            timestamp,
            timestamp + this._durationMs,
            this._maxWidth,
            this._maxHeight,
            this._video,
            this._canvas
        );
    }

    get canChangeTimestamp() {
        return true;
    }

    async base64() {
        const dataUrl = await this.dataUrl();
        return dataUrl.substring(dataUrl.indexOf(',') + 1);
    }

    async dataUrl() {
        if (this._cachedDataUrl) {
            return this._cachedDataUrl;
        }

        this._cachedDataUrl = await blobToDataUrl(await this.blob());
        return this._cachedDataUrl;
    }

    async blob() {
        if (this._cachedBlob) {
            return this._cachedBlob;
        }

        if (this._blobPromise) {
            return await this._blobPromise;
        }

        this._blobPromise = new Promise(async (resolve, reject) => {
            this._blobPromiseReject = reject;

            try {
                const blob = await this._renderGif();
                this._blobPromiseReject = undefined;
                this._cachedBlob = blob;
                resolve(blob);
            } catch (e) {
                reject(e);
            }
        });

        return await this._blobPromise;
    }

    private async _renderGif() {
        const video = await this._videoElement(this._file);
        const { width, height } = this._dimensions(video);
        const frameTimestamps = this._frameTimestamps(video.duration);
        const delayMs =
            frameTimestamps.length <= 1
                ? this._durationMs
                : Math.max(20, Math.round(this._durationMs / (frameTimestamps.length - 1)));

        if (!this._canvas) {
            this._canvas = document.createElement('canvas');
        }

        const canvas = this._canvas;
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });

        if (!ctx) {
            throw new Error('Could not create image context');
        }

        const palette = await this._globalPalette(video, ctx, width, height, frameTimestamps);
        const gif = GIFEncoder();

        for (let i = 0; i < frameTimestamps.length; ++i) {
            if (i > 0 && i % 2 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            await this._seekVideo(video, frameTimestamps[i] / 1000);
            ctx.drawImage(video, 0, 0, width, height);
            const rgba = ctx.getImageData(0, 0, width, height).data;
            const index = applyPalette(rgba, palette, gifPaletteFormat);

            if (i === 0) {
                gif.writeFrame(index, width, height, {
                    palette,
                    delay: delayMs,
                    repeat: 0,
                });
            } else {
                gif.writeFrame(index, width, height, {
                    delay: delayMs,
                });
            }
        }

        gif.finish();
        return new Blob([gif.bytesView()], { type: 'image/gif' });
    }

    private async _globalPalette(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameTimestamps: number[]
    ) {
        const paletteTimestamps = this._paletteTimestamps(frameTimestamps);
        const sampledFrames: Uint8Array[] = [];
        let totalSampledLength = 0;

        for (let i = 0; i < paletteTimestamps.length; ++i) {
            if (i > 0 && i % 2 === 0) {
                await new Promise((resolve) => setTimeout(resolve, 0));
            }

            await this._seekVideo(video, paletteTimestamps[i] / 1000);
            ctx.drawImage(video, 0, 0, width, height);
            const rgba = ctx.getImageData(0, 0, width, height).data;
            const sampled = this._sampleRgbaPixels(rgba);
            sampledFrames.push(sampled);
            totalSampledLength += sampled.length;
        }

        if (totalSampledLength === 0) {
            return quantize(new Uint8Array([0, 0, 0, 255]), gifPaletteSize, {
                format: gifPaletteFormat,
            });
        }

        const sampledFramesMerged = new Uint8Array(totalSampledLength);
        let offset = 0;
        for (const sampled of sampledFrames) {
            sampledFramesMerged.set(sampled, offset);
            offset += sampled.length;
        }

        return quantize(sampledFramesMerged, gifPaletteSize, {
            format: gifPaletteFormat,
        });
    }

    private _paletteTimestamps(frameTimestamps: number[]) {
        const targetFrameCount = Math.max(1, Math.min(gifPaletteKeyframeCount, frameTimestamps.length));

        if (targetFrameCount === frameTimestamps.length) {
            return frameTimestamps;
        }

        if (targetFrameCount === 1) {
            return [frameTimestamps[0]];
        }

        const timestamps: number[] = [];
        for (let i = 0; i < targetFrameCount; ++i) {
            const index = Math.round((i * (frameTimestamps.length - 1)) / (targetFrameCount - 1));
            const timestamp = frameTimestamps[index];

            if (timestamps[timestamps.length - 1] !== timestamp) {
                timestamps.push(timestamp);
            }
        }

        return timestamps;
    }

    private _sampleRgbaPixels(rgba: Uint8ClampedArray) {
        if (gifPalettePixelStride <= 1) {
            return new Uint8Array(rgba);
        }

        const pixelCount = Math.floor(rgba.length / 4);
        const sampledPixelCount = Math.ceil(pixelCount / gifPalettePixelStride);
        const sampled = new Uint8Array(sampledPixelCount * 4);
        let outIndex = 0;

        for (let pixel = 0; pixel < pixelCount; pixel += gifPalettePixelStride) {
            const sourceIndex = pixel * 4;
            sampled[outIndex++] = rgba[sourceIndex];
            sampled[outIndex++] = rgba[sourceIndex + 1];
            sampled[outIndex++] = rgba[sourceIndex + 2];
            sampled[outIndex++] = rgba[sourceIndex + 3];
        }

        return sampled;
    }

    private _frameTimestamps(videoDurationSeconds: number) {
        const maxVideoDurationMs = Number.isFinite(videoDurationSeconds)
            ? Math.max(0, videoDurationSeconds * 1000)
            : this._startTimestamp + this._durationMs;
        const start = clamp(this._startTimestamp, 0, maxVideoDurationMs);
        const end = clamp(start + this._durationMs, start, maxVideoDurationMs);
        const durationMs = Math.max(0, end - start);
        const frameCount = Math.max(1, Math.min(maxGifFrames, Math.floor((durationMs / 1000) * gifFps) + 1));

        if (frameCount === 1) {
            return [start];
        }

        const step = durationMs / (frameCount - 1);
        const timestamps: number[] = [];

        for (let i = 0; i < frameCount; ++i) {
            timestamps.push(start + step * i);
        }

        return timestamps;
    }

    private _dimensions(video: HTMLVideoElement) {
        const effectiveMaxWidth = this._maxWidth > 0 ? this._maxWidth : this._maxHeight > 0 ? 0 : defaultGifMaxWidth;
        const widthRatio = effectiveMaxWidth <= 0 ? 1 : effectiveMaxWidth / video.videoWidth;
        const heightRatio = this._maxHeight <= 0 ? 1 : this._maxHeight / video.videoHeight;
        const ratio = Math.min(1, Math.min(widthRatio, heightRatio));
        return {
            width: Math.max(1, Math.floor(video.videoWidth * ratio)),
            height: Math.max(1, Math.floor(video.videoHeight * ratio)),
        };
    }

    private async _seekVideo(video: HTMLVideoElement, timestamp: number) {
        return await new Promise<void>((resolve, reject) => {
            const maxTimestamp = Number.isFinite(video.duration) ? video.duration : timestamp;
            const seekTo = clamp(timestamp, 0, maxTimestamp);
            const resolveWithCleanup = () => {
                video.onseeked = null;
                video.onerror = null;
                resolve();
            };

            video.onseeked = resolveWithCleanup;
            video.onerror = () => reject(video.error?.message ?? 'Could not seek video to create GIF');

            if (Math.abs(video.currentTime - seekTo) <= 0.001) {
                resolveWithCleanup();
                return;
            }

            video.currentTime = seekTo;
        });
    }

    private async _videoElement(file: FileModel): Promise<HTMLVideoElement> {
        if (this._video) {
            return this._video;
        }

        return await new Promise((resolve) => {
            const video = document.createElement('video');
            video.src = file.blobUrl;
            video.preload = 'auto';
            video.autoplay = false;
            video.volume = 0;
            video.controls = false;
            video.pause();
            const t0 = Date.now();
            const interval = setInterval(() => {
                if (
                    (video.seekable.length > 0 && video.seekable.end(0) === video.duration) ||
                    Date.now() - t0 >= 5_000
                ) {
                    this._video = video;
                    clearInterval(interval);
                    resolve(video);
                }
            }, 100);
        });
    }

    dispose() {
        this._blobPromiseReject?.(new CancelledImageDataRenderingError());

        if (!this._video) {
            return;
        }

        this._video.removeAttribute('src');
        this._video.load();
        this._video.remove();
        this._video = undefined;
        this._canvas?.remove();
    }
}

interface ImageData {
    name: string;
    extension: string;
    timestamp: number;
    base64: () => Promise<string>;
    dataUrl: () => Promise<string>;
    blob: () => Promise<Blob>;
    atTimestamp: (timestamp: number) => ImageData;
    canChangeTimestamp: boolean;
    error?: ImageErrorCode;
    dispose: () => void;
}

export default class Image {
    private readonly data: ImageData;

    constructor(data: ImageData) {
        this.data = data;
    }

    static fromCard(card: CardModel, maxWidth: number, maxHeight: number, preferGif = false) {
        if (card.image) {
            return Image.fromBase64(
                card.subtitleFileName,
                card.subtitle.start,
                card.image.base64,
                card.image.extension,
                card.image.error
            );
        }

        if (card.file) {
            if (preferGif) {
                const { startTimestamp, endTimestamp } = trimmedGifInterval(card.subtitle.start, card.subtitle.end);
                return Image.fromGifFile(card.file, startTimestamp, endTimestamp, maxWidth, maxHeight);
            }

            return Image.fromFile(card.file, card.mediaTimestamp ?? card.subtitle.start, maxWidth, maxHeight);
        }

        return undefined;
    }

    static fromBase64(
        subtitleFileName: string,
        timestamp: number,
        base64: string,
        extension: string,
        error: ImageErrorCode | undefined
    ) {
        const prefix = subtitleFileName.substring(0, subtitleFileName.lastIndexOf('.'));
        const imageName = `${makeFileName(prefix, timestamp)}.${extension}`;
        return new Image(new Base64ImageData(imageName, timestamp, base64, extension, error));
    }

    static fromFile(file: FileModel, timestamp: number, maxWidth: number, maxHeight: number) {
        return new Image(new FileImageData(file, timestamp, maxWidth, maxHeight));
    }

    static fromGifFile(
        file: FileModel,
        startTimestamp: number,
        endTimestamp: number,
        maxWidth: number,
        maxHeight: number
    ) {
        return new Image(new GifFileImageData(file, startTimestamp, endTimestamp, maxWidth, maxHeight));
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
        return new Image(this.data.atTimestamp(timestamp));
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
