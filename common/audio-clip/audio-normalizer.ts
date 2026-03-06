const targetPeakAmplitude = 0.95;
const maxPeakNormalizationGain = 4;

export function peakNormalizationGainForChannels(
    channels: Float32Array[],
    targetPeak: number = targetPeakAmplitude,
    maxGain: number = maxPeakNormalizationGain
) {
    let peak = 0;

    for (const channel of channels) {
        for (const sample of channel) {
            peak = Math.max(peak, Math.abs(sample));
        }
    }

    if (peak <= 0) {
        return 1;
    }

    // Only boost quiet clips so already-loud recordings avoid another lossy re-encode.
    return Math.min(maxGain, Math.max(1, targetPeak / peak));
}

const audioBufferChannels = (audioBuffer: AudioBuffer) => {
    const channels: Float32Array[] = [];

    for (let i = 0; i < audioBuffer.numberOfChannels; ++i) {
        channels.push(audioBuffer.getChannelData(i));
    }

    return channels;
};

export async function normalizeAudioBlob(blob: Blob, mimeType: string) {
    const audioContext = new AudioContext();
    let destination: MediaStreamAudioDestinationNode | undefined;

    try {
        const audioBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
        const gain = peakNormalizationGainForChannels(audioBufferChannels(audioBuffer));

        if (gain === 1) {
            return blob;
        }

        if (audioContext.state === 'suspended') {
            await audioContext.resume();
        }

        destination = audioContext.createMediaStreamDestination();
        const source = audioContext.createBufferSource();
        const gainNode = audioContext.createGain();
        source.buffer = audioBuffer;
        gainNode.gain.value = gain;
        source.connect(gainNode);
        gainNode.connect(destination);

        return await new Promise<Blob>((resolve, reject) => {
            const recorder = new MediaRecorder(destination!.stream, { mimeType });
            const chunks: BlobPart[] = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    chunks.push(e.data);
                }
            };
            recorder.onerror = (e) => reject(e.error ?? new Error('Could not normalize audio'));
            recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
            source.onended = () => {
                if (recorder.state !== 'inactive') {
                    recorder.stop();
                }
            };
            recorder.start();
            source.start();
        });
    } finally {
        destination?.stream.getTracks().forEach((track) => track.stop());
        await audioContext.close().catch(() => undefined);
    }
}
