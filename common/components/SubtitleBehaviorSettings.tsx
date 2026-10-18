import InfoIcon from '@mui/icons-material/Info';
import Checkbox from '@mui/material/Checkbox';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormGroup from '@mui/material/FormGroup';
import FormLabel from '@mui/material/FormLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import Radio from '@mui/material/Radio';
import MenuItem from '@mui/material/MenuItem';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Tooltip from '@mui/material/Tooltip';
import { SubtitleHtml } from '@project/common';
import LabelWithHoverEffect from '@project/common/components/LabelWithHoverEffect';
import ResponsiveSettingsStack from '@project/common/components/ResponsiveSettingsStack';
import RadioGroup from '@project/common/components/SettingsRadioGroup';
import SettingsSection from '@project/common/components/SettingsSection';
import SettingsTextField from '@project/common/components/SettingsTextField';
import SwitchLabelWithHoverEffect from '@project/common/components/SwitchLabelWithHoverEffect';
import type { AsbplayerSettings } from '@project/common/settings';
import {
    embeddedTrackLanguages,
    isTrackAutoCopyable,
    SubtitleListTimestampDisplay,
    updateAutoCopyableTracksValue,
} from '@project/common/settings';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

function regexIsValid(regex: string) {
    try {
        new RegExp(regex.trim());
        return true;
    } catch {
        return false;
    }
}

