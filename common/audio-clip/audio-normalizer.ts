const targetPeakAmplitude = 0.95;
const maxPeakNormalizationGain = 4;

const clampTargetPeak = (targetPeak: number) =>
    Number.isFinite(targetPeak) ? Math.max(0, Math.min(1, targetPeak)) : targetPeakAmplitude;

export function peakNormalizationGainForChannels(
    channels: Float32Array[],
    targetPeak: number = targetPeakAmplitude,
    maxGain: number = maxPeakNormalizationGain
) {
    const clampedTargetPeak = clampTargetPeak(targetPeak);
    let peak = 0;

    for (const channel of channels) {
        for (const sample of channel) {
            peak = Math.max(peak, Math.abs(sample));
        }
    }

    if (peak <= 0) {
        return 1;
    }

    return Math.min(maxGain, Math.max(1, clampedTargetPeak / peak));
}

export function applyPeakNormalizationToChannels(channels: Float32Array[], targetPeak: number = targetPeakAmplitude) {
    const gain = peakNormalizationGainForChannels(channels, targetPeak);

    if (gain === 1) {
        return false;
    }

    for (const channel of channels) {
        for (let i = 0; i < channel.length; ++i) {
            channel[i] *= gain;
        }
    }

    return true;
}
