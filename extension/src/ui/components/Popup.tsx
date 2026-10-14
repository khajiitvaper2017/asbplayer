import Grid from '@mui/material/Grid';
import type { HttpPostMessage, PopupToExtensionCommand } from '@project/common';
import type { AsbplayerSettings, Profile } from '@project/common/settings';
import { chromeCommandBindsToKeyBinds } from '@project/common/settings';
import SettingsForm from '@project/common/components/SettingsForm';
import PanelIcon from '@project/common/components/PanelIcon';
import LaunchIcon from '@mui/icons-material/Launch';
import SettingsIcon from '@mui/icons-material/Settings';
import { useCallback, useMemo } from 'react';
import Button from '@mui/material/Button';
import type { ButtonProps } from '@mui/material/Button';
import ButtonGroup from '@mui/material/ButtonGroup';
import { useTranslation } from 'react-i18next';
import type { Fetcher } from '@project/common/src/fetcher';
import { useLocalFontFamilies } from '@project/common/hooks';
import { Anki } from '@project/common/anki';
import { useSupportedLanguages } from '@project/extension/src/ui/hooks/use-supported-languages';
import { useI18n } from '@project/extension/src/ui/hooks/use-i18n';
import { isMobile } from 'react-device-detect';
import { useTheme } from '@mui/material/styles';
import SettingsProfileSelectMenu from '@project/common/components/SettingsProfileSelectMenu';
import { settingsPageConfigs } from '@/services/pages';
import Stack from '@mui/material/Stack';
import TutorialIcon from '@project/common/components/TutorialIcon';
import Paper from '@mui/material/Paper';
import type { LogProvider } from '@project/common/util/log';
import Tooltip from '@project/common/components/Tooltip';


interface Props {
    logProvider: LogProvider;
    settings: AsbplayerSettings;
    commands: any;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    onOpenApp: () => void;
    onOpenSidePanel: () => void;
    onOpenExtensionShortcuts: () => void;
    onOpenUserGuide: () => void;
    profiles: Profile[];
    activeProfile?: string;
    onNewProfile: (name: string) => void;
    onRemoveProfile: (name: string) => void;
    onSetActiveProfile: (name: string | undefined) => void;
}

class ExtensionFetcher implements Fetcher {
    fetch(url: string, body: any) {
        const httpPostCommand: PopupToExtensionCommand<HttpPostMessage> = {
            sender: 'asbplayer-popup',
            message: {
                command: 'http-post',
                url,
                body,
                messageId: '',
            },
        };
        return browser.runtime.sendMessage(httpPostCommand);
    }
}

const NavButton: React.FC<ButtonProps & { label: string }> = ({ label, ...buttonProps }) => {
    const [isOverflowing, setIsOverflowing] = useState<boolean>();
    return (
        <Tooltip title={label} disabled={!isOverflowing}>
            <Button size="small" variant="contained" color="primary" {...buttonProps}>
                <span
                    ref={(ref) => {
                        setIsOverflowing(ref !== null && ref.scrollWidth > ref.clientWidth);
                    }}
                    style={{
                        display: 'block',
                        maxWidth: '100%',
                        overflow: 'hidden',
                        whiteSpace: 'nowrap',
                        textOverflow: 'ellipsis',
                    }}
                >
                    {label}
                </span>
            </Button>
        </Tooltip>
    );
};

const Popup = ({
    logProvider,
    settings,
    commands,
    onOpenApp,
    onOpenSidePanel,
    onSettingsChanged,
    onOpenExtensionShortcuts,
    onOpenUserGuide,
    ...profilesContext
}: Props) => {
    const { t } = useTranslation();
    const { initialized: i18nInitialized } = useI18n({ language: settings.language });
    const anki = useMemo(() => new Anki(settings, new ExtensionFetcher()), [settings]);
    const handleUnlockLocalFonts = useCallback(() => {
        void browser.tabs.create({
            url: `${browser.runtime.getURL('/options.html')}#subtitle-appearance`,
            active: true,
        });
    }, []);
    const { supportedLanguages } = useSupportedLanguages();
    const { localFontsAvailable, localFontsPermission, localFontFamilies } = useLocalFontFamilies();
    const theme = useTheme();
    const [scrollToId, setScrollToId] = useState<string>();
    if (!i18nInitialized) {
        return null;
    }

    return (
        <Paper>
            <Stack direction="column" spacing={1.5} sx={{ padding: theme.spacing(1.5) }}>
                <ButtonGroup
                    fullWidth
                    size="small"
                    variant="contained"
                    color="primary"
                    orientation="horizontal"
                    sx={{
                        '& .MuiButton-root': {
                            height: '36px',
                        },
                    }}
                >
                    <NavButton startIcon={<LaunchIcon />} onClick={onOpenApp} label={t('action.openApp')} />
                    {!isMobile && (
                        <NavButton
                            startIcon={<PanelIcon />}
                            onClick={onOpenSidePanel}
                            label={t('action.openSidePanel')}
                        />
                    )}
                    <NavButton startIcon={<TutorialIcon />} onClick={onOpenUserGuide} label={t('action.userGuide')} />
                </ButtonGroup>
                <Grid
                    item
                    style={{
                        height: isMobile ? 'auto' : 390,
                    }}
                >
                    <SettingsForm
                        heightConstrained
                        extensionInstalled
                        extensionVersion={browser.runtime.getManifest().version}
                        extensionSupportsAppIntegration
                        extensionSupportsOverlay
                        extensionSupportsSidePanel
                        extensionSupportsOrderableAnkiFields
                        extensionSupportsTrackSpecificSettings
                        extensionSupportsSubtitlesWidthSetting
                        extensionSupportsSubtitlesWidthInPixels
                        extensionSupportsPauseOnHover
                        extensionSupportsPlaybackEngine
                        extensionSupportsAutoPauseResume
                        extensionSupportsExportCardBind
                        extensionSupportsPageSettings
                        extensionSupportsSeekableTrackSetting
                        extensionSupportsAutoCopyableTrackSetting
                        extensionSupportsSubtitleTrackSelectorInWebApp
                        extensionSupportsSubtitleListCustomization
                        extensionSupportsUpdateLastWithSameSubtitleText
                        forceVerticalTabs={false}
                        anki={anki}
                        chromeKeyBinds={chromeCommandBindsToKeyBinds(commands)}
                        logProvider={logProvider}
                        settings={settings}
                        profiles={profilesContext.profiles}
                        activeProfile={profilesContext.activeProfile}
                        pageConfigs={settingsPageConfigs}
                        localFontsAvailable={localFontsAvailable}
                        localFontsPermission={localFontsPermission}
                        localFontFamilies={localFontFamilies}
                        supportedLanguages={supportedLanguages}
                        onSettingsChanged={onSettingsChanged}
                        onOpenChromeExtensionShortcuts={onOpenExtensionShortcuts}
                        onUnlockLocalFonts={handleUnlockLocalFonts}
                        scrollToId={scrollToId}
                    />
                </Grid>
                <Grid item>
                    <SettingsProfileSelectMenu {...profilesContext} />
                </Grid>
            </Stack>
        </Paper>
    );
};

export default Popup;
