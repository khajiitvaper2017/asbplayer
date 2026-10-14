import type { MutableRefObject, RefObject } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListRange, TableVirtuosoHandle } from 'react-virtuoso';
import type { DisplaySubtitleModel } from '@project/common';
import { normalizedLookupTerms, normalizeSearchText } from '@project/common/util';

const parseRegexQuery = (query: string): RegExp | undefined => {
    const regexMatch = /^\/(.+)\/([a-z]*)$/.exec(query);
    if (!regexMatch) return;
    try {
        return new RegExp(regexMatch[1], regexMatch[2].replace(/[gy]/g, ''));
    } catch {
        return;
    }
};

const subtitleSearchableText = (subtitle: DisplaySubtitleModel): string => {
    const tokens = subtitle.tokenization?.tokens;
    if (!tokens?.length) return subtitle.text;
    let readings = '';
    for (const token of tokens) {
        for (const reading of token.readings) {
            if (reading.reading) readings += reading.reading;
        }
    }
    return readings.length ? `${subtitle.text}\n${readings}` : subtitle.text;
};

interface UseSubtitleFindParams {
    subtitles?: DisplaySubtitleModel[];
    disableKeyEventsRef: MutableRefObject<boolean>;
    hiddenRef: MutableRefObject<boolean>;
    lastScrollTimestampRef: MutableRefObject<number>;
    subtitleListRef: MutableRefObject<DisplaySubtitleModel[] | undefined>;
    virtuosoRef: RefObject<TableVirtuosoHandle | null>;
    visibleRangeRef: MutableRefObject<ListRange>;
    setHighlightedJumpToSubtitleIndex: (index: number | undefined) => void;
}

export const useSubtitleFind = ({
    subtitles,
    disableKeyEventsRef,
    hiddenRef,
    lastScrollTimestampRef,
    subtitleListRef,
    virtuosoRef,
    visibleRangeRef,
    setHighlightedJumpToSubtitleIndex,
}: UseSubtitleFindParams) => {
    const [open, setOpen] = useState<boolean>(false);
    const [query, setQuery] = useState<string>('');
    const [expansion] = useState<{ query: string; terms: string[] }>({ query: '', terms: [] });
    const [currentMatchPosition, setCurrentMatchPosition] = useState<number>(0);
    const inputRef = useRef<HTMLInputElement | null>(null);

    const matches = useMemo(() => {
        const trimmed = query.trim();
        if (!open || !subtitles || !subtitles.length || !trimmed) return [];

        const matches: number[] = [];
        const regex = parseRegexQuery(query);
        if (regex) {
            for (const [i, subtitle] of subtitles.entries()) {
                const searchableText = subtitleSearchableText(subtitle);
                if (regex.test(searchableText)) matches.push(i);
            }
        } else {
            const terms = normalizedLookupTerms(trimmed).concat(expansion.query === trimmed ? expansion.terms : []);
            for (const [i, subtitle] of subtitles.entries()) {
                const normalized = normalizeSearchText(subtitleSearchableText(subtitle));
                if (terms.some((term) => normalized.includes(term))) matches.push(i);
            }
        }
        return matches;
    }, [open, subtitles, query, expansion]);
    const matchesRef = useRef(matches);
    matchesRef.current = matches;

    const scrollToMatch = useCallback(
        (subtitleIndex: number) => {
            lastScrollTimestampRef.current = Date.now();
            if (!hiddenRef.current) {
                virtuosoRef.current?.scrollToIndex({
                    index: subtitleIndex,
                    align: 'center',
                    behavior: 'auto',
                });
            }
            setHighlightedJumpToSubtitleIndex(subtitleIndex);
        },
        [hiddenRef, lastScrollTimestampRef, setHighlightedJumpToSubtitleIndex, virtuosoRef]
    );

    useEffect(() => {
        if (!open) return;
        const trimmed = query.trim();
        const searchCompleted = !trimmed || parseRegexQuery(query) !== undefined || expansion.query === trimmed;
        if (!searchCompleted) return;
        if (!matches.length) {
            setHighlightedJumpToSubtitleIndex(undefined);
            setCurrentMatchPosition(0);
            return;
        }
        const firstVisibleIndex = visibleRangeRef.current.startIndex;
        const matchPosition = Math.max(
            0,
            matches.findIndex((subtitleIndex) => subtitleIndex >= firstVisibleIndex)
        );
        setCurrentMatchPosition(matchPosition);
        scrollToMatch(matches[matchPosition]);
    }, [matches, open, query, expansion.query, scrollToMatch, setHighlightedJumpToSubtitleIndex, visibleRangeRef]);

    const navigate = useCallback(
        (delta: number) => {
            const matches = matchesRef.current;
            if (!matches.length) return;
            setCurrentMatchPosition((current) => {
                const next = (current + delta + matches.length) % matches.length;
                scrollToMatch(matches[next]);
                return next;
            });
        },
        [scrollToMatch]
    );

    const next = useCallback(() => navigate(1), [navigate]);
    const previous = useCallback(() => navigate(-1), [navigate]);

    const close = useCallback(() => {
        setOpen(false);
        setQuery('');
        setCurrentMatchPosition(0);
        setHighlightedJumpToSubtitleIndex(undefined);
    }, [setHighlightedJumpToSubtitleIndex]);

    useEffect(() => {
        const handleGlobalKeyDown = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && !event.altKey && (event.key === 'f' || event.key === 'F')) {
                if (disableKeyEventsRef.current || !subtitleListRef.current || !subtitleListRef.current.length) {
                    return;
                }
                event.preventDefault();
                event.stopPropagation();
                setOpen(true);
                requestAnimationFrame(() => {
                    inputRef.current?.focus();
                    inputRef.current?.select();
                });
            }
        };

        document.addEventListener('keydown', handleGlobalKeyDown, true);
        return () => document.removeEventListener('keydown', handleGlobalKeyDown, true);
    }, [disableKeyEventsRef, subtitleListRef]);

    const resultsLabel = query.trim() ? `${matches.length ? currentMatchPosition + 1 : 0}/${matches.length}` : '';

    return {
        open,
        query,
        inputRef,
        matches,
        resultsLabel,
        setQuery,
        next,
        previous,
        close,
    };
};
