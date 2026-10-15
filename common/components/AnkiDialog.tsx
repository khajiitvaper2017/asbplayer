import { asbInfo } from '@project/common/util/log';
import {
    humanReadableTime,
    surroundingSubtitlesAroundInterval,
    subtitleIntersectsTimeInterval,
    joinSubtitles,
    extractText,
} from '@project/common/util';
import type { RefObject } from 'react';
import React, { useCallback, useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import makeStyles from '@mui/styles/makeStyles';
import type { SubtitleModel, CardModel } from '@project/common';
import { MediaFragment } from '@project/common';
import type { AnkiSettings, Profile } from '@project/common/settings';
import { AudioClip } from '@project/common/audio-clip';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import Grid from '@mui/material/Grid';
import IconButton from '@mui/material/IconButton';
import InputAdornment from '@mui/material/InputAdornment';
import BorderColorIcon from '@mui/icons-material/BorderColor';
import RestoreIcon from '@mui/icons-material/Restore';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import Slider from '@mui/material/Slider';
import Toolbar from '@mui/material/Toolbar';
import Tooltip from '@project/common/components/Tooltip';
import Typography from '@mui/material/Typography';
import ZoomInIcon from '@mui/icons-material/ZoomIn';
import ZoomOutIcon from '@mui/icons-material/ZoomOut';
import DoneIcon from '@mui/icons-material/Done';
import type { ExportParams } from '@project/common/anki';
import { isFirefox } from '@project/common/browser-detection';
import SentenceField from '@project/common/components/SentenceField';
import AudioField from '@project/common/components/AudioField';
import ImageField from '@project/common/components/ImageField';
import ImageDialog from '@project/common/components/ImageDialog';
import MiniProfileSelector from '@project/common/components/MiniProfileSelector';
import Alert from '@mui/material/Alert';
import AnkiDialogButton from '@project/common/components/AnkiDialogButton';
import type { Theme } from '@mui/material';
import Link from '@mui/material/Link';
import { Checkbox, FormControlLabel, Radio, RadioGroup, Stack } from '@mui/material';
import {
    highlightJitenWord,
    jitenSurfaceForm,
    jitenValidationError,
    jitenWordUrl,
    stripJitenMarkers,
} from '@project/common/jiten/jiten';
import type { JitenTarget, JitenAttachmentResult } from '@project/common/jiten/jiten';

const useStyles = makeStyles<Theme>((theme) => ({
    root: {
        '& .MuiTextField-root': {
            marginBottom: theme.spacing(1),
        },
    },
    title: {
        flexGrow: 1,
    },
    mediaField: {
        cursor: 'pointer',
        '& input': {
            cursor: 'pointer',
        },
    },
    rangeSelectSlider: {
        '& .MuiSlider-markLabel': {
            transform: 'translateX(-3%)',
            background: theme.palette.mode === 'dark' ? '#222' : '#ddd',
            borderRadius: theme.spacing(1),
            paddingLeft: theme.spacing(1),
            paddingRight: theme.spacing(1),
            color: theme.palette.text.disabled,
        },
        '& .MuiSlider-markLabelActive': {
            opacity: 1,
            color: theme.palette.text.primary,
        },
    },
}));

const boundaryIntervalSubtitleCountRadius = 1;
const boundaryIntervalSubtitleTimeRadius = 5000;

const boundaryIntervalFromCard = (subtitle: SubtitleModel, theSurroundingSubtitles: SubtitleModel[]) => {
    const { surroundingSubtitles: subtitlesToDisplay } = surroundingSubtitlesAroundInterval(
        theSurroundingSubtitles,
        subtitle.start,
        subtitle.end,
        boundaryIntervalSubtitleCountRadius,
        boundaryIntervalSubtitleTimeRadius
    );

    let min: number | null = null;
    let max: number | null = null;

    for (const s of subtitlesToDisplay ?? []) {
        if (min === null || s.start < min) {
            min = s.start;
        }

        if (max === null || s.end > max) {
            max = s.end;
        }
    }

    return min !== null && max !== null && [min, max];
};

type Mark = {
    value: number;
    label: string;
};

const sliderMarksFromCard = (surroundingSubtitles: SubtitleModel[], boundary: number[]): Mark[] => {
    const seenTimestamps: any = {};

    return surroundingSubtitles
        .filter((s) => s.text.trim() !== '' || s.textImage !== undefined)
        .map((s) => {
            if (s.start in seenTimestamps) {
                return null;
            }

            seenTimestamps[s.start] = true;

            return {
                value: s.start,
                label: `${s.text.trim().substring(0, Math.min(s.text.length, 3))}...`,
            };
        })
        .filter((mark: Mark | null) => mark !== null)
        .filter((mark: Mark | null) => mark!.value >= boundary[0] && mark!.value <= boundary[1]);
};

const sliderValueLabelFormat = (ms: number) => {
    return humanReadableTime(ms, true);
};

interface ValueLabelComponentProps {
    children: React.ReactElement;
    open: boolean;
    value: number;
}

const ValueLabelComponent = ({ children, open, value }: ValueLabelComponentProps) => {
    return (
        <Tooltip open={open} enterTouchDelay={0} placement="top" title={value}>
            {children}
        </Tooltip>
    );
};

export interface AnkiDialogState {
    text: string;
    subtitle: SubtitleModel;
    surroundingSubtitles: SubtitleModel[];
    source: string;
    lastAppliedTimestampIntervalToText?: number[];
    lastAppliedTimestampIntervalToAudio?: number[];
    initialTimestampInterval?: number[];
    timestampBoundaryInterval?: number[];
    timestampInterval?: number[];
}

interface AnkiDialogProps {
    jiten: {
        target?: JitenTarget;
        targets?: JitenTarget[];
        result?: JitenAttachmentResult;
        preventMultipleWords?: boolean;
        showUnmatchedAttachmentTarget?: boolean;
        onMineNewWords?: (params: ExportParams, targets: JitenTarget[]) => Promise<void>;
        loadNewWords?: () => Promise<JitenTarget[]>;
    };
    open: boolean;
    disabled: boolean;
    card: CardModel;
    onProceed: (params: ExportParams) => Promise<void>;
    onRerecord?: () => void;
    onCancel: () => void;
    onOpenSettings?: () => void;
    onCopyToClipboard: (blob: Blob) => void;
    settings: AnkiSettings;
    source?: string;
    initialTimestampInterval?: number[];
    timestampBoundaryInterval?: number[];
    timestampInterval?: number[];
    lastAppliedTimestampIntervalToText?: number[];
    lastAppliedTimestampIntervalToAudio?: number[];
    stateRef?: RefObject<AnkiDialogState | undefined>;
    mp3Encoder: (blob: Blob, extension: string) => Promise<Blob>;
    profiles?: Profile[];
    activeProfile?: string;
    onSetActiveProfile?: (profile: string | undefined) => void;
    inTutorial?: boolean;
}

const renderJitenWord = (target: JitenTarget) => {
    const reading = target.reading;
    const rubyReading: React.ReactNode[] = [];
    let readingOffset = 0;
    for (const match of reading.matchAll(/([一-鿿０-ｚ々ヵヶ]+)\[([぀-ゟ゠-ヿ]+)\]/g)) {
        rubyReading.push(
            reading.slice(readingOffset, match.index),
            <ruby key={match.index} lang="ja">
                {match[1]}
                <rp>(</rp>
                <rt>{match[2]}</rt>
                <rp>)</rp>
            </ruby>
        );
        readingOffset = match.index + match[0].length;
    }
    if (rubyReading.length) return [...rubyReading, reading.slice(readingOffset)];
    return (
        target.surfaceForm ?? (
            <>
                {target.spelling} ({reading})
            </>
        )
    );
};

const AnkiDialog = ({
    jiten,
    open,
    disabled,
    card,
    onProceed,
    onCancel,
    onOpenSettings,
    onRerecord,
    onCopyToClipboard,
    settings,
    source: initialSource,
    timestampInterval: initialSelectedTimestampInterval,
    timestampBoundaryInterval: forceTimestampBoundaryInterval,
    initialTimestampInterval: forceInitialTimestampInterval,
    lastAppliedTimestampIntervalToText: initialLastAppliedTimestampIntervalToText,
    lastAppliedTimestampIntervalToAudio: initialLastAppliedTimestampIntervalToAudio,
    stateRef,
    mp3Encoder,
    profiles,
    activeProfile,
    onSetActiveProfile,
}: AnkiDialogProps) => {
    const classes = useStyles();
    const [text, setText] = useState<string>('');
    const [source, setSource] = useState<string>('');
    const [timestampInterval, setTimestampInterval] = useState<number[]>();
    const [selectedSubtitles, setSelectedSubtitles] = useState<SubtitleModel[]>([]);
    const [initialTimestampInterval, setInitialTimestampInterval] = useState<number[]>();
    const [initialTimestampBoundaryInterval, setInitialTimestampBoundaryInterval] = useState<number[]>();
    const [timestampBoundaryInterval, setTimestampBoundaryInterval] = useState<number[]>();
    const [timestampMarks, setTimestampMarks] = useState<Mark[]>();
    const [lastAppliedTimestampIntervalToText, setLastAppliedTimestampIntervalToText] = useState<number[]>();
    const [lastAppliedTimestampIntervalToAudio, setLastAppliedTimestampIntervalToAudio] = useState<number[]>();
    const [width, setWidth] = useState<number>(0);
    const [audioClip, setAudioClip] = useState<AudioClip>();
    const [imageDialogOpen, setImageDialogOpen] = useState<boolean>(false);
    const [image, setImage] = useState<MediaFragment>();
    const [imageTimestampInterval, setImageTimestampInterval] = useState<number[]>();
    const dialogRef = useRef<HTMLDivElement>(undefined);
    const dialogRefCallback = useCallback((element: HTMLDivElement) => {
        dialogRef.current = element;
        setWidth(element?.getBoundingClientRect().width ?? 0);
    }, []);
    const { t } = useTranslation();
    const allowManualHighlight = Boolean(jiten.showUnmatchedAttachmentTarget);
    const jitenText = highlightJitenWord(allowManualHighlight ? text : stripJitenMarkers(text), jiten?.target);
    const attachmentSurface = jitenSurfaceForm(jiten?.target);
    const attachmentMatches = Boolean(attachmentSurface && stripJitenMarkers(text).includes(attachmentSurface));
    const showAttachmentTarget = Boolean(jiten?.target && (attachmentMatches || jiten.showUnmatchedAttachmentTarget));
    const jitenError = jitenValidationError(jiten.target, jitenText, source);
    const [newWords, setNewWords] = useState<JitenTarget[]>();
    const [newWordsError, setNewWordsError] = useState<string>();
    const loadNewWords = jiten?.loadNewWords;
    const pendingWords = jiten?.targets;
    useEffect(() => {
        if (!open || !loadNewWords || pendingWords) return;
        let active = true;
        setNewWords(undefined);
        setNewWordsError(undefined);
        void loadNewWords().then(
            (words) => active && setNewWords(words),
            (error: Error) => active && setNewWordsError(error.message)
        );
        return () => {
            active = false;
        };
    }, [open, loadNewWords, pendingWords]);
    const mineWords = (pendingWords ?? newWords ?? []).filter((target) => {
        const form = jitenSurfaceForm(target);
        return form && stripJitenMarkers(jitenText).includes(form);
    });
    const [selectedWords, setSelectedWords] = useState<JitenTarget[]>();
    useEffect(() => setSelectedWords(undefined), [open, card, pendingWords, jiten?.preventMultipleWords]);
    const selectedMineWords = mineWords.filter((target) =>
        selectedWords ? selectedWords.includes(target) : !jiten?.preventMultipleWords || mineWords.length === 1
    );
    const [sentenceSelection, setSentenceSelection] = useState<[number, number]>();
    useEffect(() => setSentenceSelection(undefined), [jitenText, open, allowManualHighlight]);
    const handleHighlightWord = () => {
        if (!sentenceSelection) return;
        const [start, end] = sentenceSelection;
        const selected = stripJitenMarkers(jitenText.slice(start, end));
        if (!selected.trim()) return;
        setText(
            stripJitenMarkers(jitenText.slice(0, start)) + `**${selected}**` + stripJitenMarkers(jitenText.slice(end))
        );
        setLastAppliedTimestampIntervalToText(undefined);
    };

    const buildExportParams = useCallback(
        (): ExportParams => ({ text: jitenText, audioClip, image, source }),
        [jitenText, audioClip, image, source]
    );

    if (stateRef) {
        stateRef.current = {
            text,
            subtitle: card.subtitle,
            surroundingSubtitles: card.surroundingSubtitles,
            source,
            initialTimestampInterval,
            timestampBoundaryInterval,
            lastAppliedTimestampIntervalToText,
            lastAppliedTimestampIntervalToAudio,
            timestampInterval,
        };
    }

    const textForTimestampInterval = useCallback(
        (timestampInterval: number[]) => {
            return joinSubtitles(
                card.surroundingSubtitles.filter((s) => subtitleIntersectsTimeInterval(s, timestampInterval))
            );
        },
        [card.surroundingSubtitles]
    );

    const { text: cardText } = card;
    const initialText = (cardText ?? extractText(card.subtitle, card.surroundingSubtitles)) || jiten?.target?.sentence;
    useEffect(() => {
        setText(initialText ?? extractText(card.subtitle, card.surroundingSubtitles) ?? '');
        setSource(initialSource ?? `${card.subtitleFileName} (${humanReadableTime(card.subtitle.start)})`);
    }, [card.subtitle, card.surroundingSubtitles, card.subtitleFileName, initialText, initialSource]);
    useEffect(() => {
        const timestampInterval =
            initialSelectedTimestampInterval || [card.subtitle.start, card.subtitle.end] || undefined;
        const timestampBoundaryInterval =
            boundaryIntervalFromCard(card.subtitle, card.surroundingSubtitles) || undefined;
        const timestampMarks = sliderMarksFromCard(card.surroundingSubtitles, timestampBoundaryInterval!) || undefined;
        const selectedSubtitles =
            timestampInterval === undefined
                ? []
                : card.surroundingSubtitles.filter((s) => subtitleIntersectsTimeInterval(s, timestampInterval));
        setText(initialText ?? joinSubtitles(selectedSubtitles));
        setTimestampInterval(timestampInterval);
        setSelectedSubtitles(selectedSubtitles);
        setInitialTimestampInterval(forceInitialTimestampInterval || timestampInterval);
        setLastAppliedTimestampIntervalToText(initialLastAppliedTimestampIntervalToText || timestampInterval);
        setLastAppliedTimestampIntervalToAudio(initialLastAppliedTimestampIntervalToAudio || timestampInterval);
        setTimestampBoundaryInterval(forceTimestampBoundaryInterval ?? timestampBoundaryInterval);
        setInitialTimestampBoundaryInterval(timestampBoundaryInterval);
        setTimestampMarks(timestampMarks);
    }, [
        card.subtitle,
        card.surroundingSubtitles,
        initialText,
        forceInitialTimestampInterval,
        initialSelectedTimestampInterval,
        forceTimestampBoundaryInterval,
        initialLastAppliedTimestampIntervalToText,
        initialLastAppliedTimestampIntervalToAudio,
    ]);

    const initialAudioClip = useMemo(
        () =>
            AudioClip.fromCard(
                card,
                settings.audioPaddingStart,
                settings.audioPaddingEnd,
                settings.recordWithAudioPlayback
            ),
        [card, settings.audioPaddingStart, settings.audioPaddingEnd, settings.recordWithAudioPlayback]
    );

    useEffect(() => {
        if (!initialAudioClip) {
            setAudioClip(undefined);
            return;
        }

        let newAudioClip = initialAudioClip;

        if (settings.preferMp3) {
            newAudioClip = newAudioClip.toEncoded(mp3Encoder, 'mp3');
        }

        if (lastAppliedTimestampIntervalToAudio) {
            newAudioClip = newAudioClip.slice(
                Math.max(0, Math.round(lastAppliedTimestampIntervalToAudio[0]) - settings.audioPaddingStart),
                Math.round(lastAppliedTimestampIntervalToAudio[1]) + settings.audioPaddingEnd
            );
        }

        setAudioClip(newAudioClip);
    }, [
        mp3Encoder,
        initialAudioClip,
        settings.preferMp3,
        lastAppliedTimestampIntervalToAudio,
        settings.audioPaddingStart,
        settings.audioPaddingEnd,
    ]);

    const handlePlayAudio = useCallback(
        async (e: React.MouseEvent<HTMLDivElement>) => {
            if (audioClip?.error !== undefined) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            audioClip!.play().catch((error) => asbInfo('anki/ui', error));
        },
        [audioClip]
    );

    const handleViewImage = useCallback(
        async (e: React.MouseEvent<HTMLDivElement>) => {
            if (image?.error !== undefined) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();
            setImageDialogOpen(true);
        },
        [image]
    );

    const handleCloseImageDialog = useCallback(() => setImageDialogOpen(false), []);

    const handleImageTimestampChange = useCallback((timestamp: number) => {
        setImage((image) => {
            if (!image) {
                return;
            }

            return image.atTimestamp(timestamp);
        });
    }, []);

    const handleImageTimestampIntervalChange = useCallback(
        (newTimestampInterval: number[]) => {
            const file = card.file;

            if (settings.mediaFragmentFormat !== 'webm' || !file) {
                return;
            }

            setImageTimestampInterval(newTimestampInterval);

            setImage((previousImage) => {
                previousImage?.dispose();
                return MediaFragment.fromWebmFile(
                    file,
                    newTimestampInterval[0],
                    newTimestampInterval[1],
                    settings.maxImageWidth,
                    settings.maxImageHeight
                );
            });
        },
        [card.file, settings.maxImageWidth, settings.maxImageHeight, settings.mediaFragmentFormat]
    );

    const applyTimestampIntervalToAllTracks = useCallback(
        (newTimestampInterval: number[], force?: boolean) => {
            const expectedUnchangedText =
                lastAppliedTimestampIntervalToText === undefined
                    ? undefined
                    : textForTimestampInterval(lastAppliedTimestampIntervalToText);
            if (force || expectedUnchangedText === undefined || text.trim() === expectedUnchangedText.trim()) {
                setText(textForTimestampInterval(newTimestampInterval));
            }
        },
        [textForTimestampInterval, lastAppliedTimestampIntervalToText, text]
    );

    const handleApplyTimestampIntervalToText = useCallback(() => {
        if (timestampInterval === undefined) {
            return;
        }

        applyTimestampIntervalToAllTracks(timestampInterval, true);
        setLastAppliedTimestampIntervalToText(timestampInterval);
    }, [applyTimestampIntervalToAllTracks, timestampInterval]);

    const handleTimestampIntervalChange = useCallback(
        (_: unknown, newValue: number | number[]) => {
            const newTimestampInterval = newValue as number[];
            setTimestampInterval(newTimestampInterval);
            const selectedSubtitles = card.surroundingSubtitles.filter((s) =>
                subtitleIntersectsTimeInterval(s, newTimestampInterval)
            );
            setSelectedSubtitles(selectedSubtitles);
            applyTimestampIntervalToAllTracks(newTimestampInterval);
            setLastAppliedTimestampIntervalToText(newTimestampInterval);

            if (onRerecord === undefined && audioClip?.isSliceable() === true) {
                setLastAppliedTimestampIntervalToAudio(newTimestampInterval);
            }
        },
        [card.surroundingSubtitles, audioClip, onRerecord, applyTimestampIntervalToAllTracks]
    );

    const handleResetTimestampInterval = useCallback(() => {
        if (!initialTimestampBoundaryInterval) {
            return;
        }

        const selectedSubtitles =
            initialTimestampInterval == undefined
                ? []
                : card.surroundingSubtitles.filter((s) => subtitleIntersectsTimeInterval(s, initialTimestampInterval));
        setSelectedSubtitles(selectedSubtitles);
        setTimestampInterval(initialTimestampInterval);
        setTimestampBoundaryInterval(initialTimestampBoundaryInterval);
        setTimestampMarks(sliderMarksFromCard(card.surroundingSubtitles, initialTimestampBoundaryInterval));

        if (initialTimestampInterval !== undefined) {
            applyTimestampIntervalToAllTracks(initialTimestampInterval, true);
            setLastAppliedTimestampIntervalToText(initialTimestampInterval);
        }
    }, [
        initialTimestampInterval,
        initialTimestampBoundaryInterval,
        card.surroundingSubtitles,
        applyTimestampIntervalToAllTracks,
    ]);

    const handleZoomInTimestampInterval = useCallback(() => {
        if (!timestampBoundaryInterval || !timestampInterval) {
            return;
        }

        const newMin = (timestampBoundaryInterval[0] + timestampInterval[0]) / 2;
        const newMax = (timestampBoundaryInterval[1] + timestampInterval[1]) / 2;
        const newTimestampBoundaryInterval = [newMin, newMax];
        setTimestampBoundaryInterval(newTimestampBoundaryInterval);
        setTimestampMarks(sliderMarksFromCard(card.surroundingSubtitles, newTimestampBoundaryInterval));
    }, [timestampBoundaryInterval, timestampInterval, card.surroundingSubtitles]);

    const handleZoomOutTimestampInterval = useCallback(() => {
        if (!timestampBoundaryInterval || !timestampInterval) {
            return;
        }

        const currentLength = timestampBoundaryInterval[1] - timestampBoundaryInterval[0];
        const minimumChange = currentLength / 4;
        const newMin = Math.max(
            0,
            Math.min(
                timestampBoundaryInterval[0] - minimumChange,
                2 * timestampBoundaryInterval[0] - timestampInterval[0]
            )
        );
        const newMax = Math.max(
            timestampBoundaryInterval[1] + minimumChange,
            2 * timestampBoundaryInterval[1] - timestampInterval[1]
        );
        const newTimestampBoundaryInterval = [newMin, newMax];
        setTimestampBoundaryInterval(newTimestampBoundaryInterval);
        setTimestampMarks(sliderMarksFromCard(card.surroundingSubtitles, newTimestampBoundaryInterval));
    }, [timestampBoundaryInterval, timestampInterval, card.surroundingSubtitles]);

    const handleCopyImageToClipboard = useCallback(
        async (e: React.MouseEvent<HTMLButtonElement, MouseEvent>) => {
            e.stopPropagation();

            if (!image) {
                return;
            }

            if (image.extension === 'webm') {
                return;
            }

            onCopyToClipboard(await image.pngBlob());
        },
        [image, onCopyToClipboard]
    );

    const disableApplyTextSelection = card.surroundingSubtitles.filter((s) => s.text.trim() !== '').length === 0;
    const ankiFieldModels = ['sentence', 'image', 'audio', 'source'].map((key, order) => ({
        key,
        custom: false,
        field: { display: true, order },
    }));

    useEffect(() => {
        if (!open) {
            audioClip?.stop();
        }
    }, [open, audioClip]);

    const handleSentenceTextChange = useCallback((text: string) => {
        setText(text);
        setLastAppliedTimestampIntervalToText(undefined);
    }, []);

    const exportButtonRef = useRef<HTMLButtonElement | null>(null);
    const [focusedAction, setFocusedAction] = useState(false);

    const focusedButton = () => {
        const activeElement = document.activeElement;

        if (!activeElement) {
            return undefined;
        }

        for (const buttonRef of [exportButtonRef]) {
            if (buttonRef.current === activeElement) {
                return buttonRef.current;
            }
        }

        return undefined;
    };

    const focusOnPreferredAction = useCallback(() => {
        setFocusedAction(true);
    }, []);

    const handleActionBlur = useCallback(() => setFocusedAction(false), []);

    useEffect(() => {
        if (open && !disabled) {
            focusOnPreferredAction();
        }
    }, [open, disabled, focusOnPreferredAction]);

    const handleExport = useCallback(() => onProceed(buildExportParams()), [onProceed, buildExportParams]);

    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if ((e.metaKey || e.altKey) && e.shiftKey) {
                if (e.key === 'Enter') {
                    const focused = focusedButton();
                    if (focused === undefined) {
                        focusOnPreferredAction();
                    } else {
                        focused?.click();
                    }
                }
            }
        };
        document.addEventListener('keydown', listener);
        return () => document.removeEventListener('keydown', listener);
    }, [focusOnPreferredAction]);

    return (
        <>
            <Dialog
                open={open}
                disableRestoreFocus
                disableEnforceFocus
                fullWidth
                maxWidth="sm"
                onClose={disabled ? undefined : onCancel}
            >
                <Toolbar>
                    <Typography variant="h6" className={classes.title}>
                        {t('jiten.miningDialog')}
                    </Typography>
                    {profiles !== undefined && onSetActiveProfile && (
                        <MiniProfileSelector
                            profiles={profiles}
                            activeProfile={activeProfile}
                            onSetActiveProfile={onSetActiveProfile}
                        />
                    )}
                    {onOpenSettings && (
                        <IconButton edge="end" onClick={onOpenSettings}>
                            <SettingsIcon />
                        </IconButton>
                    )}
                    {onCancel && (
                        <IconButton edge="end" disabled={disabled} onClick={onCancel}>
                            <CloseIcon />
                        </IconButton>
                    )}
                </Toolbar>
                <DialogContent ref={dialogRefCallback}>
                    {jiten && (
                        <>
                            {(loadNewWords || pendingWords) && (
                                <Stack
                                    component={jiten.preventMultipleWords ? RadioGroup : 'div'}
                                    sx={{ mb: 1 }}
                                    role={jiten.preventMultipleWords ? 'radiogroup' : 'group'}
                                    aria-label={t('jiten.wordsToMine')}
                                >
                                    <Typography>{t('jiten.wordsToMine')}:</Typography>
                                    {newWordsError ??
                                        (!pendingWords && newWords === undefined
                                            ? t('jiten.checkingWords')
                                            : mineWords.length
                                              ? mineWords.map((target) => {
                                                    const key = `${target.wordId}/${target.readingIndex}`;
                                                    const checked = selectedMineWords.includes(target);
                                                    const controlProps = {
                                                        checked,
                                                        disabled,
                                                        onChange: () =>
                                                            setSelectedWords(
                                                                jiten.preventMultipleWords
                                                                    ? [target]
                                                                    : checked
                                                                      ? selectedMineWords.filter(
                                                                            (word) => word !== target
                                                                        )
                                                                      : [...selectedMineWords, target]
                                                            ),
                                                    };
                                                    return (
                                                        <FormControlLabel
                                                            key={key}
                                                            control={
                                                                jiten.preventMultipleWords ? (
                                                                    <Radio
                                                                        {...controlProps}
                                                                        name="jiten-word"
                                                                        value={key}
                                                                    />
                                                                ) : (
                                                                    <Checkbox {...controlProps} />
                                                                )
                                                            }
                                                            label={
                                                                <Link
                                                                    href={jitenWordUrl(target)}
                                                                    target="_blank"
                                                                    rel="noreferrer"
                                                                >
                                                                    {renderJitenWord(target)}
                                                                </Link>
                                                            }
                                                        />
                                                    );
                                                })
                                              : t('jiten.noNewWords'))}
                                </Stack>
                            )}
                            {showAttachmentTarget && jiten.target && (
                                <Typography sx={{ mb: 1 }}>
                                    {t('jiten.attachmentTarget')}:
                                    <Link href={jitenWordUrl(jiten.target)} target="_blank" rel="noreferrer">
                                        {renderJitenWord(jiten.target)}
                                    </Link>
                                </Typography>
                            )}
                            {showAttachmentTarget && jitenError && (
                                <Alert severity="warning" sx={{ mb: 1 }}>
                                    {jitenError}
                                </Alert>
                            )}
                            {jiten.result && (
                                <Alert severity={jiten.result.failed ? 'warning' : 'success'} sx={{ mb: 1 }}>
                                    {(['sentence', 'visual', 'audio'] as const).map((kind) => (
                                        <Typography key={kind}>
                                            {t(`jiten.${kind}`)}: {jiten.result![kind]}
                                        </Typography>
                                    ))}
                                </Alert>
                            )}
                        </>
                    )}
                    <form
                        className={classes.root}
                        onSelect={(event) => {
                            const input = event.target;
                            if (allowManualHighlight && input instanceof HTMLTextAreaElement) {
                                setSentenceSelection([input.selectionStart, input.selectionEnd]);
                            }
                        }}
                    >
                        {ankiFieldModels.map((model) => {
                            const key = model.custom ? `custom_${model.key}` : `standard_${model.key}`;

                            return (
                                <React.Fragment key={key}>
                                    {!model.custom && model.key === 'sentence' && model.field.display && (
                                        <SentenceField
                                            text={allowManualHighlight ? jitenText : stripJitenMarkers(text)}
                                            label={t('ankiDialog.sentence')}
                                            width={width}
                                            onChangeText={handleSentenceTextChange}
                                            selectedSubtitles={selectedSubtitles}
                                            endAdornment={
                                                allowManualHighlight ? (
                                                    <InputAdornment position="end">
                                                        <Tooltip title={t('jiten.highlightWord')}>
                                                            <span>
                                                                <IconButton
                                                                    edge="end"
                                                                    disabled={
                                                                        disabled ||
                                                                        !sentenceSelection ||
                                                                        sentenceSelection[0] === sentenceSelection[1]
                                                                    }
                                                                    aria-label={t('jiten.highlightWord')}
                                                                    onMouseDown={(event) => event.preventDefault()}
                                                                    onClick={handleHighlightWord}
                                                                >
                                                                    <BorderColorIcon />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                    </InputAdornment>
                                                ) : undefined
                                            }
                                        />
                                    )}
                                    {image && !model.custom && model.key === 'image' && model.field.display && (
                                        <ImageField
                                            onViewImage={handleViewImage}
                                            image={image}
                                            onCopyImageToClipboard={handleCopyImageToClipboard}
                                            copyEnabled={!isFirefox}
                                        />
                                    )}
                                    {audioClip && !model.custom && model.key === 'audio' && model.field.display && (
                                        <AudioField
                                            audioClip={audioClip}
                                            timestampIntervalSelectionNotApplied={
                                                timestampInterval?.[0] !== lastAppliedTimestampIntervalToAudio?.[0] ||
                                                timestampInterval?.[1] !== lastAppliedTimestampIntervalToAudio?.[1]
                                            }
                                            onRerecord={onRerecord}
                                            onPlayAudio={handlePlayAudio}
                                        />
                                    )}
                                    {!model.custom && model.key === 'source' && model.field.display && (
                                        <TextField
                                            variant="filled"
                                            color="primary"
                                            fullWidth
                                            label={t('ankiDialog.source')}
                                            value={source}
                                            onChange={(e) => setSource(e.target.value)}
                                        />
                                    )}
                                </React.Fragment>
                            );
                        })}
                        {timestampInterval && timestampBoundaryInterval && timestampMarks && (
                            <Grid container direction="row">
                                <Grid item style={{ flexGrow: 1 }}>
                                    <Slider
                                        slots={{ valueLabel: ValueLabelComponent }}
                                        value={timestampInterval}
                                        valueLabelFormat={sliderValueLabelFormat}
                                        onChange={handleTimestampIntervalChange}
                                        min={timestampBoundaryInterval[0]}
                                        max={timestampBoundaryInterval[1]}
                                        marks={timestampMarks}
                                        step={1}
                                        valueLabelDisplay="auto"
                                        className={classes.rangeSelectSlider}
                                        color="primary"
                                    />
                                </Grid>
                                <Grid item>
                                    <Tooltip title={t('ankiDialog.resetSlider')}>
                                        <span>
                                            <IconButton
                                                edge="end"
                                                style={{ marginTop: -4 }}
                                                onClick={handleResetTimestampInterval}
                                            >
                                                <RestoreIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </Grid>
                                <Grid item>
                                    <Tooltip title={t('ankiDialog.zoomIn')}>
                                        <span>
                                            <IconButton
                                                edge="end"
                                                style={{ marginTop: -4 }}
                                                onClick={handleZoomInTimestampInterval}
                                            >
                                                <ZoomInIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </Grid>
                                <Grid item>
                                    <Tooltip title={t('ankiDialog.zoomOut')}>
                                        <span>
                                            <IconButton
                                                edge="end"
                                                style={{ marginTop: -4 }}
                                                onClick={handleZoomOutTimestampInterval}
                                            >
                                                <ZoomOutIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </Grid>
                                <Grid item>
                                    <Tooltip title={t('ankiDialog.applySelection')}>
                                        <span>
                                            <IconButton
                                                edge="end"
                                                style={{ marginTop: -4 }}
                                                disabled={
                                                    !timestampInterval ||
                                                    (lastAppliedTimestampIntervalToText !== undefined &&
                                                        timestampInterval[0] ===
                                                            lastAppliedTimestampIntervalToText[0] &&
                                                        timestampInterval[1] ===
                                                            lastAppliedTimestampIntervalToText[1]) ||
                                                    disableApplyTextSelection
                                                }
                                                onClick={handleApplyTimestampIntervalToText}
                                            >
                                                <DoneIcon fontSize="small" />
                                            </IconButton>
                                        </span>
                                    </Tooltip>
                                </Grid>
                            </Grid>
                        )}
                    </form>
                </DialogContent>
                <DialogActions>
                    <>
                        <Button disabled={disabled} onClick={onCancel}>
                            {t('action.cancel')}
                        </Button>
                        {jiten?.onMineNewWords && (
                            <AnkiDialogButton
                                disabled={disabled || selectedMineWords.length === 0}
                                focusVisible={false}
                                onBlurVisible={handleActionBlur}
                                onClick={() => void jiten.onMineNewWords?.(buildExportParams(), selectedMineWords)}
                            >
                                {t('jiten.mineNewWords')}
                            </AnkiDialogButton>
                        )}
                        <AnkiDialogButton
                            ref={exportButtonRef}
                            disabled={disabled || !showAttachmentTarget || Boolean(jitenError)}
                            focusVisible={focusedAction}
                            onBlurVisible={handleActionBlur}
                            onClick={handleExport}
                        >
                            {t(disabled ? 'jiten.attaching' : 'jiten.attach')}
                        </AnkiDialogButton>
                    </>
                </DialogActions>
            </Dialog>
            <ImageDialog
                open={open && imageDialogOpen}
                image={image}
                interval={timestampBoundaryInterval}
                timestampInterval={imageTimestampInterval}
                onClose={handleCloseImageDialog}
                onTimestampChange={handleImageTimestampChange}
                onTimestampIntervalChange={handleImageTimestampIntervalChange}
            />
        </>
    );
};

export default AnkiDialog;
