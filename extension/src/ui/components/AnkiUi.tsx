import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
    MediaFragmentModel,
    AudioModel,
    SubtitleModel,
    AnkiUiState,
    AnkiUiInitialState,
    AnkiUiResumeState,
    AnkiUiSavedState,
    AnkiUiBridgeRerecordMessage,
    AnkiUiBridgeResumeMessage,
    AnkiUiBridgeRewindMessage,
    CopyToClipboardMessage,
    Message,
    UpdateStateMessage,
    FileModel,
    EncodeMp3Message,
    AnkiDialogSettingsMessage,
    ActiveProfileMessage,
    AnkiDialogSettings,
} from '@project/common';
import { useTranslation } from 'react-i18next';
import { JitenClient, highlightJitenWord, stripJitenMarkers, jitenOutcomeMessage } from '@project/common/jiten/jiten';
import type { JitenTarget, JitenAttachmentResult } from '@project/common/jiten/jiten';
import { jitenFetcher } from '@project/extension/src/ui/jiten-fetcher';
import { createTheme } from '@project/common/theme';
import type { Profile } from '@project/common/settings';
import ThemeProvider from '@mui/material/styles/ThemeProvider';
import type { AlertColor } from '@mui/material/Alert';
import Alert from '@mui/material/Alert';
import CssBaseline from '@mui/material/CssBaseline';
import AnkiDialog from '@project/common/components/AnkiDialog';
import Snackbar from '@mui/material/Snackbar';
import type Bridge from '@project/extension/src/ui/bridge';
import type { PaletteMode } from '@mui/material/styles';
import type { AnkiDialogState } from '@project/common/components/AnkiDialog';
import type { ExportParams } from '@project/common/anki';
import { v4 as uuidv4 } from 'uuid';
import { base64ToBlob, blobToBase64 } from '@project/common/base64';
import { StyledEngineProvider } from '@mui/material/styles';
import LogoIcon from '@project/common/components/LogoIcon';

interface Props {
    bridge: Bridge;
}

const blobToDataUrl = async (blob: Blob): Promise<string> => {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => {
            resolve(reader.result as string);
        };
        reader.readAsDataURL(blob);
    });
};

