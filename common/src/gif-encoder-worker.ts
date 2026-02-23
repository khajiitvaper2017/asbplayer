import { GIFEncoder, applyPalette, quantize } from 'gifenc';
import type {
    AppliedPaletteFromWorkerMessage,
    ApplyPaletteInWorkerMessage,
    EncodeGifInWorkerMessage,
    EncodeGifErrorFromWorkerMessage,
    EncodeIndexedGifInWorkerMessage,
    EncodeJpegInWorkerMessage,
    EncodedGifFromWorkerMessage,
    EncodedJpegFromWorkerMessage,
    GifEncoderRequestMessage,
    QuantizePaletteInWorkerMessage,
    QuantizedPaletteFromWorkerMessage,
} from './gif-encoder-message';

const frameFromBuffer = (buffer: ArrayBuffer) => new Uint8Array(buffer);

const sampleRgbaPixels = (rgba: Uint8Array, stride: number) => {
    if (stride <= 1) {
        return rgba;
    }

    const pixelCount = Math.floor(rgba.length / 4);
    const sampledPixelCount = Math.ceil(pixelCount / stride);
    const sampled = new Uint8Array(sampledPixelCount * 4);
    let outIndex = 0;

    for (let pixel = 0; pixel < pixelCount; pixel += stride) {
        const sourceIndex = pixel * 4;
        sampled[outIndex++] = rgba[sourceIndex];
        sampled[outIndex++] = rgba[sourceIndex + 1];
        sampled[outIndex++] = rgba[sourceIndex + 2];
        sampled[outIndex++] = rgba[sourceIndex + 3];
    }

    return sampled;
};

const paletteRgba = (frames: Uint8Array[], paletteFrameIndexes: number[], stride: number) => {
    if (frames.length === 0) {
        return new Uint8Array([0, 0, 0, 255]);
    }

    const uniqueIndexes: number[] = [];

    for (const index of paletteFrameIndexes) {
        const clampedIndex = Math.max(0, Math.min(index, frames.length - 1));

        if (uniqueIndexes[uniqueIndexes.length - 1] !== clampedIndex) {
            uniqueIndexes.push(clampedIndex);
        }
    }

    if (uniqueIndexes.length === 0) {
        uniqueIndexes.push(0);
    }

    const sampledFrames = uniqueIndexes.map((index) => sampleRgbaPixels(frames[index], stride));
    const merged = new Uint8Array(sampledFrames.reduce((sum, frame) => sum + frame.length, 0));
    let offset = 0;

    for (const frame of sampledFrames) {
        merged.set(frame, offset);
        offset += frame.length;
    }

    return merged;
};

const quantizedPalette = (
    frames: Uint8Array[],
    paletteFrameIndexes: number[],
    paletteSize: number,
    paletteFormat: 'rgb444' | 'rgb565' | 'rgba4444',
    palettePixelStride: number
) =>
    quantize(paletteRgba(frames, paletteFrameIndexes, palettePixelStride), paletteSize, {
        format: paletteFormat,
    });

const encodeGifFromIndexes = (
    width: number,
    height: number,
    frameIndexes: Uint8Array[],
    frameDelayMs: number[],
    palette: number[][]
) => {
    const delays =
        frameDelayMs.length === frameIndexes.length ? frameDelayMs : frameIndexes.map(() => frameDelayMs[0] ?? 20);
    const gif = GIFEncoder();

    for (let i = 0; i < frameIndexes.length; ++i) {
        const delay = Math.max(1, Math.round(delays[i]));

        if (i === 0) {
            gif.writeFrame(frameIndexes[i], width, height, {
                palette,
                delay,
                repeat: 0,
            });
        } else {
            gif.writeFrame(frameIndexes[i], width, height, {
                delay,
            });
        }
    }

    gif.finish();
    return new Uint8Array(gif.bytesView());
};

