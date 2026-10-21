import { useCallback } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import { useTranslation } from 'react-i18next';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import type ChromeExtension from '@project/common/app/services/chrome-extension';
import SettingsForm from '@project/common/components/SettingsForm';
import { useLocalFontFamilies } from '@project/common/hooks';
import type { AsbplayerSettings, Profile } from '@project/common/settings';
import { supportedLanguages } from '@project/common/settings';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import type { Theme } from '@mui/material';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import type { LogProvider } from '@project/common/util/log';

const useStyles = makeStyles<Theme>((theme) => ({
    root: {
        '& .MuiPaper-root': {
            height: '100dvh',
        },
    },
    content: {
        maxHeight: '100%',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
    },
    closeButton: {
        position: 'absolute',
        top: theme.spacing(1),
        right: theme.spacing(1),
        zIndex: 1,
    },
}));

interface Props {
    extension: ChromeExtension;
    open: boolean;
    logProvider: LogProvider;
    settings: AsbplayerSettings;
    scrollToId?: string;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    onClose: () => void;
    profiles: Profile[];
    activeProfile?: string;
    onNewProfile: (name: string) => void;
    onRemoveProfile: (name: string) => void;
    onSetActiveProfile: (name: string | undefined) => void;
}

export default function SettingsDialog({
    extension,
    open,
    logProvider,
    settings,
    scrollToId,
    onSettingsChanged,
    onClose,
    ...profilesContext
}: Props) {
    const { t } = useTranslation();
    const classes = useStyles();
    const theme = useTheme();
    const smallScreenWidth = useMediaQuery(theme.breakpoints.down(500));
    const smallScreenLandscape = useMediaQuery('(orientation: landscape) and (max-height: 500px)');
    const smallScreen = smallScreenWidth || smallScreenLandscape;

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

    return (
        <Dialog open={open} maxWidth="md" fullWidth fullScreen={smallScreen} className={classes.root} onClose={onClose}>
            <DialogContent className={classes.content}>
                <IconButton className={classes.closeButton} aria-label={t('action.close')} onClick={onClose}>
                    <CloseIcon />
                </IconButton>
                <SettingsForm
                    extensionInstalled={extension.installed}
                    extensionVersion={extension.installed ? extension.version : undefined}
                    extensionSupportsAppIntegration={extension.supportsAppIntegration}
                    extensionSupportsOverlay={extension.supportsStreamingVideoOverlay}
                    extensionSupportsSidePanel={extension.supportsSidePanel}
                    extensionSupportsTrackSpecificSettings={extension.supportsTrackSpecificSettings}
                    extensionSupportsSubtitlesWidthSetting={extension.supportsSubtitlesWidthSetting}
                    extensionSupportsSubtitlesWidthInPixels={extension.supportsSubtitlesWidthInPixels}
                    extensionSupportsPauseOnHover={extension.supportsPauseOnHover}
                    extensionSupportsPlaybackEngine={extension.supportsPlaybackEngine}
                    extensionSupportsAutoPauseResume={extension.supportsAutoPauseResume}
                    extensionSupportsPageSettings={extension.supportsPageSettings}
                    extensionSupportsSeekableTrackSetting={extension.supportsSeekableTrackSetting}
                    extensionSupportsAutoCopyableTrackSetting={extension.supportsAutoCopyableTrackSetting}
                    extensionSupportsSubtitleTrackSelectorInWebApp={extension.supportsSubtitleTrackSelectorInWebApp}
                    extensionSupportsSubtitleListCustomization={extension.supportsSubtitleListCustomization}
                    pageConfigs={extension.pageConfig}
                    insideApp
                    appVersionRepoPath={import.meta.env.VITE_APP_VERSION_REPO_PATH}
                    chromeKeyBinds={extension.extensionCommands}
                    onOpenChromeExtensionShortcuts={extension.openShortcuts}
                    onSettingsChanged={onSettingsChanged}
                    logProvider={logProvider}
                    settings={settings}
                    profiles={profilesContext.profiles}
                    activeProfile={profilesContext.activeProfile}
                    showSettingsProfiles={!extension.installed || extension.supportsSettingsProfiles}
                    onNewProfile={profilesContext.onNewProfile}
                    onRemoveProfile={profilesContext.onRemoveProfile}
                    onSetActiveProfile={profilesContext.onSetActiveProfile}
                    scrollToId={scrollToId}
                    localFontsAvailable={localFontsAvailable}
                    localFontsPermission={localFontsPermission}
                    localFontFamilies={localFontFamilies}
                    supportedLanguages={supportedLanguages}
                    onUnlockLocalFonts={handleUnlockLocalFonts}
                />
            </DialogContent>
        </Dialog>
    );
}
