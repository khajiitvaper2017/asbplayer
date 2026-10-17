import type { IndexedSubtitleModel } from '@project/common';
import { ASB_SUBTITLE_INDEX_ATTRIBUTE } from '@project/common/annotations';

export type SubtitleView = 'video' | 'panel';

class JitenSubtitleSource {
    private subtitles: readonly IndexedSubtitleModel[] = [];
    private elements = new Map<string, HTMLElement>();
    private fragments = new Map<number, { element: HTMLElement; home: HTMLElement }[]>();
    private assStyles = false;
    private container?: HTMLElement;
    private listeners = new Set<() => void>();

    subscribe = (listener: () => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    setSubtitles(subtitles: readonly IndexedSubtitleModel[], assStyles = false) {
        if (
            assStyles === this.assStyles &&
            subtitles.length === this.subtitles.length &&
            subtitles.every(
                (s, i) =>
                    s.index === this.subtitles[i].index &&
                    s.track === this.subtitles[i].track &&
                    (!assStyles || s.assText === this.subtitles[i].assText) &&
                    s.text === this.subtitles[i].text
            )
        )
            return;
        this.clear();
        this.subtitles = subtitles;
        this.assStyles = assStyles;
        this.container = document.createElement('div');
        this.container.className = 'asbplayer-offscreen';
        this.container.style.contentVisibility = 'hidden';
        this.container.style.contain = 'strict';
        const paragraph = document.createElement('div');
        const fragment = document.createDocumentFragment();
        for (const subtitle of subtitles) {
            if (!subtitle.text) continue;
            for (const view of ['video', 'panel'] as const) {
                const home = document.createElement('div');
                const element = document.createElement('span');
                element.setAttribute(ASB_SUBTITLE_INDEX_ATTRIBUTE, String(subtitle.index));
                element.setAttribute('data-track', String(subtitle.track));
                if (assStyles && view === 'panel' && subtitle.assText) {
                    const fragments: { element: HTMLElement; home: HTMLElement }[] = [];
                    for (const text of subtitle.assText) {
                        if (text === '\n') {
                            element.append(document.createTextNode('\n'));
                            continue;
                        }
                        const span = document.createElement('span');
                        const home = document.createElement('span');
                        span.className = 'asbplayer-ass-fragment';
                        span.textContent = text;
                        home.append(span);
                        element.append(home);
                        fragments.push({ element: span, home });
                    }
                    this.fragments.set(subtitle.index, fragments);
                } else {
                    element.innerHTML = subtitle.text;
                }
                this.elements.set(`${subtitle.index}/${view}`, element);
                home.append(element);
                fragment.append(home, document.createTextNode('\n'));
            }
        }
        // Reader needs cue boundaries even when subtitles only use ASCII punctuation.
        paragraph.append(fragment);
        document.body.append(this.container);
        this.container.append(paragraph);
        for (const listener of this.listeners) listener();
    }

    element(index: number, view: SubtitleView) {
        return this.elements.get(`${index}/${view}`);
    }

    assFragments(index: number) {
        return this.fragments.get(index);
    }

    clear() {
        this.container?.remove();
        for (const element of this.elements.values()) element.remove();
        this.elements.clear();
        for (const fragments of this.fragments.values()) for (const fragment of fragments) fragment.element.remove();
        this.fragments.clear();
        this.subtitles = [];
        this.container = undefined;
        for (const listener of this.listeners) listener();
    }
}

export const jitenSubtitleSource = new JitenSubtitleSource();
