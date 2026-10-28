import { useEffect, useRef, useState } from 'react'
import { AlertDialogCancel } from '@/shared/ui/alert-dialog'
import { Button } from '@/shared/ui/button'
import { EditorDialog } from '@/shared/ui/editor-dialog'
export function StorageDialog({
    chooseDirectory,
    onChanged,
    close,
}: {
    chooseDirectory: () => Promise<string | null>
    onChanged: () => void
    close: () => void
}) {
    const [pending, setPending] = useState(false),
        [error, setError] = useState('')
    const alive = useRef(true)
    useEffect(
        () => () => {
            alive.current = false
        },
        [],
    )
    const cancel = () => {
        if (!pending) close()
    }
    const submit = async () => {
        if (pending) return
        setPending(true)
        setError('')
        try {
            const directory = await chooseDirectory()
            if (directory) onChanged()
            if (alive.current) close()
        } catch (e) {
            if (alive.current) setError(String(e))
        } finally {
            if (alive.current) setPending(false)
        }
    }
    return (
        <EditorDialog
            title="Alterar pasta de armazenamento?"
            description="A reprodução será interrompida e a conversão em andamento será cancelada após escolher outra pasta. Seus arquivos atuais permanecem na pasta original."
            confirm
            pending={pending}
            cancel={cancel}
            buttons={
                <>
                    <AlertDialogCancel disabled={pending}>
                        Cancelar
                    </AlertDialogCancel>
                    <Button disabled={pending} onClick={() => void submit()}>
                        {pending ? 'Processando…' : 'Escolher pasta'}
                    </Button>
                </>
            }
        >
            {error && (
                <p className="dialog-error" role="alert">
                    {error}
                </p>
            )}
        </EditorDialog>
    )
}
