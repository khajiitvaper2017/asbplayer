import type { PaletteMode } from '@mui/material/styles';
import { createTheme as createMuiTheme } from '@mui/material/styles';
import { red } from '@mui/material/colors';

export const createTheme = (themeType: PaletteMode) =>
    createMuiTheme({
        palette: {
            primary: {
                main: '#a855f7',
            },
            grey:
                themeType === 'dark'
                    ? {
                          50: '#fafafa',
                          100: '#f5f5f5',
                          200: '#e5e5e5',
                          300: '#d4d4d4',
                          400: '#a3a3a3',
                          500: '#737373',
                          600: '#525252',
                          700: '#404040',
                          800: '#262626',
                          900: '#171717',
                      }
                    : {
                          50: '#f8fafc',
                          100: '#f1f5f9',
                          200: '#e2e8f0',
                          300: '#cbd5e1',
                          400: '#94a3b8',
                          500: '#64748b',
                          600: '#475569',
                          700: '#334155',
                          800: '#1e293b',
                          900: '#0f172a',
                      },
            error: {
                main: red.A400,
            },
            background: {
                default: themeType === 'dark' ? '#000' : '#fafafa',
                paper: themeType === 'dark' ? '#1d1d1d' : '#ffffff',
            },
            mode: themeType,
        },
        components: {
            MuiInputBase: {
                styleOverrides: {
                    input: {
                        colorScheme: themeType,
                    },
                },
            },
            MuiPaper: {
                styleOverrides: {
                    root:
                        themeType === 'dark'
                            ? {
                                  backgroundColor: '#1d1d1d',
                                  backgroundImage: 'none',
                              }
                            : {},
                },
            },
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
