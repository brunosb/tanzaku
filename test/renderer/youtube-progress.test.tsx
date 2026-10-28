import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { YoutubeDialog } from '../../src/features/catalog/import/youtube-dialog'
import { harness } from '../support/helpers'

const disposers: (() => void)[] = []
afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
    vi.useRealTimers()
    vi.restoreAllMocks()
})

async function mount() {
    const h = harness(0)
    disposers.push(() => h.runtime.dispose())
    await h.api.ready
    vi.useFakeTimers({
        toFake: ['setInterval', 'clearInterval', 'performance'],
    })
    const intervals = vi.spyOn(window, 'setInterval')
    const clearInterval = vi.spyOn(window, 'clearInterval')
    const close = vi.fn()
    const view = render(<YoutubeDialog runtime={h.runtime} close={close} />)
    fireEvent.change(screen.getByLabelText('URL do YouTube'), {
        target: { value: 'https://youtu.be/test' },
    })
    const start = async () => {
        await act(async () => {
            fireEvent.click(screen.getByRole('button', { name: 'Criar MIDI' }))
        })
    }
    const progress = (stage: string, percent: number | null = null) => {
        const jobId = h.calls.findLast(
            (call) => call.command === 'library_add_youtube',
        )!.args!.jobId
        act(() => h.emit('youtube-progress', { jobId, stage, percent }))
    }
    const advance = (seconds: number) =>
        act(() => vi.advanceTimersByTime(seconds * 1000))
    return {
        ...h,
        ...view,
        close,
        start,
        progress,
        advance,
        intervals,
        clearInterval,
    }
}

test('conversion shows every stage and only displays measured percentages', async () => {
    const h = await mount()
    await h.start()
    expect(screen.getByRole('status')).toHaveTextContent('Preparando…')
    for (const stage of [
        'Obtendo informações do vídeo',
        'Baixando áudio',
        'Convertendo para WAV',
        'Transcrevendo para MIDI',
    ]) {
        h.progress(stage)
        expect(screen.getByRole('status')).toHaveTextContent(`${stage}…`)
        expect(screen.getByRole('progressbar')).not.toHaveAttribute(
            'aria-valuenow',
        )
    }
    h.progress('Transcrevendo para MIDI', 42)
    expect(screen.getByText('42% da etapa')).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuenow',
        '42',
    )
    expect(screen.getByRole('progressbar')).toHaveAttribute(
        'aria-valuetext',
        '42% da etapa',
    )
    h.progress('Transcrevendo para MIDI', 100)
    for (const stage of [
        'Decodificando notas',
        'Gravando arquivo MIDI',
        'Salvando na biblioteca',
    ]) {
        h.progress(stage)
        expect(screen.getByRole('status')).toHaveTextContent(`${stage}…`)
        expect(screen.getByRole('progressbar')).not.toHaveAttribute(
            'aria-valuenow',
        )
        expect(screen.queryByText(/% da etapa/)).not.toBeInTheDocument()
        expect(
            document.querySelector('.progress-indeterminate'),
        ).toBeInTheDocument()
        if (stage === 'Decodificando notas')
            expect(
                screen.getByText('Essa etapa pode levar alguns minutos.'),
            ).toBeInTheDocument()
    }
    h.progress('Concluído', 100)
    await act(async () => h.finishYoutube())
    expect(h.close).toHaveBeenCalledOnce()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(h.clearInterval).toHaveBeenCalledWith(
        h.intervals.mock.results[0].value,
    )
})

test('clocks advance without events and only stage changes reset the stage clock', async () => {
    const h = await mount()
    await h.start()
    h.advance(10)
    h.progress('Transcrevendo para MIDI', 0)
    h.advance(5)
    h.progress('Transcrevendo para MIDI', 50)
    expect(
        screen.getByText('Tempo nesta etapa: 00:05 · Tempo total: 00:15'),
    ).toHaveAttribute('aria-live', 'off')
    h.progress('Decodificando notas')
    expect(
        screen.getByText('Tempo nesta etapa: 00:00 · Tempo total: 00:15'),
    ).toBeInTheDocument()
    h.advance(92)
    expect(
        screen.getByText('Tempo nesta etapa: 01:32 · Tempo total: 01:47'),
    ).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Decodificando notas…')
    expect(screen.getByRole('status')).not.toHaveTextContent('Tempo')
    expect(h.intervals).toHaveBeenCalledTimes(1)
    h.unmount()
    expect(h.clearInterval).toHaveBeenCalledWith(
        h.intervals.mock.results[0].value,
    )
})

test('failure stops the clock and retry starts with fresh progress and elapsed times', async () => {
    const h = await mount()
    const addYoutube = vi.spyOn(h.api.library, 'addYoutube')
    let reject: (error: Error) => void = () => {}
    addYoutube.mockImplementationOnce(
        () =>
            new Promise((_, rejectPromise) => {
                reject = rejectPromise
            }),
    )
    await h.start()
    h.advance(8)
    await act(async () => reject(new Error('Falha na conversão')))
    expect(screen.getByRole('alert')).toHaveTextContent('Falha na conversão')
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(h.clearInterval).toHaveBeenCalledWith(
        h.intervals.mock.results[0].value,
    )
    h.advance(12)
    await h.start()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Preparando…')
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow')
    expect(
        screen.getByText('Tempo nesta etapa: 00:00 · Tempo total: 00:00'),
    ).toBeInTheDocument()
    h.advance(1)
    expect(
        screen.getByText('Tempo nesta etapa: 00:01 · Tempo total: 00:01'),
    ).toBeInTheDocument()
})

test('cancel stops the clock and ignores late progress and completion', async () => {
    const h = await mount()
    await h.start()
    h.progress('Decodificando notas')
    h.advance(3)
    await act(async () => {
        fireEvent.click(
            screen.getByRole('button', { name: 'Cancelar conversão' }),
        )
    })
    expect(h.close).toHaveBeenCalledOnce()
    expect(h.clearInterval).toHaveBeenCalledWith(
        h.intervals.mock.results[0].value,
    )
    h.progress('Gravando arquivo MIDI')
    h.advance(5)
    await act(async () => h.finishYoutube())
    expect(h.close).toHaveBeenCalledOnce()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(h.runtime.catalog.get().entries).toEqual([])
})
