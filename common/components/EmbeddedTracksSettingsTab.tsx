import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import MenuItem from '@mui/material/MenuItem';
import { useTranslation } from 'react-i18next';
import type { AsbplayerSettings } from '@project/common/settings';
import { embeddedTrackLanguages } from '@project/common/settings';
import SettingsTextField from '@project/common/components/SettingsTextField';
import SwitchLabelWithHoverEffect from '@project/common/components/SwitchLabelWithHoverEffect';

interface Props {
    settings: AsbplayerSettings;
    onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>;
}

export default function EmbeddedTracksSettingsTab({ settings, onSettingChanged }: Props) {
    const { t } = useTranslation();
    return (
        <Stack spacing={1}>
            {(
                [
                    'loadEmbeddedAudio',
                    'loadEmbeddedSubtitles',
                    'rememberEmbeddedLanguage',
                    'loadPreferredEmbeddedLanguageOnly',
                ] as const
            ).map((key) => (
                <SwitchLabelWithHoverEffect
                    key={key}
                    label={t(`settings.${key}`)}
                    labelPlacement="start"
                    disabled={key === 'loadPreferredEmbeddedLanguageOnly' && !settings.rememberEmbeddedLanguage}
                    control={
                        <Switch checked={settings[key]} onChange={(_, checked) => onSettingChanged(key, checked)} />
                    }
                />
            ))}
            {settings.rememberEmbeddedLanguage && (
                <SettingsTextField
                    size="small"
                    select
                    label={t('settings.embeddedLanguage')}
                    value={settings.embeddedLanguage}
                    onChange={(event) => onSettingChanged('embeddedLanguage', event.target.value)}
                >
                    {embeddedTrackLanguages.map(({ code, name }) => (
                        <MenuItem key={code} value={code}>
                            {name}
                        </MenuItem>
                    ))}
                </SettingsTextField>
            )}
        </Stack>
    );
}
