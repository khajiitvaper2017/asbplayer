import React, { useState, useEffect } from 'react';
import makeStyles from '@mui/styles/makeStyles';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import IconButton from '@mui/material/IconButton';
import FileCopyIcon from '@mui/icons-material/FileCopy';
import { useTranslation } from 'react-i18next';
import { MediaFragment, MediaFragmentErrorCode } from '@project/common';
import { type Theme } from '@mui/material';
import { useMediaFragmentData } from '../hooks/use-media-fragment-data';
import Tooltip from './Tooltip';
import ImageIcon from '@mui/icons-material/Image';

interface StyleProps {
    dataUrl: string;
}

const useStyles = makeStyles<Theme, StyleProps>(() => ({
    root: {
        cursor: 'pointer',
        '& input': {
            cursor: 'pointer',
        },
    },
    imagePreview: ({ dataUrl }) => {
        if (dataUrl) {
            return {
                position: 'relative',
                top: 8,
                borderRadius: 2,
                marginRight: 8,
            };
        }

        return {};
    },
}));

const useMediaFragmentHelperText = (mediaFragment?: MediaFragment) => {
    const { t } = useTranslation();
    const [mediaFragmentHelperText, setMediaFragmentHelperText] = useState<string>();
    const [mediaFragmentAvailable, setMediaFragmentAvailable] = useState<boolean>();

    useEffect(() => {
        if (mediaFragment) {
            if (mediaFragment.error === undefined) {
                setMediaFragmentAvailable(true);
                setMediaFragmentHelperText(undefined);
            } else if (mediaFragment.error === MediaFragmentErrorCode.fileLinkLost) {
                setMediaFragmentAvailable(false);
                setMediaFragmentHelperText(t('ankiDialog.imageFileLinkLost')!);
            } else if (mediaFragment.error === MediaFragmentErrorCode.captureFailed) {
                setMediaFragmentAvailable(false);
                setMediaFragmentHelperText(t('ankiDialog.imageCaptureFailed')!);
            }
        }
    }, [mediaFragment, t]);

    return { mediaFragmentHelperText, mediaFragmentAvailable };
};

interface Props {
    onViewImage: (e: React.MouseEvent<HTMLDivElement>) => void;
    onCopyImageToClipboard: (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void;
    mediaFragment: MediaFragment;
    copyEnabled: boolean;
}

export default function MediaFragmentField({
    mediaFragment,
    onViewImage,
    onCopyImageToClipboard,
    copyEnabled,
}: Props) {
    const { t } = useTranslation();
    const { dataUrl, width, height } = useMediaFragmentData({ mediaFragment, smoothTransition: false });
    const classes = useStyles({ dataUrl });
    const { mediaFragmentHelperText, mediaFragmentAvailable } = useMediaFragmentHelperText(mediaFragment);
    const resizeRatio = height === 0 ? 0 : 20 / height;
    return (
        <div className={classes.root} onClick={onViewImage}>
            <TextField
                variant="filled"
                color="primary"
                fullWidth
                value={mediaFragment.name}
                label={t('ankiDialog.image')}
                helperText={mediaFragmentHelperText}
                disabled={!mediaFragmentAvailable}
                slotProps={{
                    input: {
                        startAdornment: dataUrl && width > 0 && height > 0 && (
                            <>
                                {mediaFragment.extension === 'webm' ? (
                                    <video
                                        src={dataUrl}
                                        width={width * resizeRatio}
                                        height={height * resizeRatio}
                                        className={classes.imagePreview}
                                        muted
                                        autoPlay
                                        loop
                                        playsInline
                                    />
                                ) : (
                                    <img
                                        src={dataUrl}
                                        width={width * resizeRatio}
                                        height={height * resizeRatio}
                                        className={classes.imagePreview}
                                    />
                                )}
                            </>
                        ),
                        endAdornment: (
                            <InputAdornment position="end">
                                <>
                                    <Tooltip
                                        disabled={!mediaFragment.canChangeTimestamp || !mediaFragmentAvailable}
                                        title={t('ankiDialog.imagePreview')!}
                                    >
                                        <span>
                                            <IconButton disabled={!mediaFragmentAvailable} onClick={() => {}} edge="end">
                                                <ImageIcon />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                    {copyEnabled && mediaFragment.extension !== 'webm' && (
                                        <Tooltip
                                            disabled={!mediaFragmentAvailable}
                                            title={t('ankiDialog.copyToClipboard')!}
                                        >
                                            <span>
                                                <IconButton
                                                    disabled={!mediaFragmentAvailable}
                                                    onClick={onCopyImageToClipboard}
                                                    edge="end"
                                                >
                                                    <FileCopyIcon />
                                                </IconButton>
                                            </span>
                                        </Tooltip>
                                    )}
                                </>
                            </InputAdornment>
                        ),
                    },
                }}
            />
        </div>
    );
}
