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

export interface EncodeGifErrorFromWorkerMessage {
    command: 'error';
    error: string;
}

export type GifEncoderRequestMessage = EncodeGifInWorkerMessage | EncodeJpegInWorkerMessage;

export type GifEncoderResponseMessage =
    | EncodedGifFromWorkerMessage
    | EncodedJpegFromWorkerMessage
    | EncodeGifErrorFromWorkerMessage;
