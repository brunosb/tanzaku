import {
    act,
    fireEvent,
    render,
    screen,
    waitFor,
    within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import { App } from '../../src/app/app'
import { harness } from '../support/helpers'

const disposers: (() => void)[] = []
afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
})
async function mount() {
    window.location.hash = '/library'
    const h = harness(8)
    disposers.push(() => h.runtime.dispose())
    render(<App runtime={h.runtime} />)
    await screen.findByText('8 músicas prontas para organizar')
    return { ...h, user: userEvent.setup() }
}
async function openParts(h: Awaited<ReturnType<typeof mount>>) {
    await h.user.click(
        screen.getByRole('button', { name: 'Águas do Céu', exact: true }),
    )
    await screen.findByRole('heading', { name: 'Águas do Céu' })
    await h.user.click(screen.getByRole('button', { name: /Partes do MIDI/ }))
    return within(screen.getByRole('dialog', { name: 'Partes do MIDI' }))
}
const imported = (id: string) => ({
    id,
    title: `Importada ${id}`,
    file: `${id}.mid`,
})

test('parts update a playing song without changing its clock and persist when reopened in a playlist', async () => {
    const h = await mount()
    const panel = await openParts(h)
    act(() => h.state({ status: 'playing', position: 0.6, speed: 1.25 }))
    await h.user.click(
        panel.getByRole('button', { name: 'Nenhuma', exact: true }),
    )
    await waitFor(() =>
        expect(h.runtime.playback.meta().plan.events).toHaveLength(0),
    )
    expect(h.runtime.playback.get()).toMatchObject({
        status: 'playing',
        position: 0.6,
        speed: 1.25,
        duration: 2,
        countdownRemaining: 0,
    })
    expect(
        h.calls.some(
            (c) =>
                c.command === 'playback_pause' ||
                c.command === 'playback_start',
        ),
    ).toBe(false)
    await h.user.click(
        panel.getByRole('button', {
            name: 'Tocar somente Piano, pista 1, canal 1',
        }),
    )
    await waitFor(() =>
        expect(h.runtime.playback.meta().midiParts?.selectedPartIds).toEqual([
            '0:0',
        ]),
    )
    await h.user.keyboard('{Escape}')
    await act(() =>
        h.api.library.open('t0', { kind: 'playlist', playlistId: 'p' }),
    )
    expect(h.runtime.playback.meta().midiParts?.selectedPartIds).toEqual([
        '0:0',
    ])
    await h.user.click(screen.getByRole('button', { name: /Partes do MIDI/ }))
    expect(
        screen.getByRole('checkbox', { name: 'Tocar Piano, pista 1, canal 1' }),
    ).toBeChecked()
    expect(
        screen.getByRole('checkbox', {
            name: 'Tocar Flauta, pista 2, canal 2',
        }),
    ).not.toBeChecked()
})

test('rapid checkbox edits are serialized and keep the latest intent', async () => {
    const h = await mount()
    const panel = await openParts(h)
    fireEvent.click(
        panel.getByRole('checkbox', { name: 'Tocar Piano, pista 1, canal 1' }),
    )
    fireEvent.click(
        panel.getByRole('checkbox', { name: 'Tocar Flauta, pista 2, canal 2' }),
    )
    await waitFor(() =>
        expect(
            h.calls.filter((c) => c.command === 'playback_set_midi_parts'),
        ).toHaveLength(2),
    )
    expect(
        h.calls
            .filter((c) => c.command === 'playback_set_midi_parts')
            .map((c) => c.args),
    ).toEqual([
        { trackId: 't0', partIds: ['1:1'] },
        { trackId: 't0', partIds: [] },
    ])
    await waitFor(() =>
        expect(h.runtime.playback.meta().midiParts?.selectedPartIds).toEqual(
            [],
        ),
    )
    await h.user.keyboard('{Escape}')
    expect(screen.getByRole('button', { name: 'Reproduzir' })).toBeEnabled()
    expect(
        screen.getByRole('slider', { name: 'Posição da música' }),
    ).toBeEnabled()
    expect(
        screen.queryByText('Escolha uma música para visualizar suas notas.'),
    ).not.toBeInTheDocument()
    expect(screen.getByText(/Nenhuma parte ativa/)).toBeInTheDocument()
})

