import { applyPeakNormalizationToChannels } from './audio-normalizer';

export interface SerializableAudioBuffer {
    channels: Float32Array[];
    numberOfChannels: number;
    length: number;
    sampleRate: number;
}

export interface Mp3EncodeOptions {
    normalizeAudio?: boolean;
    targetPeak?: number;
}

export default class Mp3Encoder {
    static async encode(
        blob: Blob,
        workerFactory: () => Worker | Promise<Worker>,
        options: Mp3EncodeOptions = {}
    ): Promise<Blob> {
        const audioContext = new AudioContext();

        try {
            const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
            const channels: Float32Array[] = [];

            for (let i = 0; i < audioBuffer.numberOfChannels; ++i) {
                channels.push(audioBuffer.getChannelData(i).slice());
            }

            if (options.normalizeAudio) {
                applyPeakNormalizationToChannels(channels, options.targetPeak);
            }

            const workerValue = workerFactory();
            const worker = workerValue instanceof Worker ? workerValue : await workerValue;

            return await new Promise<Blob>((resolve, reject) => {
                worker.postMessage({
                    command: 'encode',
                    audioBuffer: {
                        channels,
                        numberOfChannels: audioBuffer.numberOfChannels,
                        length: audioBuffer.length,
                        sampleRate: audioBuffer.sampleRate,
                    },
                });
                worker.onmessage = (e) => {
                    resolve(new Blob(e.data.buffer, { type: 'audio/mp3' }));
                    worker.terminate();
                };
                worker.onerror = (e) => {
                    const error = e?.error ?? new Error('MP3 encoding failed: ' + e?.message);
                    reject(error);
                    worker.terminate();
                };
            });
        } finally {
            await audioContext.close().catch(() => undefined);
        }
    }
}
