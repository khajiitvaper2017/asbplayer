let workerBlobUrlPromise: Promise<string> | undefined;
const workerScriptUrl = browser.runtime.getURL('/gif-encoder-worker.js' as any);

const workerBlobUrl = async () => {
    if (!workerBlobUrlPromise) {
        workerBlobUrlPromise = (async () => {
            const response = await fetch(workerScriptUrl);

            if (!response.ok) {
                throw new Error(`Failed to load GIF worker script: ${response.status}`);
            }

            const code = await response.text();
            const blob = new Blob([code], { type: 'application/javascript' });
            return URL.createObjectURL(blob);
        })().catch((error) => {
            workerBlobUrlPromise = undefined;
            throw error;
        });
    }

    return await workerBlobUrlPromise;
};

export const gifEncoderWorkerFactory = async () => {
    return new Worker(await workerBlobUrl());
};
