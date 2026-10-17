export const assContentForRendering = (content: string, resolveFont?: (name: string) => string): string => {
    const fontName = (name: string) => {
        // ASS.js interpolates font names into cssText; keep them inside the quoted font-family value.
        const sanitized = name.replace(/["\\]|\p{Cc}/gu, '').trim();
        return resolveFont?.(sanitized) ?? sanitized;
    };
    let inStyles = false;
    let fontIndex = -1;
    return content
        .split(/\r?\n/)
        .map((line) => {
            if (/^\s*\[/.test(line)) {
                inStyles = /^\s*\[V4\+? Styles\]\s*$/i.test(line);
                fontIndex = -1;
            }
            if (inStyles && /^\s*Format:/i.test(line)) {
                fontIndex = line
                    .slice(line.indexOf(':') + 1)
                    .split(',')
                    .findIndex((key) => key.trim().toLowerCase() === 'fontname');
            }
            if (inStyles && fontIndex >= 0 && /^\s*Style:/i.test(line)) {
                const colon = line.indexOf(':');
                const fields = line.slice(colon + 1).split(',');
                fields[fontIndex] = fontName(fields[fontIndex] ?? '');
                return line.slice(0, colon + 1) + fields.join(',');
            }
            return line.replace(/\{[^}]*\}/g, (tags) =>
                tags.replace(/\\fn([^\\}]*)/g, (_, name: string) => `\\fn${fontName(name)}`)
            );
        })
        .join('\n');
};
