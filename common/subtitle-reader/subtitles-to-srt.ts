import SrtParser from '@qgustavor/srt-parser';
import type { SubtitleModel } from '@project/common';

// Extracted from subtitle-reader.ts so it can be used in service worker
export const subtitlesToSrt = (subtitles: Pick<SubtitleModel, 'start' | 'end' | 'text' | 'alignment'>[]) => {
    const parser = new SrtParser({ numericTimestamps: true });
    const nodes = subtitles.map((subtitle, i) => {
        return {
            id: String(i),
            startTime: subtitle.start,
            endTime: subtitle.end,
            text: subtitle.alignment === 'top' ? '{\\an8}' + subtitle.text : subtitle.text,
        };
    });
    return parser.toSrt(nodes);
};
