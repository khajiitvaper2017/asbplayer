const defaultTargetLufs = -16;
const minTargetLufs = -30;
const maxTargetLufs = -8;
const lufsOffset = -0.691;
const absoluteGateLufs = -70;
const relativeGateOffsetLufs = 10;
const maxLoudnessNormalizationGain = 4;
const loudnessWindowMs = 400;
const loudnessHopMs = 100;
const highShelfFrequencyHz = 1500;
const highShelfGainDb = 4;
const highShelfQ = 1 / Math.SQRT2;
const highPassFrequencyHz = 38;
const highPassQ = 0.5;
const noGainEpsilon = 0.0001;

export interface LoudnessNormalizationInfo {
    measuredLufs?: number;
    targetLufs: number;
    peak: number;
    gain: number;
}

type BiquadCoefficients = {
    b0: number;
    b1: number;
    b2: number;
    a1: number;
    a2: number;
};

const clampTargetLufs = (targetLufs: number) =>
    Number.isFinite(targetLufs) ? Math.max(minTargetLufs, Math.min(maxTargetLufs, targetLufs)) : defaultTargetLufs;

const powerToLufs = (power: number) => lufsOffset + 10 * Math.log10(power);

const normalizeBiquadCoefficients = (
    b0: number,
    b1: number,
    b2: number,
    a0: number,
    a1: number,
    a2: number
): BiquadCoefficients => ({
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
});

const highShelfCoefficients = (sampleRate: number): BiquadCoefficients => {
    const w0 = (2 * Math.PI * highShelfFrequencyHz) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const amplitude = Math.sqrt(Math.pow(10, highShelfGainDb / 20));
    const alpha = sinW0 / (2 * highShelfQ);
    const beta = 2 * Math.sqrt(amplitude) * alpha;

    return normalizeBiquadCoefficients(
        amplitude * ((amplitude + 1) + (amplitude - 1) * cosW0 + beta),
        -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cosW0),
        amplitude * ((amplitude + 1) + (amplitude - 1) * cosW0 - beta),
        (amplitude + 1) - (amplitude - 1) * cosW0 + beta,
        2 * ((amplitude - 1) - (amplitude + 1) * cosW0),
        (amplitude + 1) - (amplitude - 1) * cosW0 - beta
    );
};

const highPassCoefficients = (sampleRate: number): BiquadCoefficients => {
    const w0 = (2 * Math.PI * highPassFrequencyHz) / sampleRate;
    const cosW0 = Math.cos(w0);
    const sinW0 = Math.sin(w0);
    const alpha = sinW0 / (2 * highPassQ);

    return normalizeBiquadCoefficients(
        (1 + cosW0) / 2,
        -(1 + cosW0),
        (1 + cosW0) / 2,
        1 + alpha,
        -2 * cosW0,
        1 - alpha
    );
};

const applyBiquad = (input: Float32Array, coefficients: BiquadCoefficients) => {
    const output = new Float32Array(input.length);
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;

    for (let i = 0; i < input.length; ++i) {
        const x0 = input[i];
        const y0 =
            coefficients.b0 * x0 +
            coefficients.b1 * x1 +
            coefficients.b2 * x2 -
            coefficients.a1 * y1 -
            coefficients.a2 * y2;
        output[i] = y0;
        x2 = x1;
        x1 = x0;
        y2 = y1;
        y1 = y0;
    }

    return output;
};

const kWeightedChannels = (channels: Float32Array[], sampleRate: number) => {
    const shelf = highShelfCoefficients(sampleRate);
    const highPass = highPassCoefficients(sampleRate);
    return channels.map((channel) => applyBiquad(applyBiquad(channel, shelf), highPass));
};

