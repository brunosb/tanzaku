import { toast } from 'sonner'
export const reportError = (error: unknown) =>
    toast.error(error instanceof Error ? error.message : String(error), {
        duration: 10000,
    })
export const run = (work: Promise<unknown>) => {
    void work.catch(reportError)
}
