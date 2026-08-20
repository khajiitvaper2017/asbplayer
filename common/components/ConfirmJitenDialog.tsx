import Dialog from '@mui/material/Dialog';
import Toolbar from '@mui/material/Toolbar';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import CloseIcon from '@mui/icons-material/Close';
import IconButton from '@mui/material/IconButton';
import { useTranslation } from 'react-i18next';

interface Props {
    open: boolean;
    body: string;
    onClose: () => void;
    onConfirm: () => void;
    onOpen: () => void;
}

const ConfirmJitenDialog = ({ open, body, onClose, onConfirm, onOpen }: Props) => {
    const { t } = useTranslation();
    return (
        <Dialog open={open} onClose={onClose}>
            <Toolbar>
                <Typography variant="h6" sx={{ flexGrow: 1 }}>
                    {t('jiten.sentenceMissingWordConfirmationTitle')}
                </Typography>
                <IconButton edge="end" onClick={onClose}>
                    <CloseIcon />
                </IconButton>
            </Toolbar>
            <DialogContent sx={{ whiteSpace: 'pre-line' }}>{body}</DialogContent>
            <DialogActions>
                <Button onClick={onClose}>{t('action.cancel')}</Button>
                <Button onClick={onConfirm}>{t('action.ok')}</Button>
                <Button onClick={onOpen}>{t('jiten.openDialog')}</Button>
            </DialogActions>
        </Dialog>
    );
};

export default ConfirmJitenDialog;