const integratedBlockPowers = (channels: Float32Array[], sampleRate: number) => {
    if (channels.length === 0 || channels[0].length === 0) {
        return [];
    }

    const weightedChannels = kWeightedChannels(channels, sampleRate);
    const blockLength = Math.max(1, Math.min(weightedChannels[0].length, Math.round((loudnessWindowMs / 1000) * sampleRate)));
    const hopLength = Math.max(1, Math.round((loudnessHopMs / 1000) * sampleRate));
    const powers: number[] = [];

    const blockPower = (start: number, end: number) => {
        let total = 0;
        const length = end - start;

        for (const channel of weightedChannels) {
            let channelPower = 0;
            for (let i = start; i < end; ++i) {
                const sample = channel[i];
                channelPower += sample * sample;
            }
            total += channelPower / length;
        }

        return total;
    };

    if (weightedChannels[0].length <= blockLength) {
        powers.push(blockPower(0, weightedChannels[0].length));
        return powers;
    }

    for (let start = 0; start + blockLength <= weightedChannels[0].length; start += hopLength) {
        powers.push(blockPower(start, start + blockLength));
    }

    return powers;
};

const peakForChannels = (channels: Float32Array[]) => {
    let peak = 0;

    for (const channel of channels) {
        for (const sample of channel) {
            peak = Math.max(peak, Math.abs(sample));
        }
    }

    return peak;
};

export function integratedLufsForChannels(channels: Float32Array[], sampleRate: number) {
    const blockPowers = integratedBlockPowers(channels, sampleRate).filter((power) => power > 0);
    const absoluteGated = blockPowers.filter((power) => powerToLufs(power) >= absoluteGateLufs);

    if (absoluteGated.length === 0) {
        return undefined;
    }

    const preliminaryPower = absoluteGated.reduce((sum, power) => sum + power, 0) / absoluteGated.length;
    const preliminaryLufs = powerToLufs(preliminaryPower);
    const relativeGate = preliminaryLufs - relativeGateOffsetLufs;
    const relativeGated = absoluteGated.filter((power) => powerToLufs(power) >= relativeGate);
    const integratedPower =
        (relativeGated.length > 0 ? relativeGated : absoluteGated).reduce((sum, power) => sum + power, 0) /
        (relativeGated.length > 0 ? relativeGated.length : absoluteGated.length);

    return powerToLufs(integratedPower);
}

export function loudnessNormalizationGainForChannels(
    channels: Float32Array[],
    sampleRate: number,
    targetLufs: number = defaultTargetLufs,
    maxGain: number = maxLoudnessNormalizationGain
) {
    return loudnessNormalizationInfoForChannels(channels, sampleRate, targetLufs, maxGain).gain;
}

export function loudnessNormalizationInfoForChannels(
    channels: Float32Array[],
    sampleRate: number,
    targetLufs: number = defaultTargetLufs,
    maxGain: number = maxLoudnessNormalizationGain
): LoudnessNormalizationInfo {
    const measuredLufs = integratedLufsForChannels(channels, sampleRate);
    const clampedTargetLufs = clampTargetLufs(targetLufs);
    const peak = peakForChannels(channels);

    if (measuredLufs === undefined) {
        return {
            measuredLufs,
            targetLufs: clampedTargetLufs,
            peak,
            gain: 1,
        };
    }

    const loudnessGain = Math.pow(10, (clampedTargetLufs - measuredLufs) / 20);
    const safeGain = peak > 0 ? 1 / peak : loudnessGain;
    return {
        measuredLufs,
        targetLufs: clampedTargetLufs,
        peak,
        gain: Math.min(maxGain, loudnessGain, safeGain),
    };
}

export function applyGainToChannels(channels: Float32Array[], gain: number) {
    for (const channel of channels) {
        for (let i = 0; i < channel.length; ++i) {
            channel[i] *= gain;
        }
    }
}

export function applyLoudnessNormalizationToChannels(
    channels: Float32Array[],
    sampleRate: number,
    targetLufs: number = defaultTargetLufs
) {
    const { gain } = loudnessNormalizationInfoForChannels(channels, sampleRate, targetLufs);

    if (Math.abs(gain - 1) <= noGainEpsilon) {
        return false;
    }

    applyGainToChannels(channels, gain);
    return true;
}
