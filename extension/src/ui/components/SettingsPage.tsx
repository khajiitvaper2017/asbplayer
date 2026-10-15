import { useCallback } from 'react';
import { makeStyles } from '@mui/styles';
import { useTranslation } from 'react-i18next';
import Box from '@mui/material/Box';
import SettingsForm from '@project/common/components/SettingsForm';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import { useCommandKeyBinds } from '@project/extension/src/ui/hooks/use-command-key-binds';
import { useLocalFontFamilies } from '@project/common/hooks';
import { useI18n } from '@project/extension/src/ui/hooks/use-i18n';
import Paper from '@mui/material/Paper';
import { useSupportedLanguages } from '@project/extension/src/ui/hooks/use-supported-languages';
import SettingsProfileSelectMenu from '@project/common/components/SettingsProfileSelectMenu';
import type { AsbplayerSettings, Profile } from '@project/common/settings';
import { useTheme } from '@mui/material/styles';
import type { Theme } from '@mui/material/styles';
import { settingsPageConfigs } from '@/services/pages';
import type { LogProvider } from '@project/common/util/log';
import { useLocationHash } from '@project/common/hooks/use-location-hash';

const useStyles = makeStyles<Theme>((theme) => ({
    root: {
        '& .MuiPaper-root': {
            height: '100dvh',
        },
    },
    content: {
        maxHeight: '100%',
    },
    profilesContainer: {
        paddingLeft: theme.spacing(4),
        paddingRight: theme.spacing(4),
    },
}));

interface Props {
    logProvider: LogProvider;
    settings: AsbplayerSettings;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    profiles: Profile[];
    activeProfile?: string;
    inTutorial?: boolean;
    onNewProfile: (name: string) => void;
    onRemoveProfile: (name: string) => void;
    onSetActiveProfile: (name: string | undefined) => void;
}

const SettingsPage = ({ logProvider, settings, inTutorial, onSettingsChanged, ...profileContext }: Props) => {
    const { t } = useTranslation();
    const theme = useTheme();
    const classes = useStyles();

    const {
        updateLocalFontsPermission,
        updateLocalFonts,
        localFontsAvailable,
        localFontsPermission,
        localFontFamilies,
    } = useLocalFontFamilies();
    const handleUnlockLocalFonts = useCallback(() => {
        updateLocalFontsPermission();
        updateLocalFonts();
    }, [updateLocalFontsPermission, updateLocalFonts]);

    const commands = useCommandKeyBinds();

    const handleOpenExtensionShortcuts = useCallback(() => {
        void browser.tabs.create({ active: true, url: 'chrome://extensions/shortcuts' });
    }, []);

    const { initialized: i18nInitialized } = useI18n({ language: settings?.language ?? 'en' });
    const { supportedLanguages } = useSupportedLanguages();

    const { hash: scrollToId } = useLocationHash();

    if (!settings || !commands || !i18nInitialized) {
        return null;
    }

    return (
        <Paper square style={{ height: '100dvh' }}>
            <Dialog open={true} maxWidth="md" fullWidth className={classes.root} onClose={() => {}}>
                <DialogTitle>{t('settings.title')}</DialogTitle>
                <DialogContent className={classes.content}>
                    <SettingsForm
                        extensionInstalled
                        extensionVersion={browser.runtime.getManifest().version}
                        extensionSupportsAppIntegration
                        extensionSupportsOverlay
                        extensionSupportsSidePanel
                        extensionSupportsTrackSpecificSettings
                        extensionSupportsSubtitlesWidthSetting
                        extensionSupportsSubtitlesWidthInPixels
                        extensionSupportsPauseOnHover
                        extensionSupportsPlaybackEngine
                        extensionSupportsAutoPauseResume
                        extensionSupportsPageSettings
                        extensionSupportsSeekableTrackSetting
                        extensionSupportsAutoCopyableTrackSetting
                        extensionSupportsSubtitleTrackSelectorInWebApp
                        extensionSupportsSubtitleListCustomization
                        chromeKeyBinds={commands}
                        onOpenChromeExtensionShortcuts={handleOpenExtensionShortcuts}
                        onSettingsChanged={onSettingsChanged}
                        logProvider={logProvider}
                        settings={settings}
                        profiles={profileContext.profiles}
                        activeProfile={profileContext.activeProfile}
                        pageConfigs={settingsPageConfigs}
                        localFontsAvailable={localFontsAvailable}
                        localFontsPermission={localFontsPermission}
                        localFontFamilies={localFontFamilies}
                        supportedLanguages={supportedLanguages}
                        onUnlockLocalFonts={handleUnlockLocalFonts}
                        inTutorial={inTutorial}
                        scrollToId={scrollToId}
                    />
                </DialogContent>
                <Box style={{ marginBottom: theme.spacing(2) }} className={classes.profilesContainer}>
                    <SettingsProfileSelectMenu {...profileContext} />
                </Box>
            </Dialog>
        </Paper>
    );
};

export default SettingsPage;
