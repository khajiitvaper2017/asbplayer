import { asbError } from '@project/common/util/log';
import type { Profile, SettingsProvider } from '@project/common/settings';
import { useEffect, useState, useCallback } from 'react';

interface Params {
    settingsProvider: SettingsProvider;
    onProfileChanged: () => void;
}

export const useSettingsProfileContext = ({ settingsProvider, onProfileChanged }: Params) => {
    const [profiles, setProfiles] = useState<Profile[]>([]);
    const [activeProfile, setActiveProfile] = useState<string>();
    const refreshProfileContext = useCallback(() => {
        void settingsProvider
            .profiles()
            .then(setProfiles)
            .catch((error) => {
                asbError('settings/profiles', 'Failed to load profiles:', error);
            });
        void settingsProvider
            .activeProfile()
            .then((p) => setActiveProfile(p?.name))
            .catch((error) => {
                asbError('settings/profiles', 'Failed to load the active profile:', error);
            });
    }, [settingsProvider]);
    useEffect(() => {
        refreshProfileContext();
    }, [refreshProfileContext]);

    const onNewProfile = useCallback(
        (name: string) =>
            settingsProvider
                .addProfile(name)
                .then(() => settingsProvider.profiles().then(setProfiles))
                .then(() => settingsProvider.setActiveProfile(name))
                .then(() => setActiveProfile(name))
                .then(() => onProfileChanged())
                .catch((error) => {
                    asbError('settings/profiles', `Failed to create profile '${name}':`, error);
                }),
        [settingsProvider, onProfileChanged]
    );
    const onRemoveProfile = useCallback(
        async (name: string) => {
            try {
                if (name === activeProfile) {
                    await settingsProvider.setActiveProfile(undefined);
                    setActiveProfile(undefined);
                    onProfileChanged();
                }
                await settingsProvider.removeProfile(name);
                setProfiles(await settingsProvider.profiles());
            } catch (error) {
                asbError('settings/profiles', `Failed to remove profile '${name}':`, error);
            }
        },
        [settingsProvider, activeProfile, onProfileChanged]
    );
    const onSetActiveProfile = useCallback(
        (name: string | undefined) =>
            settingsProvider
                .setActiveProfile(name)
                .then(() => setActiveProfile(name))
                .then(() => onProfileChanged())
                .catch((error) => {
                    asbError('settings/profiles', `Failed to set the active profile to '${name ?? 'none'}':`, error);
                }),
        [settingsProvider, onProfileChanged]
    );

    return { profiles, activeProfile, onNewProfile, onRemoveProfile, onSetActiveProfile, refreshProfileContext };
};
