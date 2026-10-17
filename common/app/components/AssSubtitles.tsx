import React, { useEffect, useRef } from 'react';
import ASS from 'assjs';
import type { AssSubtitleTrack, IndexedSubtitleModel } from '@project/common';
import { ASB_SUBTITLE_INDEX_ATTRIBUTE } from '@project/common/annotations';
import { jitenSubtitleSource } from '@project/common/app/services/jiten-subtitle-source';
import { markKanaOnlyWords } from '@project/common/app/hooks/use-jiten-subtitles';
import { useAssFonts } from '@project/common/app/hooks/use-ass-fonts';

interface Props {
    video: HTMLVideoElement;
    track: AssSubtitleTrack;
    subtitles: readonly IndexedSubtitleModel[];
    showingSubtitles: readonly IndexedSubtitleModel[];
    offset: number;
    visible: boolean;
    className?: string;
    onMouseOver: React.MouseEventHandler<HTMLDivElement>;
    onMouseOut: React.MouseEventHandler<HTMLDivElement>;
    onError: (error: string) => void;
}

export default function AssSubtitles(props: Props) {
    const { video, track, offset, visible, className, onMouseOver, onMouseOut, onError } = props;
    const containerRef = useRef<HTMLDivElement>(null);
    const rendererRef = useRef<ASS>(undefined);
    const propsRef = useRef(props);
    propsRef.current = props;
    const refreshRef = useRef<() => void>(() => {});
    const content = useAssFonts(track.content);

    useEffect(() => {
        if (content === undefined) return;
        const container = containerRef.current!;
        const bindings = new Map<
            HTMLElement,
            {
                index: number;
                fragments: NonNullable<ReturnType<typeof jitenSubtitleSource.assFragments>>;
            }
        >();
        const restore = (dialogue: HTMLElement) => {
            for (const { element, home } of bindings.get(dialogue)!.fragments) home.append(element);
            bindings.delete(dialogue);
        };
        const refresh = () => {
            const { subtitles, showingSubtitles, offset } = propsRef.current;
            const showing = new Set(showingSubtitles.map((subtitle) => subtitle.index));
            for (const [dialogue, binding] of bindings) {
                if (
                    !container.contains(dialogue) ||
                    binding.fragments !== jitenSubtitleSource.assFragments(binding.index)
                ) {
                    restore(dialogue);
                }
            }
            const timestamp = video.currentTime * 1000 - offset;
            const targets = new Map<number, { dialogue: HTMLElement; slots: HTMLElement[] }>();
            for (const dialogue of container.querySelectorAll<HTMLElement>('.ASS-dialogue')) {
                const slots = Array.from(dialogue.querySelectorAll<HTMLElement>('[data-text]'));
                const text = slots.map((slot) => slot.dataset.text).join('');
                const subtitle = subtitles.find(
                    (subtitle) =>
                        subtitle.track === track.track &&
                        subtitle.assText &&
                        subtitle.originalStart <= timestamp &&
                        timestamp <= subtitle.originalEnd &&
                        subtitle.assText.filter((text) => text !== '\n').join('') === text
                );
                if (!subtitle) continue;
                dialogue.setAttribute(ASB_SUBTITLE_INDEX_ATTRIBUTE, String(subtitle.index));
                dialogue.dataset.track = String(track.track);
                dialogue.setAttribute('data-asb-study', '');
                dialogue.style.visibility = showing.has(subtitle.index) ? '' : 'hidden';
                const previous = targets.get(subtitle.index);
                if (!previous || Number(dialogue.style.zIndex) >= Number(previous.dialogue.style.zIndex)) {
                    targets.set(subtitle.index, { dialogue, slots });
                }
            }
            for (const [dialogue, binding] of bindings) {
                if (targets.get(binding.index)?.dialogue !== dialogue) restore(dialogue);
            }
            for (const [index, { dialogue, slots }] of targets) {
                if (bindings.has(dialogue)) continue;
                const fragments = jitenSubtitleSource.assFragments(index);
                if (!fragments || fragments.length !== slots.length) continue;
                // Keep Reader's original nodes: sentence and conjugation data live outside the DOM.
                slots.forEach((slot, index) => slot.replaceChildren(fragments[index].element));
                bindings.set(dialogue, { index, fragments });
            }
            markKanaOnlyWords(container);
        };
        const observer = new MutationObserver((mutations) => {
            markKanaOnlyWords(container);
            if (
                mutations.some(({ addedNodes, removedNodes }) =>
                    [...addedNodes, ...removedNodes].some(
                        (node) =>
                            node instanceof Element &&
                            (node.matches('.ASS-dialogue') || node.querySelector('.ASS-dialogue'))
                    )
                )
            )
                refresh();
        });
        observer.observe(container, { childList: true, subtree: true });
        refreshRef.current = refresh;
        const unsubscribe = jitenSubtitleSource.subscribe(refresh);
        let renderer: ASS;
        try {
            renderer = new ASS(content, video, { container });
            rendererRef.current = renderer;
            renderer.delay = propsRef.current.offset / 1000;
            refresh();
        } catch (error) {
            observer.disconnect();
            unsubscribe();
            container.replaceChildren();
            onError(error instanceof Error ? error.message : String(error));
            return;
        }
        return () => {
            observer.disconnect();
            unsubscribe();
            refreshRef.current = () => {};
            for (const dialogue of bindings.keys()) restore(dialogue);
            renderer.destroy();
            rendererRef.current = undefined;
            container.replaceChildren();
        };
    }, [video, track, content, onError]);

    useEffect(() => {
        if (rendererRef.current) rendererRef.current.delay = offset / 1000;
    }, [offset]);
    useEffect(() => refreshRef.current(), [props.subtitles, props.showingSubtitles]);

    return (
        <div
            ref={containerRef}
            className={`asbplayer-ass-subtitles ${className ?? ''}`}
            data-track={track.track}
            style={{ visibility: visible ? undefined : 'hidden' }}
            onMouseOver={onMouseOver}
            onMouseOut={onMouseOut}
        />
    );
}
