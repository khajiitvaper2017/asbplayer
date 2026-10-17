import { Validator } from 'jsonschema';
import type { AsbplayerSettings } from '@project/common/settings/settings';
import { subtitleStudyWordTypes } from '@project/common/settings/settings';
import { ensureConsistencyOnRead } from '@project/common/settings/settings-provider';
import { download, getCurrentTimeString } from '@project/common/util';

const keyBindSchema = {
    id: '/KeyBind',
    type: 'object',
    properties: {
        keys: {
            type: 'string',
        },
    },
    required: ['keys'],
};
const textSubtitleSettingsSchema = {
    id: '/TextSubtitleSettings',
    type: 'object',
    properties: {
        subtitleColor: {
            type: 'string',
        },
        subtitleSize: {
            type: 'number',
        },
        subtitleThickness: {
            type: 'number',
        },
        subtitleOutlineThickness: {
            type: 'number',
        },
        subtitleShadowColor: {
            type: 'string',
        },
        subtitleBackgroundOpacity: {
            type: 'number',
        },
        subtitleBackgroundColor: {
            type: 'string',
        },
        subtitleFontFamily: {
            type: 'string',
        },
        subtitleCustomStyles: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                    },
                    value: {
                        type: 'string',
                    },
                },
            },
        },
        subtitleBlur: {
            type: 'boolean',
        },
    },
    required: [
        'subtitleColor',
        'subtitleSize',
        'subtitleThickness',
        'subtitleOutlineThickness',
        'subtitleShadowColor',
        'subtitleBackgroundOpacity',
        'subtitleBackgroundColor',
        'subtitleFontFamily',
        'subtitleCustomStyles',
        'subtitleBlur',
    ],
};
const settingsSchema = {
    id: '/Settings',
    type: 'object',
    properties: {
        subtitleStudyBlurEnabled: { type: 'boolean' },
        assSubtitleStyles: { type: 'boolean' },
        subtitleStudyHideEnabled: { type: 'boolean' },
        subtitleStudyBlurWordTypes: {
            type: 'array',
            items: { type: 'string', enum: [...subtitleStudyWordTypes] },
            uniqueItems: true,
        },
        subtitleStudyHideWordTypes: {
            type: 'array',
            items: { type: 'string', enum: [...subtitleStudyWordTypes] },
            uniqueItems: true,
        },
        subtitleStudyBlurRadius: { type: 'number', minimum: 0, maximum: 40 },
        subtitleStudyFadeSeconds: { type: 'number', minimum: 0, maximum: 1 },
        miningDestination: {
            type: 'string',
            enum: ['anki', 'jiten'],
        },
        jitenApiKey: {
            type: 'string',
        },
        jitenMiningDeckInitialized: {
            type: 'boolean',
        },
        jitenMiningDeckId: {
            type: 'integer',
            minimum: 0,
        },
        jitenShowUnmatchedAttachmentTarget: {
            type: 'boolean',
        },
        jitenPreventMultipleWords: {
            type: 'boolean',
        },
        jitenAutoAttach: {
            type: 'boolean',
        },
        jitenMediaSettingsInitialized: {
            type: 'boolean',
        },
        jitenAttachVisual: {
            type: 'boolean',
        },
        jitenAttachAudio: {
            type: 'boolean',
        },

        subtitleSize: {
            type: 'number',
        },
        subtitleColor: {
            type: 'string',
        },
        subtitleThickness: {
            type: 'number',
        },
        subtitleOutlineThickness: {
            type: 'number',
        },
        subtitleShadowThickness: {
            type: 'number',
        },
        subtitleShadowColor: {
            type: 'string',
        },
        subtitleOutlineColor: {
            type: 'string',
        },
        subtitleBackgroundColor: {
            type: 'string',
        },
        subtitleBackgroundOpacity: {
            type: 'number',
        },
        subtitleFontFamily: {
            type: 'string',
        },
        subtitleBlur: {
            type: 'boolean',
        },
        subtitlePreview: {
            type: 'string',
        },
        subtitlePositionOffset: {
            type: 'number',
        },
        topSubtitlePositionOffset: {
            type: 'number',
        },
        subtitleAlignment: {
            type: 'string',
        },
        subtitleTracksV2: {
            type: 'array',
            items: {
                $ref: '/TextSubtitleSettings',
            },
        },
        audioPaddingStart: {
            type: 'number',
        },
        audioPaddingEnd: {
            type: 'number',
        },
        maxImageWidth: {
            type: 'number',
        },
        maxImageHeight: {
            type: 'number',
        },
        mediaFragmentFormat: {
            type: 'string',
        },
        mediaFragmentTrimStart: {
            type: 'number',
        },
        mediaFragmentTrimEnd: {
            type: 'number',
        },
        mediaFragmentMaxClipLength: {
            type: 'number',
        },
        trimBlackBars: {
            type: 'boolean',
        },
        surroundingSubtitlesCountRadius: {
            type: 'number',
        },
        surroundingSubtitlesTimeRadius: {
            type: 'number',
        },
        autoPausePreference: {
            type: 'number',
        },
        subtitleTriggerStartOffset: {
            type: 'number',
        },
        subtitleTriggerEndOffset: {
            type: 'number',
        },
        subtitleTriggerGapEndOffset: {
            type: 'number',
        },
        subtitleTriggerGapStartOffset: {
            type: 'number',
        },
        seekableTracks: {
            type: 'number',
        },
        autoCopyableTracks: {
            type: 'number',
        },
        subtitleHtml: {
            type: 'number',
        },
        seekDuration: {
            type: 'number',
        },
        speedChangeStep: {
            type: 'number',
        },
        playbackRate: {
            type: 'number',
        },
        playbackRateNotificationEnabled: {
            type: 'boolean',
        },
        rememberPlaybackRate: {
            type: 'boolean',
        },
        fastForwardModePlaybackRate: {
            type: 'number',
        },
        fastForwardPlaybackMinimumSkipIntervalMs: {
            type: 'number',
        },
        repeatCountPreference: {
            type: 'number',
        },
        autoPauseResumeMode: {
            type: 'string',
            enum: ['manual', 'fixed', 'subtitleLength'],
        },
        autoPauseResumeDelayMs: {
            type: 'number',
        },
        autoPauseFixedDurationMs: {
            type: 'number',
        },
        autoPauseMinimumDurationMs: {
            type: 'number',
        },
        autoPauseMaximumDurationMs: {
            type: 'number',
        },
        autoPauseTimePerCharacterMs: {
            type: 'number',
        },
        subtitleVisibility: {
            type: 'string',
            enum: ['whenDue', 'whilePaused'],
        },
        rememberPlaybackModes: {
            type: 'boolean',
        },
        lastPlaybackModes: {
            type: 'array',
            items: {
                type: 'number',
            },
        },
        lastPlaybackPositions: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    fileName: { type: 'string' },
                    position: { type: 'number' },
                },
                required: ['fileName', 'position'],
            },
        },
        keyBindSet: {
            type: 'object',
            properties: {
                togglePlay: { $ref: '/KeyBind' },
                toggleAutoPause: { $ref: '/KeyBind' },
                toggleCondensedPlayback: { $ref: '/KeyBind' },
                toggleFastForwardPlayback: { $ref: '/KeyBind' },
                toggleSubtitles: { $ref: '/KeyBind' },
                toggleVideoSubtitleTrack1: { $ref: '/KeyBind' },
                toggleVideoSubtitleTrack2: { $ref: '/KeyBind' },
                toggleVideoSubtitleTrack3: { $ref: '/KeyBind' },
                toggleAsbplayerSubtitleTrack1: { $ref: '/KeyBind' },
                toggleAsbplayerSubtitleTrack2: { $ref: '/KeyBind' },
                toggleAsbplayerSubtitleTrack3: { $ref: '/KeyBind' },
                unblurAsbplayerTrack1: { $ref: '/KeyBind' },
                unblurAsbplayerTrack2: { $ref: '/KeyBind' },
                unblurAsbplayerTrack3: { $ref: '/KeyBind' },
                seekBackward: { $ref: '/KeyBind' },
                seekForward: { $ref: '/KeyBind' },
                seekToPreviousSubtitle: { $ref: '/KeyBind' },
                seekToNextSubtitle: { $ref: '/KeyBind' },
                seekToBeginningOfCurrentSubtitle: { $ref: '/KeyBind' },
                adjustOffsetToPreviousSubtitle: { $ref: '/KeyBind' },
                adjustOffsetToNextSubtitle: { $ref: '/KeyBind' },
                decreaseOffset: { $ref: '/KeyBind' },
                increaseOffset: { $ref: '/KeyBind' },
                resetOffset: { $ref: '/KeyBind' },
                copySubtitle: { $ref: '/KeyBind' },
                ankiExport: { $ref: '/KeyBind' },
                updateLastCard: { $ref: '/KeyBind' },

                takeScreenshot: { $ref: '/KeyBind' },
                toggleRecording: { $ref: '/KeyBind' },
                selectSubtitleTrack: { $ref: '/KeyBind' },
                decreasePlaybackRate: { $ref: '/KeyBind' },
                increasePlaybackRate: { $ref: '/KeyBind' },
                toggleSidePanel: { $ref: '/KeyBind' },
                toggleRepeat: { $ref: '/KeyBind' },
                toggleSubtitleVisibility: { $ref: '/KeyBind' },
                cycleAutoPauseResumeMode: { $ref: '/KeyBind' },
                moveBottomSubtitlesUp: { $ref: '/KeyBind' },
                moveBottomSubtitlesDown: { $ref: '/KeyBind' },
                moveTopSubtitlesUp: { $ref: '/KeyBind' },
                moveTopSubtitlesDown: { $ref: '/KeyBind' },
                openStatistics: { $ref: '/KeyBind' },
                jumpToNextToken: { $ref: '/KeyBind' },
                jumpToPreviousToken: { $ref: '/KeyBind' },
                markHoveredToken5: { $ref: '/KeyBind' },
                jumpToNextTokenStatus5: { $ref: '/KeyBind' },
                jumpToPreviousTokenStatus5: { $ref: '/KeyBind' },
                markHoveredToken4: { $ref: '/KeyBind' },
                jumpToNextTokenStatus4: { $ref: '/KeyBind' },
                jumpToPreviousTokenStatus4: { $ref: '/KeyBind' },
                markHoveredToken3: { $ref: '/KeyBind' },
                jumpToNextTokenStatus3: { $ref: '/KeyBind' },
                jumpToPreviousTokenStatus3: { $ref: '/KeyBind' },
                markHoveredToken2: { $ref: '/KeyBind' },
                jumpToNextTokenStatus2: { $ref: '/KeyBind' },
                jumpToPreviousTokenStatus2: { $ref: '/KeyBind' },
                markHoveredToken1: { $ref: '/KeyBind' },
                jumpToNextTokenStatus1: { $ref: '/KeyBind' },
                jumpToPreviousTokenStatus1: { $ref: '/KeyBind' },
                markHoveredToken0: { $ref: '/KeyBind' },
                jumpToNextTokenStatus0: { $ref: '/KeyBind' },
                jumpToPreviousTokenStatus0: { $ref: '/KeyBind' },
                toggleHoveredTokenIgnored: { $ref: '/KeyBind' },
                jumpToNextTokenState0: { $ref: '/KeyBind' },
                jumpToPreviousTokenState0: { $ref: '/KeyBind' },
            },
        },
        recordWithAudioPlayback: {
            type: 'boolean',
        },
        preferMp3: {
            type: 'boolean',
        },
        alwaysUseSubtitleForSentence: {
            type: 'boolean',
        },
        tabName: {
            type: 'string',
        },
        miningHistoryStorageLimit: {
            type: 'number',
        },
        preCacheSubtitleDom: {
            type: 'boolean',
        },
        clickToMineDefaultAction: {
            type: 'number',
        },
        postMiningPlaybackState: {
            type: 'number',
        },
        themeType: {
            type: 'string',
        },
        videoSubtitleSplitBehavior: {
            type: 'string',
        },
        showSubtitleListMiningButton: {
            type: 'boolean',
        },
        subtitleListTimestampDisplay: {
            type: 'string',
        },
        subtitleListTimestampDecimalPlaces: {
            type: 'integer',
            enum: [0, 1, 2, 3],
        },
        copyToClipboardOnMine: {
            type: 'boolean',
        },

        rememberSubtitleOffset: {
            type: 'boolean',
        },
        rememberEmbeddedSubtitleLanguage: {
            type: 'boolean',
        },
        embeddedSubtitleLanguage: {
            type: 'string',
        },
        lastSubtitleOffset: {
            type: 'number',
        },
        autoCopyCurrentSubtitle: {
            type: 'boolean',
        },
        alwaysPlayOnSubtitleRepeat: {
            type: 'boolean',
        },
        subtitleRegexFilter: {
            type: 'string',
        },
        subtitleRegexFilterTextReplacement: {
            type: 'string',
        },
        convertNetflixRuby: {
            type: 'boolean',
        },
        language: {
            type: 'string',
        },

        imageBasedSubtitleScaleFactor: {
            type: 'number',
        },
        subtitleCustomStyles: {
            type: 'array',
            items: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                    },
                    value: {
                        type: 'string',
                    },
                },
            },
        },
        subtitlesWidth: {
            type: 'number',
        },
        subtitlesWidthUnit: {
            type: 'string',
        },
        streamingAppUrl: {
            type: 'string',
        },
        streamingDisplaySubtitles: {
            type: 'boolean',
        },
        streamingRecordMedia: {
            type: 'boolean',
        },
        streamingTakeScreenshot: {
            type: 'boolean',
        },
        streamingCleanScreenshot: {
            type: 'boolean',
        },
        streamingCropScreenshot: {
            type: 'boolean',
        },
        streamingSubsDragAndDrop: {
            type: 'boolean',
        },
        streamingAutoSync: {
            type: 'boolean',
        },
        streamingAutoSyncPromptOnFailure: {
            type: 'boolean',
        },
        streamingLastLanguagesSynced: {
            type: 'object',
            additionalProperties: {
                type: 'array',
                items: {
                    type: 'string',
                },
            },
        },
        streamingCondensedPlaybackMinimumSkipIntervalMs: {
            type: 'number',
        },
        streamingScreenshotDelay: {
            type: 'number',
        },
        streamingSubtitleListPreference: {
            type: 'string',
        },
        streamingEnableOverlay: {
            type: 'boolean',
        },
        webSocketClientEnabled: {
            type: 'boolean',
        },
        webSocketServerUrl: {
            type: 'string',
        },
        pauseOnHoverMode: {
            type: 'number',
        },

        thumbnailPreview: {
            type: 'boolean',
        },
        subtitleAboveThumbnail: {
            type: 'boolean',
        },
        _schema: {
            type: 'number',
        },
    },
};

