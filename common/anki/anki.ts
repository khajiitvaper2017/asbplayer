import type { AnkiExportMode, MediaFragment } from '@project/common';
import type { AudioClip } from '@project/common/audio-clip';

export interface ExportParams {
    text: string | undefined;
    track1: string | undefined;
    track2: string | undefined;
    track3: string | undefined;
    definition: string | undefined;
    audioClip: AudioClip | undefined;
    image: MediaFragment | undefined;
    word: string | undefined;
    source: string | undefined;
    url: string | undefined;
    customFieldValues: { [key: string]: string };
    mode: AnkiExportMode;
}
