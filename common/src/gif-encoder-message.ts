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

export interface EncodedGifFromWorkerMessage {
    command: 'encoded';
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
    | EncodeIndexedGifInWorkerMessage;

export type GifEncoderResponseMessage =
    | EncodedGifFromWorkerMessage
    | QuantizedPaletteFromWorkerMessage
    | AppliedPaletteFromWorkerMessage
    | EncodeGifErrorFromWorkerMessage;
