import { CancelledMediaFragmentDataRenderingError, MediaFragment } from '@project/common';
import { useEffect, useState } from 'react';

export const useImageData = ({ image, smoothTransition }: { image?: MediaFragment; smoothTransition: boolean }) => {
    const [dataUrl, setDataUrl] = useState<string>('');
    const [width, setWidth] = useState<number>(0);
    const [height, setHeight] = useState<number>(0);

    useEffect(() => {
        if (!smoothTransition) {
            setDataUrl('');
            setWidth(0);
            setHeight(0);
        }

        if (!image || image.error !== undefined) {
            return;
        }

        let img: HTMLImageElement | undefined;
        let video: HTMLVideoElement | undefined;

        function fetchImage() {
            if (!image) {
                return;
            }

            if (image.extension === 'webm') {
                image
                    .dataUrl()
                    .then((nextDataUrl) => {
                        video = document.createElement('video');
                        video.onloadedmetadata = () => {
                            if (!video) {
                                return;
                            }

                            setWidth(video.videoWidth);
                            setHeight(video.videoHeight);
                            setDataUrl(nextDataUrl);
                        };
                        video.src = nextDataUrl;
                    })
                    .catch((e) => {
                        if (!(e instanceof CancelledMediaFragmentDataRenderingError)) {
                            throw e;
                        }
                    });
                return;
            }

            image
                .dataUrl()
                .then((nextDataUrl) => {
                    img = new Image();
                    img.onload = () => {
                        if (!img) {
                            return;
                        }

                        setWidth(img.width);
                        setHeight(img.height);
                        setDataUrl(nextDataUrl);
                    };
                    img.src = nextDataUrl;
                })
                .catch((e) => {
                    if (!(e instanceof CancelledMediaFragmentDataRenderingError)) {
                        throw e;
                    }
                });
        }

        fetchImage();

        return () => {
            if (img) {
                img.onload = null;
            }

            if (video) {
                video.onloadedmetadata = null;
            }
        };
    }, [image, smoothTransition]);

    return { dataUrl, width, height };
};