export default function AnkiUi({ bridge }: Props) {
    const { t } = useTranslation();
    const destination = 'jiten';
    const [jitenTarget, setJitenTarget] = useState<JitenTarget>();
    const [jitenWords, setJitenWords] = useState<JitenTarget[]>([]);
    const [jitenPending, setJitenPending] = useState<{ targets: JitenTarget[]; deckId: number }>();
    const [jitenResult, setJitenResult] = useState<JitenAttachmentResult>();
    const submitting = useRef(false);
    const [open, setOpen] = useState<boolean>(false);
    const [disabled, setDisabled] = useState<boolean>(false);
    const [canRerecord, setCanRerecord] = useState<boolean>(false);
    const [subtitle, setSubtitle] = useState<SubtitleModel>();
    const [surroundingSubtitles, setSurroundingSubtitles] = useState<SubtitleModel[]>();
    const [text, setText] = useState<string>();
    const [serializedAudio, setSerializedAudio] = useState<AudioModel>();
    const [serializedImage, setSerializedImage] = useState<MediaFragmentModel>();
    const [file, setFile] = useState<FileModel>();
    const [source, setSource] = useState<string>('');
    const [url, setUrl] = useState<string>('');
    const [definition, setDefinition] = useState('');
    const [word, setWord] = useState('');
    const [customFieldValues, setCustomFieldValues] = useState<{ [key: string]: string }>({});
    const [initialTimestampInterval, setInitialTimestampInterval] = useState<number[]>();
    const [timestampInterval, setTimestampInterval] = useState<number[]>();
    const [timestampBoundaryInterval, setTimestampBoundaryInterval] = useState<number[]>();
    const [lastAppliedTimestampIntervalToText, setLastAppliedTimestampIntervalToText] = useState<number[]>();
    const [lastAppliedTimestampIntervalToAudio, setLastAppliedTimestampIntervalToAudio] = useState<number[]>();
    const [settings, setSettings] = useState<AnkiDialogSettings>();
    const [alertSeverity, setAlertSeverity] = useState<AlertColor>('error');
    const [alertOpen, setAlertOpen] = useState<boolean>(false);
    const [alert, setAlert] = useState<string>('');
    const [dialogRequestedTimestamp, setDialogRequestedTimestamp] = useState<number>(0);
    const [profiles, setProfiles] = useState<Profile[]>();
    const [activeProfile, setActiveProfile] = useState<string>();
    const [inTutorial, setInTutorial] = useState<boolean>(false);

    const theme = useMemo(() => createTheme((settings?.themeType ?? 'dark') as PaletteMode), [settings?.themeType]);
    const jitenClient = useMemo(() => new JitenClient(undefined, jitenFetcher(bridge)), [bridge]);
    const dialogStateRef = useRef<AnkiDialogState>(undefined);

    const savedState = useCallback(() => {
        const dialogState = dialogStateRef.current!;
        const savedState: AnkiUiSavedState = {
            subtitle: subtitle!,
            jitenTarget,
            jitenWords,
            miningDestination: destination,
            text: dialogState.text,
            surroundingSubtitles: dialogState.surroundingSubtitles,
            definition: dialogState.definition,
            image: serializedImage,
            audio: serializedAudio,
            file,
            word: dialogState.word,
            source: dialogState.source,
            url: dialogState.url,
            customFieldValues: dialogState.customFieldValues,
            initialTimestampInterval: dialogState.initialTimestampInterval!,
            timestampInterval: dialogState.timestampInterval!,
            timestampBoundaryInterval: dialogState.timestampBoundaryInterval,
            lastAppliedTimestampIntervalToText: dialogState.lastAppliedTimestampIntervalToText!,
            lastAppliedTimestampIntervalToAudio: dialogState.lastAppliedTimestampIntervalToAudio,
            dialogRequestedTimestamp: dialogRequestedTimestamp,
        };
        return savedState;
    }, [
        subtitle,
        serializedImage,
        serializedAudio,
        file,
        dialogRequestedTimestamp,
        jitenTarget,
        jitenWords,
        destination,
    ]);

    useEffect(() => {
        return bridge.addClientMessageListener((message: Message) => {
            if (message.command !== 'updateState') {
                return;
            }

            const s = (message as UpdateStateMessage).state as AnkiUiState;

            setJitenTarget(s.jitenTarget);
            setJitenWords(s.jitenWords ?? []);
            if (s.type === 'initial') {
                setJitenPending((s as AnkiUiInitialState).jitenPending);
                setJitenResult((s as AnkiUiInitialState).jitenResult);
                setTimestampInterval((s.audio?.start && s.audio?.end && [s.audio.start, s.audio.end]) || undefined);
                setTimestampBoundaryInterval(undefined);
                setInitialTimestampInterval(undefined);
                setLastAppliedTimestampIntervalToText(undefined);
                setLastAppliedTimestampIntervalToAudio(undefined);
            } else if (s.type === 'resume') {
                const state = s as AnkiUiResumeState;
                setInitialTimestampInterval(state.initialTimestampInterval);
                setTimestampInterval(state.timestampInterval);
                setTimestampBoundaryInterval(state.timestampBoundaryInterval);
                setLastAppliedTimestampIntervalToText(state.lastAppliedTimestampIntervalToText);
                setLastAppliedTimestampIntervalToAudio(state.lastAppliedTimestampIntervalToAudio);
            }

            setText(s.text);
            setDefinition(s.definition ?? '');
            setWord(s.word ?? '');
            setCustomFieldValues(s.customFieldValues ?? {});
            setCanRerecord(s.canRerecord);
            setSubtitle(s.subtitle);
            setSurroundingSubtitles(s.surroundingSubtitles);
            setSource(s.source);
            setUrl(s.url ?? '');
            setDialogRequestedTimestamp(s.dialogRequestedTimestamp);
            setSerializedAudio(s.audio);
            setSerializedImage(s.image);
            setFile(s.file);
            setDisabled(false);
            setSettings(s.settings);
            setActiveProfile(s.activeProfile);
            setProfiles(s.profiles);
            setOpen(s.open);
            setInTutorial(s.inTutorial);
        });
    }, [bridge]);

    useEffect(() => bridge.serverIsReady(), [bridge]);

    const loadNewWords = useCallback(
        () => jitenClient.newWords(jitenWords, settings?.jitenMiningDeckId ?? 0),
        [jitenClient, jitenWords, settings?.jitenMiningDeckId]
    );
    const submitJiten = useCallback(
        async (params: ExportParams, mine = false, selectedTargets?: JitenTarget[]) => {
            if (submitting.current) return;
            submitting.current = true;
            setDisabled(true);
            try {
                let pending = mine
                    ? selectedTargets && jitenPending
                        ? { ...jitenPending, targets: selectedTargets }
                        : jitenPending
                    : undefined;
                if (!mine) setJitenPending(undefined);
                if (mine && !pending) {
                    const text = stripJitenMarkers(params.text ?? '');
                    const candidates = (selectedTargets ?? jitenWords).filter(
                        (target) => target.surfaceForm && text.includes(target.surfaceForm)
                    );
                    pending = {
                        targets: await jitenClient.newWords(candidates, settings?.jitenMiningDeckId ?? 0),
                        deckId: settings?.jitenMiningDeckId ?? 0,
                    };
                }
                const targets = mine ? (pending?.targets ?? []) : jitenTarget ? [jitenTarget] : [];
                if (!targets.length) {
                    setAlert(t(mine ? 'jiten.noNewWords' : 'jiten.mineInReaderFirst'));
                    setAlertSeverity('info');
                    setAlertOpen(true);
                    return;
                }
                const resumingTarget =
                    jitenPending &&
                    targets[0].wordId === jitenPending.targets[0]?.wordId &&
                    targets[0].readingIndex === jitenPending.targets[0].readingIndex;
                const submission = await jitenClient.submit(
                    targets,
                    {
                        ...params,
                        text: mine ? highlightJitenWord(stripJitenMarkers(params.text ?? ''), targets[0]) : params.text,
                        image: settings?.jitenAttachVisual ? params.image : undefined,
                        audioClip: settings?.jitenAttachAudio ? params.audioClip : undefined,
                    },
                    mine ? pending?.deckId : undefined,
                    (mine ? !resumingTarget : jitenPending) ? undefined : jitenResult?.sentenceId
                );
                const last = submission.outcomes.at(-1)!;
                setJitenResult(last.result);
                const notification = jitenOutcomeMessage(submission.outcomes);
                if (last.result.failed) {
                    if (pending) setJitenPending({ ...pending, targets: submission.remainingTargets });
                    setAlertSeverity('warning');
                    setAlert(notification);
                    setAlertOpen(true);
                    return;
                }
                setJitenPending(undefined);
                setOpen(false);
                const resume: AnkiUiBridgeResumeMessage = {
                    command: 'resume',
                    uiState: savedState(),
                    cardExported: true,
                    notification,
                };
                bridge.sendMessageFromServer(resume);
            } catch (error) {
                setAlertSeverity('error');
                setAlert(error instanceof Error ? error.message : String(error));
                setAlertOpen(true);
            } finally {
                submitting.current = false;
                setDisabled(false);
            }
        },
        [jitenClient, jitenPending, jitenWords, jitenTarget, jitenResult, settings, bridge, savedState, t]
    );
    const mineNewWords = useCallback(
        (params: ExportParams, targets: JitenTarget[]) => submitJiten(params, true, targets),
        [submitJiten]
    );

    const handleCancel = useCallback(() => {
        setOpen(false);
        const message: AnkiUiBridgeResumeMessage = { command: 'resume', uiState: savedState(), cardExported: false };
        bridge.sendMessageFromServer(message);
    }, [bridge, savedState]);

    const handleRewind = useCallback(() => {
        setOpen(false);
        const message: AnkiUiBridgeRewindMessage = { command: 'rewind', uiState: savedState() };
        bridge.sendMessageFromServer(message);
    }, [bridge, savedState]);

    const handleRerecord = useCallback(() => {
        setOpen(false);

        const state = savedState();
        const message: AnkiUiBridgeRerecordMessage = {
            command: 'rerecord',
            uiState: state,
            recordStart: state.timestampInterval[0],
            recordEnd: state.timestampInterval[1],
        };

        bridge.sendMessageFromServer(message);
    }, [bridge, savedState]);

    const handleOpenSettings = useCallback(() => {
        bridge.sendMessageFromServer({ command: 'openSettings' });
    }, [bridge]);

    const handleSetActiveProfile = useCallback(
        (profile: string | undefined) => {
            const message: ActiveProfileMessage = { command: 'activeProfile', profile: profile };
            bridge.sendMessageFromServer(message);
        },
        [bridge]
    );

    const lastFocusOutRef = useRef<HTMLElement>(undefined);

    const handleFocusOut = useCallback((event: FocusEvent) => {
        if (event.target instanceof HTMLElement) {
            lastFocusOutRef.current = event.target;
        }
    }, []);

    const handleCopyToClipboard = useCallback(
        async (blob: Blob) => {
            const message: CopyToClipboardMessage = {
                command: 'copy-to-clipboard',
                dataUrl: await blobToDataUrl(blob),
            };
            bridge.sendMessageFromServer(message);
        },
        [bridge]
    );

    useEffect(() => {
        return bridge.addClientMessageListener((message) => {
            if (message.command === 'focus') {
                lastFocusOutRef.current?.focus();
            } else if (message.command === 'settings') {
                const settingsMessage = message as AnkiDialogSettingsMessage;
                if (settingsMessage.jitenAccountChanged || settingsMessage.activeProfile !== activeProfile) {
                    setJitenPending(undefined);
                    setJitenResult(undefined);
                    jitenClient.clearRetry();
                }
                setSettings(settingsMessage.settings);
                setProfiles(settingsMessage.profiles);
                setActiveProfile(settingsMessage.activeProfile);
            } else if (message.command === 'rewind') {
                handleRewind();
            }
        });
    }, [bridge, handleRewind, activeProfile, jitenClient]);

    useEffect(() => {
        if (open) {
            window.removeEventListener('focusout', handleFocusOut);
            window.addEventListener('focusout', handleFocusOut);
        } else {
            window.removeEventListener('focusout', handleFocusOut);
        }
    }, [open, handleFocusOut]);

    const card = useMemo(() => {
        if (!subtitle || !surroundingSubtitles) {
            return undefined;
        }

        return {
            subtitle,
            surroundingSubtitles,
            url,
            audio: serializedAudio,
            image: serializedImage,
            file,
            subtitleFileName: source,
            mediaTimestamp: serializedAudio?.start ?? subtitle.start,
            text,
            word,
            definition,
            customFieldValues,
        };
    }, [
        file,
        source,
        subtitle,
        surroundingSubtitles,
        url,
        serializedImage,
        serializedAudio,
        text,
        word,
        definition,
        customFieldValues,
    ]);

    const mp3Encoder = useCallback(
        async (blob: Blob, extension: string) => {
            const encodeMp3Message: EncodeMp3Message = {
                command: 'encode-mp3',
                base64: await blobToBase64(blob),
                extension,
                messageId: uuidv4(),
            };
            const { base64 } = await bridge.sendMessageFromServerAndExpectResponse(encodeMp3Message, 60_000);
            return base64ToBlob(base64, 'audio/mp3');
        },
        [bridge]
    );

    return (
        <StyledEngineProvider injectFirst>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <Snackbar
                    anchorOrigin={{ horizontal: 'center', vertical: 'top' }}
                    open={alertOpen}
                    autoHideDuration={5000}
                    onClose={() => setAlertOpen(false)}
                >
                    <Alert
                        onClose={() => setAlertOpen(false)}
                        severity={alertSeverity}
                        icon={<LogoIcon fontSize="small" />}
                    >
                        {alert}
                    </Alert>
                </Snackbar>
                {settings && card && (
                    <AnkiDialog
                        jiten={{
                            target: jitenTarget,
                            targets: jitenPending?.targets,
                            result: jitenResult,
                            onMineNewWords: mineNewWords,
                            loadNewWords,
                            preventMultipleWords: settings.jitenPreventMultipleWords,
                            showUnmatchedAttachmentTarget: settings.jitenShowUnmatchedAttachmentTarget,
                        }}
                        open={open}
                        disabled={disabled}
                        card={card}
                        settings={settings}
                        profiles={profiles}
                        activeProfile={activeProfile}
                        onSetActiveProfile={handleSetActiveProfile}
                        onProceed={submitJiten}
                        onRerecord={canRerecord ? handleRerecord : undefined}
                        onCancel={handleCancel}
                        onOpenSettings={handleOpenSettings}
                        onCopyToClipboard={handleCopyToClipboard}
                        source={source}
                        initialTimestampInterval={initialTimestampInterval}
                        timestampBoundaryInterval={timestampBoundaryInterval}
                        timestampInterval={timestampInterval}
                        lastAppliedTimestampIntervalToText={lastAppliedTimestampIntervalToText}
                        lastAppliedTimestampIntervalToAudio={lastAppliedTimestampIntervalToAudio}
                        stateRef={dialogStateRef}
                        mp3Encoder={mp3Encoder}
                        inTutorial={inTutorial}
                    />
                )}
            </ThemeProvider>
        </StyledEngineProvider>
    );
}
