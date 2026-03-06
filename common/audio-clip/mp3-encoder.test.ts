import { mixChannelsToMono } from './mp3-encoder';

describe('mixChannelsToMono', () => {
    it('downmixes stereo channels with equal-power scaling', () => {
        const mono = mixChannelsToMono([Float32Array.from([1, 0.5]), Float32Array.from([-1, 0.25])]);
        expect(mono).toHaveLength(1);
        expect(mono[0][0]).toBeCloseTo(0);
        expect(mono[0][1]).toBeCloseTo(0.53033, 4);
    });

    it('leaves mono audio unchanged', () => {
        const channels = [Float32Array.from([0.1, -0.2])];
        expect(mixChannelsToMono(channels)).toBe(channels);
    });

    it('scales down the mono result when equal-power mix would clip', () => {
        const mono = mixChannelsToMono([Float32Array.from([1, 1]), Float32Array.from([1, 1])]);
        expect(mono[0][0]).toBeCloseTo(1);
        expect(mono[0][1]).toBeCloseTo(1);
    });
});
