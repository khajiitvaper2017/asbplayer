import { resizeCanvas } from './image-transformer';
import { CardModel, FileModel, ImageErrorCode } from './model';
import { download } from '../util/util';
import { isActiveBlobUrl } from '../blob-url';
import type {
    ApplyPaletteInWorkerMessage,
    EncodeGifInWorkerMessage,
    EncodeIndexedGifInWorkerMessage,
    GifEncoderResponseMessage,
    QuantizePaletteInWorkerMessage,
} from './gif-encoder-message';

const MAX_PREFIX_LENGTH = 24;

const DEFAULT_GIF_DURATION_MS = 1500;
const DEFAULT_GIF_MAX_WIDTH = 480;

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

const VIDEO_READY_TIMEOUT_MS = 5_000;
const GIF_FRAME_YIELD_INTERVAL = 2;
const MIN_GIF_FRAME_DELAY_MS = 20;
const VIDEO_SEEK_EPSILON_SECONDS = 0.001;
const SOURCE_FPS_FALLBACK = 24;
const SOURCE_FPS_SAMPLE_FRAME_COUNT = 12;
const SOURCE_FPS_SAMPLE_TIMEOUT_MS = 1_200;
const SOURCE_FPS_MIN = 1;
const SOURCE_FPS_MAX = 240;
const GIF_PLAYBACK_COLLECTION_FORMULA_OFFSET_RATE = 1.25;
const GIF_PLAYBACK_COLLECTION_FORMULA_SCALE = 1.5;
const GIF_PLAYBACK_COLLECTION_MIN_RATE = 1;
const GIF_PLAYBACK_COLLECTION_MAX_RATE = 2;
const GIF_PLAYBACK_COLLECTION_RATE_STEP = 0.25;
const GIF_FRAME_COLLECTION_DETAIL_LOG_THRESHOLD_MS = 2_000;
const GIF_FRAME_CAPTURE_SLOW_THRESHOLD_MS = 150;
const GIF_FRAME_COLLECTION_MAX_SLOW_FRAMES_LOGGED = 5;
const GIF_APPLY_PALETTE_POOL_MIN_FRAMES = 12;
const GIF_APPLY_PALETTE_POOL_MIN_WORKERS = 2;
const GIF_APPLY_PALETTE_POOL_MAX_WORKERS = 4;
const GIF_LOW_MOTION_MAX_SAMPLED_PIXELS = 12_000;
const GIF_LOW_MOTION_PER_PIXEL_COLOR_DIFF_THRESHOLD = 18;
const GIF_LOW_MOTION_MAX_CHANGED_PIXEL_RATIO = 0.01;
const GIF_LOW_MOTION_MAX_MEAN_CHANNEL_DIFF = 2;
const IMAGE_TIMING_LOG_THRESHOLD_MS = 2_000;
type TimingDetails = string | (() => string);
type GifWorkerSuccessCommand = 'encoded';
type GifPalette = number[][];
const sourceFpsByVideo = new WeakMap<HTMLVideoElement, number>();

type GifEncoderWorkerFactory = () => Worker | Promise<Worker>;

interface CollectedGifFrames {
    frameBuffers: ArrayBuffer[];
    frameDelayMs: number[];
    budgetMs?: number;
    truncatedByBudget?: boolean;
}

interface CollectedGifFrameTiming {
    buffer: ArrayBuffer;
    seekElapsedMs: number;
    readElapsedMs: number;
    totalElapsedMs: number;
    fromTimestampMs: number;
    toTimestampMs: number;
}

interface GifRenderStats {
    sourceFrameCount: number;
    outputFrameCount: number;
    effectiveFps: number;
    outputWidth: number;
    outputHeight: number;
    outputExtension: 'gif' | 'jpeg';
    budgetMs?: number;
    truncatedByBudget?: boolean;
}

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

const isFinitePositiveNumber = (value: number | undefined) =>
    typeof value === 'number' && Number.isFinite(value) && value > 0;

const roundedPlaybackRate = (playbackRate: number) => {
    const rounded = Math.round(playbackRate / GIF_PLAYBACK_COLLECTION_RATE_STEP) * GIF_PLAYBACK_COLLECTION_RATE_STEP;
    return Math.round(rounded * 100) / 100;
};

const playbackRateFromFps = (videoFps: number, targetFps: number) => {
    const resolvedTargetFps = isFinitePositiveNumber(targetFps) ? targetFps : 1;
    const resolvedVideoFps = isFinitePositiveNumber(videoFps) ? videoFps : resolvedTargetFps;
    const minFps = Math.min(resolvedTargetFps, resolvedVideoFps);
    const candidateRate = Math.min(
        GIF_PLAYBACK_COLLECTION_MAX_RATE,
        GIF_PLAYBACK_COLLECTION_FORMULA_OFFSET_RATE +
            GIF_PLAYBACK_COLLECTION_FORMULA_SCALE * (1 - minFps / resolvedVideoFps)
    );
    return clamp(
        roundedPlaybackRate(candidateRate),
        GIF_PLAYBACK_COLLECTION_MIN_RATE,
        GIF_PLAYBACK_COLLECTION_MAX_RATE
    );
};

