import { ASB_SUBTITLE_INDEX_ATTRIBUTE } from '@project/common/annotations';

export default class NewWordSubtitleFilter {
    private excluded = new Set<number>();
    private observer?: MutationObserver;
    private refreshTimeout?: ReturnType<typeof setTimeout>;

    constructor(private readonly onChanged: () => void) {}

    includes(index: number): boolean {
        return !this.excluded.has(index);
    }

    start(): void {
        this.refresh();
        if (this.observer) return;
        const selector = `[${ASB_SUBTITLE_INDEX_ATTRIBUTE}]`;
        this.observer = new MutationObserver((mutations) => {
            if (
                this.refreshTimeout !== undefined ||
                !mutations.some(
                    ({ target, addedNodes, removedNodes }) =>
                        (target instanceof Element && target.closest(selector)) ||
                        [...addedNodes, ...removedNodes].some(
                            (node) =>
                                node instanceof Element && (node.matches(selector) || node.querySelector(selector))
                        )
                )
            )
                return;
            this.refreshTimeout = setTimeout(() => {
                this.refreshTimeout = undefined;
                if (this.refresh()) this.onChanged();
            }, 0);
        });
        this.observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class'],
        });
    }

    stop(): void {
        this.observer?.disconnect();
        this.observer = undefined;
        clearTimeout(this.refreshTimeout);
        this.refreshTimeout = undefined;
        this.excluded.clear();
    }

    private refresh(): boolean {
        const parsed = new Set<number>();
        const hasNewWords = new Set<number>();
        for (const root of document.querySelectorAll(`[${ASB_SUBTITLE_INDEX_ATTRIBUTE}]`)) {
            const index = Number(root.getAttribute(ASB_SUBTITLE_INDEX_ATTRIBUTE));
            if (root.querySelector('.jiten-word')) parsed.add(index);
            if (root.querySelector('.jiten-word.new')) hasNewWords.add(index);
        }
        // Keep lines available until Reader has parsed them, including when Reader is unavailable.
        const excluded = new Set([...parsed].filter((index) => !hasNewWords.has(index)));
        if (excluded.size === this.excluded.size && [...excluded].every((index) => this.excluded.has(index)))
            return false;
        this.excluded = excluded;
        return true;
    }
}