interface Props {
    settings: AsbplayerSettings;
    onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>;
    insideApp?: boolean;
    extensionInstalled?: boolean;
    extensionSupportsAutoCopyableTrackSetting?: boolean;
    supportsSubtitleListCustomization: boolean;
}
const SubtitleBehaviorSettings: React.FC<Props> = ({
    settings,
    onSettingChanged,
    insideApp,
    extensionInstalled,
    extensionSupportsAutoCopyableTrackSetting,
    supportsSubtitleListCustomization,
}) => {
    const { t } = useTranslation();
    const {
        showSubtitleListMiningButton,
        subtitleListTimestampDisplay,
        subtitleListTimestampDecimalPlaces,
        rememberSubtitleOffset,
        rememberEmbeddedSubtitleLanguage,
        embeddedSubtitleLanguage,
        autoCopyCurrentSubtitle,
        autoCopyableTracks,
        subtitleRegexFilter,
        subtitleRegexFilterTextReplacement,
        subtitleHtml,
        convertNetflixRuby,
        subtitleAboveThumbnail,
        thumbnailPreview,
    } = settings;
    const validRegex = useMemo(() => regexIsValid(subtitleRegexFilter), [subtitleRegexFilter]);
    return (
        <Stack spacing={1}>
            {(supportsSubtitleListCustomization || insideApp) && (
                <SettingsSection>{t('settings.subtitleList')}</SettingsSection>
            )}
            {supportsSubtitleListCustomization && (
                <>
                    <SwitchLabelWithHoverEffect
                        control={
                            <Switch
                                checked={showSubtitleListMiningButton}
                                onChange={(event) =>
                                    onSettingChanged('showSubtitleListMiningButton', event.target.checked)
                                }
                            />
                        }
                        label={t('settings.showSubtitleListMiningButton')}
                        labelPlacement="start"
                    />
                    <FormControl>
                        <FormLabel>{t('settings.subtitleListTimestamps')}</FormLabel>
                        <RadioGroup
                            value={subtitleListTimestampDisplay}
                            onChange={(event) =>
                                onSettingChanged(
                                    'subtitleListTimestampDisplay',
                                    event.target.value as SubtitleListTimestampDisplay
                                )
                            }
                        >
                            {Object.values(SubtitleListTimestampDisplay).map((value) => (
                                <LabelWithHoverEffect
                                    key={value}
                                    control={<Radio value={value} />}
                                    label={t(`subtitleListTimestampDisplay.${value}`)}
                                />
                            ))}
                        </RadioGroup>
                    </FormControl>
                    {subtitleListTimestampDisplay !== SubtitleListTimestampDisplay.hidden && (
                        <SettingsTextField
                            select
                            label={t('settings.subtitleListTimestampDecimalPlaces')}
                            value={subtitleListTimestampDecimalPlaces}
                            slotProps={{
                                select: {
                                    inputProps: { 'aria-label': t('settings.subtitleListTimestampDecimalPlaces') },
                                },
                            }}
                            onChange={(event) =>
                                onSettingChanged(
                                    'subtitleListTimestampDecimalPlaces',
                                    Number(
                                        event.target.value
                                    ) as AsbplayerSettings['subtitleListTimestampDecimalPlaces']
                                )
                            }
                        >
                            {[0, 1, 2, 3].map((places) => (
                                <MenuItem key={places} value={places}>
                                    {places === 0 ? '08:54' : `08:54.${'617'.slice(0, places)}`}
                                </MenuItem>
                            ))}
                        </SettingsTextField>
                    )}
                </>
            )}
            {insideApp && (
                <>
                    <SwitchLabelWithHoverEffect
                        control={
                            <Switch
                                checked={thumbnailPreview}
                                onChange={() => onSettingChanged('thumbnailPreview', !thumbnailPreview)}
                            />
                        }
                        label={t('settings.thumbnailPreview')}
                        labelPlacement="start"
                    />
                    {thumbnailPreview && (
                        <SwitchLabelWithHoverEffect
                            control={
                                <Switch
                                    checked={subtitleAboveThumbnail}
                                    onChange={() => onSettingChanged('subtitleAboveThumbnail', !subtitleAboveThumbnail)}
                                />
                            }
                            label={t('settings.subtitleAboveThumbnail')}
                            labelPlacement="start"
                        />
                    )}
                </>
            )}
            <SettingsSection>{t('settings.behavior')}</SettingsSection>
            <SwitchLabelWithHoverEffect
                control={
                    <Switch
                        checked={rememberSubtitleOffset}
                        onChange={(event) => onSettingChanged('rememberSubtitleOffset', event.target.checked)}
                    />
                }
                label={t('settings.rememberSubtitleOffset')}
                labelPlacement="start"
            />
            {insideApp && (
                <>
                    <SwitchLabelWithHoverEffect
                        control={
                            <Switch
                                checked={rememberEmbeddedSubtitleLanguage}
                                onChange={(event) =>
                                    onSettingChanged('rememberEmbeddedSubtitleLanguage', event.target.checked)
                                }
                            />
                        }
                        label={t('settings.rememberEmbeddedSubtitleLanguage')}
                        labelPlacement="start"
                    />
                    {rememberEmbeddedSubtitleLanguage && (
                        <SettingsTextField
                            size="small"
                            select
                            label={t('settings.embeddedSubtitleLanguage')}
                            value={embeddedSubtitleLanguage}
                            onChange={(event) => onSettingChanged('embeddedSubtitleLanguage', event.target.value)}
                        >
                            {embeddedTrackLanguages.map(({ code, name }) => (
                                <MenuItem key={code} value={code}>
                                    {name}
                                </MenuItem>
                            ))}
                        </SettingsTextField>
                    )}
                </>
            )}
            <SwitchLabelWithHoverEffect
                control={
                    <Switch
                        checked={autoCopyCurrentSubtitle}
                        onChange={(event) => onSettingChanged('autoCopyCurrentSubtitle', event.target.checked)}
                    />
                }
                label={t('settings.autoCopy')}
                labelPlacement="start"
            />
            {autoCopyCurrentSubtitle && (!extensionInstalled || extensionSupportsAutoCopyableTrackSetting) && (
                <FormControl>
                    <FormLabel component="legend">{t('settings.autoCopyableTracks')}</FormLabel>
                    <FormGroup row>
                        {[0, 1, 2].map((trackIndex) => {
                            return (
                                <FormControlLabel
                                    key={trackIndex}
                                    control={
                                        <Checkbox
                                            checked={isTrackAutoCopyable(autoCopyableTracks, trackIndex)}
                                            onChange={(event) => {
                                                void onSettingChanged(
                                                    'autoCopyableTracks',
                                                    updateAutoCopyableTracksValue(
                                                        autoCopyableTracks,
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
            <SettingsSection>{t('settings.textProcessing')}</SettingsSection>
            <ResponsiveSettingsStack>
                <SettingsTextField
                    size="small"
                    label={t('settings.subtitleRegexFilter')}
                    fullWidth
                    value={subtitleRegexFilter}
                    color="primary"
                    error={!validRegex}
                    helperText={!validRegex ? 'Invalid regular expression' : undefined}
                    slotProps={{
                        input: {
                            endAdornment: (
                                <InputAdornment position="end">
                                    <Tooltip title={t('settings.subtitleRegexFilterDocs')}>
                                        <IconButton
                                            component="a"
                                            href="https://asbplayer-jiten-docs.pages.dev/docs/guides/subtitle-text-filtering"
                                            target="_blank"
                                            rel="noreferrer"
                                            aria-label={t('settings.subtitleRegexFilterDocs')}
                                        >
                                            <InfoIcon />
                                        </IconButton>
                                    </Tooltip>
                                </InputAdornment>
                            ),
                        },
                    }}
                    onChange={(event) => onSettingChanged('subtitleRegexFilter', event.target.value)}
                />
                {subtitleRegexFilter.trim() !== '' && (
                    <SettingsTextField
                        size="small"
                        label={t('settings.subtitleRegexFilterTextReplacement')}
                        fullWidth
                        value={subtitleRegexFilterTextReplacement}
                        color="primary"
                        onChange={(event) => onSettingChanged('subtitleRegexFilterTextReplacement', event.target.value)}
                    />
                )}
            </ResponsiveSettingsStack>
            <FormControl>
                <FormLabel>{t('settings.subtitleHtml')}</FormLabel>
                <RadioGroup>
                    <LabelWithHoverEffect
                        control={
                            <Radio
                                checked={subtitleHtml === SubtitleHtml.remove}
                                value={SubtitleHtml.remove}
                                onChange={(event) =>
                                    event.target.checked && void onSettingChanged('subtitleHtml', SubtitleHtml.remove)
                                }
                            />
                        }
                        label={t('settings.subtitleHtmlRemove')}
                    />
                    <LabelWithHoverEffect
                        control={
                            <Radio
                                checked={subtitleHtml === SubtitleHtml.render}
                                value={SubtitleHtml.render}
                                onChange={(event) =>
                                    event.target.checked && void onSettingChanged('subtitleHtml', SubtitleHtml.render)
                                }
                            />
                        }
                        label={t('settings.subtitleHtmlRender')}
                    />
                </RadioGroup>
            </FormControl>
            <SwitchLabelWithHoverEffect
                control={
                    <Switch
                        checked={convertNetflixRuby}
                        onChange={(event) => onSettingChanged('convertNetflixRuby', event.target.checked)}
                    />
                }
                label={t('settings.convertNetflixRuby')}
                labelPlacement="start"
            />
        </Stack>
    );
};
export default SubtitleBehaviorSettings;
