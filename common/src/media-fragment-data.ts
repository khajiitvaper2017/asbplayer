import { resizeCanvas } from './image-transformer';
import { FileModel, MediaFragmentErrorCode } from './model';
import { isActiveBlobUrl } from '../blob-url';

const maxPrefixLength = 24;
const defaultWebmDurationMs = 1500;
const minWebmDurationMs = 300;
const maxWebmDurationMs = 2500;
const videoReadyTimeoutMs = 5_000;
const videoSeekEpsilonSeconds = 0.001;
const webmVideoBitsPerSecond = 2_500_000;
const webmMimeTypeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'] as const;

export type MediaFragmentFormat = 'jpeg' | 'webm';

export const makeMediaFragmentFileName = (prefix: string, timestamp: number) => {
    return `${prefix.replaceAll(' ', '_').substring(0, Math.min(prefix.length, maxPrefixLength))}_${Math.floor(
        timestamp
    )}`;
};

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const durationFromInterval = (startTimestamp: number, endTimestamp: number) => {
    const duration = Math.abs(endTimestamp - startTimestamp);
    const resolvedDuration = duration > 0 ? duration : defaultWebmDurationMs;
    return clamp(resolvedDuration, minWebmDurationMs, maxWebmDurationMs);
};

const preferredWebmMimeType = () => {
    if (typeof MediaRecorder === 'undefined') {
        return undefined;
    }

    if (typeof MediaRecorder.isTypeSupported !== 'function') {
        return webmMimeTypeCandidates[webmMimeTypeCandidates.length - 1];
    }

    for (const mimeType of webmMimeTypeCandidates) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
            return mimeType;
        }
    }

    return undefined;
};

const mimeTypeForImageExtension = (extension: string) => {
    if (extension === 'webm') {
        return 'video/webm';
    }

    return `image/${extension}`;
};

const blobToDataUrl = async (blob: Blob): Promise<string> =>
    await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('Could not read blob as data URL'));
        reader.readAsDataURL(blob);
    });

