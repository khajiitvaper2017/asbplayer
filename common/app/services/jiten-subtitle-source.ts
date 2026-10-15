import type { IndexedSubtitleModel } from '@project/common';
import { ASB_SUBTITLE_INDEX_ATTRIBUTE } from '@project/common/annotations';

export type SubtitleView = 'video' | 'panel';

class JitenSubtitleSource {
    private subtitles: readonly IndexedSubtitleModel[] = [];
    private elements = new Map<string, HTMLElement>();
    private container?: HTMLElement;
    private listeners = new Set<() => void>();

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    setSubtitles(subtitles: readonly IndexedSubtitleModel[]) {
        if (
            subtitles.length === this.subtitles.length &&
            subtitles.every(
                (s, i) =>
                    s.index === this.subtitles[i].index &&
                    s.track === this.subtitles[i].track &&
                    s.text === this.subtitles[i].text
            )
        )
            return;
        this.clear();
        this.subtitles = subtitles;
        this.container = document.createElement('div');
        this.container.className = 'asbplayer-offscreen';
        this.container.style.contentVisibility = 'hidden';
        this.container.style.contain = 'strict';
        document.body.append(this.container);
        // Give both views identical parser input instead of repeating each line within one paragraph.
        for (const view of ['video', 'panel'] as const) {
            const paragraph = document.createElement('div');
            for (const subtitle of subtitles) {
                if (!subtitle.text) continue;
                const home = document.createElement('span');
                const element = document.createElement('span');
                element.setAttribute(ASB_SUBTITLE_INDEX_ATTRIBUTE, String(subtitle.index));
                element.setAttribute('data-track', String(subtitle.track));
                element.innerHTML = subtitle.text;
                this.elements.set(`${subtitle.index}/${view}`, element);
                home.append(element);
                paragraph.append(home, document.createTextNode('\n'));
            }
            this.container.append(paragraph);
        }
        // shortcut: each transcript must fit Reader's API size cap; larger files need chunking.
        for (const listener of this.listeners) listener();
    }

    element(index: number, view: SubtitleView) {
        return this.elements.get(`${index}/${view}`);
    }

    clear() {
        this.container?.remove();
        for (const element of this.elements.values()) element.remove();
        this.elements.clear();
        this.subtitles = [];
        this.container = undefined;
        for (const listener of this.listeners) listener();
    }
}

export const jitenSubtitleSource = new JitenSubtitleSource();
