import { resizeCanvas } from './image-transformer';
import { CardModel, FileModel, ImageErrorCode } from './model';
import { download } from '../util/util';
import { isActiveBlobUrl } from '../blob-url';
import type { EncodeGifInWorkerMessage, GifEncoderResponseMessage } from './gif-encoder-message';

const MAX_PREFIX_LENGTH = 24;
const DEFAULT_GIF_DURATION_MS = 1500;
const DEFAULT_GIF_MAX_WIDTH = 480;
const VIDEO_READY_TIMEOUT_MS = 5_000;
const VIDEO_SEEK_EPSILON_SECONDS = 0.001;
const GIF_FRAME_YIELD_INTERVAL = 2;
const MIN_GIF_FRAME_DELAY_MS = 20;

const GIF_OPTION_LIMITS = {
    minDurationMs: 300,
    maxDurationMs: 2500,
    minFps: 1,
    maxFps: 60,
    minFrames: 1,
    maxFrames: 300,
    minTrimMs: 0,
    maxTrimMs: 3_000,
} as const;

const GIF_PALETTE_OPTIONS = {
    size: 256,
    format: 'rgb444',
    keyframeCount: 5,
    pixelStride: 4,
} as const;
const GIF_LOW_MOTION_MAX_SAMPLED_PIXELS = 12_000;
const GIF_LOW_MOTION_PER_PIXEL_COLOR_DIFF_THRESHOLD = 18;
const GIF_LOW_MOTION_MAX_CHANGED_PIXEL_RATIO = 0.01;
const GIF_LOW_MOTION_MAX_MEAN_CHANNEL_DIFF = 2;

type GifWorkerSuccessCommand = 'encoded';
type GifEncoderWorkerFactory = () => Worker | Promise<Worker>;

export interface GifOptions {
    fps: number;
    maxFrames: number;
    startTrimMs: number;
    endTrimMs: number;
}

const DEFAULT_GIF_OPTIONS: GifOptions = {
    fps: 12,
    maxFrames: 60,
    startTrimMs: 150,
    endTrimMs: 150,
};

