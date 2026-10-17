import type { IndexedSubtitleModel } from '@project/common';
import { ASB_SUBTITLE_INDEX_ATTRIBUTE } from '@project/common/annotations';
import { jitenSubtitleSource as source } from '@project/common/app/services/jiten-subtitle-source';
import type { SubtitleView } from '@project/common/app/services/jiten-subtitle-source';
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';

const kanaOnly = /^[\u3040-\u309f\u30a0-\u30ff\s・ー]+$/;
const subtitleHomes = new WeakMap<HTMLElement, HTMLElement>();

export const markKanaOnlyWords = (element: ParentNode) => {
    for (const word of element.querySelectorAll('.jiten-word:not(.unparsed):not(.asb-kana-only)')) {
        if (word.textContent?.trim() && kanaOnly.test(word.textContent)) word.classList.add('asb-kana-only');
    }
};

const displayCopy = (element: HTMLElement) => {
    const copy = element.cloneNode(true) as HTMLElement;
    for (const word of copy.querySelectorAll('.hovered')) word.classList.remove('hovered');
    return copy;
};

export const useJitenSubtitleSource = (
    subtitles: readonly IndexedSubtitleModel[],
    enabled = true,
    assStyles = false
) => {
    useLayoutEffect(() => {
        if (enabled) source.setSubtitles(subtitles, assStyles);
    }, [subtitles, enabled, assStyles]);
    useEffect(
        () => () => {
            if (enabled) source.clear();
        },
        [enabled]
    );
};

export const useJitenSubtitleElement = <T extends HTMLElement = HTMLDivElement>(
    index: number,
    html: string,
    view: SubtitleView = 'video'
) => {
    const element = useSyncExternalStore(source.subscribe, () => source.element(index, 'video'));
    return useCallback(
        (container: T | null) => {
            if (!container) return;
            container.setAttribute('data-asb-study', '');
            container.innerHTML = html;
            if (!element) return;
            const home = subtitleHomes.get(element) ?? element.parentElement!;
            subtitleHomes.set(element, home);
            const target =
                view === 'video'
                    ? (container.querySelector<HTMLElement>(`[${ASB_SUBTITLE_INDEX_ATTRIBUTE}]`) ?? container)
                    : container;
            const hasReaderMarkup = () => element.matches('[ajb]') || element.querySelector('[ajb]');
            const update = () => {
                if (!hasReaderMarkup()) return;
                markKanaOnlyWords(element);
                if (element.parentElement === home) target.replaceChildren(element);
                else if (element.parentElement !== target) target.replaceChildren(displayCopy(element));
            };
            // Reader stores sentence and conjugation data on originals. Move them to the
            // interacting view before its mouse/touch events; the other view is display only.
            let hoverFrame = 0;
            const activate = (event: PointerEvent) => {
                if (element.parentElement === target || !hasReaderMarkup()) return;
                if (element.parentElement !== home) element.replaceWith(displayCopy(element));
                target.replaceChildren(element);
                if (event.pointerType === 'mouse') {
                    hoverFrame = requestAnimationFrame(() => {
                        if (element.parentElement !== target) return;
                        const word = element.matches('[wordid]:hover')
                            ? element
                            : element.querySelector('[wordid]:hover');
                        word?.dispatchEvent(new MouseEvent('mouseenter'));
                    });
                }
            };
            target.addEventListener('pointerover', activate);
            const observer = new MutationObserver(update);
            observer.observe(element, { childList: true, subtree: true, attributes: true, characterData: true });
            update();
            return () => {
                observer.disconnect();
                cancelAnimationFrame(hoverFrame);
                target.removeEventListener('pointerover', activate);
                if (container.contains(element)) home.append(element);
            };
        },
        [element, html, view]
    );
};
