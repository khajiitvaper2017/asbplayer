import { useCallback, useEffect, useState } from 'react';
import { isMobile } from '@project/common/device-detection/mobile';
import { asbWarn } from '@project/common/util/log';

export const useFullscreen = () => {
    const [fullscreen, setFullscreen] = useState<boolean>(document.fullscreenElement != null);
    useEffect(() => {
        const orientation = screen.orientation as ScreenOrientation & {
            lock?: (orientation: 'landscape') => Promise<void>;
        };
        let orientationLocked = false;
        const unlockOrientation = () => {
            if (orientationLocked) {
                orientation.unlock();
                orientationLocked = false;
            }
        };
        const listener = () => {
            const fullscreen = document.fullscreenElement != null;
            setFullscreen(fullscreen);
            if (fullscreen && isMobile && orientation?.lock) {
                orientationLocked = true;
                void orientation
                    .lock('landscape')
                    .catch((error) => asbWarn('fullscreen', 'Could not lock screen orientation:', error));
            } else if (!fullscreen) {
                unlockOrientation();
            }
        };
        document.addEventListener('fullscreenchange', listener);
        return () => {
            document.removeEventListener('fullscreenchange', listener);
            unlockOrientation();
        };
    }, []);
    const requestFullscreen = useCallback((newFullscreen: boolean) => {
        if (newFullscreen && !document.fullscreenElement) {
            void document.documentElement.requestFullscreen();
        } else if (!newFullscreen && document.fullscreenElement) {
            void document.exitFullscreen();
        }
    }, []);
    return { fullscreen, requestFullscreen };
};
