export const gifEncoderWorkerFactory = async () => {
    const code = await (await fetch(browser.runtime.getURL('/gif-encoder-worker.js'))).text();
    const blob = new Blob([code], { type: 'application/javascript' });
    return new Worker(URL.createObjectURL(blob));
};
