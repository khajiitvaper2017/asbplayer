import type { PaletteMode } from '@mui/material/styles';
import { createTheme as createMuiTheme } from '@mui/material/styles';
import { red } from '@mui/material/colors';

export const createTheme = (themeType: PaletteMode) =>
    createMuiTheme({
        palette: {
            primary: {
                main: '#ff3f78',
            },
            error: {
                main: red.A400,
            },
            background: {
                default: 'rgba(0, 0, 0, 0)',
            },
            mode: themeType,
        },
        components: {
            MuiCssBaseline: {
                styleOverrides: (theme) => ({
                    '*': {
                        scrollbarWidth: 'thin',
                        scrollbarColor: `${theme.palette.action.active} transparent`,
                        '&::-webkit-scrollbar': {
                            width: 8,
                            height: 8,
                        },
                        '&::-webkit-scrollbar-track': {
                            background: 'transparent',
                        },
                        '&::-webkit-scrollbar-thumb': {
                            backgroundColor: theme.palette.action.active,
                            borderRadius: 8,
                            border: '2px solid transparent',
                            backgroundClip: 'content-box',
                        },
                        '&::-webkit-scrollbar-thumb:hover': {
                            backgroundColor: theme.palette.action.hover,
                        },
                    },
                }),
            },
        },
    });
