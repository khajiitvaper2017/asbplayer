import { applyLightCompressionToChannels } from './audio-normalizer';

export interface SerializableAudioBuffer {
    channels: Float32Array[];
    numberOfChannels: number;
    length: number;
    sampleRate: number;
}

export interface Mp3EncodeOptions {
    normalizeAudio?: boolean;
    monoAudio?: boolean;
}

export function mixChannelsToMono(channels: Float32Array[]) {
    if (channels.length <= 1) {
        return channels;
    }

    const monoChannel = new Float32Array(channels[0].length);

    for (let i = 0; i < channels[0].length; ++i) {
        let sum = 0;

        for (const channel of channels) {
            sum += channel[i];
        }

        monoChannel[i] = sum / channels.length;
    }

    return [monoChannel];
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
            const inputChannels = audioBuffer.numberOfChannels;

            for (let i = 0; i < audioBuffer.numberOfChannels; ++i) {
                channels.push(audioBuffer.getChannelData(i).slice());
            }

            const outputChannels = options.monoAudio ? mixChannelsToMono(channels) : channels;
            const compressionInfo = options.normalizeAudio
                ? applyLightCompressionToChannels(outputChannels, audioBuffer.sampleRate)
                : undefined;

            console.info('[asbplayer][audio] Encoding MP3', {
                blobType: blob.type,
                blobSize: blob.size,
                sampleRate: audioBuffer.sampleRate,
                inputChannels,
                outputChannels: outputChannels.length,
                durationMs: Math.round((audioBuffer.length / audioBuffer.sampleRate) * 1000),
                normalizeAudio: options.normalizeAudio === true,
                monoAudio: options.monoAudio === true,
                compressionInfo,
            });

            const workerValue = workerFactory();
            const worker = workerValue instanceof Worker ? workerValue : await workerValue;

            return await new Promise<Blob>((resolve, reject) => {
                worker.postMessage({
                    command: 'encode',
                    audioBuffer: {
                        channels: outputChannels,
                        numberOfChannels: outputChannels.length,
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
