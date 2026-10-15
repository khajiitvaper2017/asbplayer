import { asbError } from '@project/common/util/log';
import { humanReadableTime, extractText, sourceString } from '@project/common/util';
import type {
    CardModel,
    CardSavedMessage,
    ExtensionToVideoCommand,
    NotifyErrorMessage,
    ShowAnkiUiMessage,
} from '@project/common';
import { PostMineAction, MediaFragment } from '@project/common';
import { AudioClip } from '@project/common/audio-clip';
import { highlightJitenWord, jitenOutcomeMessage } from '@project/common/jiten/jiten';
import type { JitenPending } from '@project/common/jiten/jiten';
import i18n from 'i18next';
import { getJitenClient } from '@project/extension/src/services/jiten-client';
import type { SettingsProvider } from '@project/common/settings';
import { jitenSettingsKeys } from '@project/common/settings';
import { v4 as uuidv4 } from 'uuid';
import { IndexedDBCopyHistoryRepository } from '@project/common/copy-history';

export class CardPublisher {
    private readonly _settingsProvider: SettingsProvider;
    private _jitenSubmitting = false;

    constructor(settingsProvider: SettingsProvider) {
        this._settingsProvider = settingsProvider;
    }

    async publish(card: CardModel, postMineAction?: PostMineAction, tabId?: number, src?: string) {
        const id = uuidv4();
        const savePromise = this._saveCardToRepository(id, card);

        if (tabId === undefined || src === undefined) {
            return;
        }

        try {
            const captured = { ...card, miningDestination: 'jiten' as const };
            if (
                postMineAction === PostMineAction.updateLastCard ||
                postMineAction === PostMineAction.mineNewJitenWords
            ) {
                await this._attachJiten(captured, id, src, tabId, postMineAction);
            } else if (postMineAction !== PostMineAction.none && postMineAction !== undefined) {
                this._showAnkiDialog(captured, id, src, tabId);
            } else {
                this._notifySaved(savePromise, card, src, tabId);
            }
        } catch (e) {
            this._notifyError(e, src, tabId);
            throw e;
        }
    }

    private _notifySaved(
        savePromise: Promise<any>,
        card: CardModel,
        src: string,
        tabId: number,
        notification?: string
    ) {
        void savePromise.then((saved: boolean) => {
            if (saved) {
                const cardSavedCommand: ExtensionToVideoCommand<CardSavedMessage> = {
                    sender: 'asbplayer-extension-to-video',
                    message: {
                        ...card,
                        command: 'card-saved',
                        notification,
                        cardName: card.subtitle.text || humanReadableTime(card.mediaTimestamp),
                    },
                    src: src,
                };

                void browser.tabs.sendMessage(tabId, cardSavedCommand);
            }
        });
    }

    private async _attachJiten(card: CardModel, id: string, src: string, tabId: number, action: PostMineAction) {
        if (this._jitenSubmitting) return;
        this._jitenSubmitting = true;
        let pending: JitenPending | undefined;
        try {
            const settings = await this._settingsProvider.get([...jitenSettingsKeys]);
            const client = await getJitenClient(this._settingsProvider);
            if (action === PostMineAction.mineNewJitenWords) {
                pending = {
                    targets: await client.newWords(card.jitenWords ?? [], settings.jitenMiningDeckId),
                    deckId: settings.jitenMiningDeckId,
                };
                if (!pending.targets.length) {
                    this._notifySaved(Promise.resolve(true), card, src, tabId, String(i18n.t('jiten.noNewWords')));
                    return;
                }
            }
            if (settings.jitenPreventMultipleWords && (pending?.targets.length ?? 0) > 1) {
                this._showAnkiDialog(card, id, src, tabId, { jitenPending: pending });
                return;
            }
            const target = pending?.targets[0] ?? card.jitenTarget;
            if (!target) throw new Error(String(i18n.t('jiten.mineInReaderFirst')));
            const source = sourceString(card.subtitleFileName, card.subtitle.start);
            const params = {
                text: highlightJitenWord(card.text ?? extractText(card.subtitle, card.surroundingSubtitles), target),
                source,
                image:
                    settings.jitenAttachVisual && card.image
                        ? MediaFragment.fromBase64(
                              source,
                              card.subtitle.start,
                              card.image.base64,
                              card.image.extension,
                              card.image.error
                          )
                        : undefined,
                audioClip:
                    settings.jitenAttachAudio && card.audio
                        ? AudioClip.fromBase64(
                              source,
                              card.subtitle.start,
                              card.subtitle.end,
                              card.audio.playbackRate ?? 1,
                              card.audio.base64,
                              card.audio.extension,
                              card.audio.error
                          )
                        : undefined,
            };
            const submission = await client.submit(pending?.targets ?? [target], params, pending?.deckId);
            const last = submission.outcomes.at(-1)!;
            if (last.result.failed) {
                this._showAnkiDialog({ ...card, text: submission.text }, id, src, tabId, {
                    jitenPending: pending ? { ...pending, targets: submission.remainingTargets } : undefined,
                    jitenResult: last.result,
                });
            } else {
                this._notifySaved(Promise.resolve(true), card, src, tabId, jitenOutcomeMessage(submission.outcomes));
            }
        } catch (error) {
            this._notifyError(error, src, tabId);
            this._showAnkiDialog(card, id, src, tabId, { jitenPending: pending });
        } finally {
            this._jitenSubmitting = false;
        }
    }

    private _showAnkiDialog(
        card: CardModel,
        id: string,
        src: string | undefined,
        tabId: number,
        retry?: Pick<ShowAnkiUiMessage, 'jitenPending' | 'jitenResult'>
    ) {
        const showAnkiUiCommand: ExtensionToVideoCommand<ShowAnkiUiMessage> = {
            sender: 'asbplayer-extension-to-video',
            message: {
                ...card,
                ...retry,
                id,
                command: 'show-anki-ui',
            },
            src,
        };

        void browser.tabs.sendMessage(tabId, showAnkiUiCommand);
    }

    private async _saveCardToRepository(id: string, card: CardModel) {
        try {
            const storageLimit = await this._settingsProvider.getSingle('miningHistoryStorageLimit');
            await new IndexedDBCopyHistoryRepository(storageLimit).save({
                ...card,
                id: card.id ?? id,
                timestamp: Date.now(),
            });
            return true;
        } catch (e) {
            asbError('copy-history', e);
            return false;
        }
    }

    private _notifyError(e: unknown, src: string | undefined, tabId: number) {
        let message: string;

        if (e instanceof Error) {
            message = e.message;
        } else if (typeof e === 'string') {
            message = e;
        } else {
            message = String(e);
        }

        const notifyErrorCommand: ExtensionToVideoCommand<NotifyErrorMessage> = {
            sender: 'asbplayer-extension-to-video',
            message: {
                command: 'notify-error',
                message,
            },
            src,
        };
        void browser.tabs.sendMessage(tabId, notifyErrorCommand);
    }
}
