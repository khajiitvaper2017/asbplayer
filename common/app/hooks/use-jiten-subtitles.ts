import type { IndexedSubtitleModel } from '@project/common';
import { ASB_SUBTITLE_INDEX_ATTRIBUTE } from '@project/common/annotations';
import { jitenSubtitleSource as source } from '@project/common/app/services/jiten-subtitle-source';
import type { SubtitleView } from '@project/common/app/services/jiten-subtitle-source';
import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore } from 'react';

const preparedStudyElements = new WeakSet<HTMLElement>();
const kanaOnly = /^[\u3040-\u309f\u30a0-\u30ff\s・ー]+$/;

export const useJitenSubtitleSource = (subtitles: readonly IndexedSubtitleModel[], enabled = true) => {
    useLayoutEffect(() => {
        if (enabled) source.setSubtitles(subtitles);
    }, [subtitles, enabled]);
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
    const element = useSyncExternalStore(source.subscribe, () => source.element(index, view));
    return useCallback(
        (container: T | null) => {
            if (!container) return;
            container.setAttribute('data-asb-study', '');
            const decorated = element && (element.matches('[ajb]') || element.querySelector('[ajb]'));
            if (view !== 'panel' || !decorated) container.innerHTML = html;
            if (!element) return;
            const home = element.parentElement!;
            const target =
                view === 'video'
                    ? (container.querySelector<HTMLElement>(`[${ASB_SUBTITLE_INDEX_ATTRIBUTE}]`) ?? container)
                    : container;
            let observer: MutationObserver | undefined;
            const attach = () => {
                observer?.disconnect();
                if (!preparedStudyElements.has(element)) {
                    for (const word of element.querySelectorAll('.jiten-word:not(.unparsed)')) {
                        if (word.textContent?.trim() && kanaOnly.test(word.textContent)) {
                            word.classList.add('asb-kana-only');
                        }
                    }
                    preparedStudyElements.add(element);
                }
                target.replaceChildren(element);
            };
            if (decorated) {
                attach();
            } else {
                observer = new MutationObserver(() => {
                    if (element.matches('[ajb]') || element.querySelector('[ajb]')) attach();
                });
                observer.observe(element, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ['ajb'],
                });
            }
            return () => {
                observer?.disconnect();
                if (container.contains(element)) home.append(element);
            };
        },
        [element, html, view]
    );
};
