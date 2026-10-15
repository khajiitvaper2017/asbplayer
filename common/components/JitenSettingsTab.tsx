import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton, InputAdornment, Link, MenuItem, Stack, Switch, Typography } from '@mui/material';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import SettingsTextField from '@project/common/components/SettingsTextField';
import SwitchLabelWithHoverEffect from '@project/common/components/SwitchLabelWithHoverEffect';
import { JitenClient } from '@project/common/jiten/jiten';
import type { JitenDeck, JitenStatus } from '@project/common/jiten/jiten';
import type { AsbplayerSettings } from '@project/common/settings';

interface Props {
    settings: AsbplayerSettings;
    onSettingsChanged: (settings: Partial<AsbplayerSettings>) => void;
    onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>;
}

export default function JitenSettingsTab({ settings, onSettingChanged, onSettingsChanged }: Props) {
    const { t } = useTranslation();
    const [showKey, setShowKey] = useState(false);
    const [status, setStatus] = useState<JitenStatus>();
    const [error, setError] = useState<string>();
    const [decks, setDecks] = useState<JitenDeck[]>([]);
    const enteredApiKey = useRef<string>(undefined);
    const client = useMemo(() => new JitenClient(settings.jitenApiKey), [settings.jitenApiKey]);
    useEffect(() => {
        let active = true;
        setStatus(undefined);
        setError(undefined);
        setDecks([]);
        if (settings.jitenApiKey) {
            void client.status().then(
                (status) => {
                    if (!active) return;
                    setStatus(status);
                    if (enteredApiKey.current === settings.jitenApiKey && !settings.jitenMediaSettingsInitialized) {
                        const canUpload = status.quota.maxBytes > 0;
                        onSettingsChanged({
                            jitenAttachVisual: canUpload,
                            jitenAttachAudio: canUpload,
                            jitenMediaSettingsInitialized: true,
                        });
                    }
                },
                (error: Error) => active && setError(error.message)
            );
            void client.decks().then(
                (decks) => {
                    if (!active) return;
                    setDecks(decks);
                    if (enteredApiKey.current === settings.jitenApiKey && !settings.jitenMiningDeckInitialized) {
                        const miningDeck = decks.find((deck) => deck.name.toLowerCase().includes('mining'));
                        onSettingsChanged({
                            jitenMiningDeckInitialized: true,
                            ...(!settings.jitenMiningDeckId && miningDeck
                                ? { jitenMiningDeckId: miningDeck.userStudyDeckId }
                                : {}),
                        });
                    }
                },
                (error: Error) => active && setError(error.message)
            );
        }
        return () => {
            active = false;
        };
    }, [
        client,
        settings.jitenApiKey,
        settings.jitenMediaSettingsInitialized,
        settings.jitenMiningDeckInitialized,
        settings.jitenMiningDeckId,
        onSettingsChanged,
    ]);

    return (
        <Stack spacing={2}>
            <Link href="https://jiten.moe/reader" target="_blank" rel="noreferrer">
                {t('jiten.reader')}
            </Link>
            <SettingsTextField
                label={t('jiten.apiKey')}
                type={showKey ? 'text' : 'password'}
                value={settings.jitenApiKey}
                error={Boolean(error)}
                helperText={
                    <>
                        <Link href="https://jiten.moe/settings#:~:text=API%20Key" target="_blank" rel="noreferrer">
                            {t('jiten.apiKey')}
                        </Link>
                        {error && (
                            <>
                                <br />
                                {error}
                            </>
                        )}
                    </>
                }
                onChange={(event) => {
                    enteredApiKey.current = event.target.value;
                    void onSettingChanged('jitenApiKey', event.target.value);
                }}
                InputProps={{
                    endAdornment: (
                        <InputAdornment position="end">
                            <IconButton
                                aria-label={t(showKey ? 'jiten.hideApiKey' : 'jiten.showApiKey')}
                                onClick={() => setShowKey(!showKey)}
                            >
                                {showKey ? <VisibilityOff /> : <Visibility />}
                            </IconButton>
                        </InputAdornment>
                    ),
                }}
            />
            <SettingsTextField
                select
                label={t('jiten.miningDeck')}
                helperText={
                    <Link href="https://jiten.moe/settings/account" target="_blank" rel="noreferrer">
                        {t('jiten.account')}
                    </Link>
                }
                value={
                    decks.some((deck) => deck.userStudyDeckId === settings.jitenMiningDeckId)
                        ? settings.jitenMiningDeckId
                        : 0
                }
                onChange={(event) => void onSettingChanged('jitenMiningDeckId', Number(event.target.value))}
            >
                <MenuItem value={0}>{t('jiten.chooseMiningDeck')}</MenuItem>
                {decks.map((deck) => (
                    <MenuItem key={deck.userStudyDeckId} value={deck.userStudyDeckId}>
                        {deck.name}
                    </MenuItem>
                ))}
            </SettingsTextField>
            <SwitchLabelWithHoverEffect
                label={t('jiten.preventMultipleWords')}
                labelPlacement="start"
                control={
                    <Switch
                        checked={settings.jitenPreventMultipleWords}
                        onChange={(_, checked) => void onSettingChanged('jitenPreventMultipleWords', checked)}
                    />
                }
            />
            <SwitchLabelWithHoverEffect
                label={t('jiten.showUnmatchedAttachmentTarget')}
                labelPlacement="start"
                control={
                    <Switch
                        checked={settings.jitenShowUnmatchedAttachmentTarget}
                        onChange={(_, checked) => void onSettingChanged('jitenShowUnmatchedAttachmentTarget', checked)}
                    />
                }
            />
            <SwitchLabelWithHoverEffect
                label={t('jiten.autoAttach')}
                labelPlacement="start"
                control={
                    <Switch
                        checked={settings.jitenAutoAttach}
                        onChange={(_, checked) => void onSettingChanged('jitenAutoAttach', checked)}
                    />
                }
            />
            {status && (
                <>
                    <Typography>
                        {t('jiten.tier', { tier: t(`jiten.tiers.${status.tier}`, { defaultValue: status.tier }) })}
                    </Typography>
                    <Typography>
                        {t('jiten.storage', {
                            used: (status.quota.usedBytes / (1024 * 1024)).toFixed(1),
                            maximum: (status.quota.maxBytes / (1024 * 1024)).toFixed(1),
                        })}
                    </Typography>
                </>
            )}
            <SwitchLabelWithHoverEffect
                label={t('jiten.includeVisual')}
                labelPlacement="start"
                control={
                    <Switch
                        checked={settings.jitenAttachVisual}
                        onChange={(_, checked) => void onSettingChanged('jitenAttachVisual', checked)}
                    />
                }
            />
            <SwitchLabelWithHoverEffect
                label={t('jiten.includeAudio')}
                labelPlacement="start"
                control={
                    <Switch
                        checked={settings.jitenAttachAudio}
                        onChange={(_, checked) => void onSettingChanged('jitenAttachAudio', checked)}
                    />
                }
            />
        </Stack>
    );
}
