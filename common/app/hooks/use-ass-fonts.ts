import { useEffect, useState } from 'react';
import { assContentForRendering } from '@project/common/subtitle-reader/ass-content';
import { asbError } from '@project/common/util/log';

interface LocalFont {
    family: string;
    postscriptName: string;
    blob: () => Promise<Blob>;
}

const queryLocalFonts = (window as Window & { queryLocalFonts?: () => Promise<LocalFont[]> }).queryLocalFonts;
const loadedFamilies = new Map<string, Promise<string | undefined>>();

function fontMetrics(buffer: ArrayBuffer): FontFaceDescriptors {
    const view = new DataView(buffer);
    const tables = new Map<string, number>();
    for (let i = 0; i < view.getUint16(4); i++) {
        const record = 12 + i * 16;
        const tag = String.fromCharCode(...new Uint8Array(buffer, record, 4));
        tables.set(tag, view.getUint32(record + 8));
    }
    const head = tables.get('head');
    const os2 = tables.get('OS/2');
    if (head === undefined || os2 === undefined) throw new Error('Font is missing ASS sizing metrics');
    const em = view.getUint16(head + 18);
    const ascent = view.getUint16(os2 + 74);
    const descent = view.getUint16(os2 + 76);
    if (!em || !(ascent + descent)) throw new Error('Font has invalid ASS sizing metrics');
    // Native ASS uses OS/2 Windows metrics; browser defaults can use different ascent/descent values.
    return {
        ascentOverride: `${(ascent / em) * 100}%`,
        descentOverride: `${(descent / em) * 100}%`,
        lineGapOverride: '0%',
        weight: String(view.getUint16(os2 + 4)),
        style: view.getUint16(os2 + 62) & 1 ? 'italic' : 'normal',
    };
}

async function prepareFonts(content: string) {
    const fonts = await queryLocalFonts!();
    const names = new Set<string>();
    assContentForRendering(content, (name) => {
        names.add(name);
        return name;
    });
    const aliases = new Map<string, string>();
    await Promise.all(
        Array.from(names, async (name) => {
            const key = name.toLowerCase();
            const family = fonts.filter((font) => font.family.toLowerCase() === key);
            if (!family.length) return;
            let loading = loadedFamilies.get(key);
            if (!loading) {
                const alias = `asbplayer-ass-font-${loadedFamilies.size}`;
                loading = Promise.all(
                    family.map(async (font) => {
                        const metrics = fontMetrics(await (await font.blob()).arrayBuffer());
                        return new FontFace(alias, `local("${CSS.escape(font.postscriptName)}")`, metrics).load();
                    })
                )
                    .then((faces) => {
                        for (const face of faces) document.fonts.add(face);
                        return alias;
                    })
                    .catch((error) => {
                        asbError('ass/fonts', error);
                        return undefined;
                    });
                loadedFamilies.set(key, loading);
            }
            const alias = await loading;
            if (alias) aliases.set(key, alias);
        })
    );
    return assContentForRendering(content, (name) => aliases.get(name.toLowerCase()) ?? name);
}

export function useAssFonts(content: string) {
    const [preparedContent, setPreparedContent] = useState<{ source: string; content: string }>();
    useEffect(() => {
        const setContent = (prepared: string) => setPreparedContent({ source: content, content: prepared });
        if (!queryLocalFonts) {
            setContent(content);
            return;
        }
        let disposed = false;
        let generation = 0;
        let permission: PermissionStatus | undefined;
        const update = () => {
            const current = ++generation;
            void (permission?.state === 'granted' ? prepareFonts(content) : Promise.resolve(content))
                .catch((error) => {
                    asbError('ass/fonts', error);
                    return content;
                })
                .then((prepared) => {
                    if (!disposed && current === generation) setContent(prepared);
                });
        };
        void navigator.permissions
            .query({ name: 'local-fonts' as PermissionName })
            .then((result) => {
                if (disposed) return;
                permission = result;
                permission.addEventListener('change', update);
                update();
            })
            .catch((error) => {
                asbError('ass/fonts', error);
                if (!disposed) setContent(content);
            });
        return () => {
            disposed = true;
            permission?.removeEventListener('change', update);
        };
    }, [content]);
    return preparedContent?.source === content ? preparedContent.content : undefined;
}