const mediaFragmentErrorForFile = (file: FileModel): MediaFragmentErrorCode | undefined => {
    if (file.blobUrl) {
        return isActiveBlobUrl(file.blobUrl) ? undefined : MediaFragmentErrorCode.fileLinkLost;
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

const disposeVideoElement = (video: HTMLVideoElement | undefined) => {
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

export class FileMediaFragmentData implements MediaFragmentData {
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
        this._name = `${makeMediaFragmentFileName(file.name, timestamp)}.jpeg`;
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

    get error(): MediaFragmentErrorCode | undefined {
        return mediaFragmentErrorForFile(this._file);
    }

    atTimestamp(timestamp: number) {
        if (timestamp === this._timestamp) {
            return this;
        }

        this._canvasPromiseReject?.(new CancelledMediaFragmentDataRenderingError());
        return new FileMediaFragmentData(
            this._file,
            timestamp,
            this._maxWidth,
            this._maxHeight,
            this._video,
            this._canvas
        );
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

export class WebmFileMediaFragmentData implements MediaFragmentData {
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

    constructor(
        file: FileModel,
        startTimestamp: number,
        endTimestamp: number,
        maxWidth: number,
        maxHeight: number,
        video: HTMLVideoElement | undefined,
        canvas: HTMLCanvasElement | undefined
    ) {
        this._file = file;
        this._startTimestamp = Math.max(0, startTimestamp);
        this._durationMs = durationFromInterval(startTimestamp, endTimestamp);
        this._maxWidth = maxWidth;
        this._maxHeight = maxHeight;
        this._baseName = makeMediaFragmentFileName(file.name, this._startTimestamp);
        this._video = video;
        this._canvas = canvas;
    }

    get name() {
        return `${this._baseName}.webm`;
    }

    get timestamp() {
        return this._startTimestamp;
    }

    get extension() {
        return 'webm';
    }

    get error(): MediaFragmentErrorCode | undefined {
        return mediaFragmentErrorForFile(this._file);
    }

    atTimestamp(timestamp: number) {
        if (timestamp === this._startTimestamp) {
            return this;
        }

        this._blobPromiseReject?.(new CancelledMediaFragmentDataRenderingError());
        return new WebmFileMediaFragmentData(
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
                const blob = await this._renderWebm();
                this._blobPromiseReject = undefined;
                this._cachedBlob = blob;
                resolve(blob);
            } catch (e) {
                reject(e);
            }
        });

        return await this._blobPromise;
    }

    private async _renderWebm() {
        const mimeType = preferredWebmMimeType();
        if (!mimeType || typeof MediaRecorder === 'undefined') {
            throw new Error('WebM capture is not supported in this browser');
        }

        const video = await this._videoElement(this._file);
        const { width, height } = this._dimensions(video);

        if (!this._canvas) {
            this._canvas = document.createElement('canvas');
        }

        const canvas = this._canvas;
        if (typeof canvas.captureStream !== 'function') {
            throw new Error('WebM capture stream is not supported in this browser');
        }

        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
            throw new Error('Could not create MediaFragment context');
        }

        const maxVideoDurationMs = Number.isFinite(video.duration)
            ? Math.max(0, video.duration * 1000)
            : this._startTimestamp + this._durationMs;
        const startTimestampMs = clamp(this._startTimestamp, 0, maxVideoDurationMs);
        const targetEndTimestampMs = clamp(startTimestampMs + this._durationMs, startTimestampMs, maxVideoDurationMs);
        const targetFps = 24;

        const chunks: BlobPart[] = [];
        let stream: MediaStream | undefined;
        let mediaRecorder: MediaRecorder | undefined;
        let stopRecorder: Promise<Blob> | undefined;

        const originalPlaybackRate = video.playbackRate;
        const originalMuted = video.muted;
        const originalVolume = video.volume;
        const originalOnError = video.onerror;
        const originalOnEnded = video.onended;
        const videoWithPreservesPitch = video as HTMLVideoElement & { preservesPitch?: boolean };
        const originalPreservesPitch = videoWithPreservesPitch.preservesPitch;
        let callbackHandle: number | undefined;
        let fallbackTimer: ReturnType<typeof setTimeout> | undefined;

        try {
            stream = canvas.captureStream(targetFps);
            mediaRecorder = new MediaRecorder(stream, {
                mimeType,
                videoBitsPerSecond: webmVideoBitsPerSecond,
            });

            const recorder = mediaRecorder;
            stopRecorder = new Promise<Blob>((resolve, reject) => {
                recorder.onerror = (event) => {
                    const error = event.error;
                    reject(error instanceof Error ? error : new Error('Could not encode WebM'));
                };
                recorder.ondataavailable = (event) => {
                    if (event.data.size > 0) {
                        chunks.push(event.data);
                    }
                };
                recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
            });

            await this._seekVideo(video, startTimestampMs / 1000);

            const drawFrame = () => {
                ctx.drawImage(video, 0, 0, width, height);
            };
            const done = () => video.currentTime * 1000 >= targetEndTimestampMs;
            const schedule = (onFrame: () => void) => {
                if (typeof video.requestVideoFrameCallback === 'function') {
                    callbackHandle = video.requestVideoFrameCallback(() => onFrame());
                } else {
                    const fallbackDelay = Math.max(16, Math.round(1000 / targetFps));
                    fallbackTimer = setTimeout(onFrame, fallbackDelay);
                }
            };

            drawFrame();
            video.muted = true;
            video.volume = 0;
            video.playbackRate = 1;

            if (typeof originalPreservesPitch === 'boolean') {
                videoWithPreservesPitch.preservesPitch = false;
            }

            await video.play();
            mediaRecorder.start();

            await new Promise<void>((resolve, reject) => {
                const finish = () => {
                    if (callbackHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
                        video.cancelVideoFrameCallback(callbackHandle);
                        callbackHandle = undefined;
                    }

                    if (fallbackTimer !== undefined) {
                        clearTimeout(fallbackTimer);
                        fallbackTimer = undefined;
                    }

                    resolve();
                };
                const fail = (error: Error) => {
                    if (callbackHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
                        video.cancelVideoFrameCallback(callbackHandle);
                        callbackHandle = undefined;
                    }

                    if (fallbackTimer !== undefined) {
                        clearTimeout(fallbackTimer);
                        fallbackTimer = undefined;
                    }

                    reject(error);
                };

                const onFrame = () => {
                    try {
                        drawFrame();

                        if (done()) {
                            finish();
                            return;
                        }

                        schedule(onFrame);
                    } catch (error) {
                        fail(error instanceof Error ? error : new Error(String(error)));
                    }
                };

                video.onerror = () => fail(new Error(video.error?.message ?? 'Could not play video to capture WebM'));
                video.onended = () => finish();
                schedule(onFrame);
            });

            video.pause();

            if (mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }

            const blob = await stopRecorder;
            if (blob.size <= 0) {
                throw new Error('Could not encode WebM from local video');
            }

            return blob;
        } finally {
            if (callbackHandle !== undefined && typeof video.cancelVideoFrameCallback === 'function') {
                video.cancelVideoFrameCallback(callbackHandle);
            }

            if (fallbackTimer !== undefined) {
                clearTimeout(fallbackTimer);
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

            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
                await stopRecorder?.catch(() => undefined);
            }

            if (stream) {
                for (const track of stream.getTracks()) {
                    track.stop();
                }
            }
        }
    }

    private _dimensions(video: HTMLVideoElement) {
        const widthRatio = this._maxWidth <= 0 ? 1 : this._maxWidth / video.videoWidth;
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
            video.onerror = () => reject(video.error?.message ?? 'Could not seek video to create WebM');

            if (Math.abs(video.currentTime - seekTo) <= videoSeekEpsilonSeconds) {
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
        this._blobPromiseReject?.(new CancelledMediaFragmentDataRenderingError());

        disposeVideoElement(this._video);
        this._video = undefined;
        this._canvas?.remove();
    }
}

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
