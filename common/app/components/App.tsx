import { asbError, asbWarn } from '@project/common/util/log';
import { humanReadableTime, download, extractText, timeDurationDisplay } from '@project/common/util';
import React, { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import { makeStyles } from '@mui/styles';
import type { Theme } from '@mui/material/styles';
import ThemeProvider from '@mui/material/styles/ThemeProvider';
import { useWindowSize } from '@project/common/app/hooks/use-window-size';
import { useLocationHash } from '@project/common/hooks/use-location-hash';
import type {
    RequestLocalSubtitlesMessage,
    SubtitleModel,
    DisplaySubtitleModel,
    VideoTabModel,
    LegacyPlayerSyncMessage,
    PlayerSyncMessage,
    CopyHistoryItem,
    VideoDataSubtitleTrack,
    CardModel,
    ShowAnkiUiMessage,
    JumpToSubtitleMessage,
    DownloadImageMessage,
    DownloadAudioMessage,
    CardTextFieldValues,
    RequestSubtitlesResponse,
    ConfirmedVideoDataSubtitleTrack,
} from '@project/common';
import { MediaFragment, PostMineAction, MediaFragmentErrorCode, VideoDataUiOpenReason } from '@project/common';
import { createTheme } from '@project/common/theme';
import { embeddedTrackLanguageDisplayName, embeddedTrackLanguages } from '@project/common/settings';
import type { AsbplayerSettings, Profile, SettingsProvider } from '@project/common/settings';
import { AudioClip, Mp3Encoder } from '@project/common/audio-clip';
import type { ExportParams } from '@project/common/anki';
import { SubtitleReader } from '@project/common/subtitle-reader';
import { extractMatroskaSubtitleFiles } from '@project/common/media-reader/matroska-reader';
import { v4 as uuidv4 } from 'uuid';
import clsx from 'clsx';
import Alert from '@project/common/app/components/Alert';
import AnkiDialog from '@project/common/components/AnkiDialog';
import {
    JitenClient,
    jitenOutcomeMessage,
    highlightJitenWord,
    jitenValidationError,
    stripJitenMarkers,
} from '@project/common/jiten/jiten';
import { readJitenWords } from '@project/common/jiten/reader-words';
import type { JitenTarget, JitenAttachmentResult } from '@project/common/jiten/jiten';
import { readJitenTarget } from '@project/common/app/hooks/use-jiten-target';
import Paper from '@mui/material/Paper';
import DragOverlay from '@project/common/app/components/DragOverlay';
import Bar from '@project/common/app/components/Bar';
import SubtitleStudyStyles from '@project/common/components/SubtitleStudyStyles';
import type { ExtensionMessage } from '@project/common/app/services/chrome-extension';
import type ChromeExtension from '@project/common/app/services/chrome-extension';
import CopyHistory from '@project/common/app/components/CopyHistory';
import LandingPage from '@project/common/app/components/LandingPage';
import type { MediaSources, PlayerRef } from '@project/common/app/components/Player';
import Player from '@project/common/app/components/Player';
import SettingsDialog from '@project/common/app/components/SettingsDialog';
import type { SeekRequest } from '@project/common/app/components/VideoPlayer';
import VideoPlayer from '@project/common/app/components/VideoPlayer';
import type { AlertColor } from '@mui/material/Alert';
import type VideoChannel from '@project/common/app/services/video-channel';
import { addBlobUrl, createBlobUrl, revokeBlobUrl } from '@project/common/blob-url';
import { useTranslation } from 'react-i18next';
import { LocalizedError } from '@project/common/app/components/localized-error';
import { useCopyHistory } from '@project/common/app/hooks/use-copy-history';
import { useFileSession } from '@project/common/app/hooks/use-file-session';
import { useI18n } from '@project/common/app/hooks/use-i18n';
import { useAppKeyBinder } from '@project/common/app/hooks/use-app-key-binder';
import { usePlaybackPreferences } from '@project/common/app/hooks/use-playback-preferences';
import { MiningContext } from '@project/common/app/services/mining-context';
import { useAppWebSocketClient } from '@project/common/app/hooks/use-app-web-socket-client';
import type { LoadSubtitlesCommand } from '@project/common/web-socket-client';
import { ExtensionBridgedCopyHistoryRepository } from '@project/common/app/services/extension-bridged-copy-history-repository';
import { IndexedDBCopyHistoryRepository } from '@project/common/copy-history';
import type { FileSystemFileHandleWithId } from '@project/common/file-system-access';
import {
    supportsFileSystemAccess,
    showFilePicker,
    requestPermissions,
    resolveFiles,
} from '@project/common/file-system-access';
import type { GlobalState } from '@project/common/global-state';
import mp3WorkerFactory from '@project/common/audio-clip/mp3-encoder-worker.ts?worker';
import pgsParserWorkerFactory from '@project/common/subtitle-reader/pgs-parser-worker.ts?worker';
import CssBaseline from '@mui/material/CssBaseline';
import { StyledEngineProvider } from '@mui/material/styles';
import { useServiceWorker } from '@project/common/app/hooks/use-service-worker';
import NeedRefreshDialog from '@project/common/app/components/NeedRefreshDialog';
import type { LogProvider } from '@project/common/util/log';
import { isFirefox } from '@project/common/browser-detection';
import VideoDataSyncDialog, { useVideoDataSyncDialogState } from '@project/common/components/VideoDataSyncDialog';
import type { FileWithId } from '@project/common/file-selector';
import { DefaultFileSelector } from '@project/common/file-selector';

const latestExtensionVersion = '1.16.0';
const extensionUrl = 'https://github.com/khajiitvaper2017/asbplayer/releases';
const useContentStyles = makeStyles<Theme, ContentProps>((theme) => ({
    content: {
        flexGrow: 1,
        transition: theme.transitions.create('margin', {
            easing: theme.transitions.easing.sharp,
            duration: theme.transitions.duration.leavingScreen,
        }),
        marginRight: 0,
    },
    contentShift: ({ drawerWidth }) => ({
        transition: theme.transitions.create('margin', {
            easing: theme.transitions.easing.easeOut,
            duration: theme.transitions.duration.enteringScreen,
        }),
        marginRight: drawerWidth,
    }),
}));

const videoExtensions = ['.mkv', '.mp4', '.m4v', '.avi', '.webm'] as const;
const audioExtensions = ['.mp3', '.m4a', '.aac', '.flac', '.ogg', '.wav', '.opus', '.m4b'] as const;
const subtitleExtensions = [
    '.srt',
    '.ass',
    '.vtt',
    '.sup',
    '.nfvtt',
    '.nfimsc',
    '.ytxml',
    '.ytsrv3',
    '.dfxp',
    '.ttml2',
    '.bbjson',
] as const;
const inputAcceptFileExtensions = [...subtitleExtensions, ...audioExtensions, ...videoExtensions].join(',');

const VIDEO_EXT_SET = new Set<string>(videoExtensions);
const AUDIO_EXT_SET = new Set<string>(audioExtensions);
const SUBTITLE_EXT_SET = new Set<string>(subtitleExtensions);

const getExtension = (fileName: string) => {
    const index = fileName.lastIndexOf('.');
    return index === -1 ? '' : fileName.substring(index).toLowerCase();
};

const isMatroskaFile = (fileName: string) => ['.mkv', '.webm'].includes(getExtension(fileName));

async function extractDropFileHandles(items: DataTransferItemList): Promise<FileSystemFileHandle[] | undefined> {
    if (!window.isSecureContext) return; // Chromium error due to getAsFileSystemHandle: RESULT_CODE_KILLED_BAD_MESSAGE
    const handlePromises: Promise<any>[] = [];

    for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        if (item.kind !== 'file') {
            continue;
        }

        // Persist dropped handles only when the browser exposes getAsFileSystemHandle.
        const getAsFileSystemHandle = (item as any).getAsFileSystemHandle as (() => Promise<any>) | undefined;
        if (typeof getAsFileSystemHandle !== 'function') {
            return undefined;
        }

        // Capture handle promises synchronously before DataTransfer gets cleared.
        handlePromises.push(getAsFileSystemHandle.call(item));
    }

    const handles: FileSystemFileHandle[] = [];
    for (const handlePromise of handlePromises) {
        try {
            const handle = await handlePromise;
            if (handle?.kind === 'file') {
                handles.push(handle as FileSystemFileHandle);
            }
        } catch (e) {
            // Best-effort only; if handle access fails, keep loading dropped files normally.
            asbWarn('app/files', 'Failed to read dropped file handle:', e);
            return undefined;
        }
    }

    return handles;
}

function extractSources(files: FileWithId[]): MediaSources {
    const subtitleFiles: FileWithId[] = [];
    let videoFile: FileWithId | undefined = undefined;

    for (let i = 0; i < files.length; ++i) {
        const f = files[i];
        const extension = getExtension(f.file.name);

        if (extension === '') {
            throw new LocalizedError('error.unknownExtension', { fileName: f.file.name });
        }

        if (SUBTITLE_EXT_SET.has(extension)) {
            subtitleFiles.push(f);
        } else if (VIDEO_EXT_SET.has(extension)) {
            if (videoFile) {
                throw new LocalizedError('error.onlyOneVideoFile');
            }
            videoFile = f;
        } else if (AUDIO_EXT_SET.has(extension)) {
            if (videoFile) {
                throw new LocalizedError('error.onlyOneAudioFile');
            }
            videoFile = f;
        } else {
            throw new LocalizedError('error.unsupportedExtension', {
                extension: extension.startsWith('.') ? extension.substring(1) : extension,
            });
        }
    }

    return { subtitleFiles: subtitleFiles, videoFile: videoFile };
}

interface RenderVideoProps {
    searchParams: URLSearchParams;
    settingsProvider: SettingsProvider;
    settings: AsbplayerSettings;
    extension: ChromeExtension;
    miningContext: MiningContext;
    ankiDialogOpen: boolean;
    seekRequest?: SeekRequest;
    onAnkiDialogRequest: (
        videoFileUrl: string,
        videoFileName: string,
        selectedAudioTrack: string | undefined,
        playbackRate: number,
        subtitle: SubtitleModel,
        surroundingSubtitles: SubtitleModel[],
        cardTextFieldValues: CardTextFieldValues,
        timestamp: number
    ) => void;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    profile?: string;
    onAnkiDialogRewind: () => void;
    onError: (error: string) => void;
}

function RenderVideo({ searchParams, ...props }: RenderVideoProps) {
    const videoFile = searchParams.get('video')!;
    const channel = searchParams.get('channel')!;
    const popOut = searchParams.get('popout')! === 'true';

    useEffect(() => {
        addBlobUrl(videoFile);
    }, [videoFile]);

    return <VideoPlayer videoFile={videoFile} channel={channel} popOut={popOut} {...props} />;
}

