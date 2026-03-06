import { Mp3Encoder } from 'lamejs';
import { SerializableAudioBuffer } from './mp3-encoder';

const samplesPerFrame = 1152;
const bitRate = 192;

const float32ToInt16 = (channel: Float32Array) => {
    const samples = new Int16Array(channel.length);

    for (let i = 0; i < channel.length; ++i) {
        const sample = Math.max(-1, Math.min(1, channel[i]));
        samples[i] = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0;
    }

    return samples;
};

async function encode(audioBuffer: SerializableAudioBuffer) {
    let left: Int16Array;
    let right: Int16Array | null = null;

    if (audioBuffer.numberOfChannels === 1) {
        left = float32ToInt16(audioBuffer.channels[0]);
    } else if (audioBuffer.numberOfChannels === 2) {
        left = float32ToInt16(audioBuffer.channels[0]);
        right = float32ToInt16(audioBuffer.channels[1]);
    } else {
        throw new Error('Unsupport number of channels ' + audioBuffer.numberOfChannels);
    }

    const buffer: Int8Array[] = [];
    const encoder = new Mp3Encoder(audioBuffer.numberOfChannels, audioBuffer.sampleRate, bitRate);
    let remaining = left.length;

    for (var i = 0; remaining >= samplesPerFrame; i += samplesPerFrame) {
        const rightSubArray = right === null ? null : right.subarray(i, i + samplesPerFrame);
        var mp3Buff = encoder.encodeBuffer(left.subarray(i, i + samplesPerFrame), rightSubArray);

        if (mp3Buff.length > 0) {
            buffer.push(new Int8Array(mp3Buff));
        }

        remaining -= samplesPerFrame;
    }

    const data = encoder.flush();

    if (data.length > 0) {
        buffer.push(new Int8Array(data));
    }

    return buffer;
}

export function onMessage() {
    onmessage = async (e) => {
        postMessage({
            command: 'finished',
            buffer: await encode(e.data.audioBuffer),
        });
    };
}

onMessage();
