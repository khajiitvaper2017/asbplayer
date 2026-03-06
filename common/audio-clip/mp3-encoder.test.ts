import { mixChannelsToMono } from './mp3-encoder';

describe('mixChannelsToMono', () => {
    it('averages stereo channels into mono', () => {
        const mono = mixChannelsToMono([Float32Array.from([1, 0.5]), Float32Array.from([-1, 0.25])]);
        expect(mono).toHaveLength(1);
        expect(Array.from(mono[0])).toEqual([0, 0.375]);
    });

    it('leaves mono audio unchanged', () => {
        const channels = [Float32Array.from([0.1, -0.2])];
        expect(mixChannelsToMono(channels)).toBe(channels);
    });
});