interface ContentProps {
    drawerOpen: boolean;
    drawerWidth: number;
    children: React.ReactNode[];
}

function Content(props: ContentProps) {
    const classes = useContentStyles(props);

    return (
        <main
            className={clsx(classes.content, {
                [classes.contentShift]: props.drawerOpen,
            })}
        >
            {props.children}
        </main>
    );
}

interface Props {
    origin: string;
    logoUrl: string;
    settingsProvider: SettingsProvider;
    logProvider: LogProvider;
    settings: AsbplayerSettings;
    globalState?: GlobalState;
    extension: ChromeExtension;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    profile?: string;
    profiles: Profile[];
    activeProfile?: string;
    onNewProfile: (name: string) => void;
    onRemoveProfile: (name: string) => void;
    onSetActiveProfile: (name: string | undefined) => void;
    onGlobalStateChanged: (globalState: Partial<GlobalState>) => void;
}

function App({
    origin,
    logoUrl,
    logProvider,
    settingsProvider,
    settings,
    globalState,
    extension,
    onSettingsChanged,
    profile,
    onGlobalStateChanged,
    ...profilesContext
}: Props) {
    const { t } = useTranslation();
    const subtitleReader = useMemo<SubtitleReader>(() => {
        return new SubtitleReader({
            regexFilter: settings.subtitleRegexFilter,
            regexFilterTextReplacement: settings.subtitleRegexFilterTextReplacement,
            subtitleHtml: settings.subtitleHtml,
            convertNetflixRuby: settings.convertNetflixRuby,
            pgsParserWorkerFactory: async () => new pgsParserWorkerFactory(),
        });
    }, [
        settings.subtitleRegexFilter,
        settings.subtitleRegexFilterTextReplacement,
        settings.subtitleHtml,
        settings.convertNetflixRuby,
    ]);
    const webSocketClient = useAppWebSocketClient({ settings });
    const [subtitles, setSubtitles] = useState<DisplaySubtitleModel[]>([]);
    const playbackPreferences = usePlaybackPreferences();
    const theme = useMemo<Theme>(() => createTheme(settings.themeType), [settings.themeType]);
    const jitenClient = useMemo(() => new JitenClient(settings.jitenApiKey), [settings.jitenApiKey]);
    const searchParams = useMemo(() => new URLSearchParams(location.search), []);
    const inVideoPlayer = useMemo(() => searchParams.get('video') !== null, [searchParams]);
    const [videoFullscreen, setVideoFullscreen] = useState<boolean>(false);
    const keyBinder = useAppKeyBinder(settings.keyBindSet, extension);
    const videoContainerRef = useRef<HTMLDivElement>(null);
    const videoChannelRef = useRef<VideoChannel>(null);
    const [videoPlayerSeekRequest, setVideoPlayerSeekRequest] = useState<SeekRequest>();
    const [width] = useWindowSize(!inVideoPlayer);
    const drawerRatio = videoContainerRef.current ? 0.2 : 0.3;
    const minDrawerSize = videoContainerRef.current ? 150 : 300;
    const drawerWidth = Math.max(minDrawerSize, width * drawerRatio);
    const copyHistoryRepository = useMemo(() => {
        if (extension.supportsCopyHistoryRequest) {
            return new ExtensionBridgedCopyHistoryRepository(extension);
        }

        return new IndexedDBCopyHistoryRepository(settings.miningHistoryStorageLimit);
    }, [extension, settings.miningHistoryStorageLimit]);
    const {
        copyHistoryItems,
        refreshCopyHistory,
        deleteCopyHistoryItem,
        saveCopyHistoryItem,
        deleteAllCopyHistoryItems,
    } = useCopyHistory(settings.miningHistoryStorageLimit, copyHistoryRepository);
    const copyHistoryItemsRef = useRef<CopyHistoryItem[]>([]);
    copyHistoryItemsRef.current = copyHistoryItems;
    const [copyHistoryOpen, setCopyHistoryOpen] = useState<boolean>(false);
    const [theaterMode, setTheaterMode] = useState<boolean>(playbackPreferences.theaterMode);
    const [hideSubtitlePlayer, setHideSubtitlePlayer] = useState<boolean>(playbackPreferences.hideSubtitleList);
    const [videoPopOut, setVideoPopOut] = useState<boolean>(false);
    const [alert, setAlert] = useState<string>();
    const [alertOpen, setAlertOpen] = useState<boolean>(false);
    const [alertSeverity, setAlertSeverity] = useState<AlertColor>();
    const [jumpToSubtitle, setJumpToSubtitle] = useState<SubtitleModel>();
    const [rewindSubtitle, setRewindSubtitle] = useState<SubtitleModel>();
    const [sources, setSources] = useState<MediaSources>({ subtitleFiles: [] });
    const sourcesRef = useRef(sources);
    sourcesRef.current = sources;
    const handleFilesRef = useRef<
        ((args: { files: FileWithId[]; flattenSubtitleFiles?: boolean }) => boolean) | undefined
    >(undefined);
    const [loadingSources, setLoadingSources] = useState<FileWithId[]>([]);
    const [dragging, setDragging] = useState<boolean>(false);
    const dragEnterRef = useRef<Element | null>(null);
    const [fileName, setFileName] = useState<string>();
    const [ankiDialogOpen, setAnkiDialogOpen] = useState<boolean>(false);
    const [ankiDialogDisabled, setAnkiDialogDisabled] = useState<boolean>(false);
    const [ankiDialogCard, setAnkiDialogCard] = useState<CardModel>();
    const [dialogJitenTarget, setDialogJitenTarget] = useState<JitenTarget>();
    const [dialogJitenBatch, setDialogJitenBatch] = useState<{
        targets: JitenTarget[];
        deckId: number;
    }>();
    const [jitenResult, setJitenResult] = useState<JitenAttachmentResult>();
    const jitenSubmitting = useRef(false);
    useEffect(() => {
        setDialogJitenBatch(undefined);
        jitenClient.clearRetry();
        setJitenResult(undefined);
    }, [jitenClient, profile]);
    const miningContext = useMemo(() => new MiningContext(), []);
    const [settingsDialogOpen, setSettingsDialogOpen] = useState<boolean>(false);
    const [settingsDialogScrollToId, setSettingsDialogScrollToId] = useState<string>();
    const [disableKeyEvents, setDisableKeyEvents] = useState<boolean>(false);
    const [tab, setTab] = useState<VideoTabModel>();
    const [availableTabs, setAvailableTabs] = useState<VideoTabModel[]>();
    const [isSidePanelOpen, setIsSidePanelOpen] = useState<boolean>(false);
    const {
        canRestoreLastSession: canRestoreLastFileSession,
        saveSession: saveFileSession,
        fetchSession: fetchFileSession,
        clearSession: clearFileSession,
        saveBufferedHandlesToSession: saveBufferedHandlesToFileSession,
        promoteBufferedHandlesInSession: promoteBufferedHandlesInFileSession,
        clearBufferedHandlesInSession: clearBufferedHandlesInFileSession,
        saveCachedSubtitleFilesToSession: saveCachedSubtitleFilesToFileSession,
        retainSourcesInSession: retainSourcesInFileSession,
    } = useFileSession();

    const [lastError, setLastError] = useState<any>();
    const playerRef = useRef<PlayerRef>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const bufferedFileInputRef = useRef<HTMLInputElement>(null);
    const { subtitleFiles } = sources;

    const handleError = useCallback(
        (message: any) => {
            asbError('app/errors', message);
            setLastError(message);
            setAlertSeverity('error');

            if (message instanceof LocalizedError) {
                setAlert(t(message.locKey, message.locParams) ?? '<failed to localize error>');
            } else if (message instanceof Error) {
                setAlert(message.message);
            } else if (typeof message === 'string') {
                setAlert(message);
            } else {
                setAlert(String(message));
            }

            setAlertOpen(true);
        },
        [t]
    );

    const handleCopyLastError = useCallback(
        (error: string) => {
            setAlertSeverity('info');

            let truncatedError: string;
            const maxErrorLength = 32;

            if (error.length >= maxErrorLength) {
                truncatedError = `${error.substring(0, maxErrorLength)}...`;
            } else {
                truncatedError = error;
            }

            setAlert(t('info.copiedSubtitle', { text: truncatedError }));
            setAlertOpen(true);
        },
        [t]
    );

    const handleAnkiDialogRequest = useCallback(
        (ankiDialogItem?: CopyHistoryItem) => {
            if (jitenSubmitting.current) return;
            if (!ankiDialogItem && copyHistoryItemsRef.current.length === 0) {
                return;
            }

            const item = ankiDialogItem ?? copyHistoryItemsRef.current[copyHistoryItemsRef.current.length - 1];

            setDialogJitenTarget(item.jitenTarget ?? readJitenTarget());
            setDialogJitenBatch(undefined);
            setJitenResult(undefined);
            setAnkiDialogCard({
                ...item,
                jitenWords: item.jitenWords?.length
                    ? item.jitenWords
                    : settings.miningDestination === 'jiten'
                      ? readJitenWords(item.subtitle, item.surroundingSubtitles)
                      : undefined,
            });
            setAnkiDialogOpen(true);
            setAnkiDialogDisabled(false);
            setDisableKeyEvents(true);
            miningContext.started();
        },
        [miningContext, settings.miningDestination]
    );

    const handleAnkiDialogRequestFromVideoPlayer = useCallback(
        async (
            videoFileUrl: string,
            videoFileName: string,
            audioTrack: string | undefined,
            playbackRate: number,
            subtitle: SubtitleModel,
            surroundingSubtitles: SubtitleModel[],
            cardTextFieldValues: CardTextFieldValues,
            timestamp: number
        ) => {
            const item = {
                subtitle,
                surroundingSubtitles,
                ...cardTextFieldValues,
                timestamp: Date.now(),
                id: uuidv4(),
                subtitleFileName: videoFileName,
                mediaTimestamp: timestamp,
                file: {
                    name: videoFileName,
                    blobUrl: videoFileUrl,
                    audioTrack,
                    playbackRate,
                },
            };
            handleAnkiDialogRequest(item);
        },
        [handleAnkiDialogRequest]
    );

    const handleJitenAttach = useCallback(
        async (
            params: ExportParams,
            target: JitenTarget,
            batch?: {
                targets: JitenTarget[];
                deckId: number;
            },
            sentenceId?: number
        ) => {
            if (jitenSubmitting.current) return;
            jitenSubmitting.current = true;
            setAnkiDialogDisabled(true);
            miningContext.started();
            setAlertSeverity('info');
            setAlert(t('jiten.attaching'));
            setAlertOpen(true);
            try {
                const submission = await jitenClient.submit(
                    batch?.targets ?? [target],
                    {
                        ...params,
                        image: settings.jitenAttachVisual ? params.image : undefined,
                        audioClip: settings.jitenAttachAudio ? params.audioClip : undefined,
                    },
                    batch?.deckId,
                    sentenceId
                );
                const last = submission.outcomes.at(-1);
                if (!last) return;
                const { result } = last;
                if (result.failed && batch) {
                    setDialogJitenBatch({ ...batch, targets: submission.remainingTargets });
                } else if (!result.failed) {
                    setDialogJitenBatch(undefined);
                }
                setJitenResult(result);
                setAlertSeverity(result.failed ? 'warning' : 'success');
                setAlert(jitenOutcomeMessage(submission.outcomes));
                setAlertOpen(true);
                setAnkiDialogOpen(result.failed);
                setDisableKeyEvents(result.failed);
                if (!result.failed) miningContext.stopped();
            } catch (error) {
                handleError(error);
                setAnkiDialogOpen(true);
                setDisableKeyEvents(true);
            } finally {
                jitenSubmitting.current = false;
                setAnkiDialogDisabled(false);
            }
        },
        [jitenClient, miningContext, handleError, t, settings.jitenAttachVisual, settings.jitenAttachAudio]
    );

    const loadJitenNewWords = useCallback(
        () => jitenClient.newWords(ankiDialogCard?.jitenWords ?? [], settings.jitenMiningDeckId),
        [jitenClient, ankiDialogCard, settings.jitenMiningDeckId]
    );

    const handleJitenMineNewWords = useCallback(
        async (params: ExportParams, selectedTargets: JitenTarget[]) => {
            if (jitenSubmitting.current || !ankiDialogCard) return;
            jitenSubmitting.current = true;
            setAnkiDialogDisabled(true);
            let batch = dialogJitenBatch ? { ...dialogJitenBatch, targets: selectedTargets } : undefined;
            try {
                if (!batch) {
                    const deckId = settings.jitenMiningDeckId;
                    const text = stripJitenMarkers(params.text ?? '');
                    const candidates = selectedTargets.filter(
                        (target) => target.surfaceForm && text.includes(target.surfaceForm)
                    );
                    batch = { targets: await jitenClient.newWords(candidates, deckId), deckId };
                }
            } catch (error) {
                handleError(error);
                return;
            } finally {
                jitenSubmitting.current = false;
                setAnkiDialogDisabled(false);
            }
            const target = batch.targets[0];
            if (!target) {
                setAlertSeverity('info');
                setAlert(t('jiten.noNewWords'));
                setAlertOpen(true);
                return;
            }
            const resumingTarget =
                dialogJitenBatch &&
                target.wordId === dialogJitenBatch.targets[0]?.wordId &&
                target.readingIndex === dialogJitenBatch.targets[0].readingIndex;
            setDialogJitenBatch(batch);
            await handleJitenAttach(
                {
                    ...params,
                    text: highlightJitenWord(stripJitenMarkers(params.text ?? ''), target),
                },
                target,
                batch,
                resumingTarget ? jitenResult?.sentenceId : undefined
            );
        },
        [
            ankiDialogCard,
            dialogJitenBatch,
            jitenResult,
            settings.jitenMiningDeckId,
            jitenClient,
            handleError,
            handleJitenAttach,
            t,
        ]
    );

    const handleAnkiDialogProceed = useCallback(
        async (params: ExportParams) => {
            if (!dialogJitenTarget) {
                handleError(t('jiten.mineInReaderFirst'));
                return;
            }
            setDialogJitenBatch(undefined);
            await handleJitenAttach(
                params,
                dialogJitenTarget,
                undefined,
                dialogJitenBatch ? undefined : jitenResult?.sentenceId
            );
        },
        [dialogJitenTarget, handleError, t, handleJitenAttach, dialogJitenBatch, jitenResult]
    );

    const settingsRef = useRef(settings);
    settingsRef.current = settings;
    const handleCopy = useCallback(
        async (card: CardModel, postMineAction?: PostMineAction, id?: string) => {
            if (card.subtitle && settingsRef.current.copyToClipboardOnMine) {
                void navigator.clipboard.writeText(card.subtitle.text);
            }

            const newCard = {
                ...card,
                subtitleFileName: card.subtitleFileName || card.file?.name || '',
                timestamp: Date.now(),
                id: id || uuidv4(),
            };

            if (extension.supportsSidePanel) {
                extension.publishCard(newCard);
            } else {
                void saveCopyHistoryItem(newCard);
            }
            if (jitenSubmitting.current && postMineAction !== PostMineAction.none) return;
            if (
                postMineAction !== undefined &&
                postMineAction !== PostMineAction.none &&
                postMineAction !== PostMineAction.updateLastCard &&
                postMineAction !== PostMineAction.mineNewJitenWords
            ) {
                handleAnkiDialogRequest(newCard);
                return;
            }

            switch (postMineAction ?? PostMineAction.none) {
                case PostMineAction.none:
                    setAlertSeverity('success');
                    setAlert(
                        card.subtitle.text === ''
                            ? t('info.savedTimestamp', { timestamp: humanReadableTime(card.subtitle.start) })
                            : t('info.copiedSubtitle2', { result: card.subtitle.text })
                    );
                    setAlertOpen(true);
                    break;
                case PostMineAction.updateLastCard:
                case PostMineAction.mineNewJitenWords: {
                    let batch:
                        | {
                              targets: JitenTarget[];
                              deckId: number;
                          }
                        | undefined;
                    if (postMineAction === PostMineAction.mineNewJitenWords) {
                        jitenSubmitting.current = true;
                        try {
                            const deckId = settingsRef.current.jitenMiningDeckId;
                            const candidates = card.jitenWords?.length
                                ? card.jitenWords
                                : readJitenWords(card.subtitle, card.surroundingSubtitles);
                            const targets = await jitenClient.newWords(candidates, deckId);
                            if (!targets.length) {
                                setAlertSeverity('info');
                                setAlert(t('jiten.noNewWords'));
                                setAlertOpen(true);
                                break;
                            }
                            batch = { targets, deckId };
                        } catch (error) {
                            handleError(error);
                            break;
                        } finally {
                            jitenSubmitting.current = false;
                        }
                    }
                    const target = batch?.targets[0] ?? card.jitenTarget ?? readJitenTarget();
                    const text = highlightJitenWord(
                        extractText(card.subtitle, card.surroundingSubtitles) || target?.sentence || '',
                        target
                    );
                    const source = `${newCard.subtitleFileName} (${humanReadableTime(card.mediaTimestamp)})`;
                    if (
                        jitenValidationError(target, text, source) ||
                        (settingsRef.current.jitenPreventMultipleWords && (batch?.targets.length ?? 0) > 1)
                    ) {
                        handleAnkiDialogRequest(newCard);
                        if (batch) {
                            setDialogJitenBatch(batch);
                        }
                        break;
                    }
                    miningContext.started();
                    let audioClip = AudioClip.fromCard(
                        newCard,
                        settingsRef.current.audioPaddingStart,
                        settingsRef.current.audioPaddingEnd,
                        settingsRef.current.recordWithAudioPlayback
                    );

                    if (audioClip && settingsRef.current.preferMp3) {
                        audioClip = audioClip.toMp3(() => new mp3WorkerFactory());
                    }

                    const params: ExportParams = {
                        text,
                        audioClip: audioClip,
                        image: MediaFragment.fromCard(
                            newCard,
                            settingsRef.current.maxImageWidth,
                            settingsRef.current.maxImageHeight,
                            settingsRef.current.mediaFragmentFormat,
                            settingsRef.current.mediaFragmentTrimStart,
                            settingsRef.current.mediaFragmentTrimEnd,
                            settingsRef.current.mediaFragmentMaxClipLength,
                            settingsRef.current.trimBlackBars
                        ),
                        source,
                    };
                    {
                        setDialogJitenBatch(batch);
                        setDialogJitenTarget(newCard.jitenTarget ?? readJitenTarget());
                        setAnkiDialogCard(newCard);
                        setJitenResult(undefined);
                        await handleJitenAttach(params, target!, batch);
                        params.image?.dispose();
                    }
                    break;
                }
                default:
                    throw new Error('Unknown post mine action: ' + postMineAction);
            }
        },
        [
            extension,
            miningContext,
            saveCopyHistoryItem,
            handleAnkiDialogRequest,
            handleJitenAttach,
            jitenClient,
            handleError,
            t,
        ]
    );

    const handleOpenCopyHistory = useCallback(async () => {
        const toggleInAppCopyHistory = async () => {
            await refreshCopyHistory();
            setCopyHistoryOpen((copyHistoryOpen) => !copyHistoryOpen);
            setVideoFullscreen(false);
        };
        if (isFirefox) {
            // Firefox doesn't support opening the side panel with a button from the app.
            // So update the side panel state if it happens to be open,
            // otherwise open the in-app drawer.
            if (extension.supportsSidePanel && isSidePanelOpen) {
                extension.toggleSidePanel('mining-history');
            } else {
                await toggleInAppCopyHistory();
            }
        } else if (extension.supportsSidePanel) {
            extension.toggleSidePanel('mining-history');
        } else {
            await toggleInAppCopyHistory();
        }
    }, [extension, refreshCopyHistory, isSidePanelOpen]);
    const handleCloseCopyHistory = useCallback(() => setCopyHistoryOpen(false), []);
    const handleAppBarToggle = useCallback(() => {
        const newValue = !playbackPreferences.theaterMode;
        playbackPreferences.theaterMode = newValue;
        setTheaterMode(newValue);
        setVideoFullscreen(false);
    }, [playbackPreferences]);
    useEffect(() => {
        if (videoFullscreen) {
            if (!document.fullscreenElement) {
                void document.documentElement.requestFullscreen();
            }
        } else if (document.fullscreenElement) {
            void document.exitFullscreen();
        }
    }, [videoFullscreen]);
    useEffect(() => {
        const listener = () => {
            setVideoFullscreen(document.fullscreenElement !== null);
        };
        document.addEventListener('fullscreenchange', listener);
        return () => document.removeEventListener('fullscreenchange', listener);
    }, []);
    const handleHideSubtitlePlayer = useCallback(() => {
        playbackPreferences.hideSubtitleList = !hideSubtitlePlayer;
        setHideSubtitlePlayer(!hideSubtitlePlayer);
    }, [hideSubtitlePlayer, playbackPreferences]);
    const handleVideoPopOut = useCallback(() => {
        setVideoPopOut((videoPopOut) => !videoPopOut);
        setHideSubtitlePlayer(false);
    }, []);
    const handleOpenSettings = useCallback(() => {
        setDisableKeyEvents(true);
        setSettingsDialogOpen(true);
    }, []);
    const handleOpenSubtitleSettings = useCallback(() => {
        setSettingsDialogScrollToId('subtitle-appearance');
        handleOpenSettings();
    }, [handleOpenSettings]);
    const handleAlertClosed = useCallback(() => setAlertOpen(false), []);
    const handleCloseSettings = useCallback(() => {
        setSettingsDialogOpen(false);
        setSettingsDialogScrollToId(undefined);

        // ATM only the Anki dialog may appear under the settings dialog,
        // so it's the only one we need to check to re-enable key events
        setDisableKeyEvents(ankiDialogOpen);
    }, [ankiDialogOpen]);

    const handleUnloadVideo = useCallback(
        (videoFileUrl: string) => {
            if (videoFileUrl !== sources.videoFileUrl) {
                return;
            }

            setSources((previous) => {
                revokeBlobUrl(videoFileUrl);

                return {
                    subtitleFiles: previous.subtitleFiles,
                    videoFile: undefined,
                    videoFileUrl: undefined,
                };
            });
            setVideoFullscreen(false);
        },
        [sources]
    );

    const handleDownloadAudio = useCallback(
        async (card: CardModel) => {
            try {
                const clip = AudioClip.fromCard(card, settings.audioPaddingStart, settings.audioPaddingEnd, false);

                if (clip?.error === undefined) {
                    if (settings.preferMp3) {
                        void clip!.toMp3(() => new mp3WorkerFactory()).download();
                    } else {
                        void clip!.download();
                    }
                } else {
                    handleError(t(clip.errorLocKey!));
                }
            } catch (e) {
                handleError(e);
            }
        },
        [handleError, settings.audioPaddingStart, settings.audioPaddingEnd, settings.preferMp3, t]
    );

    const handleDownloadImage = useCallback(
        (item: CardModel) => {
            try {
                const image = MediaFragment.fromCard(
                    item,
                    settings.maxImageWidth,
                    settings.maxImageHeight,
                    settings.mediaFragmentFormat,
                    settings.mediaFragmentTrimStart,
                    settings.mediaFragmentTrimEnd,
                    settings.mediaFragmentMaxClipLength,
                    settings.trimBlackBars
                )!;

                if (image.error === undefined) {
                    void image.download();
                } else if (image.error === MediaFragmentErrorCode.fileLinkLost) {
                    handleError(t('ankiDialog.imageFileLinkLost'));
                } else if (image.error === MediaFragmentErrorCode.captureFailed) {
                    handleError(t('ankiDialog.imageCaptureFailed'));
                }
            } catch (e) {
                handleError(e);
            }
        },
        [
            handleError,
            settings.maxImageWidth,
            settings.maxImageHeight,
            settings.mediaFragmentFormat,
            settings.mediaFragmentTrimStart,
            settings.mediaFragmentTrimEnd,
            settings.mediaFragmentMaxClipLength,
            settings.trimBlackBars,
            t,
        ]
    );

    const handleDownloadCopyHistorySectionAsSrt = useCallback(
        (name: string, items: CopyHistoryItem[]) => {
            const deduplicated: SubtitleModel[] = [];

            for (const item of items) {
                if (
                    deduplicated.find(
                        (i) =>
                            i.start === item.subtitle.start &&
                            i.end === item.subtitle.end &&
                            i.text === item.subtitle.text
                    ) === undefined
                ) {
                    deduplicated.push(item.subtitle);
                }
            }

            download(
                new Blob([subtitleReader.subtitlesToSrt(deduplicated)], { type: 'text/plain' }),
                `${name}_MiningHistory_${new Date().toISOString()}.srt`
            );
        },
        [subtitleReader]
    );

    const handleJumpToSubtitle = useCallback(
        (subtitle: SubtitleModel, subtitleFileName: string) => {
            if (!subtitleFiles.find((f) => f.file.name === subtitleFileName)) {
                handleError(t('error.subtitleFileNotOpen', { fileName: subtitleFileName }));
                return;
            }

            setJumpToSubtitle({ ...subtitle });
        },
        [subtitleFiles, handleError, t]
    );

    const handleSelectCopyHistoryItem = useCallback(
        (item: CopyHistoryItem) => {
            handleJumpToSubtitle(item.subtitle, item.subtitleFileName);
        },
        [handleJumpToSubtitle]
    );
    const handleJumpToSubtitleHandled = useCallback(() => {
        setJumpToSubtitle(undefined);
    }, []);

    const handleAnki = useCallback((card: CardModel) => {
        if (jitenSubmitting.current) return;

        setDialogJitenTarget(card.jitenTarget ?? readJitenTarget());
        setDialogJitenBatch(undefined);
        setJitenResult(undefined);
        setAnkiDialogCard(card);
        setAnkiDialogOpen(true);
        setAnkiDialogDisabled(false);
        setDisableKeyEvents(true);
    }, []);

    const handleAnkiDialogCancel = useCallback(() => {
        setAnkiDialogOpen(false);
        setAnkiDialogDisabled(false);
        setDisableKeyEvents(false);

        if (miningContext.mining) {
            miningContext.stopped();
        }
    }, [miningContext]);

    const handleAnkiDialogRewind = useCallback(() => {
        if (!ankiDialogCard) {
            return;
        }

        if (!subtitleFiles.find((f) => f.file.name === ankiDialogCard.subtitleFileName)) {
            handleError(t('error.subtitleFileNotOpen', { fileName: ankiDialogCard.subtitleFileName }));
            return;
        }

        setRewindSubtitle(ankiDialogCard.subtitle);
        handleAnkiDialogCancel();
    }, [ankiDialogCard, subtitleFiles, handleAnkiDialogCancel, handleError, t]);

    const handleAnkiDialogRewindFromVideoPlayer = useCallback(() => {
        if (!ankiDialogCard) {
            return;
        }

        setVideoPlayerSeekRequest({ timestamp: ankiDialogCard.subtitle.start });
        handleAnkiDialogCancel();
    }, [ankiDialogCard, handleAnkiDialogCancel]);

    useEffect(() => {
        function onTabs(tabs: VideoTabModel[]) {
            if (availableTabs === undefined || tabs.length !== availableTabs.length) {
                setAvailableTabs(tabs);
            } else {
                let update = false;

                for (let i = 0; i < availableTabs.length; ++i) {
                    const t1 = availableTabs[i];
                    const t2 = tabs[i];
                    if (
                        t1.id !== t2.id ||
                        t1.title !== t2.title ||
                        t1.src !== t2.src ||
                        t1.faviconUrl !== t2.faviconUrl ||
                        t1.subscribed !== t2.subscribed ||
                        t1.synced !== t2.synced ||
                        t1.syncedTimestamp !== t2.syncedTimestamp ||
                        t1.faviconUrl !== t2.faviconUrl
                    ) {
                        update = true;
                        break;
                    }
                }

                if (update) {
                    setAvailableTabs(tabs);
                }
            }

            const selectedTabMissing = tab && tabs.filter((t) => t.id === tab.id && t.src === tab.src).length === 0;

            if (selectedTabMissing) {
                setTab(undefined);
                handleError(t('error.lostTabConnection', { tabName: tab.id + ' ' + tab.title }));
            }

            const isSidePanelOpen = extension.asbplayers?.find((a) => a.sidePanel) !== undefined;
            setIsSidePanelOpen(isSidePanelOpen);
        }

        return extension.subscribeTabs(onTabs);
    }, [availableTabs, tab, extension, handleError, t]);
    const handleTabSelected = useCallback((tab: VideoTabModel) => {
        setTab(tab);
    }, []);

    const validateFiles = useCallback(
        (files: FileWithId[]) => {
            try {
                extractSources(files);
                return true;
            } catch (e) {
                handleError(e);
                return false;
            }
        },
        [handleError]
    );

    const {
        subtitleTrackSelectorOpen,
        openSubtitleTrackSelector,
        closeSubtitleTrackSelector,
        subtitleTrackSelectorSelectedTrackIds,
        setSubtitleTrackSelectorSelectedTrackIds,
        subtitleTrackSelectorTracks,
        setSubtitleTrackSelectorTracks,
        subtitleTrackSelectorDisabled,
        setSubtitleTrackSelectorDisabled,
    } = useVideoDataSyncDialogState();
    const subtitleTrackSelectorOpenRef = useRef(subtitleTrackSelectorOpen);
    subtitleTrackSelectorOpenRef.current = subtitleTrackSelectorOpen;
    const embeddedSubtitleVideoRef = useRef<File>(undefined);
    const embeddedSubtitleLanguageRef = useRef<string>(undefined);
    const embeddedSubtitleIdsRef = useRef(new Set<string>());
    const [subtitleExtractionProgress, setSubtitleExtractionProgress] = useState<number>();
    const subtitleExtractionRef = useRef<{
        file: File;
        language: string | undefined;
        controller: AbortController;
    }>(undefined);
    const cancelSubtitleExtraction = useCallback(() => {
        const extraction = subtitleExtractionRef.current;
        if (!extraction) return;
        extraction.controller.abort();
        embeddedSubtitleVideoRef.current = extraction.file;
        embeddedSubtitleLanguageRef.current = extraction.language;
        subtitleExtractionRef.current = undefined;
        setSubtitleExtractionProgress(undefined);
    }, []);

    useEffect(() => {
        if (
            subtitleExtractionRef.current &&
            (subtitleExtractionRef.current.file !== sources.videoFile?.file || !settings.loadEmbeddedSubtitles)
        ) {
            cancelSubtitleExtraction();
        }
    }, [sources.videoFile?.file, settings.loadEmbeddedSubtitles, cancelSubtitleExtraction]);
    useEffect(() => () => subtitleExtractionRef.current?.controller.abort(), []);

    const populateEmbeddedSubtitleTracks = useCallback(
        (videoFile: File, autoLoadPreferredLanguage: boolean) => {
            if (!settingsRef.current.loadEmbeddedSubtitles) return;
            const language =
                settingsRef.current.rememberEmbeddedLanguage && settingsRef.current.loadPreferredEmbeddedLanguageOnly
                    ? settingsRef.current.embeddedLanguage
                    : undefined;
            cancelSubtitleExtraction();
            const extraction = { file: videoFile, language, controller: new AbortController() };
            subtitleExtractionRef.current = extraction;
            setSubtitleExtractionProgress(-1);
            setSubtitleTrackSelectorTracks((tracks) =>
                tracks.filter((track) => !embeddedSubtitleIdsRef.current.has(track.id))
            );
            let lastProgressUpdate = 0;
            void extractMatroskaSubtitleFiles(videoFile, language, {
                signal: extraction.controller.signal,
                onProgress: (progress) => {
                    if (extraction.controller.signal.aborted) return;
                    const now = performance.now();
                    if (progress === 0 || now - lastProgressUpdate >= 250) {
                        lastProgressUpdate = now;
                        setSubtitleExtractionProgress(Math.min(99, Math.floor(progress * 100)));
                    }
                },
            })
                .then((embeddedSubtitleFiles) => {
                    if (extraction.controller.signal.aborted) return;
                    const tracks: VideoDataSubtitleTrack[] = embeddedSubtitleFiles.map(
                        ({ file, language, name, type }) => {
                            const id = uuidv4();
                            return {
                                id,
                                file,
                                label: `Embedded · ${embeddedTrackLanguageDisplayName(language)} · ${type.toUpperCase()}${name ? ` · ${name}` : ''}`,
                                language,
                                extension: type,
                            };
                        }
                    );
                    if (
                        sourcesRef.current.videoFile?.file !== videoFile ||
                        !settingsRef.current.loadEmbeddedSubtitles ||
                        language !==
                            (settingsRef.current.rememberEmbeddedLanguage &&
                            settingsRef.current.loadPreferredEmbeddedLanguageOnly
                                ? settingsRef.current.embeddedLanguage
                                : undefined)
                    )
                        return;
                    embeddedSubtitleVideoRef.current = videoFile;
                    embeddedSubtitleLanguageRef.current = language;
                    embeddedSubtitleIdsRef.current = new Set([
                        ...sourcesRef.current.subtitleFiles
                            .map((file) => file.id)
                            .filter((id) => embeddedSubtitleIdsRef.current.has(id)),
                        ...tracks.map((track) => track.id),
                    ]);
                    setSubtitleTrackSelectorTracks((current) => [
                        ...tracks,
                        ...current.filter((track) => !embeddedSubtitleIdsRef.current.has(track.id)),
                    ]);
                    if (subtitleTrackSelectorOpenRef.current) return;
                    setSubtitleTrackSelectorSelectedTrackIds([]);
                    if (autoLoadPreferredLanguage && settingsRef.current.rememberEmbeddedLanguage) {
                        const preferredLanguage = embeddedTrackLanguageDisplayName(
                            settingsRef.current.embeddedLanguage
                        );
                        const matchingTracks = tracks.filter(
                            (track) =>
                                track.language !== undefined &&
                                embeddedTrackLanguageDisplayName(track.language) === preferredLanguage
                        );
                        const preferredTrack =
                            matchingTracks.find((track) => track.extension === 'srt') ?? matchingTracks[0];
                        if (preferredTrack?.file !== undefined) {
                            handleFilesRef.current?.({
                                files: [{ file: preferredTrack.file, id: preferredTrack.id }],
                            });
                            return;
                        }
                    }
                    if (autoLoadPreferredLanguage && tracks.length === 0) return;
                    openSubtitleTrackSelector();
                })
                .catch((e) => {
                    if (extraction.controller.signal.aborted) return;
                    asbWarn('app/subtitles', 'Failed to extract embedded Matroska subtitles:', e);
                    handleError(e);
                })
                .finally(() => {
                    if (subtitleExtractionRef.current === extraction) {
                        subtitleExtractionRef.current = undefined;
                        setSubtitleExtractionProgress(undefined);
                    }
                });
        },
        [
            cancelSubtitleExtraction,
            handleError,
            openSubtitleTrackSelector,
            setSubtitleTrackSelectorSelectedTrackIds,
            setSubtitleTrackSelectorTracks,
        ]
    );

    const handleFiles = useCallback(
        ({ files, flattenSubtitleFiles }: { files: FileWithId[]; flattenSubtitleFiles?: boolean }): boolean => {
            try {
                const mediaSources = extractSources(files);
                let videoFile = mediaSources.videoFile;
                const selectedVideoFile = mediaSources.videoFile;
                const subtitleFiles = mediaSources.subtitleFiles;

                if (selectedVideoFile || subtitleFiles.length > 0) cancelSubtitleExtraction();

                if (videoFile || subtitleFiles.length > 0) {
                    setJumpToSubtitle(undefined);
                }

                setSources((previous) => {
                    let videoFileUrl: string | undefined = undefined;

                    if (videoFile) {
                        if (previous.videoFileUrl) {
                            revokeBlobUrl(previous.videoFileUrl);
                        }

                        if (videoFile) {
                            videoFileUrl = createBlobUrl(videoFile.file);
                        }

                        setTab(undefined);
                    } else {
                        videoFile = previous.videoFile;
                        videoFileUrl = previous.videoFileUrl;
                    }

                    const sources = {
                        subtitleFiles: subtitleFiles.length === 0 ? previous.subtitleFiles : subtitleFiles,
                        videoFile,
                        videoFileUrl: videoFileUrl,
                        flattenSubtitleFiles,
                    };

                    const sourcesToList = (s: MediaSources) =>
                        [...s.subtitleFiles, s.videoFile].filter((f) => f !== undefined);

                    const previousLoadingSources = sourcesToList(previous);
                    const loadingSources = sourcesToList(sources).filter((f) => {
                        for (const previousLoadingSource of previousLoadingSources) {
                            if (f.file === previousLoadingSource.file) {
                                return false;
                            }
                        }

                        return true;
                    });
                    setLoadingSources(loadingSources);

                    void retainSourcesInFileSession([
                        ...sources.subtitleFiles.map((f) => f.id),
                        ...(sources.videoFile === undefined ? [] : [sources.videoFile.id]),
                    ]);

                    return sources;
                });

                if (
                    selectedVideoFile &&
                    isMatroskaFile(selectedVideoFile.file.name) &&
                    subtitleFiles.length === 0 &&
                    sourcesRef.current.subtitleFiles.every((file) => embeddedSubtitleIdsRef.current.has(file.id))
                ) {
                    populateEmbeddedSubtitleTracks(selectedVideoFile.file, true);
                }

                if (subtitleFiles.length > 0) {
                    const subtitleFileName = subtitleFiles[0].file.name;
                    setFileName(subtitleFileName.substring(0, subtitleFileName.lastIndexOf('.')));
                }

                return true;
            } catch (e) {
                handleError(e);
                return false;
            }
        },
        [cancelSubtitleExtraction, handleError, populateEmbeddedSubtitleTracks, retainSourcesInFileSession]
    );
    handleFilesRef.current = handleFiles;

    const persistFileSessionHandles = useCallback(
        (handles: FileSystemFileHandleWithId[] | undefined) => {
            if (!handles || handles.length === 0) {
                return;
            }

            let videoHandle: FileSystemFileHandleWithId | undefined;
            const subtitleHandles: FileSystemFileHandleWithId[] = [];
            for (const handle of handles) {
                const extension = getExtension(handle.handle.name);
                if (VIDEO_EXT_SET.has(extension) || AUDIO_EXT_SET.has(extension)) {
                    videoHandle = handle;
                } else if (SUBTITLE_EXT_SET.has(extension)) {
                    subtitleHandles.push(handle);
                }
            }

            if (!videoHandle && subtitleHandles.length === 0) {
                return;
            }

            // Persist in background so session saving never blocks current file loading.
            void saveFileSession({ videoHandle, subtitleHandles }).catch((e) => {
                asbError('app/session', 'Failed to save file session:', e);
                handleError(e);
            });
        },
        [handleError, saveFileSession]
    );

    const persistBufferedFileSessionHandles = useCallback(
        (handles: FileSystemFileHandleWithId[]) => {
            if (!handles || handles.length === 0) {
                return;
            }

            // Persist in background so session saving never blocks current file loading.
            void saveBufferedHandlesToFileSession(handles).catch((e) => {
                asbError('app/session', 'Failed to save file session:', e);
                handleError(e);
            });
        },
        [handleError, saveBufferedHandlesToFileSession]
    );

    const handleRestoreLastSession = useCallback(async () => {
        try {
            const record = await fetchFileSession();
            if (!record) return;

            const allHandles = [...(record.videoHandle ? [record.videoHandle] : []), ...record.subtitleHandles];

            const { granted, denied } = await requestPermissions(allHandles);
            if (denied.length > 0) {
                handleError(t('error.restoreSessionFailed'));
                return;
            }

            const { files: resolvedFiles, errors } = await resolveFiles(granted);
            if (errors.length > 0) {
                handleError(t('error.restoreSessionFailed'));
                await clearFileSession();
                return;
            }

            const files = [...resolvedFiles, ...(record.cachedSubtitleFiles ?? [])];
            if (!handleFiles({ files })) {
                await clearFileSession();
            }
        } catch (e) {
            asbError('app/session', 'Failed to restore last session:', e);
            handleError(e);
        }
    }, [fetchFileSession, clearFileSession, handleFiles, handleError, t]);

    const handleDirectory = useCallback(
        async (items: DataTransferItemList) => {
            if (items.length !== 1) {
                handleError(t('error.onlyOneDirectoryAllowed'));
                return;
            }

            const fileSystemEntry = items[0].webkitGetAsEntry();

            if (!fileSystemEntry || !fileSystemEntry.isDirectory) {
                handleError(t('error.failedToLoadDirectory'));
                return;
            }

            const fileSystemDirectoryEntry = fileSystemEntry as FileSystemDirectoryEntry;

            try {
                const entries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
                    fileSystemDirectoryEntry.createReader().readEntries(resolve, reject)
                );

                if (entries.find((e) => e.isDirectory)) {
                    handleError(t('error.subdirectoriesNotAllowed'));
                    return;
                }

                const filePromises = entries.map(
                    (e) => new Promise<File>((resolve, reject) => (e as FileSystemFileEntry).file(resolve, reject))
                );
                const files: FileWithId[] = [];

                for (const f of filePromises) {
                    files.push({ file: await f, id: uuidv4() });
                }

                handleFiles({ files });
            } catch (e) {
                handleError(e);
            }
        },
        [handleError, handleFiles, t]
    );

    useEffect(() => {
        if (!webSocketClient) {
            return;
        }

        webSocketClient.onLoadSubtitles = async (command: LoadSubtitlesCommand) => {
            const { files } = command.body;
            const filePromises = (files ?? []).map(
                async (f) => new File([await (await fetch('data:text/plain;base64,' + f.base64)).blob()], f.name)
            );
            const loadedFiles = await Promise.all(filePromises);
            handleFiles({ files: loadedFiles.map((file) => ({ file, id: uuidv4() })) });
        };
    }, [webSocketClient, handleFiles]);

    useEffect(() => {
        if (inVideoPlayer) {
            extension.videoPlayer = true;
            extension.loadedSubtitles = false;
            extension.setSubtitleTracks([], []);
            extension.syncedVideoElement = undefined;
            extension.startHeartbeat();
            return undefined;
        }

        async function onMessage(message: ExtensionMessage) {
            if (message.data.command === 'sync' || message.data.command === 'syncv2') {
                const tabs = (extension.tabs ?? []).filter((t) => {
                    if (t.id !== message.tabId) {
                        return false;
                    }

                    return !message.src || t.src === message.src;
                });

                if (tabs.length === 0) {
                    if (message.src) {
                        asbError(
                            'app/messages',
                            'Received sync request but the requesting tab ID ' +
                                message.tabId +
                                ' with src ' +
                                message.src +
                                ' was not found'
                        );
                    } else {
                        asbError(
                            'app/messages',
                            'Received sync request but the requesting tab ID ' + message.tabId + ' was not found'
                        );
                    }

                    return;
                }

                const tab = tabs[0];
                let subtitleFiles: File[];
                let flatten = false;

                if (message.data.command === 'sync') {
                    const syncMessage = message.data as LegacyPlayerSyncMessage;
                    subtitleFiles = [
                        new File(
                            [await (await fetch('data:text/plain;base64,' + syncMessage.subtitles.base64)).blob()],
                            syncMessage.subtitles.name
                        ),
                    ];
                } else if (message.data.command === 'syncv2') {
                    const syncMessage = message.data as PlayerSyncMessage;
                    subtitleFiles = await Promise.all(
                        syncMessage.subtitles.map(
                            async (s) =>
                                new File([await (await fetch('data:text/plain;base64,' + s.base64)).blob()], s.name)
                        )
                    );
                    flatten = syncMessage.flatten ?? false;
                } else {
                    asbError('app/messages', 'Unknown message ' + message.data.command);
                    return;
                }

                if (sources.videoFileUrl) {
                    handleUnloadVideo(sources.videoFileUrl);
                }

                handleFiles({
                    files: subtitleFiles.map((file) => ({ file, id: uuidv4() })),
                    flattenSubtitleFiles: flatten,
                });
                setTab(tab);
            } else if (message.data.command === 'edit-keyboard-shortcuts') {
                setSettingsDialogOpen(true);
                setSettingsDialogScrollToId('keyboard-shortcuts');
            } else if (message.data.command === 'open-asbplayer-settings') {
                setSettingsDialogOpen(true);
            } else if (message.data.command === 'show-anki-ui') {
                handleAnki(message.data as ShowAnkiUiMessage);
            } else if (message.data.command === 'request-local-subtitles') {
                const requestMessage = message.data as RequestLocalSubtitlesMessage;
                extension.sendSubtitles(requestMessage.messageId, {
                    subtitles,
                    subtitleFileNames: sources.subtitleFiles.map((f) => f.file.name),
                });
            }
        }

        const unsubscribe = extension.subscribe((message) => {
            void onMessage(message);
        });
        extension.videoPlayer = Boolean(sources.videoFileUrl && !videoPopOut);
        extension.loadedSubtitles = subtitles.length > 0;
        extension.setSubtitleTracks(
            subtitles,
            sources.subtitleFiles.map((f) => f.file.name)
        );
        extension.syncedVideoElement = tab;
        extension.startHeartbeat();
        return unsubscribe;
    }, [
        extension,
        subtitles,
        inVideoPlayer,
        sources.videoFileUrl,
        videoPopOut,
        sources.subtitleFiles,
        tab,
        handleFiles,
        handleAnki,
        handleUnloadVideo,
    ]);

    useEffect(() => {
        if (inVideoPlayer) {
            return;
        }

        return extension.subscribe((message: ExtensionMessage) => {
            if (message.data.command === 'jump-to-subtitle') {
                const jumpToSubtitleMessage = message.data as JumpToSubtitleMessage;
                handleJumpToSubtitle(jumpToSubtitleMessage.subtitle, jumpToSubtitleMessage.subtitleFileName);
            }
        });
    }, [extension, inVideoPlayer, handleJumpToSubtitle]);

    useEffect(() => {
        if (inVideoPlayer) {
            return;
        }

        return extension.subscribe((message: ExtensionMessage) => {
            if (message.data.command === 'download-image') {
                handleDownloadImage(message.data as DownloadImageMessage);
            }
        });
    }, [extension, inVideoPlayer, handleDownloadImage]);

    useEffect(() => {
        if (inVideoPlayer) {
            return;
        }

        return extension.subscribe((message: ExtensionMessage) => {
            if (message.data.command === 'download-audio') {
                void handleDownloadAudio(message.data as DownloadAudioMessage);
            }
        });
    }, [extension, inVideoPlayer, handleDownloadAudio]);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            if (ankiDialogOpen) {
                return;
            }

            e.preventDefault();

            if (inVideoPlayer) {
                handleError(t('error.videoPlayerDragAndDropNotAllowed'));
                return;
            }

            setDragging(false);
            dragEnterRef.current = null;
            const dataTransfer = e.dataTransfer;

            function allDirectories(items: DataTransferItemList) {
                for (let i = 0; i < items.length; ++i) {
                    if (!items[i].webkitGetAsEntry()?.isDirectory) {
                        return false;
                    }
                }

                return true;
            }

            if (dataTransfer.items && dataTransfer.items.length > 0 && allDirectories(dataTransfer.items)) {
                void handleDirectory(dataTransfer.items);
            } else if (dataTransfer.files && dataTransfer.files.length > 0) {
                // Copy files synchronously; DataTransfer may be cleared after this handler returns.
                const files = [...dataTransfer.files].map((file) => ({ file, id: uuidv4() }));

                if (!handleFiles({ files })) {
                    return;
                }

                if (dataTransfer.items && dataTransfer.items.length > 0) {
                    void extractDropFileHandles(dataTransfer.items)
                        .then((handles) => {
                            if (!handles) {
                                return;
                            }

                            const handlesWithId = handles.map((handle) => ({
                                handle,
                                // Not perfect, but should work most of the time for matching the handle to the file
                                id: files.find(({ file }) => file.name === handle.name)?.id ?? uuidv4(),
                            }));
                            persistFileSessionHandles(handlesWithId);
                        })
                        .catch((e) => {
                            asbWarn('app/files', 'Failed to collect dropped file handles:', e);
                        });
                }
            }
        },
        [inVideoPlayer, handleError, handleFiles, handleDirectory, ankiDialogOpen, t, persistFileSessionHandles]
    );

    const handleFileSelector = useCallback(
        async (params?: { buffered?: boolean }) => {
            if (!supportsFileSystemAccess()) {
                if (params?.buffered) {
                    bufferedFileInputRef.current?.click();
                } else {
                    fileInputRef.current?.click();
                }
                return;
            }

            try {
                const handles = await showFilePicker({
                    videoExtensions: [...videoExtensions],
                    audioExtensions: [...audioExtensions],
                    subtitleExtensions: [...subtitleExtensions],
                });
                if (!handles || handles.length === 0) return;

                const { files } = await resolveFiles(handles);

                if (files.length === 0) return;

                if (params?.buffered && validateFiles(files)) {
                    persistBufferedFileSessionHandles(handles);
                    return files;
                }

                if (!params?.buffered && handleFiles({ files })) {
                    persistFileSessionHandles(handles);
                    return files;
                }
            } catch (e) {
                asbError('app/files', 'Failed to pick files via File System Access API:', e);
                handleError(e);
            }
        },
        [handleFiles, validateFiles, handleError, persistFileSessionHandles, persistBufferedFileSessionHandles]
    );

    const fileSelector = useMemo(
        () => new DefaultFileSelector(() => handleFileSelector({ buffered: true })),
        [handleFileSelector]
    );

    const handleFileInputChange = useCallback(() => {
        const files = fileInputRef.current?.files;

        if (files && files.length > 0) {
            handleFiles({ files: [...files].map((file) => ({ file, id: uuidv4() })) });
            fileInputRef.current!.value = '';
        }
    }, [handleFiles]);

    const handleBufferedFileInputChange = useCallback(() => {
        const files = bufferedFileInputRef.current?.files;

        if (files && files.length > 0) {
            const filesWithId = [...files].map((file) => ({ file, id: uuidv4() }));
            if (validateFiles(filesWithId)) {
                fileSelector.publishFiles(filesWithId);
            }
            bufferedFileInputRef.current!.value = '';
        }
    }, [validateFiles, fileSelector]);

    const handleVideoElementSelected = useCallback(
        async (videoElement: VideoTabModel) => {
            const { id: tabId, synced, src } = videoElement;

            if (synced) {
                const response = (await extension.requestSubtitles(tabId, src)) as RequestSubtitlesResponse | undefined;

                if (response !== undefined) {
                    const { subtitles, subtitleFileNames } = response;

                    if (subtitleFileNames.length > 0) {
                        const subtitleFileName = subtitleFileNames[0];
                        setFileName(subtitleFileName.substring(0, subtitleFileName.lastIndexOf('.')));
                        const length = subtitles.length > 0 ? subtitles[subtitles.length - 1].end : 0;
                        setSubtitles(
                            subtitles.map((s, i) => ({
                                ...s,
                                displayTime: timeDurationDisplay(s.start, length),
                                displayEndTime: timeDurationDisplay(s.end, length),
                                index: i,
                            }))
                        );
                        setTab(videoElement);
                    }
                }
            } else {
                extension.loadSubtitles(tabId, src);
            }
        },
        [extension]
    );

    const handleDownloadSubtitleFilesAsSrt = useCallback(async () => {
        if (sources.subtitleFiles === undefined) {
            return;
        }

        const nonSupSubtitleFiles = sources.subtitleFiles
            .filter((f) => !f.file.name.endsWith('.sup'))
            .map((f) => f.file);

        if (nonSupSubtitleFiles.length === 0) {
            return;
        }

        download(
            new Blob([await subtitleReader.filesToSrt(nonSupSubtitleFiles)], {
                type: 'text/plain',
            }),
            `${fileName}.srt`
        );
    }, [fileName, sources.subtitleFiles, subtitleReader]);

    const handleDownloadSubtitleTimeline = useCallback(() => {
        playerRef.current?.downloadSubtitleTimeline();
    }, []);

    const handleDragOver = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            if (ankiDialogOpen) {
                return;
            }

            e.preventDefault();
        },
        [ankiDialogOpen]
    );

    const handleDragEnter = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            if (ankiDialogOpen) {
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            if (!inVideoPlayer) {
                dragEnterRef.current = e.target as Element;
                setDragging(true);
            }
        },
        [inVideoPlayer, ankiDialogOpen]
    );

    const handleDragLeave = useCallback(
        (e: React.DragEvent<HTMLDivElement>) => {
            e.nativeEvent.preventDefault();
            e.nativeEvent.stopPropagation();

            if (!inVideoPlayer && dragEnterRef.current === e.target) {
                setDragging(false);
            }
        },
        [inVideoPlayer]
    );

    const handleFilesLoaded = useCallback((loadedFiles: File[]) => {
        setLoadingSources((loadingFiles) =>
            loadingFiles?.filter((loadingFile) => {
                for (const loadedFile of loadedFiles) {
                    if (loadedFile === loadingFile.file) {
                        return false;
                    }
                }

                return true;
            })
        );
    }, []);

    const { hash: settingsHash } = useLocationHash({ view: 'settings' });
    useEffect(() => {
        if (settingsHash === undefined) {
            return;
        }

        setSettingsDialogScrollToId(settingsHash);
        setSettingsDialogOpen(true);
    }, [settingsHash]);

    useEffect(() => {
        if (sources.videoFile && alertOpen && alert && alertSeverity) {
            videoChannelRef.current?.alert(alert, alertSeverity);
            setAlertOpen(false);
        }
    }, [sources.videoFile, alert, alertSeverity, alertOpen]);

    const handleCopyToClipboard = useCallback((blob: Blob) => {
        navigator.clipboard
            .write([new ClipboardItem({ [blob.type]: blob })])
            .catch((error) => asbError('app/clipboard', error));
    }, []);

    useEffect(() => {
        return keyBinder?.bindToggleSidePanel(
            () => {
                if (extension.supportsSidePanel) {
                    extension.toggleSidePanel();
                } else if (copyHistoryOpen) {
                    void handleOpenCopyHistory();
                } else {
                    void handleOpenCopyHistory();
                }
            },
            () => ankiDialogOpen || !extension.supportsSidePanel,
            false
        );
    }, [extension, keyBinder, copyHistoryOpen, handleOpenCopyHistory, ankiDialogOpen]);

    const mp3Encoder = useCallback(async (blob: Blob) => {
        return Mp3Encoder.encode(blob, () => new mp3WorkerFactory());
    }, []);

    useEffect(() => {
        document.title = settings.tabName;
    }, [settings.tabName]);

    const { initialized: i18nInitialized } = useI18n({ language: settings.language });
    const [needRefreshDialogOpen, setNeedRefreshDialogOpen] = useState<boolean>(false);
    const handleOpenNeedRefreshDialog = useCallback(() => setNeedRefreshDialogOpen(true), []);
    const handleCloseNeedRefreshDialog = useCallback(() => setNeedRefreshDialogOpen(false), []);
    const handleOfflineReady = useCallback(() => {}, []);
    const { doUpdate: updateFromServiceWorker } = useServiceWorker({
        onNeedRefresh: handleOpenNeedRefreshDialog,
        onOfflineReady: handleOfflineReady,
    });

    const handleConfirmSubtitleTrackSelection = useCallback(
        (tracks: ConfirmedVideoDataSubtitleTrack[]) => {
            void (async () => {
                setSubtitleTrackSelectorDisabled(false);
                try {
                    const files: FileWithId[] = [];
                    const cachedSubtitleFiles: FileWithId[] = [];
                    for (const t of tracks) {
                        if (t.id === '-') continue;
                        if (t.file !== undefined) {
                            files.push({ file: t.file, id: t.id });
                        } else if (!Array.isArray(t.url)) {
                            const url = t.url as string;
                            const blob = await (await fetch(url)).blob();
                            const isEmptyTrack = t.id === '-';
                            const file = new File([blob], isEmptyTrack ? '.srt' : `${t.name}.${t.extension}`);
                            const fileWithId = { file, id: t.id };
                            files.push(fileWithId);
                            if (!isEmptyTrack) {
                                cachedSubtitleFiles.push(fileWithId);
                            }
                        } else {
                            asbWarn(
                                'app/subtitles',
                                'unexpected url array when downloading subtitle track selection',
                                t
                            );
                        }
                    }
                    if (handleFiles({ files })) {
                        const language = tracks.find((track) => embeddedSubtitleIdsRef.current.has(track.id))?.language;
                        if (language && settingsRef.current.rememberEmbeddedLanguage) {
                            const embeddedLanguage =
                                embeddedTrackLanguages.find(
                                    ({ name }) => name === embeddedTrackLanguageDisplayName(language)
                                )?.code ?? language;
                            onSettingsChanged({ embeddedLanguage });
                        }
                        await saveCachedSubtitleFilesToFileSession(cachedSubtitleFiles);
                        await promoteBufferedHandlesInFileSession(files.map((f) => f.id));
                        closeSubtitleTrackSelector();
                    }
                } catch (e) {
                    asbError('app/selector', 'Failed to confirm track selection:', e);
                    handleError(e);
                } finally {
                    setSubtitleTrackSelectorDisabled(false);
                }
            })();
        },
        [
            handleFiles,
            handleError,
            closeSubtitleTrackSelector,
            promoteBufferedHandlesInFileSession,
            saveCachedSubtitleFilesToFileSession,
            setSubtitleTrackSelectorDisabled,
            onSettingsChanged,
        ]
    );

    const handleOpenSubtitleTrackSelection = useCallback(
        (files: FileWithId[]) => {
            if (handleFiles({ files })) {
                void promoteBufferedHandlesInFileSession(files.map((f) => f.id));
                closeSubtitleTrackSelector();
            } else {
                void clearBufferedHandlesInFileSession();
            }
        },
        [
            promoteBufferedHandlesInFileSession,
            clearBufferedHandlesInFileSession,
            closeSubtitleTrackSelector,
            handleFiles,
        ]
    );

    const handleOpenSubtitleTrackSelector = useCallback(() => {
        const videoFile = sourcesRef.current.videoFile?.file;
        if (
            settings.loadEmbeddedSubtitles &&
            videoFile &&
            subtitleExtractionRef.current?.file !== videoFile &&
            isMatroskaFile(videoFile.name) &&
            (embeddedSubtitleVideoRef.current !== videoFile ||
                embeddedSubtitleLanguageRef.current !==
                    (settings.rememberEmbeddedLanguage && settings.loadPreferredEmbeddedLanguageOnly
                        ? settings.embeddedLanguage
                        : undefined))
        ) {
            populateEmbeddedSubtitleTracks(videoFile, false);
        }
        if (!settings.loadEmbeddedSubtitles) {
            const embeddedIds = embeddedSubtitleIdsRef.current;
            setSubtitleTrackSelectorTracks((tracks) => tracks.filter((track) => !embeddedIds.has(track.id)));
            embeddedSubtitleVideoRef.current = undefined;
            embeddedSubtitleIdsRef.current = new Set();
        }
        setSubtitleTrackSelectorSelectedTrackIds(
            sourcesRef.current.subtitleFiles
                .map((file) => file.id)
                .filter((id) => subtitleTrackSelectorTracks.some((track) => track.id === id))
        );
        openSubtitleTrackSelector();
    }, [
        openSubtitleTrackSelector,
        populateEmbeddedSubtitleTracks,
        setSubtitleTrackSelectorSelectedTrackIds,
        subtitleTrackSelectorTracks,
        settings.loadEmbeddedSubtitles,
        settings.rememberEmbeddedLanguage,
        settings.loadPreferredEmbeddedLanguageOnly,
        settings.embeddedLanguage,
        setSubtitleTrackSelectorTracks,
    ]);

    const handleCloseSubtitleTrackSelector = useCallback(() => {
        closeSubtitleTrackSelector();
        void clearBufferedHandlesInFileSession();
    }, [closeSubtitleTrackSelector, clearBufferedHandlesInFileSession]);

    useEffect(() => {
        return keyBinder.bindSelectSubtitleTrack(
            () => {
                handleOpenSubtitleTrackSelector();
            },
            () => ankiDialogOpen,
            false
        );
    }, [keyBinder, ankiDialogOpen, handleOpenSubtitleTrackSelector]);

    const loading = loadingSources.length !== 0;
    const nothingLoaded =
        tab === undefined &&
        ((loading && !videoContainerRef.current) || (sources.subtitleFiles.length === 0 && !sources.videoFile));
    const appBarHidden = sources.videoFile !== undefined && ((theaterMode && !videoPopOut) || videoFullscreen);
    const effectiveDrawerOpen = copyHistoryOpen && !videoFullscreen;
    const headerControls = useMemo(
        () => (
            <Bar
                title={fileName || 'asbplayer-jiten'}
                drawerWidth={drawerWidth}
                drawerOpen={effectiveDrawerOpen}
                hidden={false}
                controlsOnly={appBarHidden}
                subtitleFiles={sources.subtitleFiles}
                onOpenCopyHistory={handleOpenCopyHistory}
                onDownloadSubtitleFilesAsSrt={handleDownloadSubtitleFilesAsSrt}
                onDownloadSubtitleTimeline={handleDownloadSubtitleTimeline}
                onOpenSettings={handleOpenSettings}
                lastError={lastError}
                onCopyLastError={handleCopyLastError}
            />
        ),
        [
            fileName,
            drawerWidth,
            effectiveDrawerOpen,
            appBarHidden,
            sources.subtitleFiles,
            handleOpenCopyHistory,
            handleDownloadSubtitleFilesAsSrt,
            handleDownloadSubtitleTimeline,
            handleOpenSettings,
            lastError,
            handleCopyLastError,
        ]
    );

    if (!i18nInitialized) {
        return null;
    }
    return (
        <StyledEngineProvider injectFirst>
            <ThemeProvider theme={theme}>
                <CssBaseline />
                <SubtitleStudyStyles settings={settings} />
                <div
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragEnter={handleDragEnter}
                    onDragLeave={handleDragLeave}
                >
                    {!sources.videoFile && (
                        <Alert open={alertOpen} useAppLogo={false} onClose={handleAlertClosed} severity={alertSeverity}>
                            {alert}
                        </Alert>
                    )}
                    {inVideoPlayer ? (
                        <>
                            <RenderVideo
                                searchParams={searchParams}
                                settingsProvider={settingsProvider}
                                settings={settings}
                                extension={extension}
                                miningContext={miningContext}
                                ankiDialogOpen={ankiDialogOpen}
                                seekRequest={videoPlayerSeekRequest}
                                onSettingsChanged={onSettingsChanged}
                                profile={profile}
                                onAnkiDialogRequest={handleAnkiDialogRequestFromVideoPlayer}
                                onAnkiDialogRewind={handleAnkiDialogRewindFromVideoPlayer}
                                onError={handleError}
                            />
                            {ankiDialogCard && (
                                <AnkiDialog
                                    jiten={{
                                        target: dialogJitenTarget,
                                        targets: dialogJitenBatch?.targets,
                                        result: jitenResult,
                                        onMineNewWords: handleJitenMineNewWords,
                                        loadNewWords: loadJitenNewWords,
                                        preventMultipleWords: settings.jitenPreventMultipleWords,
                                        showUnmatchedAttachmentTarget: settings.jitenShowUnmatchedAttachmentTarget,
                                    }}
                                    open={ankiDialogOpen}
                                    disabled={ankiDialogDisabled}
                                    card={ankiDialogCard}
                                    settings={settings}
                                    onCancel={handleAnkiDialogCancel}
                                    onProceed={handleAnkiDialogProceed}
                                    onCopyToClipboard={handleCopyToClipboard}
                                    mp3Encoder={mp3Encoder}
                                    {...profilesContext}
                                />
                            )}
                        </>
                    ) : (
                        <Paper square sx={{ backgroundColor: 'background.default' }}>
                            <CopyHistory
                                items={copyHistoryItems}
                                open={effectiveDrawerOpen}
                                drawerWidth={drawerWidth}
                                onClose={handleCloseCopyHistory}
                                onDelete={deleteCopyHistoryItem}
                                onDeleteAll={deleteAllCopyHistoryItems}
                                onClipAudio={handleDownloadAudio}
                                onDownloadImage={handleDownloadImage}
                                onDownloadSectionAsSrt={handleDownloadCopyHistorySectionAsSrt}
                                onSelect={handleSelectCopyHistoryItem}
                            />
                            {ankiDialogCard && (
                                <AnkiDialog
                                    jiten={{
                                        target: dialogJitenTarget,
                                        targets: dialogJitenBatch?.targets,
                                        result: jitenResult,
                                        onMineNewWords: handleJitenMineNewWords,
                                        loadNewWords: loadJitenNewWords,
                                        preventMultipleWords: settings.jitenPreventMultipleWords,
                                        showUnmatchedAttachmentTarget: settings.jitenShowUnmatchedAttachmentTarget,
                                    }}
                                    open={ankiDialogOpen}
                                    disabled={ankiDialogDisabled}
                                    card={ankiDialogCard}
                                    settings={settings}
                                    onCancel={handleAnkiDialogCancel}
                                    onProceed={handleAnkiDialogProceed}
                                    onOpenSettings={handleOpenSettings}
                                    onCopyToClipboard={handleCopyToClipboard}
                                    mp3Encoder={mp3Encoder}
                                    {...profilesContext}
                                />
                            )}
                            <SettingsDialog
                                extension={extension}
                                open={settingsDialogOpen}
                                onSettingsChanged={onSettingsChanged}
                                onClose={handleCloseSettings}
                                logProvider={logProvider}
                                settings={settings}
                                activeProfile={profilesContext.activeProfile}
                                scrollToId={settingsDialogScrollToId}
                                {...profilesContext}
                            />
                            {globalState && (
                                <VideoDataSyncDialog
                                    open={subtitleTrackSelectorOpen}
                                    disabled={subtitleTrackSelectorDisabled}
                                    isLoading={false}
                                    suggestedName={sources.videoFile?.file?.name ?? ''}
                                    subtitleTracks={subtitleTrackSelectorTracks}
                                    selectedSubtitleTrackIds={subtitleTrackSelectorSelectedTrackIds}
                                    onSelectedSubtitleTrackIds={setSubtitleTrackSelectorSelectedTrackIds}
                                    defaultCheckboxState={false}
                                    error=""
                                    openReason={VideoDataUiOpenReason.userRequested}
                                    profiles={profilesContext.profiles}
                                    activeProfile={profilesContext.activeProfile}
                                    onlineSubtitleSourceConfig={globalState.onlineSubtitleSourceConfig}
                                    clientId="asbplayer-app"
                                    hasSeenFtue={true}
                                    hideRememberTrackPreferenceToggle={true}
                                    hideVideoNameTextField={true}
                                    fileSelector={fileSelector}
                                    onCancel={handleCloseSubtitleTrackSelector}
                                    onOpenFiles={handleOpenSubtitleTrackSelection}
                                    onOpenSettings={handleOpenSubtitleSettings}
                                    onConfirm={handleConfirmSubtitleTrackSelection}
                                    onDismissFtue={() => {}}
                                    onOnlineSourceConfigChanged={(state) =>
                                        onGlobalStateChanged({
                                            onlineSubtitleSourceConfig: {
                                                ...globalState.onlineSubtitleSourceConfig,
                                                ...state,
                                            },
                                        })
                                    }
                                    onSubtitleTracks={setSubtitleTrackSelectorTracks}
                                    onSetActiveProfile={profilesContext.onSetActiveProfile}
                                />
                            )}
                            <NeedRefreshDialog
                                open={needRefreshDialogOpen}
                                onRefresh={updateFromServiceWorker}
                                onClose={handleCloseNeedRefreshDialog}
                            />
                            {!appBarHidden && headerControls}
                            <input
                                ref={fileInputRef}
                                onChange={handleFileInputChange}
                                type="file"
                                accept={inputAcceptFileExtensions}
                                multiple
                                hidden
                            />
                            <input
                                ref={bufferedFileInputRef}
                                onChange={handleBufferedFileInputChange}
                                type="file"
                                accept={inputAcceptFileExtensions}
                                multiple
                                hidden
                            />
                            <Content drawerWidth={drawerWidth} drawerOpen={effectiveDrawerOpen}>
                                <Paper square style={{ width: '100%', height: '100%', position: 'relative' }}>
                                    {nothingLoaded && (
                                        <LandingPage
                                            latestExtensionVersion={latestExtensionVersion}
                                            extensionUrl={extensionUrl}
                                            extension={extension}
                                            loading={loading}
                                            dragging={dragging}
                                            appBarHidden={appBarHidden}
                                            videoElements={availableTabs ?? []}
                                            canRestoreLastSession={canRestoreLastFileSession}
                                            onFileSelector={handleFileSelector}
                                            onVideoElementSelected={handleVideoElementSelected}
                                            onRestoreLastSession={handleRestoreLastSession}
                                            onOpenSubtitleTrackSelector={handleOpenSubtitleTrackSelector}
                                        />
                                    )}
                                    <DragOverlay
                                        dragging={dragging}
                                        appBarHidden={appBarHidden}
                                        logoUrl={logoUrl}
                                        loading={loading}
                                    />
                                </Paper>
                                <Player
                                    ref={playerRef}
                                    origin={origin}
                                    subtitleReader={subtitleReader}
                                    subtitles={subtitles}
                                    mediaId={extension.id}
                                    settings={settings}
                                    settingsProvider={settingsProvider}
                                    onSettingsChanged={onSettingsChanged}
                                    profile={profile}
                                    playbackPreferences={playbackPreferences}
                                    onCopy={handleCopy}
                                    onError={handleError}
                                    onUnloadVideo={handleUnloadVideo}
                                    onLoaded={handleFilesLoaded}
                                    onTabSelected={handleTabSelected}
                                    onAnkiDialogRequest={handleAnkiDialogRequest}
                                    onAnkiDialogRewind={handleAnkiDialogRewind}
                                    onAppBarToggle={handleAppBarToggle}
                                    onHideSubtitlePlayer={handleHideSubtitlePlayer}
                                    onVideoPopOut={handleVideoPopOut}
                                    onSubtitles={
                                        setSubtitles as React.Dispatch<
                                            React.SetStateAction<DisplaySubtitleModel[] | undefined>
                                        >
                                    }
                                    onLoadFiles={handleFileSelector}
                                    onLoadSubtitles={handleOpenSubtitleTrackSelector}
                                    subtitleExtractionProgress={subtitleExtractionProgress}
                                    onCancelSubtitleExtraction={cancelSubtitleExtraction}
                                    tab={tab}
                                    availableTabs={availableTabs ?? []}
                                    sources={sources}
                                    jumpToSubtitle={jumpToSubtitle}
                                    onJumpToSubtitleHandled={handleJumpToSubtitleHandled}
                                    rewindSubtitle={rewindSubtitle}
                                    renderVideo={(
                                        videoFile,
                                        channel,
                                        disableVideoKeyEvents,
                                        playerSubtitles,
                                        assTracks
                                    ) => (
                                        <VideoPlayer
                                            key={videoFile}
                                            embedded
                                            playerSubtitles={playerSubtitles}
                                            assTracks={assTracks}
                                            topControls={appBarHidden ? headerControls : undefined}
                                            subtitleExtractionProgress={subtitleExtractionProgress}
                                            onCancelSubtitleExtraction={cancelSubtitleExtraction}
                                            videoFile={videoFile}
                                            channel={channel}
                                            popOut={false}
                                            settingsProvider={settingsProvider}
                                            settings={settings}
                                            extension={extension}
                                            miningContext={miningContext}
                                            ankiDialogOpen={ankiDialogOpen}
                                            seekRequest={videoPlayerSeekRequest}
                                            disableKeyEvents={disableVideoKeyEvents}
                                            onSettingsChanged={onSettingsChanged}
                                            profile={profile}
                                            onAnkiDialogRequest={handleAnkiDialogRequestFromVideoPlayer}
                                            onAnkiDialogRewind={handleAnkiDialogRewindFromVideoPlayer}
                                            onError={handleError}
                                        />
                                    )}
                                    videoContainerRef={videoContainerRef}
                                    videoChannelRef={videoChannelRef}
                                    extension={extension}
                                    drawerOpen={effectiveDrawerOpen}
                                    appBarHidden={appBarHidden}
                                    showCopyButton={tab === undefined}
                                    videoFullscreen={videoFullscreen}
                                    hideSubtitlePlayer={hideSubtitlePlayer || videoFullscreen}
                                    videoPopOut={videoPopOut}
                                    disableKeyEvents={disableKeyEvents}
                                    miningContext={miningContext}
                                    keyBinder={keyBinder}
                                    webSocketClient={webSocketClient}
                                    playbackTimelineFileName={fileName}
                                    playbackTimelineModeLabels={{
                                        normal: t('controls.normalMode'),
                                        fastForward: t('controls.fastForwardMode'),
                                        condensed: t('controls.condensedMode'),
                                        autoPauseAtStart: t('settings.autoPauseAtSubtitleStart'),
                                        autoPauseAtEnd: t('settings.autoPauseAtSubtitleEnd'),
                                        repeat: t('controls.repeatMode'),
                                    }}
                                    playbackTimelineOptionLabels={{
                                        title: t('settings.playbackModes'),
                                        subtitleTrack: (trackNumber) =>
                                            t('settings.subtitleTrackChoice', { trackNumber }),
                                        subtitleTriggerStartOffset: t('settings.subtitleTriggerStartOffset'),
                                        subtitleTriggerEndOffset: t('settings.subtitleTriggerEndOffset'),
                                        subtitleTriggerGapEndOffset: t('settings.subtitleTriggerGapEndOffset'),
                                        subtitleTriggerGapStartOffset: t('settings.subtitleTriggerGapStartOffset'),
                                        condensedPlaybackMinimumSkipInterval: t(
                                            'settings.condensedPlaybackMinimumSkipInterval'
                                        ),
                                        fastForwardPlaybackMinimumSkipInterval: t(
                                            'settings.fastForwardPlaybackMinimumSkipInterval'
                                        ),
                                    }}
                                />
                            </Content>
                        </Paper>
                    )}
                </div>
            </ThemeProvider>
        </StyledEngineProvider>
    );
}

export default App;
