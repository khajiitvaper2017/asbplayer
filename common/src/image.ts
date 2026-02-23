import { resizeCanvas } from './image-transformer';
import { CardModel, FileModel, ImageErrorCode } from './model';
import { download } from '../util/util';
import { isActiveBlobUrl } from '../blob-url';
import type {
    ApplyPaletteInWorkerMessage,
    EncodeGifInWorkerMessage,
    EncodeIndexedGifInWorkerMessage,
    EncodeJpegInWorkerMessage,
    GifEncoderResponseMessage,
    QuantizePaletteInWorkerMessage,
} from './gif-encoder-message';

const MAX_PREFIX_LENGTH = 24;

const DEFAULT_GIF_DURATION_MS = 1500;
const DEFAULT_GIF_MAX_WIDTH = 480;

const GIF_OPTION_LIMITS = {
    minDurationMs: 300,
    maxDurationMs: 2500,
    maxDurationCapMs: 60_000,
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
const GIF_MOTION_SCORE_JPEG_CUTOFF = 50;
const GIF_MOTION_SCORE_MAX_FPS = 200;
const GIF_MOTION_NEW_DRAWING_THRESHOLD = 4;
const GIF_MOTION_EARLY_JPEG_MAX_SCORE = 8;
const GIF_MOTION_PROBE_FRAME_COUNT = 5;
const GIF_MOTION_SLOW_SCENE_MIN_DELAY_MS = 100;
const GIF_MOTION_COLLECTION_BUDGET_MULTIPLIER = 0.9;
const GIF_MOTION_COLLECTION_BUDGET_PADDING_MS = 500;
const GIF_MOTION_COLLECTION_BUDGET_MIN_MS = 1_200;
const GIF_MOTION_SAMPLE_STRIDE = 4;
const GIF_APPLY_PALETTE_POOL_MIN_FRAMES = 12;
const GIF_APPLY_PALETTE_POOL_MIN_WORKERS = 2;
const GIF_APPLY_PALETTE_POOL_MAX_WORKERS = 4;
const IMAGE_TIMING_LOG_THRESHOLD_MS = 500;
type TimingDetails = string | (() => string);
type GifWorkerSuccessCommand = 'encoded' | 'encodedJpeg';
type GifPalette = number[][];

type GifEncoderWorkerFactory = () => Worker | Promise<Worker>;

interface CollectedGifFrames {
    frameBuffers: ArrayBuffer[];
    frameDelayMs: number[];
    motionScore?: number;
    motionScoreMax?: number;
    motionScoreComparisons?: number;
    motionScoreMs?: number;
    budgetMs?: number;
    truncatedByBudget?: boolean;
    motionDetected?: boolean;
}

interface GifRenderStats {
    sourceFrameCount: number;
    outputFrameCount: number;
    effectiveFps: number;
    outputWidth: number;
    outputHeight: number;
    outputExtension: 'gif' | 'jpeg';
    motionScore?: number;
    motionScoreMax?: number;
    motionScoreComparisons?: number;
    motionScoreMs?: number;
    budgetMs?: number;
    truncatedByBudget?: boolean;
    motionDetected?: boolean;
}

export interface GifOptions {
    maxDurationMs: number;
    detectMotion: boolean;
    createJpegIfMotionIsLow: boolean;
    fps: number;
    maxFrames: number;
    startTrimMs: number;
    endTrimMs: number;
}

const DEFAULT_GIF_OPTIONS: GifOptions = {
    maxDurationMs: GIF_OPTION_LIMITS.maxDurationMs,
    detectMotion: true,
    createJpegIfMotionIsLow: true,
    fps: 12,
    maxFrames: 24,
    startTrimMs: 100,
    endTrimMs: 0,
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

const normalizeBoolean = (value: boolean | undefined, fallback: boolean) =>
    typeof value === 'boolean' ? value : fallback;

const normalizeGifOptions = (gifOptions?: Partial<GifOptions>): GifOptions => {
    return {
        maxDurationMs: normalizeRoundedNumber(
            gifOptions?.maxDurationMs,
            DEFAULT_GIF_OPTIONS.maxDurationMs,
            GIF_OPTION_LIMITS.minDurationMs,
            GIF_OPTION_LIMITS.maxDurationCapMs
        ),
        detectMotion: normalizeBoolean(gifOptions?.detectMotion, DEFAULT_GIF_OPTIONS.detectMotion),
        createJpegIfMotionIsLow: normalizeBoolean(
            gifOptions?.createJpegIfMotionIsLow,
            DEFAULT_GIF_OPTIONS.createJpegIfMotionIsLow
        ),
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

const motionScore = (previous: Uint8Array, current: Uint8Array, sampleStride: number) => {
    const pixelStep = Math.max(1, sampleStride) * 4;
    const maxLength = Math.min(previous.length, current.length);
    let diff = 0;
    let sampledPixelCount = 0;

    for (let i = 0; i + 2 < maxLength; i += pixelStep) {
        diff +=
            Math.abs(previous[i] - current[i]) +
            Math.abs(previous[i + 1] - current[i + 1]) +
            Math.abs(previous[i + 2] - current[i + 2]);
        sampledPixelCount++;
    }

    return sampledPixelCount === 0 ? 0 : diff / sampledPixelCount;
};

const yieldToEventLoop = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const uniformFrameDelayMs = (frameCount: number, delayMs: number) => Array.from({ length: frameCount }, () => delayMs);

const evenlySpacedIndexes = (frameCount: number, targetFrameCount: number) => {
    const safeFrameCount = Math.max(1, frameCount);
    const safeTargetFrameCount = Math.max(1, Math.min(targetFrameCount, safeFrameCount));

    if (safeTargetFrameCount === safeFrameCount) {
        return [...Array(safeFrameCount).keys()];
    }

    if (safeTargetFrameCount === 1) {
        return [safeFrameCount - 1];
    }

    const indexes: number[] = [];

    for (let i = 0; i < safeTargetFrameCount; ++i) {
        const index = Math.round((i * (safeFrameCount - 1)) / (safeTargetFrameCount - 1));

        if (indexes[indexes.length - 1] !== index) {
            indexes.push(index);
        }
    }

    if (indexes[0] !== 0) {
        indexes.unshift(0);
    }

    if (indexes[indexes.length - 1] !== safeFrameCount - 1) {
        indexes.push(safeFrameCount - 1);
    }

    return indexes;
};

const requiredDelayMsForMotionScore = (score: number, baseFrameDelayMs: number) => {
    const fastDelayMs = Math.max(MIN_GIF_FRAME_DELAY_MS, Math.round(baseFrameDelayMs));
    const slowDelayMs = Math.max(fastDelayMs, GIF_MOTION_SLOW_SCENE_MIN_DELAY_MS);

    if (score >= GIF_MOTION_SCORE_MAX_FPS) {
        return fastDelayMs;
    }

    if (score <= GIF_MOTION_SCORE_JPEG_CUTOFF) {
        return slowDelayMs;
    }

    const t = (score - GIF_MOTION_SCORE_JPEG_CUTOFF) / (GIF_MOTION_SCORE_MAX_FPS - GIF_MOTION_SCORE_JPEG_CUTOFF);
    return Math.max(MIN_GIF_FRAME_DELAY_MS, Math.round(slowDelayMs - t * (slowDelayMs - fastDelayMs)));
};

const durationFromInterval = (startTimestamp: number, endTimestamp: number, gifOptions: GifOptions) => {
    const duration = Math.abs(endTimestamp - startTimestamp);
    const resolvedDuration = duration > 0 ? duration : DEFAULT_GIF_DURATION_MS;
    return clamp(resolvedDuration, GIF_OPTION_LIMITS.minDurationMs, gifOptions.maxDurationMs);
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
        this._durationMs = durationFromInterval(startTimestamp, endTimestamp, gifOptions);
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
        const {
            frameBuffers,
            frameDelayMs,
            motionScore,
            motionScoreMax,
            motionScoreComparisons,
            motionScoreMs,
            budgetMs,
            truncatedByBudget,
            motionDetected,
        } = await this._collectFrames(video, ctx, width, height, frameTimestamps, baseFrameDelayMs);

        if (frameBuffers.length === 1) {
            this._outputExtension = 'jpeg';
            const jpegWidth = width;
            const jpegHeight = height;
            const jpegFrameBuffer = frameBuffers[0];

            this._lastRenderStats = {
                sourceFrameCount: frameTimestamps.length,
                outputFrameCount: 1,
                effectiveFps: Math.round((1000 / Math.max(1, baseFrameDelayMs)) * 10) / 10,
                outputWidth: jpegWidth,
                outputHeight: jpegHeight,
                outputExtension: 'jpeg',
                motionScore,
                motionScoreMax,
                motionScoreComparisons,
                motionScoreMs,
                budgetMs,
                truncatedByBudget,
                motionDetected,
            };

            const worker = await this._worker();

            try {
                const encodedJpeg = await this._encodeJpegInWorker(worker, {
                    command: 'encodeJpeg',
                    width: jpegWidth,
                    height: jpegHeight,
                    frameBuffer: jpegFrameBuffer,
                });
                return new Blob([encodedJpeg], { type: 'image/jpeg' });
            } catch {
                // Keep compatibility in environments without worker JPEG APIs.
                return await this._jpegBlobFromFrameBuffer(ctx, jpegWidth, jpegHeight, jpegFrameBuffer);
            } finally {
                worker.terminate();
            }
        }

        this._outputExtension = 'gif';
        this._lastRenderStats = {
            sourceFrameCount: frameTimestamps.length,
            outputFrameCount: frameBuffers.length,
            effectiveFps: Math.round((1000 / Math.max(1, baseFrameDelayMs)) * 10) / 10,
            outputWidth: width,
            outputHeight: height,
            outputExtension: 'gif',
            motionScore,
            motionScoreMax,
            motionScoreComparisons,
            motionScoreMs,
            budgetMs,
            truncatedByBudget,
            motionDetected,
        };

        const paletteFrameIndexes = this._paletteFrameIndexes(frameBuffers.length);
        const applyPaletteWorkerCount = this._applyPaletteWorkerCount(frameBuffers.length);

        if (applyPaletteWorkerCount > 1) {
            console.debug(
                `[Image] apply palette worker pool workers=${applyPaletteWorkerCount} frames=${frameBuffers.length}`
            );
        }

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
        return new Blob([encodedBytes], { type: 'image/gif' });
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

        if (frameTimestamps.length === 1) {
            const singleFrame = await this._captureFrameBuffer(video, ctx, width, height, frameTimestamps[0]);
            return {
                frameBuffers: [singleFrame],
                frameDelayMs: [baseFrameDelayMs],
            };
        }

        if (!this._gifOptions.detectMotion) {
            const frameBuffers = await this._captureFrameBuffers(
                video,
                ctx,
                width,
                height,
                frameTimestamps,
                0,
                frameTimestamps.length
            );

            return {
                frameBuffers,
                frameDelayMs: uniformFrameDelayMs(frameBuffers.length, baseFrameDelayMs),
            };
        }

        const firstFrameBuffer = await this._captureFrameBuffer(video, ctx, width, height, frameTimestamps[0]);
        const preCapturedFrames = new Map<number, ArrayBuffer>([[0, firstFrameBuffer]]);
        const probeIndexes = evenlySpacedIndexes(
            frameTimestamps.length,
            Math.min(frameTimestamps.length, GIF_MOTION_PROBE_FRAME_COUNT)
        );
        const collectionStartedAtMs = now();
        const defaultCollectionBudgetMs = Math.max(
            GIF_MOTION_COLLECTION_BUDGET_MIN_MS,
            Math.round(
                this._durationMs * GIF_MOTION_COLLECTION_BUDGET_MULTIPLIER + GIF_MOTION_COLLECTION_BUDGET_PADDING_MS
            )
        );
        const collectionBudgetMs =
            this._motionCollectionBudgetOverrideMs === undefined
                ? defaultCollectionBudgetMs
                : Math.max(
                      GIF_MOTION_COLLECTION_BUDGET_MIN_MS,
                      Math.min(defaultCollectionBudgetMs, this._motionCollectionBudgetOverrideMs)
                  );
        let probeScoreTotal = 0;
        let probeScoreMax = 0;
        let probeScoreComparisons = 0;
        let probeScoreElapsedMs = 0;

        for (let i = 0; i < probeIndexes.length; ++i) {
            const index = probeIndexes[i];

            if (preCapturedFrames.has(index)) {
                continue;
            }

            preCapturedFrames.set(
                index,
                await this._captureFrameBuffer(video, ctx, width, height, frameTimestamps[index])
            );
        }

        for (let i = 1; i < probeIndexes.length; ++i) {
            const previousIndex = probeIndexes[i - 1];
            const currentIndex = probeIndexes[i];
            const previousProbeFrame = new Uint8Array(preCapturedFrames.get(previousIndex)!);
            const currentProbeFrame = new Uint8Array(preCapturedFrames.get(currentIndex)!);
            const scoreStartedAtMs = now();
            const score = motionScore(previousProbeFrame, currentProbeFrame, GIF_MOTION_SAMPLE_STRIDE);
            probeScoreElapsedMs += now() - scoreStartedAtMs;
            probeScoreTotal += score;
            probeScoreMax = probeScoreComparisons === 0 ? score : Math.max(probeScoreMax, score);
            probeScoreComparisons++;
        }

        const probeAverageMotionScore = probeScoreComparisons === 0 ? 0 : probeScoreTotal / probeScoreComparisons;
        const roundedProbeAverageMotionScore = Math.round(probeAverageMotionScore * 10) / 10;
        const roundedProbeMaxMotionScore = Math.round(probeScoreMax * 10) / 10;
        const roundedProbeScoreElapsedMs = Math.round(probeScoreElapsedMs);

        if (
            this._gifOptions.createJpegIfMotionIsLow &&
            probeAverageMotionScore <= GIF_MOTION_SCORE_JPEG_CUTOFF &&
            probeScoreMax <= GIF_MOTION_EARLY_JPEG_MAX_SCORE
        ) {
            const lastFrameBuffer =
                preCapturedFrames.get(frameTimestamps.length - 1) ??
                (await this._captureFrameBuffer(
                    video,
                    ctx,
                    width,
                    height,
                    frameTimestamps[frameTimestamps.length - 1]
                ));

            console.debug(
                `[Image] motion score avg=${roundedProbeAverageMotionScore} max=${roundedProbeMaxMotionScore} comparisons=${probeScoreComparisons} took=${roundedProbeScoreElapsedMs}ms jpegCutoff=${GIF_MOTION_SCORE_JPEG_CUTOFF} maxFpsScore=${GIF_MOTION_SCORE_MAX_FPS} earlyProbe=true`
            );

            return {
                frameBuffers: [lastFrameBuffer],
                frameDelayMs: [Math.max(MIN_GIF_FRAME_DELAY_MS, Math.round(this._durationMs))],
                motionScore: probeAverageMotionScore,
                motionScoreMax: probeScoreMax,
                motionScoreComparisons: probeScoreComparisons,
                motionScoreMs: roundedProbeScoreElapsedMs,
                budgetMs: collectionBudgetMs,
                truncatedByBudget: false,
                motionDetected: false,
            };
        }

        let previousFrame = new Uint8Array(firstFrameBuffer);
        let pendingFrameBuffer = firstFrameBuffer;
        let pendingTimestampMs = frameTimestamps[0];
        let lastFlushedTimestampMs = frameTimestamps[0];
        const frameBuffers: ArrayBuffer[] = [];
        const frameDelayMs: number[] = [];
        let motionScoreTotal = 0;
        let motionScoreMax = 0;
        let motionScoreComparisons = 0;
        let motionScoreElapsedMs = 0;
        let truncatedByBudget = false;

        for (let i = 1; i < frameTimestamps.length; ++i) {
            if (now() - collectionStartedAtMs >= collectionBudgetMs) {
                truncatedByBudget = true;
                break;
            }

            if (i > 0 && i % GIF_FRAME_YIELD_INTERVAL === 0) {
                await yieldToEventLoop();
            }

            const currentFrameBuffer =
                preCapturedFrames.get(i) ??
                (await this._captureFrameBuffer(video, ctx, width, height, frameTimestamps[i]));
            const currentFrame = new Uint8Array(currentFrameBuffer);

            const scoreStartedAtMs = now();
            const score = motionScore(previousFrame, currentFrame, GIF_MOTION_SAMPLE_STRIDE);
            motionScoreElapsedMs += now() - scoreStartedAtMs;

            motionScoreTotal += score;
            motionScoreMax = motionScoreComparisons === 0 ? score : Math.max(motionScoreMax, score);
            motionScoreComparisons++;

            const elapsedSinceFlushMs = Math.max(
                MIN_GIF_FRAME_DELAY_MS,
                Math.round(frameTimestamps[i] - lastFlushedTimestampMs)
            );
            const requiredDelayMs = requiredDelayMsForMotionScore(score, baseFrameDelayMs);
            const isNewDrawing = score > GIF_MOTION_NEW_DRAWING_THRESHOLD;

            if (isNewDrawing && elapsedSinceFlushMs >= requiredDelayMs) {
                frameBuffers.push(pendingFrameBuffer);
                frameDelayMs.push(elapsedSinceFlushMs);
                lastFlushedTimestampMs = frameTimestamps[i];
            }

            pendingFrameBuffer = currentFrameBuffer;
            pendingTimestampMs = frameTimestamps[i];
            previousFrame = currentFrame;
        }

        const finalFrameDelayMs = Math.max(
            MIN_GIF_FRAME_DELAY_MS,
            Math.round(Math.max(baseFrameDelayMs, pendingTimestampMs - lastFlushedTimestampMs))
        );
        frameBuffers.push(pendingFrameBuffer);
        frameDelayMs.push(finalFrameDelayMs);

        const averageMotionScore = motionScoreComparisons === 0 ? 0 : motionScoreTotal / motionScoreComparisons;
        const roundedAverageMotionScore = Math.round(averageMotionScore * 10) / 10;
        const roundedMaxMotionScore = Math.round(motionScoreMax * 10) / 10;
        const roundedMotionScoreElapsedMs = Math.round(motionScoreElapsedMs);

        console.debug(
            `[Image] motion score avg=${roundedAverageMotionScore} max=${roundedMaxMotionScore} comparisons=${motionScoreComparisons} took=${roundedMotionScoreElapsedMs}ms jpegCutoff=${GIF_MOTION_SCORE_JPEG_CUTOFF} maxFpsScore=${GIF_MOTION_SCORE_MAX_FPS} budgetMs=${collectionBudgetMs} truncated=${truncatedByBudget}`
        );

        if (
            this._gifOptions.createJpegIfMotionIsLow &&
            averageMotionScore <= GIF_MOTION_SCORE_JPEG_CUTOFF &&
            motionScoreMax <= GIF_MOTION_SCORE_JPEG_CUTOFF
        ) {
            return {
                frameBuffers: [pendingFrameBuffer],
                frameDelayMs: [Math.max(MIN_GIF_FRAME_DELAY_MS, Math.round(this._durationMs))],
                motionScore: averageMotionScore,
                motionScoreMax,
                motionScoreComparisons,
                motionScoreMs: roundedMotionScoreElapsedMs,
                budgetMs: collectionBudgetMs,
                truncatedByBudget,
                motionDetected: false,
            };
        }

        return {
            frameBuffers,
            frameDelayMs,
            motionScore: averageMotionScore,
            motionScoreMax,
            motionScoreComparisons,
            motionScoreMs: roundedMotionScoreElapsedMs,
            budgetMs: collectionBudgetMs,
            truncatedByBudget,
            motionDetected: true,
        };
    }

    private async _captureFrameBuffers(
        video: HTMLVideoElement,
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameTimestamps: number[],
        startIndex: number,
        endIndexExclusive: number
    ) {
        const frameBuffers: ArrayBuffer[] = [];

        for (let i = startIndex; i < endIndexExclusive; ++i) {
            if (i > 0 && i % GIF_FRAME_YIELD_INTERVAL === 0) {
                await yieldToEventLoop();
            }

            frameBuffers.push(await this._captureFrameBuffer(video, ctx, width, height, frameTimestamps[i]));
        }

        return frameBuffers;
    }

    private async _jpegBlobFromFrameBuffer(
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        frameBuffer: ArrayBuffer
    ) {
        const framePixels = new Uint8ClampedArray(frameBuffer);
        ctx.putImageData(new ImageData(framePixels, width, height), 0, 0);
        return await new Promise<Blob>((resolve, reject) => {
            ctx.canvas.toBlob((blob) => {
                if (blob === null) {
                    reject(new Error('Could not create JPEG from single-frame GIF fallback'));
                    return;
                }

                resolve(blob);
            }, 'image/jpeg');
        });
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
        return rgba.buffer instanceof ArrayBuffer ? rgba.buffer : new Uint8Array(rgba).buffer;
    }

    private _timingSettingsSummary() {
        return `settings={maxWidth:${this._maxWidth},maxHeight:${this._maxHeight},gifMaxDuration:${
            this._gifOptions.maxDurationMs
        },gifDetectMotion:${this._gifOptions.detectMotion},gifCreateJpegIfLowMotion:${
            this._gifOptions.createJpegIfMotionIsLow
        },gifFps:${this._gifOptions.fps},gifMaxFrames:${
            this._gifOptions.maxFrames
        },gifStartTrim:${this._gifOptions.startTrimMs},gifEndTrim:${this._gifOptions.endTrimMs}}`;
    }

    private _timingRenderSummary() {
        if (!this._lastRenderStats) {
            return 'render={}';
        }

        const stats = this._lastRenderStats;
        const motionSummary =
            stats.motionScore === undefined
                ? ''
                : `,motionScore:${Math.round(stats.motionScore * 10) / 10},motionScoreMax:${
                      Math.round((stats.motionScoreMax ?? 0) * 10) / 10
                  },motionScoreComparisons:${stats.motionScoreComparisons ?? 0},motionScoreMs:${
                      stats.motionScoreMs ?? 0
                  },motionBudgetMs:${stats.budgetMs ?? 0},motionTruncated:${stats.truncatedByBudget === true},motionDetected:${stats.motionDetected}`;
        return `render={sourceFrames:${stats.sourceFrameCount},outputFrames:${stats.outputFrameCount},effectiveFps:${stats.effectiveFps},width:${stats.outputWidth},height:${stats.outputHeight},output:${stats.outputExtension},gifDurationMs:${this._durationMs}${motionSummary}}`;
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
        const coordinatorWorker = await this._worker();
        const applyPaletteWorkers: Worker[] = [];

        try {
            for (let i = 0; i < applyPaletteWorkerCount; ++i) {
                applyPaletteWorkers.push(await this._worker());
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

    private async _encodeJpegInWorker(worker: Worker, message: EncodeJpegInWorkerMessage) {
        return await this._encodeInWorker(worker, message, 'encodedJpeg', 'Failed to encode JPEG', [
            message.frameBuffer,
        ]);
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
        message: EncodeGifInWorkerMessage | EncodeIndexedGifInWorkerMessage | EncodeJpegInWorkerMessage,
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

    private _dimensions(video: HTMLVideoElement) {
        const effectiveMaxWidth = this._maxWidth > 0 ? this._maxWidth : this._maxHeight > 0 ? 0 : DEFAULT_GIF_MAX_WIDTH;
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
