import Image from './image';

const gifDataForInterval = (startTimestamp: number, endTimestamp: number) => {
    const image = Image.fromGifFile(
        { name: 'clip.mp4', blobUrl: 'blob:clip' },
        startTimestamp,
        endTimestamp,
        0,
        0,
        (() => {
            throw new Error('worker should not be used in this test');
        }) as any
    );

    if (!image) {
        throw new Error('Expected GIF image');
    }

    return (image as any).data as {
        _frameDelayMs: (frameCount: number, sampledFrameCount?: number) => number[];
    };
};

it('uses sampled frame intervals for gif delay timing', () => {
    const data = gifDataForInterval(0, 1000);
    expect(data._frameDelayMs(11, 11)).toEqual(Array.from({ length: 11 }, () => 100));
});

it('keeps source timing when captured frame count is truncated', () => {
    const data = gifDataForInterval(0, 1000);
    expect(data._frameDelayMs(3, 11)).toEqual([100, 100, 100]);
});

it('uses clip duration when encoding a single frame', () => {
    const data = gifDataForInterval(0, 1000);
    expect(data._frameDelayMs(1, 1)).toEqual([1000]);
});
