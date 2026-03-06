import AudioClip from './audio-clip';
import {
    applyLoudnessNormalizationToChannels,
    integratedLufsForChannels,
    loudnessNormalizationGainForChannels,
} from './audio-normalizer';

const sampleRate = 48_000;
const constantSignal = (amplitude: number, durationSeconds: number = 1) =>
    new Float32Array(sampleRate * durationSeconds).fill(amplitude);

describe('integratedLufsForChannels', () => {
    it('returns undefined for silence', () => {
        expect(integratedLufsForChannels([constantSignal(0)], sampleRate)).toBeUndefined();
    });

    it('reports louder LUFS for stronger signals', () => {
        const quiet = integratedLufsForChannels([constantSignal(0.25)], sampleRate)!;
        const loud = integratedLufsForChannels([constantSignal(0.5)], sampleRate)!;
        expect(loud).toBeGreaterThan(quiet);
        expect(loud - quiet).toBeCloseTo(6, 0);
    });
});

describe('loudnessNormalizationGainForChannels', () => {
    it('returns 1 for silence', () => {
        expect(loudnessNormalizationGainForChannels([constantSignal(0)], sampleRate)).toBe(1);
    });

    it('boosts quieter clips toward the LUFS target', () => {
        expect(loudnessNormalizationGainForChannels([constantSignal(0.05)], sampleRate, -16)).toBeGreaterThan(1);
    });

    it('attenuates louder clips toward the LUFS target', () => {
        const loud = [constantSignal(0.8)];
        const measuredLufs = integratedLufsForChannels(loud, sampleRate)!;
        expect(loudnessNormalizationGainForChannels(loud, sampleRate, measuredLufs - 6)).toBeLessThan(1);
    });

    it('caps boost to avoid extreme amplification', () => {
        expect(loudnessNormalizationGainForChannels([constantSignal(0.01)], sampleRate, -8)).toBe(4);
    });
});

describe('applyLoudnessNormalizationToChannels', () => {
    it('scales channels in place toward the target LUFS', () => {
        const channels = [constantSignal(0.05)];
        const targetLufs = -16;
        const before = integratedLufsForChannels(channels, sampleRate)!;
        expect(applyLoudnessNormalizationToChannels(channels, sampleRate, targetLufs)).toBe(true);
        const after = integratedLufsForChannels(channels, sampleRate)!;
        expect(Math.abs(after - targetLufs)).toBeLessThan(Math.abs(before - targetLufs));
    });

    it('also reduces loud clips toward the target LUFS', () => {
        const channels = [constantSignal(0.8)];
        const targetLufs = -16;
        const before = integratedLufsForChannels(channels, sampleRate)!;
        expect(applyLoudnessNormalizationToChannels(channels, sampleRate, targetLufs)).toBe(true);
        const after = integratedLufsForChannels(channels, sampleRate)!;
        expect(Math.abs(after - targetLufs)).toBeLessThan(Math.abs(before - targetLufs));
    });
});

describe('AudioClip', () => {
    it('can create a base64-backed clip', () => {
        const clip = AudioClip.fromBase64('clip.webm', 0, 1000, 1, 'AAAA', 'webm', undefined);
        expect(clip.name).toBe('clip_0.webm');
    });
});
