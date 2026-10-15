import type { MediaFragment } from '@project/common';
import type { AudioClip } from '@project/common/audio-clip';

export interface ExportParams {
    text: string | undefined;
    audioClip: AudioClip | undefined;
    image: MediaFragment | undefined;
    source: string | undefined;
}
