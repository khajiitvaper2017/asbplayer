import AudioClip from './audio-clip';
import { peakNormalizationGainForChannels } from './audio-normalizer';

describe('peakNormalizationGainForChannels', () => {
    it('returns 1 for silent audio', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0, 0, 0])])).toBe(1);
    });

    it('does not attenuate clips that are already loud enough', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0.2, -1, 0.3])])).toBe(1);
    });

    it('boosts quieter clips up to the target peak', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0.1, -0.5, 0.25])])).toBeCloseTo(1.9);
    });

    it('caps normalization gain', () => {
        expect(peakNormalizationGainForChannels([Float32Array.from([0.05, -0.1])])).toBe(4);
    });
});

describe('AudioClip', () => {
    it('can create a base64-backed clip', () => {
        const clip = AudioClip.fromBase64('clip.webm', 0, 1000, 1, 'AAAA', 'webm', undefined);
        expect(clip.name).toBe('clip_0.webm');
    });
});
