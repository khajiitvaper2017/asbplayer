const compressorThresholdDb = -24;
const compressorRatio = 2.5;
const compressorAttackMs = 5;
const compressorReleaseMs = 120;
const minLinearLevel = 1e-8;

export interface CompressionInfo {
    thresholdDb: number;
    ratio: number;
    attackMs: number;
    releaseMs: number;
    maxReductionDb: number;
    averageReductionDb: number;
}

const dbToLinear = (db: number) => Math.pow(10, db / 20);
const linearToDb = (value: number) => 20 * Math.log10(Math.max(minLinearLevel, value));

export function applyGainToChannels(channels: Float32Array[], gain: number) {
    for (const channel of channels) {
        for (let i = 0; i < channel.length; ++i) {
            channel[i] *= gain;
        }
    }
}

export function applyLightCompressionToChannels(channels: Float32Array[], sampleRate: number): CompressionInfo {
    if (channels.length === 0 || channels[0].length === 0) {
        return {
            thresholdDb: compressorThresholdDb,
            ratio: compressorRatio,
            attackMs: compressorAttackMs,
            releaseMs: compressorReleaseMs,
            maxReductionDb: 0,
            averageReductionDb: 0,
        };
    }

    const attackCoeff = Math.exp(-1 / ((compressorAttackMs / 1000) * sampleRate));
    const releaseCoeff = Math.exp(-1 / ((compressorReleaseMs / 1000) * sampleRate));
    let gain = 1;
    let maxReductionDb = 0;
    let reductionDbTotal = 0;
    let reductionSamples = 0;

    for (let i = 0; i < channels[0].length; ++i) {
        let detector = 0;

        for (const channel of channels) {
            detector = Math.max(detector, Math.abs(channel[i]));
        }

        const detectorDb = linearToDb(detector);
        let targetGain = 1;

        if (detectorDb > compressorThresholdDb) {
            const compressedDb = compressorThresholdDb + (detectorDb - compressorThresholdDb) / compressorRatio;
            targetGain = dbToLinear(compressedDb - detectorDb);
        }

        const coeff = targetGain < gain ? attackCoeff : releaseCoeff;
        gain = coeff * gain + (1 - coeff) * targetGain;

        for (const channel of channels) {
            channel[i] *= gain;
        }

        const reductionDb = Math.max(0, -linearToDb(gain));
        maxReductionDb = Math.max(maxReductionDb, reductionDb);
        reductionDbTotal += reductionDb;
        reductionSamples += 1;
    }

    return {
        thresholdDb: compressorThresholdDb,
        ratio: compressorRatio,
        attackMs: compressorAttackMs,
        releaseMs: compressorReleaseMs,
        maxReductionDb,
        averageReductionDb: reductionSamples === 0 ? 0 : reductionDbTotal / reductionSamples,
    };
}
