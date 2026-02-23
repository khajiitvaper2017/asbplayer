export interface EncodeGifInWorkerMessage {
    command: 'encode';
    width: number;
    height: number;
    delayMs: number;
    frameBuffers: ArrayBuffer[];
    paletteFrameIndexes: number[];
    paletteSize: number;
    paletteFormat: 'rgb444' | 'rgb565' | 'rgba4444';
    palettePixelStride: number;
}

export interface EncodedGifFromWorkerMessage {
    command: 'encoded';
    buffer: ArrayBuffer;
}

export interface EncodeGifErrorFromWorkerMessage {
    command: 'error';
    error: string;
}
