import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { makeStyles } from '@mui/styles';
import type { CreateCSSProperties } from '@mui/styles';
import { createTheme, ThemeProvider, useTheme } from '@mui/material/styles';
import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import type { Theme } from '@mui/material';
import type { AsbplayerSettings, PageConfig, PageSettings, Profile } from '@project/common/settings';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import useMediaQuery from '@mui/material/useMediaQuery';
import About from '@project/common/components/About';
import MiningSettingsTab from '@project/common/components/MiningSettingsTab';
import JitenSettingsTab from '@project/common/components/JitenSettingsTab';
import SubtitleStudySettingsTab from '@project/common/components/SubtitleStudySettingsTab';
import SubtitleAppearanceSettingsTab from '@project/common/components/SubtitleAppearanceSettingsTab';
import KeyboardShortcutsSettingsTab, {
    keyboardShortcutSectionId,
} from '@project/common/components/KeyboardShortcutsSettingsTab';
import type { KeyboardShortcutSection } from '@project/common/components/KeyboardShortcutsSettingsTab';
import StreamingVideoSettingsTab from '@project/common/components/StreamingVideoSettingsTab';
import GeneralSettingsTab from '@project/common/components/GeneralSettingsTab';
import PlaybackSettingsTab from '@project/common/components/PlaybackSettingsTab';
import SubtitleBehaviorSettings from '@project/common/components/SubtitleBehaviorSettings';
import EmbeddedTracksSettingsTab from '@project/common/components/EmbeddedTracksSettingsTab';
import type { LogProvider } from '@project/common/util/log';

interface StylesProps {
    smallScreen: boolean;
    heightConstrained?: boolean;
}

const useStyles = makeStyles<Theme, StylesProps>((theme) => ({
    root: ({ smallScreen }) => {
        let styles: any = {
            position: 'relative',
            maxHeight: '100%',
            height: 'calc(100% - 48px)',
        };

        if (!smallScreen) {
            styles = { ...styles, flexGrow: 1, display: 'flex', height: '100%' };
        }

        return styles;
    },
    tabs: ({ smallScreen, heightConstrained }) => {
        let buttonStyles: React.CSSProperties = {
            paddingLeft: 0,
            paddingRight: theme.spacing(1),
        };
        if (heightConstrained) {
            buttonStyles = { ...buttonStyles, minHeight: 38, fontSize: 12 };
        }
        let styles: CreateCSSProperties<StylesProps> = {
            '& .MuiButtonBase-root': buttonStyles,
            '& .MuiTab-root': {
                minWidth: 120,
                height: '100%',
            },
        };

        if (!smallScreen) {
            styles = { ...styles, minWidth: 120, width: 120 };
        }

        return styles;
    },
    formGroup: {
        '& .MuiTextField-root': {
            marginTop: theme.spacing(1),
            marginBottom: theme.spacing(1),
        },
    },
    subtitleSetting: {
        '& .MuiTextField-root': {
            marginTop: theme.spacing(1),
            marginBottom: theme.spacing(1),
        },
    },
    subtitlePreview: {
        backgroundImage: `linear-gradient(45deg, ${theme.palette.action.disabledBackground} 25%, transparent 25%), linear-gradient(-45deg, ${theme.palette.action.disabledBackground} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${theme.palette.action.disabledBackground} 75%), linear-gradient(-45deg, transparent 75%,${theme.palette.action.disabledBackground} 75%)`,
        backgroundSize: '20px 20px',
        backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
        marginTop: theme.spacing(1),
        marginBottom: theme.spacing(1),
        maxWidth: '100%',
        padding: 10,
    },
    subtitlePreviewInput: {
        border: 'none',
        width: '100%',
        textAlign: 'center',
        backgroundColor: 'rgba(0,0,0,0)',
        '&:focus': {
            outline: 'none',
        },
    },
    switchLabel: {
        justifyContent: 'space-between',
        marginLeft: 0,
        marginRight: -8,
    },
    verticallyCentered: {
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
    },
}));

