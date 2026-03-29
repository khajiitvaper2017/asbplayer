import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import { type Theme } from '@mui/material/styles';
import CircularProgress from '@mui/material/CircularProgress';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { MediaFragment } from '@project/common';
import { useTranslation } from 'react-i18next';
import { useImageData } from '../../hooks/use-image-data';

interface StyleProps {
    exportComplete: boolean;
}

export interface MediaFragmentCreationPreviewHandle {
    preview: (mediaFragment: MediaFragment) => Promise<void>;
    complete: () => void;
    hide: () => void;
}

const closeTransitionMs = 120;

const useStyles = makeStyles<Theme, StyleProps>((theme) => ({
    root: {
        position: 'fixed',
        right: 16,
        bottom: 16,
        zIndex: 2100,
        pointerEvents: 'none',
        width: 'min(320px, calc(100vw - 32px))',
        opacity: 1,
        transform: 'translateY(0)',
        transition: `opacity ${closeTransitionMs}ms ease, transform ${closeTransitionMs}ms ease`,
    },
    closed: {
        opacity: 0,
        transform: 'translateY(10px)',
    },
    paper: {
        overflow: 'hidden',
        border: `1px solid ${theme.palette.divider}`,
        backgroundColor: theme.palette.background.paper,
        boxShadow: theme.shadows[8],
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        gap: theme.spacing(1),
        padding: theme.spacing(1, 1.25, 0.75),
    },
    dot: {
        width: 8,
        height: 8,
        borderRadius: '50%',
        backgroundColor: ({ exportComplete }) =>
            exportComplete ? theme.palette.success.main : theme.palette.primary.main,
        flexShrink: 0,
    },
    title: {
        minWidth: 0,
        flexGrow: 1,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: theme.palette.text.secondary,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    name: {
        padding: theme.spacing(0, 1.25, 1),
        fontSize: 12,
        color: theme.palette.text.secondary,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
    },
    frame: {
        margin: theme.spacing(0, 1, 1),
        borderRadius: theme.spacing(1),
        overflow: 'hidden',
        minHeight: 132,
        display: 'grid',
        placeItems: 'center',
        backgroundColor: theme.palette.action.hover,
        border: `1px solid ${theme.palette.divider}`,
    },
    preview: {
        display: 'block',
        width: '100%',
        maxHeight: 220,
        objectFit: 'contain',
        backgroundColor: 'transparent',
    },
    '@media (max-width: 640px)': {
        root: {
            left: 12,
            right: 12,
            bottom: 12,
            width: 'calc(100vw - 24px)',
        },
    },
}));

export default React.forwardRef<MediaFragmentCreationPreviewHandle, {}>(
    function MediaFragmentCreationPreview(_props, ref) {
        const { t } = useTranslation();
        const [mediaFragment, setMediaFragment] = useState<MediaFragment>();
        const [exportComplete, setExportComplete] = useState(false);
        const [visible, setVisible] = useState(false);
        const [playbackComplete, setPlaybackComplete] = useState(false);
        const previewRequestId = useRef(0);
        const { dataUrl } = useImageData({ image: mediaFragment, smoothTransition: false });
        const webm = mediaFragment?.extension === 'webm';
        const classes = useStyles({ exportComplete });

        const preview = useCallback(async (nextMediaFragment: MediaFragment) => {
            const requestId = ++previewRequestId.current;

            setMediaFragment(nextMediaFragment);
            setExportComplete(false);
            setPlaybackComplete(false);
            setVisible(false);

            await new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

            if (previewRequestId.current === requestId) {
                setVisible(true);
            }
        }, []);

        const complete = useCallback(() => {
            setExportComplete(true);
        }, []);

        const hide = useCallback(() => {
            previewRequestId.current += 1;
            setVisible(false);
            setExportComplete(false);
            setPlaybackComplete(false);
            setMediaFragment(undefined);
        }, []);

        useImperativeHandle(ref, () => ({ preview, complete, hide }), [complete, hide, preview]);

        useEffect(() => {
            if (!mediaFragment || !exportComplete || (webm && !playbackComplete)) {
                return;
            }

            setVisible(false);
            const timeout = window.setTimeout(() => {
                setMediaFragment(undefined);
                setPlaybackComplete(false);
                setExportComplete(false);
            }, closeTransitionMs);

            return () => window.clearTimeout(timeout);
        }, [exportComplete, mediaFragment, playbackComplete, webm]);

        const handleVideoEnded = useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
            setPlaybackComplete(true);
            const video = event.currentTarget;
            video.currentTime = 0;
            void video.play().catch(() => undefined);
        }, []);

        if (!mediaFragment) {
            return null;
        }

        return (
            <div className={`${classes.root} ${visible ? '' : classes.closed}`} role="status" aria-live="polite">
                <Paper className={classes.paper} elevation={0}>
                    <div className={classes.header}>
                        <div className={classes.dot} />
                        <div className={classes.title}>{t('action.preview')}</div>
                    </div>
                    <div className={classes.frame}>
                        {dataUrl ? (
                            webm ? (
                                <video
                                    className={classes.preview}
                                    src={dataUrl}
                                    autoPlay
                                    preload="auto"
                                    muted
                                    playsInline
                                    onEnded={handleVideoEnded}
                                />
                            ) : (
                                <img className={classes.preview} src={dataUrl} alt={mediaFragment.name} />
                            )
                        ) : (
                            <CircularProgress size={28} />
                        )}
                    </div>
                    <Typography className={classes.name}>{mediaFragment.name}</Typography>
                </Paper>
            </div>
        );
    }
);
