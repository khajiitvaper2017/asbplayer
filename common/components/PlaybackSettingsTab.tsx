import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormLabel from '@mui/material/FormLabel';
import InputAdornment from '@mui/material/InputAdornment';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { AutoPausePreference } from '@project/common';
import KeyboardShortcutLink from '@project/common/components/KeyboardShortcutLink';
import LabelWithHoverEffect from '@project/common/components/LabelWithHoverEffect';
import NumericSettingInput from '@project/common/components/NumericSettingInput';
import ResponsiveSettingsStack from '@project/common/components/ResponsiveSettingsStack';
import RadioGroup from '@project/common/components/SettingsRadioGroup';
import SettingsSection, { SettingsSubSection } from '@project/common/components/SettingsSection';
import SwitchLabelWithHoverEffect from '@project/common/components/SwitchLabelWithHoverEffect';
import { normalizePlaybackRate } from '@project/common/playback/controllers/playback-mode-controller';
import { normalizeAutoPauseDurationBounds } from '@project/common/playback/plan/playback-plan';
import type { AsbplayerSettings } from '@project/common/settings';
import {
    autoPausePreferenceForCheckboxChange,
    AutoPauseResumeMode,
    isTrackSeekable,
    PauseOnHoverMode,
    SubtitleVisibility,
    updateSeekableTracksValue,
} from '@project/common/settings';
import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';