type TabsOrientation = 'horizontal' | 'vertical';

interface PanelStyleProps {
    tabsOrientation: TabsOrientation;
}

const usePanelStyles = makeStyles<Theme, PanelStyleProps>((theme: Theme) => ({
    panel: ({ tabsOrientation }) => ({
        paddingLeft: tabsOrientation === 'horizontal' ? theme.spacing(1) : theme.spacing(2),
        paddingRight: theme.spacing(1),
        paddingTop: tabsOrientation === 'horizontal' ? theme.spacing(1) : 0,
        overflowY: 'scroll',
        maxHeight: '100%',
        height: '100%',
        width: '100%',
    }),
}));

interface TabPanelProps {
    children?: React.ReactNode;
    index: any;
    value: any;
    tabsOrientation: TabsOrientation;
}

const TabPanel = React.forwardRef<HTMLDivElement, TabPanelProps>(function TabPanel(
    { children, value, index, tabsOrientation, ...other }: TabPanelProps,
    ref
) {
    const classes = usePanelStyles({ tabsOrientation });
    return (
        <Box ref={ref} className={classes.panel} hidden={value !== index} {...other}>
            {value === index && children}
        </Box>
    );
});

type TabName =
    | 'anki-settings'
    | 'mining-settings'
    | 'subtitle-appearance'
    | 'subtitle-study'
    | 'embedded-tracks'
    | 'playback-settings'
    | 'keyboard-shortcuts'
    | 'streaming-video'
    | 'misc-settings';

interface SettingsFormPageConfig extends PageConfig {
    faviconUrl: string;
}

export type PageConfigMap = { [K in keyof PageSettings]: SettingsFormPageConfig };

interface Props {
    extensionInstalled: boolean;
    extensionVersion?: string;
    extensionSupportsAppIntegration: boolean;
    extensionSupportsOverlay: boolean;
    extensionSupportsSidePanel: boolean;
    extensionSupportsTrackSpecificSettings: boolean;
    extensionSupportsSubtitlesWidthSetting: boolean;
    extensionSupportsSubtitlesWidthInPixels: boolean;
    extensionSupportsPauseOnHover: boolean;
    extensionSupportsPlaybackEngine: boolean;
    extensionSupportsAutoPauseResume: boolean;
    extensionSupportsPageSettings: boolean;
    extensionSupportsSeekableTrackSetting: boolean;
    extensionSupportsAutoCopyableTrackSetting: boolean;
    extensionSupportsSubtitleTrackSelectorInWebApp: boolean;
    extensionSupportsSubtitleListCustomization: boolean;
    insideApp?: boolean;
    appVersionRepoPath?: string;
    logProvider: LogProvider;
    settings: AsbplayerSettings;
    profiles: Profile[];
    activeProfile?: string;
    pageConfigs?: PageConfigMap;
    scrollToId?: string;
    chromeKeyBinds: { [key: string]: string | undefined };
    localFontsAvailable: boolean;
    localFontsPermission?: PermissionState;
    localFontFamilies: string[];
    supportedLanguages: string[];
    forceVerticalTabs?: boolean;
    inTutorial?: boolean;
    heightConstrained?: boolean;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    onOpenChromeExtensionShortcuts: () => void;
    onUnlockLocalFonts: () => void;
}

