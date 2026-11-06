import type { ImportReport } from '@/shared/api/contracts'
import { Button } from '@/shared/ui/button'
import { EditorDialog } from '@/shared/ui/editor-dialog'

export function ImportReportDialog({
    report,
    close,
}: {
    report: ImportReport
    close: () => void
}) {
    return (
        <EditorDialog
            title="Resultado da importação"
            description={`${report.imported.length === 1 ? '1 música importada' : `${report.imported.length} músicas importadas`}. ${report.failed.length === 1 ? '1 arquivo não pôde ser importado' : `${report.failed.length} arquivos não puderam ser importados`}. Os arquivos de origem foram preservados.`}
            cancel={close}
            buttons={<Button onClick={close}>Fechar</Button>}
        >
            <ul className="import-failures">
                {report.failed.map((failure, index) => (
                    <li key={`${index}:${failure.fileName}`}>
                        <strong>{failure.fileName}</strong>
                        <p>{failure.error}</p>
                    </li>
                ))}
            </ul>
        </EditorDialog>
    )
}
