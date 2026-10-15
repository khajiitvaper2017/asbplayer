import BuildIcon from '@mui/icons-material/Build';
import DownloadIcon from '@mui/icons-material/Download';
import RefreshIcon from '@mui/icons-material/Refresh';
import UploadIcon from '@mui/icons-material/Upload';
import ButtonGroup from '@mui/material/ButtonGroup';
import FormControl from '@mui/material/FormControl';
import FormLabel from '@mui/material/FormLabel';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import Stack from '@mui/material/Stack';
import Box from '@mui/material/Box';
import ResponsiveSettingsStack from '@project/common/components/ResponsiveSettingsStack';
import { useTheme } from '@mui/material/styles';
import Switch from '@mui/material/Switch';
import useMediaQuery from '@mui/material/useMediaQuery';
import LabelWithHoverEffect from '@project/common/components/LabelWithHoverEffect';
import LogViewerDialog from '@project/common/components/LogViewerDialog';
import NoWrapButton from '@project/common/components/NoWrapButton';
import RadioGroup from '@project/common/components/SettingsRadioGroup';
import SettingsSection from '@project/common/components/SettingsSection';
import SettingsTextField from '@project/common/components/SettingsTextField';
import SwitchLabelWithHoverEffect from '@project/common/components/SwitchLabelWithHoverEffect';
import type { AsbplayerSettings } from '@project/common/settings';
import { VideoSubtitleSplitBehavior } from '@project/common/settings';
import { exportSettings, mergeImportedSettings, validateSettings } from '@project/common/settings/import-export';
import type { LogProvider } from '@project/common/util/log';
import { asbError } from '@project/common/util/log';
import { WebSocketClient } from '@project/common/web-socket-client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
    settings: AsbplayerSettings;
    onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    logProvider: LogProvider;
    supportedLanguages: string[];
    insideApp?: boolean;
}
const GeneralSettingsTab: React.FC<Props> = ({
    settings,
    onSettingChanged,
    onSettingsChanged,
    logProvider,
    supportedLanguages,
    insideApp,
}) => {
    const { t } = useTranslation();
    const { themeType, videoSubtitleSplitBehavior, language, tabName, webSocketClientEnabled, webSocketServerUrl } =
        settings;
    const [webSocketConnectionSucceeded, setWebSocketConnectionSucceeded] = useState<boolean>();
    const [logViewerOpen, setLogViewerOpen] = useState(false);
    const pingWebSocketServer = useCallback(() => {
        const client = new WebSocketClient();
        client
            .bind(webSocketServerUrl)
            .then(() => client.ping())
            .then(() => setWebSocketConnectionSucceeded(true))
            .catch((e) => {
                asbError('settings/web-socket', e);
                setWebSocketConnectionSucceeded(false);
            })
            .finally(() => client.unbind());
    }, [webSocketServerUrl]);
    useEffect(() => {
        if (webSocketClientEnabled && webSocketServerUrl) {
            pingWebSocketServer();
        }
    }, [pingWebSocketServer, webSocketClientEnabled, webSocketServerUrl]);

    let webSocketServerUrlHelperText: string | null | undefined = undefined;

    if (webSocketClientEnabled) {
        if (webSocketConnectionSucceeded) {
            webSocketServerUrlHelperText = t('info.connectionSucceeded');
        } else if (webSocketConnectionSucceeded === false) {
            webSocketServerUrlHelperText = t('info.connectionFailed');
        }
    }

    const settingsFileInputRef = useRef<HTMLInputElement>(null);
    const handleSettingsFileInputChange = useCallback(async () => {
        try {
            const file = settingsFileInputRef.current?.files?.[0];

            if (file === undefined) {
                return;
            }

            const importedSettings = JSON.parse(await file.text());
            const validatedSettings = validateSettings(mergeImportedSettings(importedSettings, settings));
            onSettingsChanged(validatedSettings);
        } catch (e) {
            asbError('settings/import', e);
        }
    }, [onSettingsChanged, settings]);

    const handleImportSettings = useCallback(() => {
        settingsFileInputRef.current?.click();
    }, []);
    const handleExportSettings = useCallback(() => {
        exportSettings(settings);
    }, [settings]);
    const theme = useTheme();
    const isSmallScreen = useMediaQuery(theme.breakpoints.down('md'));

    return (
        <>
            <Stack spacing={1}>
                <SettingsSection>{t('settings.interface')}</SettingsSection>
                <ResponsiveSettingsStack>
                    <FormControl>
                        <FormLabel>{t('settings.theme')}</FormLabel>
                        <RadioGroup>
                            <LabelWithHoverEffect
                                control={
                                    <Radio
                                        checked={themeType === 'light'}
                                        value="light"
                                        onChange={(event) =>
                                            event.target.checked && void onSettingChanged('themeType', 'light')
                                        }
                                    />
                                }
                                label={t('settings.themeLight')}
                            />
                            <LabelWithHoverEffect
                                control={
                                    <Radio
                                        checked={themeType === 'dark'}
                                        value="dark"
                                        onChange={(event) =>
                                            event.target.checked && void onSettingChanged('themeType', 'dark')
                                        }
                                    />
                                }
                                label={t('settings.themeDark')}
                            />
                        </RadioGroup>
                    </FormControl>
                    <SettingsTextField
                        size="small"
                        select
                        label={t('settings.language')}
                        value={language}
                        color="primary"
                        onChange={(event) => onSettingChanged('language', event.target.value)}
                    >
                        {supportedLanguages.map((s) => (
                            <MenuItem key={s} value={s}>
                                {s}
                            </MenuItem>
                        ))}
                    </SettingsTextField>
                </ResponsiveSettingsStack>{' '}
                <SwitchLabelWithHoverEffect
                    control={
                        <Switch
                            checked={videoSubtitleSplitBehavior === VideoSubtitleSplitBehavior.autoMaximizeVideo}
                            onChange={(event) =>
                                onSettingChanged(
                                    'videoSubtitleSplitBehavior',
                                    event.target.checked
                                        ? VideoSubtitleSplitBehavior.autoMaximizeVideo
                                        : VideoSubtitleSplitBehavior.rememberSplitPosition
                                )
                            }
                        />
                    }
                    label={t('videoSubtitleSplitBehavior.autoMaximizeVideo')}
                    labelPlacement="start"
                />
                {insideApp && (
                    <SettingsTextField
                        size="small"
                        label={t('settings.tabName')}
                        fullWidth
                        value={tabName}
                        color="primary"
                        onChange={(event) => onSettingChanged('tabName', event.target.value)}
                    />
                )}
                <Box component="details">
                    <Box component="summary" sx={{ cursor: 'pointer', py: 1 }}>
                        {t('settings.webSocketInterface')}
                    </Box>
                    <SwitchLabelWithHoverEffect
                        control={
                            <Switch
                                checked={webSocketClientEnabled}
                                onChange={(e) => onSettingChanged('webSocketClientEnabled', e.target.checked)}
                            />
                        }
                        label={t('settings.webSocketClientEnabled')}
                        labelPlacement="start"
                    />
                    {webSocketClientEnabled && (
                        <SettingsTextField
                            size="small"
                            color="primary"
                            fullWidth
                            label={t('settings.webSocketServerUrl')}
                            value={webSocketServerUrl}
                            onChange={(e) => onSettingChanged('webSocketServerUrl', e.target.value)}
                            error={webSocketClientEnabled && webSocketConnectionSucceeded === false}
                            helperText={webSocketServerUrlHelperText}
                            slotProps={{
                                input: {
                                    endAdornment: (
                                        <InputAdornment position="end">
                                            <IconButton onClick={pingWebSocketServer}>
                                                <RefreshIcon />
                                            </IconButton>
                                        </InputAdornment>
                                    ),
                                },
                            }}
                        />
                    )}
                </Box>{' '}
                <SettingsSection>{t('settings.tools')}</SettingsSection>
                <ButtonGroup size="small" variant="contained" orientation={isSmallScreen ? 'vertical' : 'horizontal'}>
                    <NoWrapButton fullWidth startIcon={<UploadIcon />} onClick={handleImportSettings}>
                        {t('action.importSettings')}
                    </NoWrapButton>
                    <NoWrapButton fullWidth startIcon={<DownloadIcon />} onClick={handleExportSettings}>
                        {t('action.exportSettings')}
                    </NoWrapButton>
                    <NoWrapButton fullWidth startIcon={<BuildIcon />} onClick={() => setLogViewerOpen(true)}>
                        {t('settings.logs')}
                    </NoWrapButton>
                </ButtonGroup>
            </Stack>
            <input
                ref={settingsFileInputRef}
                onChange={handleSettingsFileInputChange}
                type="file"
                accept=".json"
                multiple
                hidden
            />
            <LogViewerDialog open={logViewerOpen} onClose={() => setLogViewerOpen(false)} logProvider={logProvider} />
        </>
    );
};
export default GeneralSettingsTab;
