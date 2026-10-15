import React from 'react';
import type { SubtitleStudySettings, SubtitleStudyWordType } from '@project/common/settings';
import { subtitleStudyWordTypes } from '@project/common/settings';

const root = '[data-asb-study]';
const wordSelector = (types: readonly SubtitleStudyWordType[]) =>
    subtitleStudyWordTypes
        .filter((type) => types.includes(type))
        .map((type) => `.${type === 'kana' ? 'asb-kana-only' : type}`)
        .join(',');

export const subtitleStudyCss = (settings: SubtitleStudySettings) => {
    const blur = wordSelector(settings.subtitleStudyBlurWordTypes);
    const hide = wordSelector(settings.subtitleStudyHideWordTypes);
    const radius = Math.min(40, Math.max(0, settings.subtitleStudyBlurRadius || 0));
    const fade = Math.min(1, Math.max(0, settings.subtitleStudyFadeSeconds || 0));
    return `
        ${
            settings.subtitleStudyBlurEnabled && blur
                ? `
            ${root}:not(:hover):not(:focus-within) :is(.jiten-word:is(${blur}), .jiten-word:is(${blur}) *) {
                -webkit-text-fill-color: transparent !important;
                -webkit-text-stroke: 0 !important;
                text-shadow: 0 0 ${radius}px currentColor !important;
                text-decoration-color: transparent !important;
            }
        `
                : ''
        }
        ${
            settings.subtitleStudyHideEnabled && hide
                ? `
            ${root} { transition: opacity ${fade}s ease; }
            ${root}:has(.jiten-word):not(:has(.jiten-word:not(:is(${hide})))):not(:hover):not(:focus-within) {
                opacity: 0;
            }
            @media (prefers-reduced-motion: reduce) { ${root} { transition: none; } }
        `
                : ''
        }
    `;
};

export default React.memo(function SubtitleStudyStyles({ settings }: { settings: SubtitleStudySettings }) {
    return <style>{subtitleStudyCss(settings)}</style>;
});