test('failed part persistence restores checkboxes and preserves the confirmed plan and transport', async () => {
    const h = await mount()
    const panel = await openParts(h)
    act(() => h.state({ status: 'paused', position: 1 }))
    h.fail('playback_set_midi_parts')
    await h.user.click(
        panel.getByRole('button', { name: 'Nenhuma', exact: true }),
    )
    expect(await panel.findByRole('alert')).toHaveTextContent(
        'Falha de gravação simulada',
    )
    expect(
        panel.getByRole('checkbox', { name: 'Tocar Piano, pista 1, canal 1' }),
    ).toBeChecked()
    expect(h.runtime.playback.meta().plan.events).toHaveLength(2)
    expect(h.runtime.playback.get()).toMatchObject({
        status: 'paused',
        position: 1,
    })
})

test('batch import adds all valid entries without playing or creating a playlist', async () => {
    const h = await mount()
    await act(() => h.api.library.open('t0'))
    act(() => h.state({ status: 'playing', position: 0.4 }))
    const beforeImport = h.calls.length
    h.setImportReport({ imported: [imported('a'), imported('b')], failed: [] })
    await h.user.click(
        screen.getByRole('button', { name: 'Importar MIDIs', exact: true }),
    )
    await screen.findByText('10 músicas prontas para organizar')
    expect(await screen.findByText('2 músicas importadas.')).toBeInTheDocument()
    expect(
        screen.getByRole('button', { name: 'Ver na biblioteca' }),
    ).toBeInTheDocument()
    expect(h.runtime.catalog.get().playlists).toHaveLength(1)
    expect(
        h.calls.filter((c) => c.command === 'library_import_many'),
    ).toHaveLength(1)
    expect(
        h.calls
            .slice(beforeImport)
            .some(
                (c) =>
                    c.command === 'playback_start' ||
                    c.command === 'playback_load',
            ),
    ).toBe(false)
    expect(h.runtime.playback.get()).toMatchObject({
        status: 'playing',
        position: 0.4,
    })
})

test('partial import lists the failed files and keeps successful entries', async () => {
    const h = await mount()
    h.setImportReport({
        imported: [imported('ok')],
        failed: [
            { fileName: 'broken.mid', error: 'MIDI inválido' },
            {
                fileName: 'format2.mid',
                error: 'MIDI formato 2 não é suportado',
            },
        ],
    })
    await h.user.click(
        screen.getByRole('button', { name: 'Importar MIDIs', exact: true }),
    )
    const report = within(
        await screen.findByRole('dialog', { name: 'Resultado da importação' }),
    )
    expect(report.getByText('broken.mid')).toBeInTheDocument()
    expect(report.getByText('format2.mid')).toBeInTheDocument()
    expect(h.runtime.catalog.get().entries).toHaveLength(9)
    expect(h.calls.some((c) => c.command === 'playback_start')).toBe(false)
    await h.user.click(
        report.getByRole('button', { name: 'Fechar', exact: true }),
    )
    await h.user.click(screen.getByRole('button', { name: 'Abrir no tocador' }))
    expect(
        await screen.findByRole('heading', { name: 'Importada ok' }),
    ).toBeInTheDocument()
})

test('cancelling multiple selection leaves the library and playback unchanged', async () => {
    const h = await mount()
    await h.user.click(
        screen.getByRole('button', { name: 'Importar MIDIs', exact: true }),
    )
    await waitFor(() => expect(h.runtime.catalog.get().busy).toBe(false))
    expect(h.runtime.catalog.get().entries).toHaveLength(8)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(h.runtime.playback.meta().track).toBeNull()
})