const encodeGif = ({
    width,
    height,
    frameDelayMs,
    frameBuffers,
    paletteFrameIndexes,
    paletteSize,
    paletteFormat,
    palettePixelStride,
}: EncodeGifInWorkerMessage) => {
    const frames = frameBuffers.map(frameFromBuffer);
    const delays = frameDelayMs.length === frames.length ? frameDelayMs : frames.map(() => frameDelayMs[0] ?? 20);
    const palette = quantizedPalette(frames, paletteFrameIndexes, paletteSize, paletteFormat, palettePixelStride);
    const indexes = frames.map((frame) => applyPalette(frame, palette, paletteFormat));
    return encodeGifFromIndexes(width, height, indexes, delays, palette);
};

const quantizePalette = ({
    frameBuffers,
    paletteSize,
    paletteFormat,
    palettePixelStride,
}: QuantizePaletteInWorkerMessage) => {
    const frames = frameBuffers.map(frameFromBuffer);
    const paletteFrameIndexes = frames.map((_, index) => index);
    return quantizedPalette(frames, paletteFrameIndexes, paletteSize, paletteFormat, palettePixelStride);
};

const applyPaletteToFrame = ({ frameIndex, frameBuffer, palette, paletteFormat }: ApplyPaletteInWorkerMessage) => {
    const frame = frameFromBuffer(frameBuffer);
    const index = applyPalette(frame, palette, paletteFormat);
    return {
        frameIndex,
        index,
    };
};

const encodeIndexedGif = ({
    width,
    height,
    frameDelayMs,
    frameIndexBuffers,
    palette,
}: EncodeIndexedGifInWorkerMessage) => {
    const indexes = frameIndexBuffers.map(frameFromBuffer);
    return encodeGifFromIndexes(width, height, indexes, frameDelayMs, palette);
};

const encodeJpeg = async ({ width, height, frameBuffer }: EncodeJpegInWorkerMessage) => {
    if (typeof OffscreenCanvas === 'undefined') {
        throw new Error('OffscreenCanvas is not available for worker JPEG encoding');
    }

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');

    if (!ctx) {
        throw new Error('Could not create OffscreenCanvas 2d context');
    }

    const pixels = new Uint8ClampedArray(frameBuffer);
    ctx.putImageData(new ImageData(pixels, width, height), 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/jpeg' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return bytes;
};

const toArrayBuffer = (bytes: Uint8Array) =>
    bytes.buffer instanceof ArrayBuffer ? bytes.buffer : new Uint8Array(bytes).buffer;

const onMessage = () => {
    onmessage = async (event: MessageEvent<GifEncoderRequestMessage>) => {
        try {
            const message = event.data;

            if (message.command === 'encode') {
                const bytes = encodeGif(message);
                const buffer = toArrayBuffer(bytes);
                const response: EncodedGifFromWorkerMessage = {
                    command: 'encoded',
                    buffer,
                };
                postMessage(response, { transfer: [buffer] });
                return;
            }

            if (message.command === 'quantizePalette') {
                const palette = quantizePalette(message);
                const response: QuantizedPaletteFromWorkerMessage = {
                    command: 'quantizedPalette',
                    palette,
                };
                postMessage(response);
                return;
            }

            if (message.command === 'applyPalette') {
                const { frameIndex, index } = applyPaletteToFrame(message);
                const buffer = toArrayBuffer(index);
                const response: AppliedPaletteFromWorkerMessage = {
                    command: 'appliedPalette',
                    frameIndex,
                    buffer,
                };
                postMessage(response, { transfer: [buffer] });
                return;
            }

            if (message.command === 'encodeIndexedGif') {
                const bytes = encodeIndexedGif(message);
                const buffer = toArrayBuffer(bytes);
                const response: EncodedGifFromWorkerMessage = {
                    command: 'encoded',
                    buffer,
                };
                postMessage(response, { transfer: [buffer] });
                return;
            }

            if (message.command === 'encodeJpeg') {
                const bytes = await encodeJpeg(message);
                const buffer = toArrayBuffer(bytes);
                const response: EncodedJpegFromWorkerMessage = {
                    command: 'encodedJpeg',
                    buffer,
                };
                postMessage(response, { transfer: [buffer] });
                return;
            }

            throw new Error(`Unknown worker command: ${(message as { command: string }).command}`);
        } catch (error) {
            const response: EncodeGifErrorFromWorkerMessage = {
                command: 'error',
                error: error instanceof Error ? error.message : String(error),
            };
            postMessage(response);
        }
    };
};

onMessage();
