declare module 'vtt.js';
declare module 'lamejs';
declare module 'sanitize-filename';
declare module 'gifenc' {
    export type Palette = number[][];

    export interface Encoder {
        writeFrame(
            index: Uint8Array,
            width: number,
            height: number,
            opts?: {
                palette?: Palette;
                first?: boolean;
                transparent?: boolean;
                transparentIndex?: number;
                delay?: number;
                repeat?: number;
                dispose?: number;
            }
        ): void;
        finish(): void;
        bytesView(): Uint8Array;
    }

    export function GIFEncoder(opts?: { auto?: boolean; initialCapacity?: number }): Encoder;
    export function quantize(
        rgba: Uint8Array | Uint8ClampedArray,
        maxColors: number,
        opts?: {
            format?: 'rgb565' | 'rgb444' | 'rgba4444';
            oneBitAlpha?: boolean | number;
            clearAlpha?: boolean;
            clearAlphaThreshold?: number;
            clearAlphaColor?: number;
        }
    ): Palette;
    export function applyPalette(
        rgba: Uint8Array | Uint8ClampedArray,
        palette: Palette,
        format?: 'rgb565' | 'rgb444' | 'rgba4444'
    ): Uint8Array;
}
