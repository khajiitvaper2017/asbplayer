import AudioClip from './audio-clip';
import { applyGainToChannels, applyLightCompressionToChannels } from './audio-normalizer';

const sampleRate = 48_000;
const constantSignal = (amplitude: number, durationSeconds: number = 1) =>
    new Float32Array(sampleRate * durationSeconds).fill(amplitude);

describe('applyGainToChannels', () => {
    it('applies the same gain to every channel', () => {
        const channels = [Float32Array.from([0.25, -0.5]), Float32Array.from([0.5, -0.25])];
        applyGainToChannels(channels, 0.5);
        expect(Array.from(channels[0])).toEqual([0.125, -0.25]);
        expect(Array.from(channels[1])).toEqual([0.25, -0.125]);
    });
});

describe('applyLightCompressionToChannels', () => {
    it('reduces peaks for loud material', () => {
        const channels = [constantSignal(0.95)];
        const info = applyLightCompressionToChannels(channels, sampleRate);
        expect(info.maxReductionDb).toBeGreaterThan(0);
        expect(channels[0][channels[0].length - 1]).toBeLessThan(0.95);
    });

    it('largely leaves quiet material alone', () => {
        const channels = [constantSignal(0.05)];
        const info = applyLightCompressionToChannels(channels, sampleRate);
        expect(info.maxReductionDb).toBeCloseTo(0, 4);
        expect(channels[0][channels[0].length - 1]).toBeCloseTo(0.05, 4);
    });
});

describe('AudioClip', () => {
    it('can create a base64-backed clip', () => {
        const clip = AudioClip.fromBase64('clip.webm', 0, 1000, 1, 'AAAA', 'webm', undefined);
        expect(clip.name).toBe('clip_0.webm');
    });
});
