export const asbplayerMatches = ['*://asbplayer-jiten.pages.dev/*'];
export const asbplayerExcludeGlobs = [...asbplayerMatches];

if (import.meta.env.DEV) {
    asbplayerMatches.push('*://localhost/*');
    asbplayerExcludeGlobs.push('*://localhost:3000/*');
}