export type IgnorePathSegment = string | '*';
export type IgnorePath = readonly IgnorePathSegment[];

const ignorePaths: readonly IgnorePath[] = [
    ['jitenApiKey'],
    ['streamingPages'], // Ignored due to security risk (e.g. disable CSP)
];
const validationIgnorePaths: readonly IgnorePath[] = [['streamingPages']];

export const omitPath = (value: any, path: IgnorePath): any => {
    if (value === null || typeof value !== 'object' || !path.length) return value;

    const [segment, ...remainingPath] = path;
    if (segment === '*') {
        if (Array.isArray(value)) return value.map((item) => omitPath(item, remainingPath));
        return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, omitPath(child, remainingPath)]));
    }

    const copy = Array.isArray(value) ? [...value] : { ...value };
    if (!remainingPath.length) {
        delete copy[segment];
    } else if (segment in copy) {
        copy[segment] = omitPath(copy[segment], remainingPath);
    }
    return copy;
};

const omitPaths = (settings: any, paths: readonly IgnorePath[]) =>
    paths.reduce((settingsCopy, ignorePath) => omitPath(settingsCopy, ignorePath), settings);

export const settingsForExport = (settings: AsbplayerSettings): Partial<AsbplayerSettings> => {
    return omitPaths(settings, ignorePaths);
};

