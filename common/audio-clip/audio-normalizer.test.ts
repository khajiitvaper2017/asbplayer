import AudioClip from './audio-clip';
import { applyPeakNormalizationToChannels, peakNormalizationGainForChannels } from './audio-normalizer';

describe('peakNormalizationGainForChannels', () => {
    it('returns 1 for silent audio', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0, 0, 0])])).toBe(1);
    });

    it('attenuates clips that are louder than the target peak', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0.2, -1, 0.3])])).toBeCloseTo(0.95);
    });

    it('returns 1 when peak already matches the target', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0.2, -0.95, 0.3])])).toBeCloseTo(1);
    });

    it('boosts quieter clips up to the target peak', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0.1, -0.5, 0.25])])).toBeCloseTo(1.9);
    });

    it('supports a custom target peak', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0.1, -0.5, 0.25])], 0.8)).toBeCloseTo(1.6);
    });

    it('caps normalization gain', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0.05, -0.1])])).toBe(4);
    });
});

describe('applyPeakNormalizationToChannels', () => {
    it('scales quiet channels in place', () => {
        const channels = [Float32Array.from([0.1, -0.5, 0.25])];
        expect(applyPeakNormalizationToChannels(channels)).toBe(true);
        expect(channels[0][0]).toBeCloseTo(0.19);
        expect(channels[0][1]).toBeCloseTo(-0.95);
        expect(channels[0][2]).toBeCloseTo(0.475);
    });

    it('scales to a custom target peak', () => {
        const channels = [Float32Array.from([0.1, -0.5, 0.25])];
        expect(applyPeakNormalizationToChannels(channels, 0.8)).toBe(true);
        expect(channels[0][0]).toBeCloseTo(0.16);
        expect(channels[0][1]).toBeCloseTo(-0.8);
        expect(channels[0][2]).toBeCloseTo(0.4);
    });

    it('attenuates already-loud channels', () => {
        const channels = [Float32Array.from([0.2, -1, 0.3])];
        expect(applyPeakNormalizationToChannels(channels)).toBe(true);
        expect(channels[0][0]).toBeCloseTo(0.19);
        expect(channels[0][1]).toBeCloseTo(-0.95);
        expect(channels[0][2]).toBeCloseTo(0.285);
    });

    it('can reduce all the way to silence at the lowest target', () => {
        const channels = [Float32Array.from([0.2, -1, 0.3])];
        expect(applyPeakNormalizationToChannels(channels, 0)).toBe(true);
        expect(channels[0][0]).toBeCloseTo(0);
        expect(channels[0][1]).toBeCloseTo(0);
        expect(channels[0][2]).toBeCloseTo(0);
    });
});

describe('AudioClip', () => {
    it('can create a base64-backed clip', () => {
        const clip = AudioClip.fromBase64('clip.webm', 0, 1000, 1, 'AAAA', 'webm', undefined);
        expect(clip.name).toBe('clip_0.webm');
    });
});
