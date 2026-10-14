import ThemeProvider from '@mui/material/styles/ThemeProvider';
import CssBaseline from '@mui/material/CssBaseline';
import { useSettings } from '@project/extension/src/ui/hooks/use-settings';
import { useMemo } from 'react';
import SettingsPage from '@project/extension/src/ui/components/SettingsPage';
import { createTheme } from '@project/common/theme';
import { StyledEngineProvider } from '@mui/material/styles';
import { extensionLogProvider } from '@/services/extension-log-provider';

const searchParams = new URLSearchParams(window.location.search);
const inTutorial = searchParams.get('tutorial') === 'true';
const SettingsUi = () => {
    const { settings, onSettingsChanged, profileContext } = useSettings();
    const theme = useMemo(() => settings && createTheme(settings.themeType), [settings]);

    if (!settings || !theme) {
        return null;
    }

    return (
        <StyledEngineProvider injectFirst>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <SettingsPage
                    logProvider={extensionLogProvider}
                    settings={settings}
                    onSettingsChanged={onSettingsChanged}
                    inTutorial={inTutorial}
                    {...profileContext}
                />
            </ThemeProvider>
        </StyledEngineProvider>
    );
};

export default SettingsUi;
