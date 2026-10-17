import React from 'react';
import { useTranslation } from 'react-i18next';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Switch from '@mui/material/Switch';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Button from '@mui/material/Button';
import type { AsbplayerSettings } from '@project/common/settings';
import { defaultSettings, subtitleStudyWordTypes } from '@project/common/settings';
import SettingsSection from '@project/common/components/SettingsSection';
import SwitchLabelWithHoverEffect from '@project/common/components/SwitchLabelWithHoverEffect';
import NumericSettingInput from '@project/common/components/NumericSettingInput';
import KeyboardShortcutLink from '@project/common/components/KeyboardShortcutLink';

interface Props {
    settings: AsbplayerSettings;
    onViewKeyboardShortcuts: () => void;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
}

export default function SubtitleStudySettingsTab({ settings, onSettingsChanged, onViewKeyboardShortcuts }: Props) {
    const { t } = useTranslation();
    return (
        <Stack spacing={2} sx={{ containerType: 'inline-size' }}>
            {(['blur', 'hide'] as const).map((mode) => {
                const enabledKey = mode === 'blur' ? 'subtitleStudyBlurEnabled' : 'subtitleStudyHideEnabled';
                const typesKey = mode === 'blur' ? 'subtitleStudyBlurWordTypes' : 'subtitleStudyHideWordTypes';
                return (
                    <Stack key={mode} spacing={1}>
                        <SettingsSection>{t(`subtitleStudy.${mode}Title`)}</SettingsSection>
                        <SwitchLabelWithHoverEffect
                            label={
                                <Box sx={{ display: 'flex', alignItems: 'center' }}>
                                    {t(`subtitleStudy.${mode}Enabled`)}
                                    <KeyboardShortcutLink onClick={onViewKeyboardShortcuts} preset="formLabel" />
                                </Box>
                            }
                            labelPlacement="start"
                            control={
                                <Switch
                                    checked={settings[enabledKey]}
                                    onChange={(_, checked) => onSettingsChanged({ [enabledKey]: checked })}
                                />
                            }
                        />
                        <Typography variant="body2" color="text.secondary">
                            {t(`subtitleStudy.${mode}Description`)}
                        </Typography>
                        {settings[enabledKey] && (
                            <>
                                <Box
                                    sx={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                                    }}
                                >
                                    {subtitleStudyWordTypes.map((type) => (
                                        <FormControlLabel
                                            key={type}
                                            sx={{ mr: 0 }}
                                            label={t(`subtitleStudy.wordTypes.${type}`)}
                                            control={
                                                <Checkbox
                                                    checked={settings[typesKey].includes(type)}
                                                    onChange={(_, checked) =>
                                                        onSettingsChanged({
                                                            [typesKey]: checked
                                                                ? [...settings[typesKey], type]
                                                                : settings[typesKey].filter((value) => value !== type),
                                                        })
                                                    }
                                                />
                                            }
                                        />
                                    ))}
                                </Box>
                                <Box
                                    sx={{
                                        width: '100%',
                                        '@container (min-width: 560px)': { width: 'calc((100% - 8px) / 2)' },
                                    }}
                                >
                                    {mode === 'blur' ? (
                                        <NumericSettingInput
                                            size="small"
                                            fullWidth
                                            label={t('subtitleStudy.blurRadius')}
                                            value={settings.subtitleStudyBlurRadius}
                                            normalizeValue={(value) =>
                                                Number.isFinite(value) ? Math.min(40, Math.max(0, value)) : undefined
                                            }
                                            onValueChange={(value) =>
                                                onSettingsChanged({ subtitleStudyBlurRadius: value })
                                            }
                                            slotProps={{ htmlInput: { min: 0, max: 40, step: 0.5 } }}
                                        />
                                    ) : (
                                        <NumericSettingInput
                                            size="small"
                                            fullWidth
                                            label={t('subtitleStudy.fadeTime')}
                                            value={settings.subtitleStudyFadeSeconds}
                                            normalizeValue={(value) =>
                                                Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : undefined
                                            }
                                            onValueChange={(value) =>
                                                onSettingsChanged({ subtitleStudyFadeSeconds: value })
                                            }
                                            slotProps={{ htmlInput: { min: 0, max: 1, step: 0.01 } }}
                                        />
                                    )}
                                </Box>
                            </>
                        )}
                    </Stack>
                );
            })}
            <Button
                sx={{ alignSelf: 'flex-start' }}
                onClick={() =>
                    onSettingsChanged({
                        subtitleStudyBlurEnabled: defaultSettings.subtitleStudyBlurEnabled,
                        subtitleStudyHideEnabled: defaultSettings.subtitleStudyHideEnabled,
                        subtitleStudyBlurWordTypes: defaultSettings.subtitleStudyBlurWordTypes,
                        subtitleStudyHideWordTypes: defaultSettings.subtitleStudyHideWordTypes,
                        subtitleStudyBlurRadius: defaultSettings.subtitleStudyBlurRadius,
                        subtitleStudyFadeSeconds: defaultSettings.subtitleStudyFadeSeconds,
                    })
                }
            >
                {t('subtitleStudy.reset')}
            </Button>
        </Stack>
    );
}