interface Props {
    settings: AsbplayerSettings;
    onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    extensionInstalled?: boolean;
    extensionSupportsPauseOnHover?: boolean;
    extensionSupportsSeekableTrackSetting?: boolean;
    supportsPlaybackEngine: boolean;
    supportsAutoPauseResume: boolean;
    onViewPlaybackModeKeyboardShortcuts: () => void;
    onViewPlaybackRateKeyboardShortcuts: () => void;
    onViewSubtitleKeyboardShortcuts: () => void;
}
const PlaybackSettingsTab: React.FC<Props> = ({
    settings,
    onSettingChanged,
    onSettingsChanged,
    extensionInstalled,
    extensionSupportsPauseOnHover,
    extensionSupportsSeekableTrackSetting,
    supportsPlaybackEngine,
    supportsAutoPauseResume,
    onViewPlaybackModeKeyboardShortcuts,
    onViewPlaybackRateKeyboardShortcuts,
    onViewSubtitleKeyboardShortcuts,
}) => {
    const { t } = useTranslation();
    const {
        seekableTracks,
        pauseOnHoverMode,
        autoPausePreference,
        subtitleTriggerStartOffset,
        subtitleTriggerEndOffset,
        subtitleTriggerGapEndOffset,
        subtitleTriggerGapStartOffset,
        playbackRate,
        playbackRateNotificationEnabled,
        rememberPlaybackRate,
        fastForwardModePlaybackRate,
        fastForwardPlaybackMinimumSkipIntervalMs,
        repeatCountPreference,
        autoPauseResumeMode,
        autoPauseResumeDelayMs,
        autoPauseFixedDurationMs,
        autoPauseMinimumDurationMs,
        autoPauseMaximumDurationMs,
        autoPauseTimePerCharacterMs,
        subtitleVisibility,
        rememberPlaybackModes,
        streamingCondensedPlaybackMinimumSkipIntervalMs,
    } = settings;
    const autoPauseAtStart = autoPausePreference !== AutoPausePreference.atEnd;
    const autoPauseAtEnd = autoPausePreference !== AutoPausePreference.atStart;
    const handleAutoPausePreferenceChanged = useCallback(
        (edge: AutoPausePreference.atStart | AutoPausePreference.atEnd, checked: boolean) => {
            void onSettingChanged(
                'autoPausePreference',
                autoPausePreferenceForCheckboxChange(autoPausePreference, edge, checked)
            );
        },
        [autoPausePreference, onSettingChanged]
    );
    const handleAutoPauseMinimumDurationChanged = useCallback(
        (minimumDurationMs: number) => {
            const bounds = normalizeAutoPauseDurationBounds(minimumDurationMs, autoPauseMaximumDurationMs);
            onSettingsChanged({
                autoPauseMinimumDurationMs: bounds.minimumDurationMs,
                autoPauseMaximumDurationMs: bounds.maximumDurationMs,
            });
        },
        [autoPauseMaximumDurationMs, onSettingsChanged]
    );
    const handleAutoPauseMaximumDurationChanged = useCallback(
        (maximumDurationMs: number) => {
            const bounds = normalizeAutoPauseDurationBounds(autoPauseMinimumDurationMs, maximumDurationMs);
            onSettingsChanged({
                autoPauseMinimumDurationMs: bounds.minimumDurationMs,
                autoPauseMaximumDurationMs: bounds.maximumDurationMs,
            });
        },
        [autoPauseMinimumDurationMs, onSettingsChanged]
    );

    return (
        <Stack spacing={1} sx={{ containerType: 'inline-size' }}>
            <SettingsSection>
                {t('settings.playbackSpeed')}
                <KeyboardShortcutLink onClick={onViewPlaybackRateKeyboardShortcuts} />
            </SettingsSection>
            {supportsPlaybackEngine && (
                <>
                    <Box sx={{ width: '100%', '@container (min-width: 560px)': { width: 'calc((100% - 8px) / 2)' } }}>
                        <NumericSettingInput
                            size="small"
                            fullWidth
                            label={
                                <>
                                    {t('settings.playbackRate')}
                                    <KeyboardShortcutLink
                                        onClick={onViewPlaybackRateKeyboardShortcuts}
                                        preset="numericalInputLabel"
                                    />
                                </>
                            }
                            value={playbackRate}
                            color="primary"
                            normalizeValue={normalizePlaybackRate}
                            onValueChange={(value) => void onSettingChanged('playbackRate', value)}
                            slotProps={{
                                htmlInput: {
                                    min: 0,
                                    step: 0.05,
                                },
                            }}
                        />
                    </Box>
                    <SwitchLabelWithHoverEffect
                        control={
                            <Switch
                                checked={playbackRateNotificationEnabled}
                                onChange={(event) =>
                                    onSettingChanged('playbackRateNotificationEnabled', event.target.checked)
                                }
                            />
                        }
                        label={t('settings.playbackRateNotificationEnabled')}
                        labelPlacement="start"
                    />
                    <SwitchLabelWithHoverEffect
                        control={
                            <Switch
                                checked={rememberPlaybackRate}
                                onChange={(event) => onSettingChanged('rememberPlaybackRate', event.target.checked)}
                            />
                        }
                        label={t('settings.rememberPlaybackRate')}
                        labelPlacement="start"
                    />
                    <SwitchLabelWithHoverEffect
                        control={
                            <Switch
                                checked={rememberPlaybackModes}
                                onChange={(event) => onSettingChanged('rememberPlaybackModes', event.target.checked)}
                            />
                        }
                        label={t('settings.rememberPlaybackModes')}
                        labelPlacement="start"
                    />
                </>
            )}
            <SettingsSection>{t('settings.autoPause')}</SettingsSection>
            {(!extensionInstalled || extensionSupportsPauseOnHover) && (
                <FormControl>
                    <FormLabel component="legend">{t('settings.pauseOnHoverMode')}</FormLabel>
                    <RadioGroup>
                        <LabelWithHoverEffect
                            control={
                                <Radio
                                    checked={pauseOnHoverMode === PauseOnHoverMode.disabled}
                                    value={PauseOnHoverMode.disabled}
                                    onChange={(event) =>
                                        event.target.checked &&
                                        void onSettingChanged('pauseOnHoverMode', PauseOnHoverMode.disabled)
                                    }
                                />
                            }
                            label={t('pauseOnHoverMode.disabled')}
                        />
                        <LabelWithHoverEffect
                            control={
                                <Radio
                                    checked={pauseOnHoverMode === PauseOnHoverMode.inAndOut}
                                    value={PauseOnHoverMode.inAndOut}
                                    onChange={(event) =>
                                        event.target.checked &&
                                        void onSettingChanged('pauseOnHoverMode', PauseOnHoverMode.inAndOut)
                                    }
                                />
                            }
                            label={t('pauseOnHoverMode.inAndOut')}
                        />
                        <LabelWithHoverEffect
                            control={
                                <Radio
                                    checked={pauseOnHoverMode === PauseOnHoverMode.inNotOut}
                                    value={PauseOnHoverMode.inNotOut}
                                    onChange={(event) =>
                                        event.target.checked &&
                                        void onSettingChanged('pauseOnHoverMode', PauseOnHoverMode.inNotOut)
                                    }
                                />
                            }
                            label={t('pauseOnHoverMode.inNotOut')}
                        />
                    </RadioGroup>
                </FormControl>
            )}
            <FormControl>
                <FormLabel component="legend">{t('settings.autoPausePreference')}</FormLabel>
                {supportsPlaybackEngine ? (
                    <>
                        <FormGroup row>
                            <LabelWithHoverEffect
                                control={
                                    <Checkbox
                                        checked={autoPauseAtStart}
                                        onChange={(event) =>
                                            handleAutoPausePreferenceChanged(
                                                AutoPausePreference.atStart,
                                                event.target.checked
                                            )
                                        }
                                    />
                                }
                                label={t('settings.autoPauseAtSubtitleStart')}
                            />
                            <LabelWithHoverEffect
                                control={
                                    <Checkbox
                                        checked={autoPauseAtEnd}
                                        onChange={(event) =>
                                            handleAutoPausePreferenceChanged(
                                                AutoPausePreference.atEnd,
                                                event.target.checked
                                            )
                                        }
                                    />
                                }
                                label={t('settings.autoPauseAtSubtitleEnd')}
                            />
                        </FormGroup>
                        <Typography variant="caption" color="textSecondary">
                            {t('settings.autoPausePreferenceHelperText')}
                        </Typography>
                    </>
                ) : (
                    <RadioGroup>
                        <LabelWithHoverEffect
                            control={
                                <Radio
                                    checked={autoPausePreference === AutoPausePreference.atStart}
                                    value={AutoPausePreference.atStart}
                                    onChange={(event) =>
                                        event.target.checked &&
                                        void onSettingChanged('autoPausePreference', AutoPausePreference.atStart)
                                    }
                                />
                            }
                            label={t('settings.autoPauseAtSubtitleStart')}
                        />
                        <LabelWithHoverEffect
                            control={
                                <Radio
                                    checked={autoPausePreference === AutoPausePreference.atEnd}
                                    value={AutoPausePreference.atEnd}
                                    onChange={(event) =>
                                        event.target.checked &&
                                        void onSettingChanged('autoPausePreference', AutoPausePreference.atEnd)
                                    }
                                />
                            }
                            label={t('settings.autoPauseAtSubtitleEnd')}
                        />
                    </RadioGroup>
                )}
            </FormControl>
            {supportsAutoPauseResume && (
                <>
                    <FormControl>
                        <FormLabel component="legend" sx={{ display: 'flex' }}>
                            {t('settings.autoPauseResumeMode')}
                            <KeyboardShortcutLink onClick={onViewPlaybackModeKeyboardShortcuts} preset="formLabel" />
                        </FormLabel>
                        <RadioGroup>
                            <LabelWithHoverEffect
                                control={
                                    <Radio
                                        checked={autoPauseResumeMode === AutoPauseResumeMode.manual}
                                        value={AutoPauseResumeMode.manual}
                                        onChange={(event) =>
                                            event.target.checked &&
                                            void onSettingChanged('autoPauseResumeMode', AutoPauseResumeMode.manual)
                                        }
                                    />
                                }
                                label={t('settings.autoPauseResumeModeManual')}
                            />
                            <LabelWithHoverEffect
                                control={
                                    <Radio
                                        checked={autoPauseResumeMode === AutoPauseResumeMode.fixed}
                                        value={AutoPauseResumeMode.fixed}
                                        onChange={(event) =>
                                            event.target.checked &&
                                            void onSettingChanged('autoPauseResumeMode', AutoPauseResumeMode.fixed)
                                        }
                                    />
                                }
                                label={t('settings.autoPauseResumeModeFixed')}
                            />
                            <LabelWithHoverEffect
                                control={
                                    <Radio
                                        checked={autoPauseResumeMode === AutoPauseResumeMode.subtitleLength}
                                        value={AutoPauseResumeMode.subtitleLength}
                                        onChange={(event) =>
                                            event.target.checked &&
                                            void onSettingChanged(
                                                'autoPauseResumeMode',
                                                AutoPauseResumeMode.subtitleLength
                                            )
                                        }
                                    />
                                }
                                label={t('settings.autoPauseResumeModeSubtitleLength')}
                            />
                        </RadioGroup>
                    </FormControl>
                    {autoPauseResumeMode === AutoPauseResumeMode.fixed && (
                        <ResponsiveSettingsStack>
                            <NumericSettingInput
                                size="small"
                                color="primary"
                                fullWidth
                                label={t('settings.autoPauseFixedDuration')}
                                value={autoPauseFixedDurationMs}
                                onValueChange={(value) => void onSettingChanged('autoPauseFixedDurationMs', value)}
                                slotProps={{
                                    htmlInput: { min: 0, step: 1 },
                                    input: { endAdornment: <InputAdornment position="end">ms</InputAdornment> },
                                }}
                            />
                            <NumericSettingInput
                                size="small"
                                color="primary"
                                fullWidth
                                label={t('settings.autoPauseResumeDelay')}
                                value={autoPauseResumeDelayMs}
                                onValueChange={(value) => void onSettingChanged('autoPauseResumeDelayMs', value)}
                                slotProps={{
                                    htmlInput: { min: 0, step: 1 },
                                    input: { endAdornment: <InputAdornment position="end">ms</InputAdornment> },
                                }}
                            />
                        </ResponsiveSettingsStack>
                    )}
                    {autoPauseResumeMode === AutoPauseResumeMode.subtitleLength && (
                        <>
                            <ResponsiveSettingsStack>
                                <NumericSettingInput
                                    size="small"
                                    color="primary"
                                    fullWidth
                                    label={t('settings.autoPauseMinimumDuration')}
                                    value={autoPauseMinimumDurationMs}
                                    onValueChange={handleAutoPauseMinimumDurationChanged}
                                    slotProps={{
                                        htmlInput: { min: 0, step: 1 },
                                        input: { endAdornment: <InputAdornment position="end">ms</InputAdornment> },
                                    }}
                                />
                                <NumericSettingInput
                                    size="small"
                                    color="primary"
                                    fullWidth
                                    label={t('settings.autoPauseMaximumDuration')}
                                    helperText={t('settings.autoPauseMaximumDurationHelperText')}
                                    value={autoPauseMaximumDurationMs}
                                    onValueChange={handleAutoPauseMaximumDurationChanged}
                                    slotProps={{
                                        htmlInput: { min: 0, step: 1 },
                                        input: { endAdornment: <InputAdornment position="end">ms</InputAdornment> },
                                    }}
                                />
                            </ResponsiveSettingsStack>
                            <ResponsiveSettingsStack>
                                <NumericSettingInput
                                    size="small"
                                    color="primary"
                                    fullWidth
                                    label={t('settings.autoPauseTimePerCharacter')}
                                    value={autoPauseTimePerCharacterMs}
                                    onValueChange={(value) =>
                                        void onSettingChanged('autoPauseTimePerCharacterMs', value)
                                    }
                                    slotProps={{
                                        htmlInput: { min: 0, step: 1 },
                                        input: { endAdornment: <InputAdornment position="end">ms</InputAdornment> },
                                    }}
                                />
                                <NumericSettingInput
                                    size="small"
                                    color="primary"
                                    fullWidth
                                    label={t('settings.autoPauseResumeDelay')}
                                    value={autoPauseResumeDelayMs}
                                    onValueChange={(value) => void onSettingChanged('autoPauseResumeDelayMs', value)}
                                    slotProps={{
                                        htmlInput: { min: 0, step: 1 },
                                        input: { endAdornment: <InputAdornment position="end">ms</InputAdornment> },
                                    }}
                                />
                            </ResponsiveSettingsStack>
                        </>
                    )}
                    <FormControl>
                        <FormLabel component="legend" sx={{ display: 'flex' }}>
                            {t('settings.subtitleVisibility')}
                            <KeyboardShortcutLink onClick={onViewPlaybackModeKeyboardShortcuts} preset="formLabel" />
                        </FormLabel>
                        <RadioGroup>
                            <LabelWithHoverEffect
                                control={
                                    <Radio
                                        checked={subtitleVisibility === SubtitleVisibility.whenDue}
                                        value={SubtitleVisibility.whenDue}
                                        onChange={(event) =>
                                            event.target.checked &&
                                            void onSettingChanged('subtitleVisibility', SubtitleVisibility.whenDue)
                                        }
                                    />
                                }
                                label={t('settings.subtitleVisibilityWhenDue')}
                            />
                            <LabelWithHoverEffect
                                control={
                                    <Radio
                                        checked={subtitleVisibility === SubtitleVisibility.whilePaused}
                                        value={SubtitleVisibility.whilePaused}
                                        onChange={(event) =>
                                            event.target.checked &&
                                            void onSettingChanged('subtitleVisibility', SubtitleVisibility.whilePaused)
                                        }
                                    />
                                }
                                label={t('settings.subtitleVisibilityWhilePaused')}
                            />
                        </RadioGroup>
                    </FormControl>
                </>
            )}
            {supportsPlaybackEngine && (
                <>
                    <SettingsSection>{t('settings.repeatPlayback')}</SettingsSection>
                    <Box sx={{ width: '100%', '@container (min-width: 560px)': { width: 'calc((100% - 8px) / 2)' } }}>
                        <NumericSettingInput
                            size="small"
                            color="primary"
                            fullWidth
                            label={t('settings.repeatCountPreference')}
                            helperText={t('settings.repeatCountPreferenceHelperText')}
                            value={repeatCountPreference}
                            onValueChange={(value) => void onSettingChanged('repeatCountPreference', value)}
                            slotProps={{
                                htmlInput: {
                                    min: 0,
                                    step: 1,
                                },
                            }}
                        />
                    </Box>
                    <Box component="details">
                        <Box component="summary" sx={{ cursor: 'pointer' }}>
                            {t('settings.advancedTiming')}
                        </Box>
                        <ResponsiveSettingsStack>
                            <NumericSettingInput
                                size="small"
                                color="primary"
                                fullWidth
                                label={t('settings.subtitleTriggerStartOffset')}
                                value={subtitleTriggerStartOffset}
                                onValueChange={(value) => void onSettingChanged('subtitleTriggerStartOffset', value)}
                                slotProps={{
                                    htmlInput: {
                                        step: 1,
                                    },
                                    input: {
                                        endAdornment: <InputAdornment position="end">ms</InputAdornment>,
                                    },
                                }}
                            />
                            <NumericSettingInput
                                size="small"
                                color="primary"
                                fullWidth
                                label={t('settings.subtitleTriggerEndOffset')}
                                value={subtitleTriggerEndOffset}
                                onValueChange={(value) => void onSettingChanged('subtitleTriggerEndOffset', value)}
                                slotProps={{
                                    htmlInput: {
                                        step: 1,
                                    },
                                    input: {
                                        endAdornment: <InputAdornment position="end">ms</InputAdornment>,
                                    },
                                }}
                            />
                        </ResponsiveSettingsStack>
                        <Typography variant="caption" color="textSecondary">
                            {t('settings.subtitleTriggerOffsetHelperText')}
                        </Typography>
                    </Box>
                </>
            )}
            <SettingsSubSection>{t('settings.skipping')}</SettingsSubSection>
            <ResponsiveSettingsStack>
                {supportsPlaybackEngine && (
                    <NumericSettingInput
                        size="small"
                        color="primary"
                        fullWidth
                        label={t('settings.fastForwardPlaybackMinimumSkipInterval')}
                        value={fastForwardPlaybackMinimumSkipIntervalMs}
                        onValueChange={(value) =>
                            void onSettingChanged('fastForwardPlaybackMinimumSkipIntervalMs', value)
                        }
                        slotProps={{
                            htmlInput: {
                                min: 0,
                                step: 1,
                            },
                            input: {
                                endAdornment: <InputAdornment position="end">ms</InputAdornment>,
                            },
                        }}
                    />
                )}
                <NumericSettingInput
                    size="small"
                    fullWidth
                    label={t('settings.fastForwardModePlaybackRate')}
                    value={fastForwardModePlaybackRate}
                    color="primary"
                    normalizeValue={normalizePlaybackRate}
                    onValueChange={(value) => void onSettingChanged('fastForwardModePlaybackRate', value)}
                    slotProps={{
                        htmlInput: {
                            min: 0,
                            step: 0.05,
                        },
                    }}
                />
            </ResponsiveSettingsStack>
            <NumericSettingInput
                size="small"
                color="primary"
                fullWidth
                label={t('settings.condensedPlaybackMinimumSkipInterval')}
                value={streamingCondensedPlaybackMinimumSkipIntervalMs}
                onValueChange={(value) =>
                    void onSettingChanged('streamingCondensedPlaybackMinimumSkipIntervalMs', value)
                }
                slotProps={{
                    htmlInput: {
                        min: 0,
                        step: 1,
                    },
                    input: {
                        endAdornment: <InputAdornment position="end">ms</InputAdornment>,
                    },
                }}
            />
            {supportsPlaybackEngine && (
                <Box component="details">
                    <Box component="summary" sx={{ cursor: 'pointer' }}>
                        {t('settings.advancedTiming')}
                    </Box>
                    <ResponsiveSettingsStack>
                        <NumericSettingInput
                            size="small"
                            color="primary"
                            fullWidth
                            label={t('settings.subtitleTriggerGapStartOffset')}
                            value={subtitleTriggerGapStartOffset}
                            onValueChange={(value) => void onSettingChanged('subtitleTriggerGapStartOffset', value)}
                            slotProps={{
                                htmlInput: {
                                    min: 0,
                                    step: 1,
                                },
                                input: {
                                    endAdornment: <InputAdornment position="end">ms</InputAdornment>,
                                },
                            }}
                        />
                        <NumericSettingInput
                            size="small"
                            color="primary"
                            fullWidth
                            label={t('settings.subtitleTriggerGapEndOffset')}
                            value={subtitleTriggerGapEndOffset}
                            onValueChange={(value) => void onSettingChanged('subtitleTriggerGapEndOffset', value)}
                            slotProps={{
                                htmlInput: {
                                    max: 0,
                                    step: 1,
                                },
                                input: {
                                    endAdornment: <InputAdornment position="end">ms</InputAdornment>,
                                },
                            }}
                        />
                    </ResponsiveSettingsStack>
                    <Typography variant="caption" color="textSecondary">
                        {t('settings.subtitleTriggerGapOffsetHelperText')}
                    </Typography>
                </Box>
            )}
            {(!extensionInstalled || extensionSupportsSeekableTrackSetting) && (
                <FormControl>
                    <FormLabel component="legend" sx={{ display: 'flex' }}>
                        {t('settings.seekableTracks')}
                        <KeyboardShortcutLink onClick={onViewSubtitleKeyboardShortcuts} preset="formLabel" />
                    </FormLabel>
                    <FormGroup row>
                        {[0, 1, 2].map((trackIndex) => {
                            return (
                                <FormControlLabel
                                    key={trackIndex}
                                    control={
                                        <Checkbox
                                            checked={isTrackSeekable(seekableTracks, trackIndex)}
                                            onChange={(event) => {
                                                void onSettingChanged(
                                                    'seekableTracks',
                                                    updateSeekableTracksValue(
                                                        seekableTracks,
                                                        trackIndex,
                                                        event.target.checked
                                                    )
                                                );
                                            }}
                                        />
                                    }
                                    label={t('settings.subtitleTrackChoice', { trackNumber: trackIndex + 1 })}
                                />
                            );
                        })}
                    </FormGroup>
                </FormControl>
            )}
        </Stack>
    );
};
export default PlaybackSettingsTab;
