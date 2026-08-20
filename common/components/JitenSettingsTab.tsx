import React, { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import Button from '@mui/material/Button';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import SettingsTextField from '@project/common/components/SettingsTextField';
import type { AsbplayerSettings } from '@project/common/settings';
import { JitenClient } from '@project/common/jiten';
import type { JitenStudyDeck } from '@project/common/jiten';
import MenuItem from '@mui/material/MenuItem';

interface Props {
    settings: AsbplayerSettings;
    onSettingChanged: <K extends keyof AsbplayerSettings>(key: K, value: AsbplayerSettings[K]) => Promise<void>;
}

const JitenSettingsTab: React.FC<Props> = ({ settings, onSettingChanged }) => {
    const { t } = useTranslation();
    const [visible, setVisible] = useState(false);
    const [status, setStatus] = useState<string>();
    const [plusStatus, setPlusStatus] = useState<{ tier: string; quota?: string }>();
    const [decks, setDecks] = useState<JitenStudyDeck[]>([]);
    const [selectedDeckId, setSelectedDeckId] = useState<number>(settings.jitenStudyDeckId || 0);
    useEffect(() => setSelectedDeckId(settings.jitenStudyDeckId || 0), [settings.jitenStudyDeckId]);
    useEffect(() => {
        if (!settings.jitenApiKey) {
            setDecks([]);
            return;
        }
        void new JitenClient({ jitenApiKey: settings.jitenApiKey })
            .readerStudyDecks()
            .then(setDecks)
            .catch(() => setDecks([]));
    }, [settings.jitenApiKey]);
    const testConnection = async () => {
        setStatus(t('jiten.testingConnection'));
        setPlusStatus(undefined);
        try {
            const client = new JitenClient({ jitenApiKey: settings.jitenApiKey });
            const ok = await client.ping();
            if (!ok) {
                setStatus(t('jiten.apiKeyRejected'));
                return;
            }
            const status = await client.plusStatus();
            setDecks(await client.readerStudyDecks());
            const tier = status.tier ?? 'none';
            const used = status.quota?.usedBytes;
            const max = status.quota?.maxBytes;
            setStatus(t('jiten.connected'));
            setPlusStatus({
                tier,
                quota:
                    typeof used === 'number' && typeof max === 'number'
                        ? `${formatBytes(used)} / ${formatBytes(max)}`
                        : undefined,
            });
        } catch (error) {
            setStatus(error instanceof Error ? error.message : t('jiten.connectionFailed'));
        }
    };

    return (
        <Stack spacing={2}>
            <Typography variant="h6">{t('jiten.title')}</Typography>
            <Typography variant="body2">
                <Trans
                    i18nKey="jiten.description"
                    components={{
                        reader: <Link href="https://jiten.moe/reader" target="_blank" rel="noreferrer" />,
                    }}
                />
            </Typography>
            <SettingsTextField
                label={t('jiten.apiKey')}
                type={visible ? 'text' : 'password'}
                value={settings.jitenApiKey}
                onChange={(event) => void onSettingChanged('jitenApiKey', event.target.value)}
                fullWidth
            />
            <Stack direction="row" spacing={1}>
                <Button variant="contained" disabled={!settings.jitenApiKey} onClick={() => void testConnection()}>
                    {t('jiten.testConnection')}
                </Button>
                <Button onClick={() => setVisible((value) => !value)}>
                    {visible ? t('jiten.hideKey') : t('jiten.showKey')}
                </Button>
            </Stack>
            {status && <Typography variant="body2">{status}</Typography>}
            {plusStatus && (
                <Stack spacing={0.5}>
                    <Typography variant="body2">{t('jiten.plusTier', { tier: plusStatus.tier })}</Typography>
                    {plusStatus.quota && (
                        <Typography variant="body2">{t('jiten.mediaQuota', { quota: plusStatus.quota })}</Typography>
                    )}
                </Stack>
            )}
            <Typography variant="body2">{t('jiten.mediaEntitlement')}</Typography>
            <SettingsTextField
                select
                fullWidth
                label={t('jiten.miningDeck')}
                helperText={t('jiten.miningDeckHelp')}
                value={selectedDeckId}
                onChange={(event) => {
                    const value = event.target.value ? Number(event.target.value) : 0;
                    setSelectedDeckId(value);
                    void onSettingChanged('jitenStudyDeckId', value);
                }}
            >
                <MenuItem value={0}>{t('jiten.noMiningDeck')}</MenuItem>
                {selectedDeckId !== 0 && !decks.some((deck) => deck.id === selectedDeckId) && (
                    <MenuItem value={selectedDeckId}>{selectedDeckId}</MenuItem>
                )}
                {decks.map((deck) => (
                    <MenuItem key={deck.id} value={deck.id}>
                        {deck.name ?? deck.id}
                    </MenuItem>
                ))}
            </SettingsTextField>
            <Link href="https://jiten.moe/srs/decks" target="_blank" rel="noreferrer">
                {t('jiten.manageMiningDecks')}
            </Link>
            <Link href="https://jiten.moe/settings" target="_blank" rel="noreferrer">
                {t('jiten.openSettings')}
            </Link>
        </Stack>
    );
};

const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let value = bytes;
    let unit = units[0];
    for (const nextUnit of units) {
        value /= 1024;
        unit = nextUnit;
        if (value < 1024 || nextUnit === units[units.length - 1]) break;
    }
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value)} ${unit}`;
};

export default JitenSettingsTab;