const median = (values: number[]) => {
    if (values.length === 0) {
        return undefined;
    }

    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);

    if (sorted.length % 2 === 0) {
        return (sorted[middle - 1] + sorted[middle]) / 2;
    }

    return sorted[middle];
};

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const uniformFrameDelayMs = (frameCount: number, delayMs: number) => Array.from({ length: frameCount }, () => delayMs);

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

const logImageGenerationTime = (extension: string, startedAtMs: number, details?: TimingDetails) => {
    const elapsedMs = Math.round(now() - startedAtMs);
    if (elapsedMs < IMAGE_TIMING_LOG_THRESHOLD_MS) {
        return;
    }

    const resolvedDetails = typeof details === 'function' ? details() : details;
    const suffix = resolvedDetails ? ` ${resolvedDetails}` : '';
    console.debug(`[Image] created ${extension} in ${elapsedMs}ms${suffix}`);
};

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
        const startedAtMs = now();
        return new Promise((resolve, reject) => {
            this._getCanvas()
                .then((canvas) => {
                    canvas.toBlob((blob) => {
                        if (blob === null) {
                            reject(new Error('Could not obtain blob'));
                        } else {
                            logImageGenerationTime(
                                this.extension,
                                startedAtMs,
                                () => `settings={maxWidth:${this._maxWidth},maxHeight:${this._maxHeight}}`
                            );
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
    private _video?: HTMLVideoElement;
    private _canvas?: HTMLCanvasElement;
    private _blobPromise?: Promise<Blob>;
    private _blobPromiseReject?: (error: Error) => void;
    private _cachedBlob?: Blob;
    private _cachedDataUrl?: string;
    private readonly _workerFactory: GifEncoderWorkerFactory;
    private readonly _gifOptions: GifOptions;
    private _outputExtension: 'gif' | 'jpeg' = 'gif';
    private _lastRenderStats?: GifRenderStats;
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
        this._video = video;
        this._canvas = canvas;
        this._workerFactory = workerFactory;
        this._gifOptions = gifOptions;
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
            const startedAtMs = now();

            try {
                const blob = await this._renderGif();
                this._blobPromiseReject = undefined;
                this._cachedBlob = blob;
                logImageGenerationTime(
                    this.extension,
                    startedAtMs,
                    () => `${this._timingSettingsSummary()} ${this._timingRenderSummary()}`
                );
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
        const baseFrameDelayMs =
            frameTimestamps.length <= 1
                ? this._durationMs
                : Math.max(MIN_GIF_FRAME_DELAY_MS, Math.round(this._durationMs / (frameTimestamps.length - 1)));

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

        return await this._renderGifInWorker(video, ctx, width, height, frameTimestamps, baseFrameDelayMs);
    }

    private async _renderGifInWorker(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameTimestamps: number[],
        baseFrameDelayMs: number
    ) {
        const collectFramesStartedAtMs = now();
        const { frameBuffers, frameDelayMs, budgetMs, truncatedByBudget } = await this._collectFrames(
            video,
            ctx,
            width,
            height,
            frameTimestamps,
            baseFrameDelayMs
        );
        const collectFramesElapsedMs = Math.round(now() - collectFramesStartedAtMs);

        this._outputExtension = 'gif';
        this._lastRenderStats = {
            sourceFrameCount: frameTimestamps.length,
            outputFrameCount: frameBuffers.length,
            effectiveFps: Math.round((1000 / Math.max(1, baseFrameDelayMs)) * 10) / 10,
            outputWidth: width,
            outputHeight: height,
            outputExtension: 'gif',
            budgetMs,
            truncatedByBudget,
        };

        if (this._shouldUseStandardJpeg(frameBuffers)) {
            const { width: jpegWidth, height: jpegHeight } = this._dimensions(video, false);
            this._outputExtension = 'jpeg';
            this._lastRenderStats = {
                ...this._lastRenderStats,
                outputFrameCount: 1,
                outputWidth: jpegWidth,
                outputHeight: jpegHeight,
                outputExtension: 'jpeg',
            };

            if (jpegWidth === width && jpegHeight === height) {
                return await this._jpegBlobFromFrameBuffer(frameBuffers[0], ctx, width, height);
            }

            return await this._jpegBlobFromVideo(
                video,
                ctx,
                frameTimestamps[0] ?? this._startTimestamp,
                jpegWidth,
                jpegHeight
            );
        }

        const paletteFrameIndexes = this._paletteFrameIndexes(frameBuffers.length);
        const applyPaletteWorkerCount = this._applyPaletteWorkerCount(frameBuffers.length);

        const encodeStartedAtMs = now();
        if (applyPaletteWorkerCount === 1) {
            const worker = await this._worker();

            try {
                const encodedBytes = await this._encodeGifInWorker(worker, {
                    command: 'encode',
                    width,
                    height,
                    frameDelayMs,
                    frameBuffers,
                    paletteFrameIndexes,
                    paletteSize: GIF_PALETTE_OPTIONS.size,
                    paletteFormat: GIF_PALETTE_OPTIONS.format,
                    palettePixelStride: GIF_PALETTE_OPTIONS.pixelStride,
                });
                const encodeElapsedMs = Math.round(now() - encodeStartedAtMs);
                this._logGifPhaseTimings(
                    collectFramesElapsedMs,
                    encodeElapsedMs,
                    applyPaletteWorkerCount,
                    frameBuffers.length
                );
                return new Blob([encodedBytes], { type: 'image/gif' });
            } finally {
                worker.terminate();
            }
        }

        const encodedBytes = await this._encodeGifWithPaletteWorkerPool(
            width,
            height,
            frameDelayMs,
            frameBuffers,
            paletteFrameIndexes,
            applyPaletteWorkerCount
        );
        const encodeElapsedMs = Math.round(now() - encodeStartedAtMs);
        this._logGifPhaseTimings(collectFramesElapsedMs, encodeElapsedMs, applyPaletteWorkerCount, frameBuffers.length);
        return new Blob([encodedBytes], { type: 'image/gif' });
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

    private _logGifPhaseTimings(
        collectFramesElapsedMs: number,
        encodeElapsedMs: number,
        workerCount: number,
        frameCount: number
    ) {
        if (collectFramesElapsedMs < IMAGE_TIMING_LOG_THRESHOLD_MS && encodeElapsedMs < IMAGE_TIMING_LOG_THRESHOLD_MS) {
            return;
        }

        console.debug(
            `[Image] gif phases collectFrames=${collectFramesElapsedMs}ms encode=${encodeElapsedMs}ms workers=${workerCount} frames=${frameCount}`
        );
    }

    private async _collectFrames(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameTimestamps: number[],
        baseFrameDelayMs: number
    ): Promise<CollectedGifFrames> {
        if (frameTimestamps.length === 0) {
            return {
                frameBuffers: [],
                frameDelayMs: [],
            };
        }

        const collectionBudgetMs =
            this._motionCollectionBudgetOverrideMs === undefined
                ? undefined
                : Math.max(MIN_GIF_FRAME_DELAY_MS, Math.round(this._motionCollectionBudgetOverrideMs));
        const playbackFrames = await this._collectFramesWithPlayback(
            video,
            ctx,
            width,
            height,
            frameTimestamps,
            baseFrameDelayMs,
            collectionBudgetMs
        );

        if (playbackFrames) {
            return playbackFrames;
        }

        return await this._collectFramesWithSeeking(
            video,
            ctx,
            width,
            height,
            frameTimestamps,
            baseFrameDelayMs,
            collectionBudgetMs
        );
    }

    private async _collectFramesWithPlayback(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameTimestamps: number[],
        baseFrameDelayMs: number,
        collectionBudgetMs: number | undefined
    ): Promise<CollectedGifFrames | undefined> {
        if (
            collectionBudgetMs !== undefined ||
            frameTimestamps.length <= 1 ||
            typeof video.requestVideoFrameCallback !== 'function'
        ) {
            return undefined;
        }

        const collectionStartedAtMs = now();
        const frameBuffersByIndex = new Array<ArrayBuffer | undefined>(frameTimestamps.length);
        const captureToleranceMs = Math.max(1, Math.floor(baseFrameDelayMs / 2));
        const maxCaptureDriftMs = Math.max(captureToleranceMs, baseFrameDelayMs);
        let totalReadElapsedMs = 0;
        let callbackCount = 0;
        let nextFrameIndex = 0;
        let playbackCapturedCount = 0;
        let fallbackSeekCount = 0;
        let playbackElapsedMs = 0;
        const sourceFps = await this._sourceFps(video, frameTimestamps[0]);

        if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
            ctx.canvas.width = width;
            ctx.canvas.height = height;
        }

        const captureCurrentFrame = () => {
            const readStartedAtMs = now();
            ctx.drawImage(video, 0, 0, width, height);
            const rgba = ctx.getImageData(0, 0, width, height).data;
            totalReadElapsedMs += Math.round(now() - readStartedAtMs);
            return rgba.buffer instanceof ArrayBuffer ? rgba.buffer : new Uint8Array(rgba).buffer;
        };

        const originalPlaybackRate = video.playbackRate;
        const originalMuted = video.muted;
        const originalVolume = video.volume;
        const originalOnError = video.onerror;
        const originalOnEnded = video.onended;
        const videoWithPreservesPitch = video as HTMLVideoElement & { preservesPitch?: boolean };
        const originalPreservesPitch = videoWithPreservesPitch.preservesPitch;

        let callbackHandle: number | undefined;

        try {
            await this._seekVideo(video, frameTimestamps[0] / 1000);

            frameBuffersByIndex[0] = captureCurrentFrame();
            playbackCapturedCount = 1;
            nextFrameIndex = 1;

            if (nextFrameIndex >= frameTimestamps.length) {
                return {
                    frameBuffers: [frameBuffersByIndex[0]!],
                    frameDelayMs: uniformFrameDelayMs(1, baseFrameDelayMs),
                    budgetMs: collectionBudgetMs,
                    truncatedByBudget: false,
                };
            }

            const playbackRate = this._playbackCollectionRate(baseFrameDelayMs, sourceFps);
            const playbackStartedAtMs = now();

            video.muted = true;
            video.volume = 0;
            video.playbackRate = playbackRate;

            if (typeof originalPreservesPitch === 'boolean') {
                videoWithPreservesPitch.preservesPitch = false;
            }

            await video.play();
            await new Promise<void>((resolve, reject) => {
                const finish = () => {
                    if (callbackHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
                        video.cancelVideoFrameCallback(callbackHandle);
                        callbackHandle = undefined;
                    }

                    resolve();
                };

                const fail = (error: Error) => {
                    if (callbackHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
                        video.cancelVideoFrameCallback(callbackHandle);
                        callbackHandle = undefined;
                    }

                    reject(error);
                };

                const onFrame: VideoFrameRequestCallback = (_ts, metadata) => {
                    callbackCount++;

                    try {
                        const mediaTimeMs = metadata.mediaTime * 1000;

                        while (
                            nextFrameIndex < frameTimestamps.length &&
                            frameTimestamps[nextFrameIndex] < mediaTimeMs - maxCaptureDriftMs
                        ) {
                            nextFrameIndex++;
                        }

                        if (nextFrameIndex < frameTimestamps.length) {
                            const targetTimestampMs = frameTimestamps[nextFrameIndex];
                            if (
                                mediaTimeMs >= targetTimestampMs - captureToleranceMs &&
                                mediaTimeMs <= targetTimestampMs + maxCaptureDriftMs
                            ) {
                                frameBuffersByIndex[nextFrameIndex] = captureCurrentFrame();
                                playbackCapturedCount++;
                                nextFrameIndex++;
                            }
                        }

                        if (nextFrameIndex >= frameTimestamps.length) {
                            finish();
                            return;
                        }

                        callbackHandle = video.requestVideoFrameCallback(onFrame);
                    } catch (error) {
                        fail(error instanceof Error ? error : new Error(String(error)));
                    }
                };

                video.onerror = () => fail(new Error(video.error?.message ?? 'Could not play video to capture GIF'));
                video.onended = () => finish();
                callbackHandle = video.requestVideoFrameCallback(onFrame);
            });
            playbackElapsedMs = Math.round(now() - playbackStartedAtMs);

            video.pause();

            for (let i = 0; i < frameTimestamps.length; ++i) {
                if (frameBuffersByIndex[i] === undefined) {
                    frameBuffersByIndex[i] = await this._captureFrameBuffer(
                        video,
                        ctx,
                        width,
                        height,
                        frameTimestamps[i]
                    );
                    fallbackSeekCount++;
                }
            }

            const frameBuffers: ArrayBuffer[] = [];
            for (const frameBuffer of frameBuffersByIndex) {
                if (frameBuffer === undefined) {
                    break;
                }

                frameBuffers.push(frameBuffer);
            }

            const collectionElapsedMs = Math.round(now() - collectionStartedAtMs);
            const fallbackSeekRatio = frameTimestamps.length > 0 ? fallbackSeekCount / frameTimestamps.length : 0;
            if (collectionElapsedMs >= GIF_FRAME_COLLECTION_DETAIL_LOG_THRESHOLD_MS) {
                console.debug(
                    `[Image] collect frames playback total=${collectionElapsedMs}ms captured=${frameBuffers.length}/${frameTimestamps.length} playbackCaptured=${playbackCapturedCount} fallbackSeeks=${fallbackSeekCount} fallbackRatio=${
                        Math.round(fallbackSeekRatio * 1000) / 10
                    }% playback=${playbackElapsedMs}ms callbacks=${callbackCount} read=${totalReadElapsedMs}ms sourceFps=${sourceFps} playbackRate=${playbackRate}`
                );
            }

            return {
                frameBuffers,
                frameDelayMs: uniformFrameDelayMs(frameBuffers.length, baseFrameDelayMs),
                budgetMs: collectionBudgetMs,
                truncatedByBudget: false,
            };
        } catch (error) {
            console.debug(
                `[Image] collect frames playback unavailable falling back to seek error=${
                    error instanceof Error ? error.message : String(error)
                }`
            );
            return undefined;
        } finally {
            if (callbackHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
                video.cancelVideoFrameCallback(callbackHandle);
            }

            video.pause();
            video.playbackRate = originalPlaybackRate;
            video.muted = originalMuted;
            video.volume = originalVolume;
            video.onerror = originalOnError;
            video.onended = originalOnEnded;

            if (typeof originalPreservesPitch === 'boolean') {
                videoWithPreservesPitch.preservesPitch = originalPreservesPitch;
            }
        }
    }

    private async _sourceFps(video: HTMLVideoElement, startTimestampMs: number) {
        const cachedSourceFps = sourceFpsByVideo.get(video);
        if (cachedSourceFps !== undefined) {
            return cachedSourceFps;
        }

        if (typeof video.requestVideoFrameCallback !== 'function') {
            return SOURCE_FPS_FALLBACK;
        }

        const originalPlaybackRate = video.playbackRate;
        const originalMuted = video.muted;
        const originalVolume = video.volume;
        const originalOnError = video.onerror;
        const originalOnEnded = video.onended;
        const videoWithPreservesPitch = video as HTMLVideoElement & { preservesPitch?: boolean };
        const originalPreservesPitch = videoWithPreservesPitch.preservesPitch;
        const sampledMediaTimesMs: number[] = [];
        let callbackHandle: number | undefined;

        try {
            await this._seekVideo(video, startTimestampMs / 1000);
            video.muted = true;
            video.volume = 0;
            video.playbackRate = 1;

            if (typeof originalPreservesPitch === 'boolean') {
                videoWithPreservesPitch.preservesPitch = false;
            }

            await video.play();
            const samplingStartedAtMs = now();
            await new Promise<void>((resolve, reject) => {
                const finish = () => {
                    if (callbackHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
                        video.cancelVideoFrameCallback(callbackHandle);
                        callbackHandle = undefined;
                    }

                    resolve();
                };

                const fail = (error: Error) => {
                    if (callbackHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
                        video.cancelVideoFrameCallback(callbackHandle);
                        callbackHandle = undefined;
                    }

                    reject(error);
                };

                const onFrame: VideoFrameRequestCallback = (_ts, metadata) => {
                    const mediaTimeMs = metadata.mediaTime * 1000;
                    if (
                        sampledMediaTimesMs.length === 0 ||
                        mediaTimeMs > sampledMediaTimesMs[sampledMediaTimesMs.length - 1]
                    ) {
                        sampledMediaTimesMs.push(mediaTimeMs);
                    }

                    if (
                        sampledMediaTimesMs.length >= SOURCE_FPS_SAMPLE_FRAME_COUNT + 1 ||
                        now() - samplingStartedAtMs >= SOURCE_FPS_SAMPLE_TIMEOUT_MS
                    ) {
                        finish();
                        return;
                    }

                    callbackHandle = video.requestVideoFrameCallback(onFrame);
                };

                video.onerror = () =>
                    fail(new Error(video.error?.message ?? 'Could not estimate video FPS from playback'));
                video.onended = () => finish();
                callbackHandle = video.requestVideoFrameCallback(onFrame);
            });
        } catch (error) {
            console.debug(
                `[Image] source fps estimation failed fallback=${SOURCE_FPS_FALLBACK} error=${
                    error instanceof Error ? error.message : String(error)
                }`
            );
        } finally {
            if (callbackHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
                video.cancelVideoFrameCallback(callbackHandle);
            }

            video.pause();
            video.playbackRate = originalPlaybackRate;
            video.muted = originalMuted;
            video.volume = originalVolume;
            video.onerror = originalOnError;
            video.onended = originalOnEnded;

            if (typeof originalPreservesPitch === 'boolean') {
                videoWithPreservesPitch.preservesPitch = originalPreservesPitch;
            }
        }

        const frameDurationsMs: number[] = [];
        for (let i = 1; i < sampledMediaTimesMs.length; ++i) {
            const frameDurationMs = sampledMediaTimesMs[i] - sampledMediaTimesMs[i - 1];
            if (frameDurationMs > 0) {
                frameDurationsMs.push(frameDurationMs);
            }
        }

        const medianFrameDurationMs = median(frameDurationsMs);
        const estimatedSourceFps =
            medianFrameDurationMs === undefined
                ? SOURCE_FPS_FALLBACK
                : clamp(Math.round((1000 / medianFrameDurationMs) * 10) / 10, SOURCE_FPS_MIN, SOURCE_FPS_MAX);
        sourceFpsByVideo.set(video, estimatedSourceFps);
        return estimatedSourceFps;
    }

    private _playbackCollectionRate(baseFrameDelayMs: number, sourceFps: number) {
        const targetFps = 1000 / Math.max(1, baseFrameDelayMs);
        return playbackRateFromFps(sourceFps, targetFps);
    }

    private async _collectFramesWithSeeking(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameTimestamps: number[],
        baseFrameDelayMs: number,
        collectionBudgetMs: number | undefined
    ): Promise<CollectedGifFrames> {
        const collectionStartedAtMs = now();
        const frameBuffers: ArrayBuffer[] = [];
        let totalYieldElapsedMs = 0;
        let totalCaptureElapsedMs = 0;
        let totalSeekElapsedMs = 0;
        let totalReadElapsedMs = 0;
        let maxCaptureElapsedMs = 0;
        const slowFrames: Array<{
            index: number;
            targetTimestampMs: number;
            fromTimestampMs: number;
            toTimestampMs: number;
            seekElapsedMs: number;
            readElapsedMs: number;
            totalElapsedMs: number;
        }> = [];
        let truncatedByBudget = false;

        for (let i = 0; i < frameTimestamps.length; ++i) {
            if (collectionBudgetMs !== undefined && i > 0 && now() - collectionStartedAtMs >= collectionBudgetMs) {
                truncatedByBudget = true;
                break;
            }

            if (i > 0 && i % GIF_FRAME_YIELD_INTERVAL === 0) {
                const yieldStartedAtMs = now();
                await yieldToEventLoop();
                totalYieldElapsedMs += Math.round(now() - yieldStartedAtMs);
            }

            const capturedFrame = await this._captureFrameBufferWithTiming(
                video,
                ctx,
                width,
                height,
                frameTimestamps[i]
            );
            frameBuffers.push(capturedFrame.buffer);
            totalCaptureElapsedMs += capturedFrame.totalElapsedMs;
            totalSeekElapsedMs += capturedFrame.seekElapsedMs;
            totalReadElapsedMs += capturedFrame.readElapsedMs;
            maxCaptureElapsedMs = Math.max(maxCaptureElapsedMs, capturedFrame.totalElapsedMs);

            if (capturedFrame.totalElapsedMs >= GIF_FRAME_CAPTURE_SLOW_THRESHOLD_MS) {
                slowFrames.push({
                    index: i,
                    targetTimestampMs: Math.round(frameTimestamps[i]),
                    fromTimestampMs: capturedFrame.fromTimestampMs,
                    toTimestampMs: capturedFrame.toTimestampMs,
                    seekElapsedMs: capturedFrame.seekElapsedMs,
                    readElapsedMs: capturedFrame.readElapsedMs,
                    totalElapsedMs: capturedFrame.totalElapsedMs,
                });
            }
        }

        const collectionElapsedMs = Math.round(now() - collectionStartedAtMs);
        if (collectionElapsedMs >= GIF_FRAME_COLLECTION_DETAIL_LOG_THRESHOLD_MS) {
            const capturedFrameCount = frameBuffers.length;
            const averageCaptureElapsedMs =
                capturedFrameCount > 0 ? Math.round(totalCaptureElapsedMs / capturedFrameCount) : 0;
            const slowFrameSummary = slowFrames
                .sort((a, b) => b.totalElapsedMs - a.totalElapsedMs)
                .slice(0, GIF_FRAME_COLLECTION_MAX_SLOW_FRAMES_LOGGED)
                .map(
                    (frame) =>
                        `{i:${frame.index},target:${frame.targetTimestampMs},from:${frame.fromTimestampMs},to:${
                            frame.toTimestampMs
                        },seek:${frame.seekElapsedMs},read:${frame.readElapsedMs},total:${frame.totalElapsedMs}}`
                )
                .join(',');
            const slowFrameSuffix = slowFrameSummary.length > 0 ? ` slowFrames=[${slowFrameSummary}]` : '';

            console.debug(
                `[Image] collect frames detail total=${collectionElapsedMs}ms captured=${capturedFrameCount}/${
                    frameTimestamps.length
                } yield=${totalYieldElapsedMs}ms capture=${totalCaptureElapsedMs}ms seek=${totalSeekElapsedMs}ms read=${totalReadElapsedMs}ms avgCapture=${averageCaptureElapsedMs}ms maxCapture=${maxCaptureElapsedMs}ms truncatedByBudget=${truncatedByBudget}${slowFrameSuffix}`
            );
        }

        return {
            frameBuffers,
            frameDelayMs: uniformFrameDelayMs(frameBuffers.length, baseFrameDelayMs),
            budgetMs: collectionBudgetMs,
            truncatedByBudget,
        };
    }

    private async _captureFrameBuffer(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        timestampMs: number
    ) {
        const capturedFrame = await this._captureFrameBufferWithTiming(video, ctx, width, height, timestampMs);
        return capturedFrame.buffer;
    }

    private async _captureFrameBufferWithTiming(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        timestampMs: number
    ): Promise<CollectedGifFrameTiming> {
        if (ctx.canvas.width !== width || ctx.canvas.height !== height) {
            ctx.canvas.width = width;
            ctx.canvas.height = height;
        }

        const fromTimestampMs = Math.round(video.currentTime * 1000);
        const seekStartedAtMs = now();
        await this._seekVideo(video, timestampMs / 1000);
        const seekElapsedMs = Math.round(now() - seekStartedAtMs);

        const readStartedAtMs = now();
        ctx.drawImage(video, 0, 0, width, height);
        const rgba = ctx.getImageData(0, 0, width, height).data;
        const readElapsedMs = Math.round(now() - readStartedAtMs);
        const buffer = rgba.buffer instanceof ArrayBuffer ? rgba.buffer : new Uint8Array(rgba).buffer;
        const toTimestampMs = Math.round(video.currentTime * 1000);

        return {
            buffer,
            seekElapsedMs,
            readElapsedMs,
            totalElapsedMs: seekElapsedMs + readElapsedMs,
            fromTimestampMs,
            toTimestampMs,
        };
    }

    private _timingSettingsSummary() {
        return `settings={maxWidth:${this._maxWidth},maxHeight:${this._maxHeight},gifFps:${this._gifOptions.fps},gifMaxFrames:${
            this._gifOptions.maxFrames
        },gifStartTrim:${this._gifOptions.startTrimMs},gifEndTrim:${this._gifOptions.endTrimMs}}`;
    }

    private _timingRenderSummary() {
        if (!this._lastRenderStats) {
            return 'render={}';
        }

        const stats = this._lastRenderStats;
        const budgetSummary =
            stats.budgetMs === undefined
                ? ''
                : `,collectionBudgetMs:${stats.budgetMs},truncatedByBudget:${stats.truncatedByBudget === true}`;
        return `render={sourceFrames:${stats.sourceFrameCount},outputFrames:${stats.outputFrameCount},effectiveFps:${stats.effectiveFps},width:${stats.outputWidth},height:${stats.outputHeight},output:${stats.outputExtension},gifDurationMs:${this._durationMs}${budgetSummary}}`;
    }

    private _applyPaletteWorkerCount(frameCount: number) {
        if (frameCount < GIF_APPLY_PALETTE_POOL_MIN_FRAMES) {
            return 1;
        }

        const hardwareConcurrency =
            typeof navigator !== 'undefined' && Number.isFinite(navigator.hardwareConcurrency)
                ? Math.floor(navigator.hardwareConcurrency)
                : 2;
        const maxWorkersFromHardware = Math.max(1, hardwareConcurrency - 1);
        const workerCount = Math.min(GIF_APPLY_PALETTE_POOL_MAX_WORKERS, maxWorkersFromHardware, frameCount);

        return workerCount >= GIF_APPLY_PALETTE_POOL_MIN_WORKERS ? workerCount : 1;
    }

    private _paletteFrameBuffers(frameBuffers: ArrayBuffer[], paletteFrameIndexes: number[]) {
        if (frameBuffers.length === 0) {
            return [];
        }

        const selectedBuffers: ArrayBuffer[] = [];
        const seenIndexes = new Set<number>();

        for (const index of paletteFrameIndexes) {
            const clampedIndex = Math.max(0, Math.min(index, frameBuffers.length - 1));

            if (seenIndexes.has(clampedIndex)) {
                continue;
            }

            selectedBuffers.push(frameBuffers[clampedIndex]);
            seenIndexes.add(clampedIndex);
        }

        if (selectedBuffers.length === 0) {
            selectedBuffers.push(frameBuffers[0]);
        }

        return selectedBuffers;
    }

    private async _encodeGifWithPaletteWorkerPool(
        width: number,
        height: number,
        frameDelayMs: number[],
        frameBuffers: ArrayBuffer[],
        paletteFrameIndexes: number[],
        applyPaletteWorkerCount: number
    ) {
        const workerPoolStartedAtMs = now();
        const [coordinatorWorker, ...applyPaletteWorkers] = await this._workerPool(applyPaletteWorkerCount + 1);
        const workerPoolElapsedMs = Math.round(now() - workerPoolStartedAtMs);

        try {
            if (workerPoolElapsedMs >= IMAGE_TIMING_LOG_THRESHOLD_MS) {
                console.debug(
                    `[Image] gif workers ready in ${workerPoolElapsedMs}ms workers=${applyPaletteWorkerCount + 1}`
                );
            }

            const palette = await this._quantizePaletteInWorker(coordinatorWorker, {
                command: 'quantizePalette',
                frameBuffers: this._paletteFrameBuffers(frameBuffers, paletteFrameIndexes),
                paletteSize: GIF_PALETTE_OPTIONS.size,
                paletteFormat: GIF_PALETTE_OPTIONS.format,
                palettePixelStride: GIF_PALETTE_OPTIONS.pixelStride,
            });
            const frameIndexBuffers = await this._applyPaletteInWorkerPool(applyPaletteWorkers, frameBuffers, palette);

            return await this._encodeIndexedGifInWorker(coordinatorWorker, {
                command: 'encodeIndexedGif',
                width,
                height,
                frameDelayMs,
                frameIndexBuffers,
                palette,
            });
        } finally {
            coordinatorWorker.terminate();

            for (const worker of applyPaletteWorkers) {
                worker.terminate();
            }
        }
    }

    private async _applyPaletteInWorkerPool(workers: Worker[], frameBuffers: ArrayBuffer[], palette: GifPalette) {
        if (frameBuffers.length === 0) {
            return [];
        }

        if (workers.length === 0) {
            throw new Error('Could not apply GIF palette: worker pool is empty');
        }

        const frameIndexBuffers = new Array<ArrayBuffer>(frameBuffers.length);
        let nextFrameIndex = 0;
        let completedFrameCount = 0;

        return await new Promise<ArrayBuffer[]>((resolve, reject) => {
            let settled = false;
            const fail = (error: Error) => {
                if (!settled) {
                    settled = true;
                    reject(error);
                }
            };

            const schedule = (worker: Worker) => {
                if (settled) {
                    return;
                }

                if (nextFrameIndex >= frameBuffers.length) {
                    if (completedFrameCount >= frameBuffers.length) {
                        settled = true;
                        resolve(frameIndexBuffers);
                    }

                    return;
                }

                const frameIndex = nextFrameIndex++;

                this._applyPaletteInWorker(worker, {
                    command: 'applyPalette',
                    frameIndex,
                    frameBuffer: frameBuffers[frameIndex],
                    palette,
                    paletteFormat: GIF_PALETTE_OPTIONS.format,
                })
                    .then((appliedFrame) => {
                        if (settled) {
                            return;
                        }

                        frameIndexBuffers[appliedFrame.frameIndex] = appliedFrame.buffer;
                        completedFrameCount++;

                        if (completedFrameCount >= frameBuffers.length) {
                            settled = true;
                            resolve(frameIndexBuffers);
                            return;
                        }

                        schedule(worker);
                    })
                    .catch(fail);
            };

            for (const worker of workers) {
                schedule(worker);
            }
        });
    }

    private async _encodeGifInWorker(worker: Worker, message: EncodeGifInWorkerMessage) {
        return await this._encodeInWorker(worker, message, 'encoded', 'Failed to encode GIF', message.frameBuffers);
    }

    private async _encodeIndexedGifInWorker(worker: Worker, message: EncodeIndexedGifInWorkerMessage) {
        return await this._encodeInWorker(
            worker,
            message,
            'encoded',
            'Failed to encode indexed GIF',
            message.frameIndexBuffers
        );
    }

    private async _quantizePaletteInWorker(worker: Worker, message: QuantizePaletteInWorkerMessage) {
        return await new Promise<GifPalette>((resolve, reject) => {
            const handleError = (error: Error) => {
                worker.onmessage = null;
                worker.onerror = null;
                reject(error);
            };

            worker.onmessage = (event: MessageEvent<GifEncoderResponseMessage>) => {
                const data = event.data;

                if (data.command === 'quantizedPalette') {
                    worker.onmessage = null;
                    worker.onerror = null;
                    resolve(data.palette);
                    return;
                }

                if (data.command === 'error') {
                    handleError(new Error(data.error));
                    return;
                }

                handleError(new Error(`Unexpected worker response: ${data.command}`));
            };
            worker.onerror = (event) => {
                handleError(event.error ?? new Error(event.message ?? 'Failed to quantize GIF palette'));
            };

            worker.postMessage(message);
        });
    }

    private async _applyPaletteInWorker(worker: Worker, message: ApplyPaletteInWorkerMessage) {
        return await new Promise<{ frameIndex: number; buffer: ArrayBuffer }>((resolve, reject) => {
            const handleError = (error: Error) => {
                worker.onmessage = null;
                worker.onerror = null;
                reject(error);
            };

            worker.onmessage = (event: MessageEvent<GifEncoderResponseMessage>) => {
                const data = event.data;

                if (data.command === 'appliedPalette') {
                    worker.onmessage = null;
                    worker.onerror = null;
                    resolve({
                        frameIndex: data.frameIndex,
                        buffer: data.buffer,
                    });
                    return;
                }

                if (data.command === 'error') {
                    handleError(new Error(data.error));
                    return;
                }

                handleError(new Error(`Unexpected worker response: ${data.command}`));
            };
            worker.onerror = (event) => {
                handleError(event.error ?? new Error(event.message ?? 'Failed to apply GIF palette'));
            };

            worker.postMessage(message, [message.frameBuffer]);
        });
    }

    private async _encodeInWorker(
        worker: Worker,
        message: EncodeGifInWorkerMessage | EncodeIndexedGifInWorkerMessage,
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

                handleError(new Error(`Unexpected worker response: ${data.command}`));
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

    private async _workerPool(size: number) {
        if (size <= 0) {
            return [];
        }

        const workerResults = await Promise.allSettled(Array.from({ length: size }, () => this._worker()));
        const workers: Worker[] = [];
        let firstError: Error | undefined;

        for (const result of workerResults) {
            if (result.status === 'fulfilled') {
                workers.push(result.value);
            } else if (!firstError) {
                firstError = result.reason instanceof Error ? result.reason : new Error(String(result.reason));
            }
        }

        if (firstError) {
            for (const worker of workers) {
                worker.terminate();
            }

            throw firstError;
        }

        return workers;
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
