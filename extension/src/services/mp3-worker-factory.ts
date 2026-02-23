let workerBlobUrlPromise: Promise<string> | undefined;
const workerScriptUrl = browser.runtime.getURL('/mp3-encoder-worker.js' as any);

const workerBlobUrl = async () => {
    if (!workerBlobUrlPromise) {
        workerBlobUrlPromise = (async () => {
            const response = await fetch(workerScriptUrl);

            if (!response.ok) {
                throw new Error(`Failed to load MP3 worker script: ${response.status}`);
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

export const mp3WorkerFactory = async () => {
    return new Worker(await workerBlobUrl());
};