const mergeIgnoredPath = (importedValue: any, currentValue: any, path: IgnorePath): any => {
    if (importedValue === null || typeof importedValue !== 'object' || !path.length) return importedValue;

    const [segment, ...remainingPath] = path;
    if (segment === '*') {
        if (Array.isArray(importedValue)) {
            return importedValue.map((item, index) => mergeIgnoredPath(item, currentValue?.[index], remainingPath));
        }
        return Object.fromEntries(
            Object.entries(importedValue).map(([key, value]) => [
                key,
                mergeIgnoredPath(value, currentValue?.[key], remainingPath),
            ])
        );
    }

    const mergedValue = Array.isArray(importedValue) ? [...importedValue] : { ...importedValue };
    if (remainingPath.length && segment in importedValue) {
        mergedValue[segment] = mergeIgnoredPath(importedValue[segment], currentValue?.[segment], remainingPath);
    } else if (currentValue !== null && typeof currentValue === 'object' && segment in currentValue) {
        mergedValue[segment] = currentValue[segment];
    }
    return mergedValue;
};

/**
 * Restore ignored values from the current settings, regardless of whether they are present in an import.
 */
export const mergeImportedSettings = (
    importedSettings: Partial<AsbplayerSettings>,
    currentSettings: AsbplayerSettings
): Partial<AsbplayerSettings> =>
    ignorePaths.reduce(
        (mergedSettings, ignorePath) => mergeIgnoredPath(mergedSettings, currentSettings, ignorePath),
        importedSettings
    );

