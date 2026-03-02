import { CancelledMediaFragmentDataRenderingError, MediaFragment as CommonMediaFragment } from '@project/common';
import { useEffect, useState } from 'react';

export const useMediaFragmentData = ({
    mediaFragment,
    smoothTransition,
}: {
    mediaFragment?: CommonMediaFragment;
    smoothTransition: boolean;
}) => {
    const [dataUrl, setDataUrl] = useState<string>('');
    const [width, setWidth] = useState<number>(0);
    const [height, setHeight] = useState<number>(0);

    useEffect(() => {
        if (!smoothTransition) {
            setDataUrl('');
            setWidth(0);
            setHeight(0);
        }

        if (!mediaFragment || mediaFragment.error !== undefined) {
            return;
        }

        let img: HTMLImageElement | undefined;
        let video: HTMLVideoElement | undefined;

        function fetchImage() {
            if (!mediaFragment) {
                return;
            }

            mediaFragment
                .dataUrl()
                .then((dataUrl) => {
                    if (mediaFragment.extension === 'webm') {
                        video = document.createElement('video');
                        video.preload = 'metadata';
                        video.onloadedmetadata = () => {
                            if (!video) {
                                return;
                            }

                            setWidth(video.videoWidth);
                            setHeight(video.videoHeight);
                            setDataUrl(dataUrl);
                        };
                        video.src = dataUrl;
                        return;
                    }

                    img = new Image();
                    img.onload = () => {
                        if (!img) {
                            return;
                        }

                        setWidth(img.width);
                        setHeight(img.height);
                        setDataUrl(dataUrl);
                    };
                    img.src = dataUrl;
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
                video.removeAttribute('src');
                video.load();
            }
        };
    }, [mediaFragment, smoothTransition]);

    return { dataUrl, width, height };
};
