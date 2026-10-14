import { useMemo, useRef } from 'react';
import type { SubtitleSettings, TextSubtitleSettings } from '@project/common/settings';
import { areSubtitleSettingsEqual, textSubtitleSettingsForTrack } from '@project/common/settings';
import { computeStyleString, computeStyles } from '@project/common/util';

interface TrackStyles {
    styles: { [key: string]: any };
    styleString: string;
    classes: string;
}

const useStableValue = <T>(value: T, areEqual: (left: T, right: T) => boolean) => {
    const stableValueRef = useRef(value);
    const previousValueRef = useRef(value);

    if (value !== previousValueRef.current) {
        if (!areEqual(stableValueRef.current, value)) stableValueRef.current = value;
        previousValueRef.current = value;
    }

    return stableValueRef.current;
};

export const useStableSubtitleSettings = (settings: SubtitleSettings) => {
    return useStableValue(settings, areSubtitleSettingsEqual);
};

export const useSubtitleStyles = (settings: SubtitleSettings, trackCount: number) => {
    const stableSettings = useStableSubtitleSettings(settings);

    return useMemo(() => {
        const tracks: TrackStyles[] = [];
        for (let track = 0; track < trackCount; ++track) {
            const s = textSubtitleSettingsForTrack(stableSettings, track) as TextSubtitleSettings;
            tracks.push({
                styles: computeStyles(s),
                styleString: computeStyleString(s),
                classes: s.subtitleBlur ? 'asbplayer-subtitles-blurred asb-subtitles' : 'asb-subtitles',
            });
        }
        return tracks;
    }, [stableSettings, trackCount]);
};
