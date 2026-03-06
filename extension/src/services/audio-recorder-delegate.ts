import {
    ExtensionToOffscreenDocumentCommand,
    ExtensionToVideoCommand,
    StartRecordingAudioMessage,
    StartRecordingAudioViaCaptureStreamMessage,
    StartRecordingAudioWithTimeoutMessage,
    StartRecordingAudioWithTimeoutViaCaptureStreamMessage,
    StartRecordingResponse,
    StopRecordingAudioMessage,
    StopRecordingResponse,
} from '@project/common';
import { ensureOffscreenAudioServiceDocument } from './offscreen-document';
import type { AudioEncodeOptions } from './audio-recorder-service';

export interface Requester {
    tabId: number;
    src: string;
}

export interface AudioRecorderDelegate {
    startWithTimeout: (
        time: number,
        encodeOptions: AudioEncodeOptions,
        requestId: string,
        { tabId, src }: Requester
    ) => Promise<StartRecordingResponse>;
    start: (requestId: string, requester: Requester) => Promise<StartRecordingResponse>;
    stop: (encodeOptions: AudioEncodeOptions, requester: Requester) => Promise<StopRecordingResponse>;
}

export class OffscreenAudioRecorder implements AudioRecorderDelegate {
    private _mediaStreamId(tabId: number): Promise<string> {
        return new Promise((resolve, reject) => {
            browser.tabCapture.getMediaStreamId(
                {
                    targetTabId: tabId,
                },
                (streamId) => resolve(streamId)
            );
        });
    }

    async startWithTimeout(
        time: number,
        encodeOptions: AudioEncodeOptions,
        requestId: string,
        { tabId, src }: Requester
    ): Promise<StartRecordingResponse> {
        await ensureOffscreenAudioServiceDocument();

        const streamId = await this._mediaStreamId(tabId);
        const command: ExtensionToOffscreenDocumentCommand<StartRecordingAudioWithTimeoutMessage> = {
            sender: 'asbplayer-extension-to-offscreen-document',
            message: {
                command: 'start-recording-audio-with-timeout',
                timeout: time,
                encodeAsMp3: encodeOptions.encodeAsMp3,
                normalizeAudio: encodeOptions.normalizeAudio,
                targetPeak: encodeOptions.targetPeak,
                streamId,
                requestId,
            },
        };
        return (await browser.runtime.sendMessage(command)) as StartRecordingResponse;
    }

    async start(requestId: string, { tabId, src }: Requester) {
        await ensureOffscreenAudioServiceDocument();
        const streamId = await this._mediaStreamId(tabId);

        const command: ExtensionToOffscreenDocumentCommand<StartRecordingAudioMessage> = {
            sender: 'asbplayer-extension-to-offscreen-document',
            message: {
                command: 'start-recording-audio',
                streamId,
                requestId,
            },
        };
        return (await browser.runtime.sendMessage(command)) as StartRecordingResponse;
    }

    async stop(encodeOptions: AudioEncodeOptions): Promise<StopRecordingResponse> {
        const command: ExtensionToOffscreenDocumentCommand<StopRecordingAudioMessage> = {
            sender: 'asbplayer-extension-to-offscreen-document',
            message: {
                command: 'stop-recording-audio',
                encodeAsMp3: encodeOptions.encodeAsMp3,
                normalizeAudio: encodeOptions.normalizeAudio,
                targetPeak: encodeOptions.targetPeak,
            },
        };
        return (await browser.runtime.sendMessage(command)) as StopRecordingResponse;
    }
}

export class CaptureStreamAudioRecorder implements AudioRecorderDelegate {
    async startWithTimeout(
        time: number,
        encodeOptions: AudioEncodeOptions,
        requestId: string,
        { tabId, src }: Requester
    ): Promise<StartRecordingResponse> {
        const command: ExtensionToVideoCommand<StartRecordingAudioWithTimeoutViaCaptureStreamMessage> = {
            sender: 'asbplayer-extension-to-video',
            message: {
                command: 'start-recording-audio-with-timeout',
                timeout: time,
                encodeAsMp3: encodeOptions.encodeAsMp3,
                normalizeAudio: encodeOptions.normalizeAudio,
                targetPeak: encodeOptions.targetPeak,
                requestId,
            },
            src,
        };

        return (await browser.tabs.sendMessage(tabId, command)) as StartRecordingResponse;
    }

    async start(requestId: string, { tabId, src }: Requester) {
        const command: ExtensionToVideoCommand<StartRecordingAudioViaCaptureStreamMessage> = {
            sender: 'asbplayer-extension-to-video',
            message: {
                command: 'start-recording-audio',
                requestId,
            },
            src,
        };
        return (await browser.tabs.sendMessage(tabId, command)) as StartRecordingResponse;
    }

    async stop(encodeOptions: AudioEncodeOptions, { tabId, src }: Requester): Promise<StopRecordingResponse> {
        const command: ExtensionToVideoCommand<StopRecordingAudioMessage> = {
            sender: 'asbplayer-extension-to-video',
            message: {
                command: 'stop-recording-audio',
                encodeAsMp3: encodeOptions.encodeAsMp3,
                normalizeAudio: encodeOptions.normalizeAudio,
                targetPeak: encodeOptions.targetPeak,
            },
            src,
        };
        return (await browser.tabs.sendMessage(tabId, command)) as StopRecordingResponse;
    }
}