const makeFileName = (prefix: string, timestamp: number) => {
    return `${prefix.replaceAll(' ', '_').substring(0, Math.min(prefix.length, MAX_PREFIX_LENGTH))}_${Math.floor(
        timestamp
    )}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const normalizeRoundedNumber = (value: number | undefined, fallback: number, min: number, max: number) => {
    const resolvedValue = typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
    return clamp(resolvedValue, min, max);
};

const normalizeGifOptions = (gifOptions?: Partial<GifOptions>): GifOptions => {
    return {
        fps: normalizeRoundedNumber(
            gifOptions?.fps,
            DEFAULT_GIF_OPTIONS.fps,
            GIF_OPTION_LIMITS.minFps,
            GIF_OPTION_LIMITS.maxFps
        ),
        maxFrames: normalizeRoundedNumber(
            gifOptions?.maxFrames,
            DEFAULT_GIF_OPTIONS.maxFrames,
            GIF_OPTION_LIMITS.minFrames,
            GIF_OPTION_LIMITS.maxFrames
        ),
        startTrimMs: normalizeRoundedNumber(
            gifOptions?.startTrimMs,
            DEFAULT_GIF_OPTIONS.startTrimMs,
            GIF_OPTION_LIMITS.minTrimMs,
            GIF_OPTION_LIMITS.maxTrimMs
        ),
        endTrimMs: normalizeRoundedNumber(
            gifOptions?.endTrimMs,
            DEFAULT_GIF_OPTIONS.endTrimMs,
            GIF_OPTION_LIMITS.minTrimMs,
            GIF_OPTION_LIMITS.maxTrimMs
        ),
    };
};

const durationFromInterval = (startTimestamp: number, endTimestamp: number) => {
    const duration = Math.abs(endTimestamp - startTimestamp);
    const resolvedDuration = duration > 0 ? duration : DEFAULT_GIF_DURATION_MS;
    return clamp(resolvedDuration, GIF_OPTION_LIMITS.minDurationMs, GIF_OPTION_LIMITS.maxDurationMs);
};

const trimmedGifInterval = (startTimestamp: number, endTimestamp: number, gifOptions: GifOptions) => {
    const trimmedStartTimestamp = startTimestamp + gifOptions.startTrimMs;
    const trimmedEndTimestamp = endTimestamp - gifOptions.endTrimMs;

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

const imageErrorForFile = (file: FileModel): ImageErrorCode | undefined => {
    if (file.blobUrl) {
        return isActiveBlobUrl(file.blobUrl) ? undefined : ImageErrorCode.fileLinkLost;
    }

    return undefined;
};

const createVideoElement = async (blobUrl: string): Promise<HTMLVideoElement> =>
    await new Promise((resolve, reject) => {
        const video = document.createElement('video');
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                cleanup();
                resolve(video);
            }
        }, VIDEO_READY_TIMEOUT_MS);
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
                reject(video.error?.message ?? 'Could not initialize video for image capture');
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

const disposeVideoElement = (video: HTMLVideoElement | undefined) => {
    if (!video) {
        return;
    }

    video.removeAttribute('src');
    video.load();
    video.remove();
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

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
        return imageErrorForFile(this._file);
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
        if (!this._video) {
            this._video = await createVideoElement(file.blobUrl);
        }

        return this._video;
    }

    dispose() {
        disposeVideoElement(this._video);
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
    private readonly _baseName: string;
    private readonly _workerFactory: GifEncoderWorkerFactory;
    private readonly _gifOptions: GifOptions;
    private _video?: HTMLVideoElement;
    private _canvas?: HTMLCanvasElement;
    private _blobPromise?: Promise<Blob>;
    private _blobPromiseReject?: (error: Error) => void;
    private _cachedBlob?: Blob;
    private _cachedDataUrl?: string;
    private _outputExtension: 'gif' | 'jpeg' = 'gif';
    private _motionCollectionBudgetOverrideMs?: number;

    constructor(
        file: FileModel,
        startTimestamp: number,
        endTimestamp: number,
        maxWidth: number,
        maxHeight: number,
        video: HTMLVideoElement | undefined,
        canvas: HTMLCanvasElement | undefined,
        workerFactory: GifEncoderWorkerFactory,
        gifOptions: GifOptions
    ) {
        this._file = file;
        this._startTimestamp = Math.max(0, startTimestamp);
        this._durationMs = durationFromInterval(startTimestamp, endTimestamp);
        this._maxWidth = maxWidth;
        this._maxHeight = maxHeight;
        this._baseName = makeFileName(file.name, this._startTimestamp);
        this._workerFactory = workerFactory;
        this._gifOptions = gifOptions;
        this._video = video;
        this._canvas = canvas;
    }

    get name() {
        return `${this._baseName}.${this._outputExtension}`;
    }

    get timestamp() {
        return this._startTimestamp;
    }

    get extension() {
        return this._outputExtension;
    }

    get error(): ImageErrorCode | undefined {
        return imageErrorForFile(this._file);
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
            this._canvas,
            this._workerFactory,
            this._gifOptions
        );
    }

    get canChangeTimestamp() {
        return true;
    }

    setMotionCollectionBudgetMs(motionCollectionBudgetMs: number | undefined) {
        this._motionCollectionBudgetOverrideMs =
            typeof motionCollectionBudgetMs === 'number' && Number.isFinite(motionCollectionBudgetMs)
                ? Math.max(0, Math.round(motionCollectionBudgetMs))
                : undefined;
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
        const { width, height } = this._dimensions(video, true);
        const frameTimestamps = this._frameTimestamps(video.duration);

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

        const lowMotionJpegBlob = await this._renderLowMotionJpegIfPossible(
            video,
            ctx,
            width,
            height,
            frameTimestamps
        );
        if (lowMotionJpegBlob) {
            return lowMotionJpegBlob;
        }

        this._outputExtension = 'gif';
        const frameBuffers = await this._collectFrameBuffers(video, ctx, width, height, frameTimestamps);

        if (frameBuffers.length === 0) {
            throw new Error('Could not capture GIF frames');
        }

        const worker = await this._worker();

        try {
            const encodedBytes = await this._encodeGifInWorker(worker, {
                command: 'encode',
                width,
                height,
                frameDelayMs: this._frameDelayMs(frameBuffers.length),
                frameBuffers,
                paletteFrameIndexes: this._paletteFrameIndexes(frameBuffers.length),
                paletteSize: GIF_PALETTE_OPTIONS.size,
                paletteFormat: GIF_PALETTE_OPTIONS.format,
                palettePixelStride: GIF_PALETTE_OPTIONS.pixelStride,
            });
            return new Blob([encodedBytes], { type: 'image/gif' });
        } finally {
            worker.terminate();
        }
    }

    private async _renderLowMotionJpegIfPossible(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameTimestamps: number[]
    ) {
        const { shouldUseJpeg, firstFrameBuffer } = await this._shouldUseStandardJpegFromProbe(
            video,
            ctx,
            width,
            height,
            frameTimestamps
        );
        if (!shouldUseJpeg) {
            return undefined;
        }

        const { width: jpegWidth, height: jpegHeight } = this._dimensions(video, false);
        this._outputExtension = 'jpeg';

        if (firstFrameBuffer && jpegWidth === width && jpegHeight === height) {
            return await this._jpegBlobFromFrameBuffer(firstFrameBuffer, ctx, width, height);
        }

        return await this._jpegBlobFromVideo(
            video,
            ctx,
            frameTimestamps[0] ?? this._startTimestamp,
            jpegWidth,
            jpegHeight
        );
    }

    private _shouldUseStandardJpeg(frameBuffers: ArrayBuffer[]) {
        if (frameBuffers.length <= 1) {
            return true;
        }

        const firstFrame = new Uint8ClampedArray(frameBuffers[0]);
        const lastFrame = new Uint8ClampedArray(frameBuffers[frameBuffers.length - 1]);
        const channelCount = Math.min(firstFrame.length, lastFrame.length);
        const pixelCount = Math.floor(channelCount / 4);

        if (pixelCount <= 0) {
            return true;
        }

        const sampleStride = Math.max(1, Math.floor(pixelCount / GIF_LOW_MOTION_MAX_SAMPLED_PIXELS));
        let sampledPixelCount = 0;
        let changedPixelCount = 0;
        let totalColorDiff = 0;

        for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += sampleStride) {
            const offset = pixelIndex * 4;
            const diffR = Math.abs(firstFrame[offset] - lastFrame[offset]);
            const diffG = Math.abs(firstFrame[offset + 1] - lastFrame[offset + 1]);
            const diffB = Math.abs(firstFrame[offset + 2] - lastFrame[offset + 2]);
            const colorDiff = diffR + diffG + diffB;

            totalColorDiff += colorDiff;
            sampledPixelCount++;

            if (colorDiff >= GIF_LOW_MOTION_PER_PIXEL_COLOR_DIFF_THRESHOLD) {
                changedPixelCount++;
            }
        }

        if (sampledPixelCount === 0) {
            return true;
        }

        const changedPixelRatio = changedPixelCount / sampledPixelCount;
        const meanChannelDiff = totalColorDiff / (sampledPixelCount * 3);
        return (
            changedPixelRatio <= GIF_LOW_MOTION_MAX_CHANGED_PIXEL_RATIO &&
            meanChannelDiff <= GIF_LOW_MOTION_MAX_MEAN_CHANNEL_DIFF
        );
    }

    private async _shouldUseStandardJpegFromProbe(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameTimestamps: number[]
    ): Promise<{ shouldUseJpeg: boolean; firstFrameBuffer?: ArrayBuffer }> {
        if (frameTimestamps.length === 0) {
            return { shouldUseJpeg: true };
        }

        const firstTimestampMs = frameTimestamps[0];
        const lastTimestampMs = frameTimestamps[frameTimestamps.length - 1];

        try {
            const firstFrameBuffer = await this._captureFrameBuffer(video, ctx, width, height, firstTimestampMs);
            if (Math.abs(lastTimestampMs - firstTimestampMs) < 1) {
                return { shouldUseJpeg: true, firstFrameBuffer };
            }

            const lastFrameBuffer = await this._captureFrameBuffer(video, ctx, width, height, lastTimestampMs);
            return {
                shouldUseJpeg: this._shouldUseStandardJpeg([firstFrameBuffer, lastFrameBuffer]),
                firstFrameBuffer,
            };
        } catch {
            return { shouldUseJpeg: false };
        }
    }

    private async _collectFrameBuffers(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameTimestamps: number[]
    ) {
        const frameBuffers: ArrayBuffer[] = [];
        const startedAtMs = now();

        for (let i = 0; i < frameTimestamps.length; ++i) {
            if (
                this._motionCollectionBudgetOverrideMs !== undefined &&
                i > 0 &&
                now() - startedAtMs >= this._motionCollectionBudgetOverrideMs
            ) {
                break;
            }

            if (i > 0 && i % GIF_FRAME_YIELD_INTERVAL === 0) {
                await yieldToEventLoop();
            }

            frameBuffers.push(await this._captureFrameBuffer(video, ctx, width, height, frameTimestamps[i]));
        }

        if (frameBuffers.length === 0 && frameTimestamps.length > 0) {
            frameBuffers.push(await this._captureFrameBuffer(video, ctx, width, height, frameTimestamps[0]));
        }

        return frameBuffers;
    }

    private async _captureFrameBuffer(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        timestampMs: number
    ) {
        if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
            ctx.canvas.width = width;
            ctx.canvas.height = height;
        }

        await this._seekVideo(video, timestampMs / 1000);
        ctx.drawImage(video, 0, 0, width, height);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        const copy = new Uint8Array(rgba.length);
        copy.set(rgba);
        return copy.buffer;
    }

    private async _jpegBlobFromFrameBuffer(
        frameBuffer: ArrayBuffer,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number
    ) {
        const rgba = new Uint8ClampedArray(frameBuffer);
        const expectedLength = width * height * 4;
        if (rgba.length < expectedLength) {
            throw new Error('Could not encode JPEG from GIF frame: insufficient frame buffer data');
        }

        const imageData = ctx.createImageData(width, height);
        imageData.data.set(rgba.subarray(0, expectedLength));
        ctx.putImageData(imageData, 0, 0);
        return await this._jpegBlobFromCanvas(ctx.canvas);
    }

    private async _jpegBlobFromVideo(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        timestampMs: number,
        width: number,
        height: number
    ) {
        await this._seekVideo(video, timestampMs / 1000);
        const canvas = ctx.canvas;
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(video, 0, 0, width, height);
        return await this._jpegBlobFromCanvas(canvas);
    }

    private async _jpegBlobFromCanvas(canvas: HTMLCanvasElement) {
        return await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob((blob) => {
                if (!blob) {
                    reject(new Error('Could not encode JPEG from GIF frame'));
                    return;
                }

                resolve(blob);
            }, 'image/jpeg');
        });
    }

    private _frameDelayMs(frameCount: number) {
        const delayMs = Math.max(MIN_GIF_FRAME_DELAY_MS, Math.round(this._durationMs / Math.max(1, frameCount)));
        return Array.from({ length: frameCount }, () => delayMs);
    }

    private _paletteFrameIndexes(frameCount: number) {
        const targetFrameCount = Math.max(1, Math.min(GIF_PALETTE_OPTIONS.keyframeCount, frameCount));

        if (targetFrameCount === frameCount) {
            return [...Array(frameCount).keys()];
        }

        if (targetFrameCount === 1) {
            return [0];
        }

        const indexes: number[] = [];
        for (let i = 0; i < targetFrameCount; ++i) {
            const index = Math.round((i * (frameCount - 1)) / (targetFrameCount - 1));

            if (indexes[indexes.length - 1] !== index) {
                indexes.push(index);
            }
        }

        return indexes;
    }

    private async _encodeGifInWorker(worker: Worker, message: EncodeGifInWorkerMessage) {
        return await this._encodeInWorker(worker, message, 'encoded', 'Failed to encode GIF', message.frameBuffers);
    }

    private async _encodeInWorker(
        worker: Worker,
        message: EncodeGifInWorkerMessage,
        expectedCommand: GifWorkerSuccessCommand,
        fallbackErrorMessage: string,
        transfer: Transferable[]
    ) {
        return await new Promise<Uint8Array>((resolve, reject) => {
            const handleError = (error: Error) => {
                worker.onmessage = null;
                worker.onerror = null;
                reject(error);
            };

            worker.onmessage = (event: MessageEvent<GifEncoderResponseMessage>) => {
                const data = event.data;

                if (data.command === expectedCommand) {
                    worker.onmessage = null;
                    worker.onerror = null;
                    resolve(new Uint8Array(data.buffer));
                    return;
                }

                if (data.command === 'error') {
                    handleError(new Error(data.error));
                    return;
                }

                handleError(new Error('Unexpected worker response'));
            };
            worker.onerror = (event) => {
                handleError(event.error ?? new Error(event.message ?? fallbackErrorMessage));
            };

            worker.postMessage(message, transfer);
        });
    }

    private async _worker() {
        const workerFactoryResult = this._workerFactory();
        return workerFactoryResult instanceof Worker ? workerFactoryResult : await workerFactoryResult;
    }

    private _frameTimestamps(videoDurationSeconds: number) {
        const maxVideoDurationMs = Number.isFinite(videoDurationSeconds)
            ? Math.max(0, videoDurationSeconds * 1000)
            : this._startTimestamp + this._durationMs;
        const start = clamp(this._startTimestamp, 0, maxVideoDurationMs);
        const end = clamp(start + this._durationMs, start, maxVideoDurationMs);
        const durationMs = Math.max(0, end - start);
        const frameCount = Math.max(
            1,
            Math.min(this._gifOptions.maxFrames, Math.floor((durationMs / 1000) * this._gifOptions.fps) + 1)
        );

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

    private _dimensions(video: HTMLVideoElement, applyDefaultGifMaxWidth = true) {
        const effectiveMaxWidth =
            this._maxWidth > 0
                ? this._maxWidth
                : this._maxHeight > 0
                  ? 0
                  : applyDefaultGifMaxWidth
                    ? DEFAULT_GIF_MAX_WIDTH
                    : 0;
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

            if (Math.abs(video.currentTime - seekTo) <= VIDEO_SEEK_EPSILON_SECONDS) {
                resolveWithCleanup();
                return;
            }

            video.currentTime = seekTo;
        });
    }

    private async _videoElement(file: FileModel): Promise<HTMLVideoElement> {
        if (!this._video) {
            this._video = await createVideoElement(file.blobUrl);
        }

        return this._video;
    }

    dispose() {
        this._blobPromiseReject?.(new CancelledImageDataRenderingError());

        disposeVideoElement(this._video);
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

    static fromCard(card: CardModel, maxWidth: number, maxHeight: number): Image | undefined;
    static fromCard(
        card: CardModel,
        maxWidth: number,
        maxHeight: number,
        preferGif: false,
        gifWorkerFactory?: GifEncoderWorkerFactory,
        gifOptions?: Partial<GifOptions>
    ): Image | undefined;
    static fromCard(
        card: CardModel,
        maxWidth: number,
        maxHeight: number,
        preferGif: true,
        gifWorkerFactory: GifEncoderWorkerFactory,
        gifOptions?: Partial<GifOptions>
    ): Image | undefined;
    static fromCard(
        card: CardModel,
        maxWidth: number,
        maxHeight: number,
        preferGif: boolean,
        gifWorkerFactory: GifEncoderWorkerFactory,
        gifOptions?: Partial<GifOptions>
    ): Image | undefined;
    static fromCard(
        card: CardModel,
        maxWidth: number,
        maxHeight: number,
        preferGif = false,
        gifWorkerFactory?: GifEncoderWorkerFactory,
        gifOptions?: Partial<GifOptions>
    ) {
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
                if (!gifWorkerFactory) {
                    throw new Error('GIF worker factory is required when preferGif is true');
                }

                const resolvedGifOptions = normalizeGifOptions(gifOptions);
                const { startTimestamp, endTimestamp } = trimmedGifInterval(
                    card.subtitle.start,
                    card.subtitle.end,
                    resolvedGifOptions
                );
                return Image._fromGifFileWithOptions(
                    card.file,
                    startTimestamp,
                    endTimestamp,
                    maxWidth,
                    maxHeight,
                    gifWorkerFactory,
                    resolvedGifOptions
                );
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
        maxHeight: number,
        gifWorkerFactory: GifEncoderWorkerFactory,
        gifOptions?: Partial<GifOptions>
    ) {
        const resolvedGifOptions = normalizeGifOptions(gifOptions);
        return Image._fromGifFileWithOptions(
            file,
            startTimestamp,
            endTimestamp,
            maxWidth,
            maxHeight,
            gifWorkerFactory,
            resolvedGifOptions
        );
    }

    private static _fromGifFileWithOptions(
        file: FileModel,
        startTimestamp: number,
        endTimestamp: number,
        maxWidth: number,
        maxHeight: number,
        gifWorkerFactory: GifEncoderWorkerFactory,
        gifOptions: GifOptions
    ) {
        return new Image(
            new GifFileImageData(
                file,
                startTimestamp,
                endTimestamp,
                maxWidth,
                maxHeight,
                undefined,
                undefined,
                gifWorkerFactory,
                gifOptions
            )
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

    setGifMotionCollectionBudgetMs(motionCollectionBudgetMs: number | undefined) {
        if (this.data instanceof GifFileImageData) {
            this.data.setMotionCollectionBudgetMs(motionCollectionBudgetMs);
        }
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
