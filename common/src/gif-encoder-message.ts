export interface EncodeGifInWorkerMessage {
    command: 'encode';
    width: number;
    height: number;
    frameDelayMs: number[];
    frameBuffers: ArrayBuffer[];
    paletteFrameIndexes: number[];
    paletteSize: number;
    paletteFormat: 'rgb444' | 'rgb565' | 'rgba4444';
    palettePixelStride: number;
}

export interface QuantizePaletteInWorkerMessage {
    command: 'quantizePalette';
    frameBuffers: ArrayBuffer[];
    paletteSize: number;
    paletteFormat: 'rgb444' | 'rgb565' | 'rgba4444';
    palettePixelStride: number;
}

export interface ApplyPaletteInWorkerMessage {
    command: 'applyPalette';
    frameIndex: number;
    frameBuffer: ArrayBuffer;
    palette: number[][];
    paletteFormat: 'rgb444' | 'rgb565' | 'rgba4444';
}

export interface EncodeIndexedGifInWorkerMessage {
    command: 'encodeIndexedGif';
    width: number;
    height: number;
    frameDelayMs: number[];
    frameIndexBuffers: ArrayBuffer[];
    palette: number[][];
}

export interface EncodeJpegInWorkerMessage {
    command: 'encodeJpeg';
    width: number;
    height: number;
    frameBuffer: ArrayBuffer;
}

export interface EncodedGifFromWorkerMessage {
    command: 'encoded';
    buffer: ArrayBuffer;
}

export interface EncodedJpegFromWorkerMessage {
    command: 'encodedJpeg';
    buffer: ArrayBuffer;
}

export interface QuantizedPaletteFromWorkerMessage {
    command: 'quantizedPalette';
    palette: number[][];
}

export interface AppliedPaletteFromWorkerMessage {
    command: 'appliedPalette';
    frameIndex: number;
    buffer: ArrayBuffer;
}

export interface EncodeGifErrorFromWorkerMessage {
    command: 'error';
    error: string;
}

export type GifEncoderRequestMessage =
    | EncodeGifInWorkerMessage
    | QuantizePaletteInWorkerMessage
    | ApplyPaletteInWorkerMessage
    | EncodeIndexedGifInWorkerMessage
    | EncodeJpegInWorkerMessage;

export type GifEncoderResponseMessage =
    | EncodedGifFromWorkerMessage
    | EncodedJpegFromWorkerMessage
    | QuantizedPaletteFromWorkerMessage
    | AppliedPaletteFromWorkerMessage
    | EncodeGifErrorFromWorkerMessage;
