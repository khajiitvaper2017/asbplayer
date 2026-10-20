import { asbError } from '@project/common/util/log';
import { currentPageDelegate } from '@/services/pages';
import { configureExtensionLogProvider } from '@/services/extension-log-provider';
import { asbplayerExcludeGlobs } from '@/constants';

export default defineContentScript({
    // Set manifest options
    matches: ['<all_urls>'],
    excludeGlobs: asbplayerExcludeGlobs,
    allFrames: true,
    runAt: 'document_start',

    main() {
        configureExtensionLogProvider();
        void currentPageDelegate()
            .then((pageDelegate) => pageDelegate.loadScripts())
            .catch((error) => asbError('content', 'Failed to load page integration:', error));
    },
});