export const exportSettings = (settings: AsbplayerSettings) => {
    download(
        new Blob([JSON.stringify(settingsForExport(settings))], { type: 'application/json' }),
        `asbplayer-settings-${getCurrentTimeString()}.json`
    );
};

export const validateSettings = (settings: any) => {
    const copy = omitPaths(settings, validationIgnorePaths);
    const validator = new Validator();
    validator.addSchema(keyBindSchema);
    validator.addSchema(textSubtitleSettingsSchema);
    const result = validator.validate(copy, settingsSchema);
    validateAllKnownKeys(copy, []);

    if (!result.valid) {
        throw new Error('Settings validation failed: ' + JSON.stringify(result.errors));
    }

    return ensureConsistencyOnRead(copy as AsbplayerSettings);
};

const validateAllKnownKeys = (object: any, path: string[]) => {
    for (const key of Object.keys(object)) {
        const schema = schemaAtPath(settingsSchema, path);

        // Empty string is sentinel value for 'additional properties' which can have any key
        if (schema === undefined || (schema !== '' && !(key in schema))) {
            delete object[key];
            continue;
        }

        const value = object[key];

        if (typeof value === 'object' && !Array.isArray(value)) {
            validateAllKnownKeys(value, [...path, key]);
        }
    }
};

const schemaAtPath = (schema: any, path: string[]) => {
    let value = schema['properties'];

    for (const key of path) {
        if (typeof value[key] === 'object' && 'additionalProperties' in value[key]) {
            return '';
        }

        value = value[key]?.['properties'] ?? schemaForRef(value[key]?.['$ref'])?.['properties'];

        if (value === undefined) {
            return undefined;
        }
    }

    return value;
};

const schemaForRef = (ref: string) => {
    if (ref === '/KeyBind') {
        return keyBindSchema;
    }

    if (ref === '/TextSubtitleSettings') {
        return textSubtitleSettingsSchema;
    }

    return undefined;
};
