import type { ReactNode } from 'react'
import {
    AlertDialog,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from './alert-dialog'
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from './dialog'
export function EditorDialog({
    title,
    description,
    confirm = false,
    pending = false,
    cancelable = false,
    wide = false,
    cancel,
    children,
    buttons,
}: {
    title: string
    description: string
    confirm?: boolean
    pending?: boolean
    cancelable?: boolean
    wide?: boolean
    cancel: () => void
    children: ReactNode
    buttons: ReactNode
}) {
    if (confirm)
        return (
            <AlertDialog
                open
                onOpenChange={(open) => {
                    if (!open) cancel()
                }}
            >
                <AlertDialogContent
                    onCloseAutoFocus={(e) => e.preventDefault()}
                >
                    <AlertDialogHeader>
                        <AlertDialogTitle>{title}</AlertDialogTitle>
                        <AlertDialogDescription>
                            {description}
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    {children}
                    <AlertDialogFooter>{buttons}</AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        )
    return (
        <Dialog
            open
            onOpenChange={(open) => {
                if (!open) cancel()
            }}
        >
            <DialogContent
                onCloseAutoFocus={(e) => e.preventDefault()}
                className={wide ? 'catalog-dialog' : ''}
                onInteractOutside={(e) => {
                    if (pending) e.preventDefault()
                }}
                onEscapeKeyDown={(e) => {
                    if (pending && !cancelable) e.preventDefault()
                }}
            >
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription>{description}</DialogDescription>
                </DialogHeader>
                {children}
                <DialogFooter>{buttons}</DialogFooter>
            </DialogContent>
        </Dialog>
    )
}