export default function SettingsForm({
    logProvider,
    settings,
    pageConfigs,
    extensionInstalled,
    extensionVersion,
    extensionSupportsAppIntegration,
    extensionSupportsOverlay,
    extensionSupportsSidePanel,
    extensionSupportsSubtitleTrackSelectorInWebApp,
    extensionSupportsSubtitleListCustomization,
    extensionSupportsTrackSpecificSettings,
    extensionSupportsSubtitlesWidthSetting,
    extensionSupportsSubtitlesWidthInPixels,
    extensionSupportsPauseOnHover,
    extensionSupportsPlaybackEngine,
    extensionSupportsAutoPauseResume,
    extensionSupportsPageSettings,
    extensionSupportsSeekableTrackSetting,
    extensionSupportsAutoCopyableTrackSetting,
    insideApp,
    appVersionRepoPath,
    scrollToId,
    chromeKeyBinds,
    localFontsAvailable,
    localFontsPermission,
    localFontFamilies,
    supportedLanguages,
    forceVerticalTabs,
    heightConstrained,
    onSettingsChanged,
    onOpenChromeExtensionShortcuts,
    onUnlockLocalFonts,
}: Props) {
    const supportsPlaybackEngine = !extensionInstalled || extensionSupportsPlaybackEngine;
    const supportsSubtitleListCustomization = !extensionInstalled || extensionSupportsSubtitleListCustomization;
    const supportsAutoPauseResume = !extensionInstalled || extensionSupportsAutoPauseResume;
    const theme = useTheme();
    const settingsTheme = useMemo(
        () =>
            createTheme(theme, {
                components: {
                    MuiFormHelperText: {
                        styleOverrides: {
                            root: {
                                marginLeft: 0,
                            },
                            contained: {
                                marginLeft: 0,
                            },
                        },
                    },
                },
            }),
        [theme]
    );
    const smallScreen = useMediaQuery(theme.breakpoints.down(500)) && !forceVerticalTabs;
    const classes = useStyles({ smallScreen, heightConstrained });
    const handleSettingChanged = useCallback(
        async <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => {
            onSettingsChanged({ [key]: value });
        },
        [onSettingsChanged]
    );
    const { t } = useTranslation();
    const tabIndicesById = useMemo(() => {
        const tabs = [
            'mining-settings',
            'anki-settings',
            'subtitle-appearance',
            'subtitle-study',
            'embedded-tracks',
            'playback-settings',
            'keyboard-shortcuts',
            'streaming-video',
            'misc-settings',
            'about',
        ];

        if (!extensionSupportsAppIntegration) tabs.splice(tabs.indexOf('streaming-video'), 1);
        if (!insideApp) tabs.splice(tabs.indexOf('subtitle-study'), 1);
        if (!insideApp) tabs.splice(tabs.indexOf('embedded-tracks'), 1);
        return Object.fromEntries(tabs.map((tab, i) => [tab, i]));
    }, [extensionSupportsAppIntegration, insideApp]);

    useEffect(() => {
        if (!scrollToId) {
            return;
        }

        if (scrollToId in tabIndicesById) {
            setTabIndex(tabIndicesById[scrollToId as TabName]);
        }
    }, [scrollToId, tabIndicesById]);

    const [tabIndex, setTabIndex] = useState<number>(0);
    const tabsOrientation = smallScreen ? 'horizontal' : 'vertical';
    const keyboardShortcutsPanelRef = useRef<HTMLDivElement>(null);

    const viewKeyboardShortcutSection = useCallback(
        (section: KeyboardShortcutSection) => {
            setTabIndex(tabIndicesById['keyboard-shortcuts']);
            setTimeout(
                () =>
                    keyboardShortcutsPanelRef.current
                        ?.querySelector(`#${keyboardShortcutSectionId(section)}`)
                        ?.scrollIntoView({ behavior: 'smooth' }),
                0
            );
        },
        [tabIndicesById]
    );

    return (
        <ThemeProvider theme={settingsTheme}>
            <div className={classes.root}>
                <Tabs
                    orientation={tabsOrientation}
                    variant="scrollable"
                    value={tabIndex}
                    className={classes.tabs}
                    scrollButtons={false}
                    onChange={(event, index) => {
                        setTabIndex(index);
                    }}
                    sx={{
                        maxWidth: '100vw',
                        marginLeft: smallScreen ? 'auto' : 0,
                        marginRight: smallScreen ? 'auto' : 0,
                    }}
                >
                    <Tab
                        tabIndex={tabIndicesById['mining-settings']}
                        label={t('settings.mining')}
                        id="mining-settings"
                    />
                    <Tab tabIndex={tabIndicesById['anki-settings']} label="Jiten" id="anki-settings" />
                    <Tab
                        tabIndex={tabIndicesById['subtitle-appearance']}
                        label={t('settings.subtitles')}
                        id="subtitle-appearance"
                    />
                    {insideApp && (
                        <Tab
                            tabIndex={tabIndicesById['subtitle-study']}
                            label={t('subtitleStudy.title')}
                            id="subtitle-study"
                        />
                    )}
                    {insideApp && (
                        <Tab
                            tabIndex={tabIndicesById['embedded-tracks']}
                            label={t('settings.embeddedTracks')}
                            id="embedded-tracks"
                        />
                    )}
                    <Tab
                        tabIndex={tabIndicesById['playback-settings']}
                        label={t('settings.playback')}
                        id="playback-settings"
                    />
                    <Tab
                        tabIndex={tabIndicesById['keyboard-shortcuts']}
                        label={t('settings.keyboardShortcuts')}
                        id="keyboard-shortcuts"
                    />
                    {extensionSupportsAppIntegration && (
                        <Tab
                            tabIndex={tabIndicesById['streaming-video']}
                            label={t('settings.streamingVideo')}
                            id="streaming-video"
                        />
                    )}
                    <Tab tabIndex={tabIndicesById['misc-settings']} label={t('settings.general')} id="misc-settings" />
                    <Tab tabIndex={tabIndicesById['about']} label={t('about.title')} id="about" />
                </Tabs>
                {insideApp && (
                    <TabPanel
                        value={tabIndex}
                        index={tabIndicesById['subtitle-study']}
                        tabsOrientation={tabsOrientation}
                    >
                        <SubtitleStudySettingsTab
                            settings={settings}
                            onSettingsChanged={onSettingsChanged}
                            onViewKeyboardShortcuts={() => viewKeyboardShortcutSection('subtitles')}
                        />
                    </TabPanel>
                )}
                <TabPanel value={tabIndex} index={tabIndicesById['anki-settings']} tabsOrientation={tabsOrientation}>
                    <JitenSettingsTab
                        settings={settings}
                        onSettingChanged={handleSettingChanged}
                        onSettingsChanged={onSettingsChanged}
                    />
                </TabPanel>
                <TabPanel value={tabIndex} index={tabIndicesById['mining-settings']} tabsOrientation={tabsOrientation}>
                    <MiningSettingsTab
                        settings={settings}
                        onSettingChanged={handleSettingChanged}
                        showWebmMediaFragmentSettings={Boolean(insideApp)}
                    />
                </TabPanel>
                <TabPanel
                    value={tabIndex}
                    index={tabIndicesById['subtitle-appearance']}
                    tabsOrientation={tabsOrientation}
                >
                    <Stack spacing={2}>
                        <SubtitleAppearanceSettingsTab
                            insideApp={insideApp}
                            settings={settings}
                            onSettingChanged={handleSettingChanged}
                            onSettingsChanged={onSettingsChanged}
                            extensionInstalled={extensionInstalled}
                            extensionSupportsTrackSpecificSettings={extensionSupportsTrackSpecificSettings}
                            extensionSupportsSubtitlesWidthSetting={extensionSupportsSubtitlesWidthSetting}
                            extensionSupportsSubtitlesWidthInPixels={extensionSupportsSubtitlesWidthInPixels}
                            localFontsAvailable={localFontsAvailable}
                            localFontsPermission={localFontsPermission}
                            localFontFamilies={localFontFamilies}
                            onUnlockLocalFonts={onUnlockLocalFonts}
                            onViewKeyboardShortcuts={() => viewKeyboardShortcutSection('subtitles')}
                        />
                        <SubtitleBehaviorSettings
                            settings={settings}
                            onSettingChanged={handleSettingChanged}
                            insideApp={insideApp}
                            extensionInstalled={extensionInstalled}
                            extensionSupportsAutoCopyableTrackSetting={extensionSupportsAutoCopyableTrackSetting}
                            supportsSubtitleListCustomization={supportsSubtitleListCustomization}
                        />
                    </Stack>
                </TabPanel>
                {insideApp && (
                    <TabPanel
                        value={tabIndex}
                        index={tabIndicesById['embedded-tracks']}
                        tabsOrientation={tabsOrientation}
                    >
                        <EmbeddedTracksSettingsTab settings={settings} onSettingChanged={handleSettingChanged} />
                    </TabPanel>
                )}
                <TabPanel
                    value={tabIndex}
                    index={tabIndicesById['playback-settings']}
                    tabsOrientation={tabsOrientation}
                >
                    <PlaybackSettingsTab
                        settings={settings}
                        onSettingChanged={handleSettingChanged}
                        onSettingsChanged={onSettingsChanged}
                        extensionInstalled={extensionInstalled}
                        extensionSupportsPauseOnHover={extensionSupportsPauseOnHover}
                        extensionSupportsSeekableTrackSetting={extensionSupportsSeekableTrackSetting}
                        supportsPlaybackEngine={supportsPlaybackEngine}
                        supportsAutoPauseResume={supportsAutoPauseResume}
                        onViewPlaybackModeKeyboardShortcuts={() => viewKeyboardShortcutSection('playback')}
                        onViewPlaybackRateKeyboardShortcuts={() => viewKeyboardShortcutSection('playbackRate')}
                        onViewSubtitleKeyboardShortcuts={() => viewKeyboardShortcutSection('subtitles')}
                    />
                </TabPanel>
                <TabPanel
                    ref={keyboardShortcutsPanelRef}
                    value={tabIndex}
                    index={tabIndicesById['keyboard-shortcuts']}
                    tabsOrientation={tabsOrientation}
                >
                    <KeyboardShortcutsSettingsTab
                        settings={settings}
                        onSettingChanged={handleSettingChanged}
                        chromeKeyBinds={chromeKeyBinds}
                        extensionInstalled={extensionInstalled}
                        extensionSupportsSidePanel={extensionSupportsSidePanel}
                        extensionSupportsAutoPauseResume={extensionSupportsAutoPauseResume}
                        extensionSupportsSubtitleTrackSelectorInWebApp={extensionSupportsSubtitleTrackSelectorInWebApp}
                        onOpenChromeExtensionShortcuts={onOpenChromeExtensionShortcuts}
                    />
                </TabPanel>
                <TabPanel value={tabIndex} index={tabIndicesById['streaming-video']} tabsOrientation={tabsOrientation}>
                    <StreamingVideoSettingsTab
                        settings={settings}
                        onSettingChanged={handleSettingChanged}
                        onSettingsChanged={onSettingsChanged}
                        insideApp={insideApp}
                        extensionSupportsOverlay={extensionSupportsOverlay}
                        extensionSupportsPageSettings={extensionSupportsPageSettings}
                        pageConfigs={pageConfigs}
                    />
                </TabPanel>
                <TabPanel value={tabIndex} index={tabIndicesById['misc-settings']} tabsOrientation={tabsOrientation}>
                    <GeneralSettingsTab
                        settings={settings}
                        onSettingChanged={handleSettingChanged}
                        onSettingsChanged={onSettingsChanged}
                        logProvider={logProvider}
                        supportedLanguages={supportedLanguages}
                        insideApp={insideApp}
                    />
                </TabPanel>
                <TabPanel value={tabIndex} index={tabIndicesById['about']} tabsOrientation={tabsOrientation}>
                    <About
                        appVersionRepoPath={insideApp ? appVersionRepoPath : undefined}
                        extensionVersion={extensionInstalled ? extensionVersion : undefined}
                    />
                </TabPanel>
            </div>
        </ThemeProvider>
    );
}
