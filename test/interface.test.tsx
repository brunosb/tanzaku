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
import { App } from '../src/renderer/app'
import { harness } from './helpers'

const disposers: (() => void)[] = []
afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
})
async function mount(path = '/library', size = 8) {
    window.location.hash = path
    const h = harness(size)
    disposers.push(() => h.runtime.dispose())
    const user = userEvent.setup()
    render(<App runtime={h.runtime} />)
    if (path === '/library')
        await screen.findByText(`${size} músicas prontas para organizar`)
    else await screen.findByRole('heading', { name: 'Minha playlist' })
    await waitFor(() => expect(h.runtime.catalog.get().loading).toBe(false))
    return { ...h, user }
}
test('navigation retains search and selection, opens only on the track name, and never starts playback', async () => {
    const h = await mount()
    await h.user.click(
        screen.getByRole('checkbox', { name: 'Selecionar Águas do Céu' }),
    )
    expect(screen.getByText('1 selecionadas')).toBeInTheDocument()
    expect(h.calls.some((c) => c.command === 'playback_load')).toBe(false)
    await h.user.type(screen.getByRole('searchbox'), 'aguas')
    expect(
        screen.getByRole('button', { name: 'Águas do Céu' }),
    ).toBeInTheDocument()
    expect(
        screen.queryByRole('button', { name: 'Música 001' }),
    ).not.toBeInTheDocument()
    await h.user.click(
        screen.getByRole('link', { name: 'Playlists', exact: true }),
    )
    await h.user.click(
        screen.getByRole('link', { name: 'Biblioteca', exact: true }),
    )
    expect(screen.getByRole('searchbox')).toHaveValue('aguas')
    expect(screen.getByText('1 selecionadas')).toBeInTheDocument()
    await h.user.click(
        screen.getByRole('button', { name: 'Águas do Céu', exact: true }),
    )
    await screen.findByRole('heading', { name: 'Águas do Céu' })
    expect(h.calls.filter((c) => c.command === 'playback_load')).toHaveLength(1)
    expect(h.calls.some((c) => c.command === 'playback_start')).toBe(false)
    expect(document.querySelectorAll('.note')).toHaveLength(2)
})
test('page checkbox selects 50 and selection can be added across pages without loading', async () => {
    const h = await mount('/library', 65)
    await h.user.click(
        screen.getByRole('checkbox', { name: 'Selecionar página' }),
    )
    expect(screen.getByText('50 selecionadas')).toBeInTheDocument()
    await h.user.click(screen.getByRole('button', { name: 'Próxima página' }))
    await h.user.click(
        screen.getByRole('checkbox', { name: 'Selecionar página' }),
    )
    expect(screen.getByText('65 selecionadas')).toBeInTheDocument()
    await h.user.click(
        screen.getByRole('button', {
            name: 'Adicionar à playlist',
            exact: true,
        }),
    )
    const dialog = screen.getByRole('dialog')
    await h.user.click(
        within(dialog).getByRole('button', { name: /Minha playlist/ }),
    )
    await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    expect(h.runtime.catalog.get().playlists[0].trackIds).toHaveLength(65)
    expect(h.calls.some((c) => c.command === 'playback_load')).toBe(false)
})
test('simulated playback survives navigation and simultaneous sustains clear after pause', async () => {
    const h = await mount()
    await h.user.click(
        screen.getByRole('button', { name: 'Águas do Céu', exact: true }),
    )
    await screen.findByRole('heading', { name: 'Águas do Céu' })
    act(() =>
        h.state({
            status: 'playing',
            position: 0.1,
            currentEventIndex: 2,
            activeEventIndices: [0, 1],
        }),
    )
    await waitFor(() =>
        expect(document.querySelectorAll('.note.current')).toHaveLength(2),
    )
    const notes = [...document.querySelectorAll('.note')]
    act(() => h.state({ position: 0.15 }))
    expect([...document.querySelectorAll('.note')]).toEqual(notes)
    const count = h.calls.length
    await h.user.click(
        screen.getByRole('link', { name: 'Biblioteca', exact: true }),
    )
    await h.user.click(screen.getByRole('link', { name: 'Tocador' }))
    await waitFor(() =>
        expect(document.querySelectorAll('.note.current')).toHaveLength(2),
    )
    expect(
        h.calls.slice(count).filter((c) => c.command.startsWith('playback_')),
    ).toEqual([])
    act(() => h.state({ status: 'paused', activeEventIndices: [] }))
    await waitFor(() =>
        expect(document.querySelectorAll('.note.current')).toHaveLength(0),
    )
})
test('playlist reorder persists through remount; search disables order changes and failures preserve rows', async () => {
    const h = await mount('/playlists/p')
    await h.user.click(
        screen.getByRole('button', { name: 'Opções de Águas do Céu' }),
    )
    await h.user.click(screen.getByRole('menuitem', { name: 'Mover abaixo' }))
    await waitFor(() =>
        expect(h.runtime.catalog.get().playlists[0].trackIds).toEqual([
            't1',
            't0',
        ]),
    )
    expect(h.calls.some((c) => c.command === 'playlist_play')).toBe(false)
    await h.user.type(screen.getByRole('searchbox'), 'aguas')
    await h.user.click(
        screen.getByRole('button', { name: 'Opções de Águas do Céu' }),
    )
    expect(
        screen.getByRole('menuitem', { name: 'Mover acima' }),
    ).toHaveAttribute('data-disabled')
    await h.user.keyboard('{Escape}')
    await h.user.click(
        screen.getByRole('button', { name: 'Limpar busca para reorganizar' }),
    )
    h.fail('playlist_reorder')
    await h.user.click(
        screen.getByRole('button', { name: 'Opções de Águas do Céu' }),
    )
    await h.user.click(screen.getByRole('menuitem', { name: 'Mover acima' }))
    await waitFor(() =>
        expect(h.runtime.catalog.get().error).toContain('Falha'),
    )
    expect(h.runtime.catalog.get().playlists[0].trackIds).toEqual(['t1', 't0'])
})
test('removing playlist references requires confirmation and never deletes library files', async () => {
    const h = await mount('/playlists/p')
    await h.user.click(
        screen.getByRole('checkbox', { name: 'Selecionar página' }),
    )
    await h.user.click(
        screen.getByRole('button', { name: 'Remover da playlist' }),
    )
    const dialog = screen.getByRole('alertdialog')
    expect(h.calls.some((c) => c.command === 'playlist_remove_track')).toBe(
        false,
    )
    await h.user.click(
        within(dialog).getByRole('button', { name: 'Confirmar' }),
    )
    await screen.findByText('Esta playlist está vazia')
    expect(h.runtime.catalog.get().entries).toHaveLength(8)
    expect(h.calls.some((c) => c.command === 'library_delete')).toBe(false)
})
test('dialogs retain errors, restore focus, and cancellation ignores a late YouTube completion', async () => {
    const h = await mount()
    const youtube = screen.getByRole('button', { name: 'YouTube', exact: true })
    await h.user.click(youtube)
    await h.user.type(
        screen.getByLabelText('URL do YouTube'),
        'https://youtu.be/test',
    )
    await h.user.click(screen.getByRole('button', { name: 'Criar MIDI' }))
    await h.user.click(
        screen.getByRole('button', { name: 'Cancelar conversão' }),
    )
    await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    )
    await waitFor(() => expect(youtube).toHaveFocus())
    expect(h.calls.some((c) => c.command === 'youtube_cancel')).toBe(true)
    act(() => h.finishYoutube())
    expect(h.calls.some((c) => c.command === 'playback_load')).toBe(false)
})
test('Ctrl+F focuses page search but does not override an open dialog', async () => {
    const h = await mount()
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    expect(screen.getByRole('searchbox')).toHaveFocus()
    await h.user.click(
        screen.getByRole('button', { name: 'YouTube', exact: true }),
    )
    expect(screen.getByLabelText('URL do YouTube')).toHaveFocus()
    fireEvent.keyDown(window, { key: 'f', ctrlKey: true })
    expect(screen.getByLabelText('URL do YouTube')).toHaveFocus()
})

test('seek commits once with native resume, even when pointer and blur both finish', async () => {
    const h = await mount()
    await h.user.click(
        screen.getByRole('button', { name: 'Águas do Céu', exact: true }),
    )
    await screen.findByRole('heading', { name: 'Águas do Céu' })
    act(() => h.state({ status: 'playing', position: 0.1 }))
    const seek = screen.getByRole('slider', { name: 'Posição da música' })
    fireEvent.pointerDown(seek, { pointerId: 1 })
    fireEvent.input(seek, { target: { value: '1.2' } })
    fireEvent.pointerUp(seek, { pointerId: 1 })
    fireEvent.blur(seek)
    await waitFor(() =>
        expect(
            h.calls.filter((c) => c.command === 'playback_seek'),
        ).toHaveLength(1),
    )
    expect(h.calls.find((c) => c.command === 'playback_seek')?.args).toEqual({
        position: 1.2,
        resume: true,
    })
})
test('deleting the loaded track clears its plan only after confirmation', async () => {
    const h = await mount()
    await h.user.click(
        screen.getByRole('button', { name: 'Águas do Céu', exact: true }),
    )
    await screen.findByRole('heading', { name: 'Águas do Céu' })
    await h.user.click(screen.getByRole('link', { name: 'Biblioteca' }))
    await h.user.click(
        screen.getByRole('button', { name: 'Opções de Águas do Céu' }),
    )
    await h.user.click(
        screen.getByRole('menuitem', { name: 'Excluir da biblioteca' }),
    )
    const dialog = screen.getByRole('alertdialog')
    expect(
        within(dialog).getByRole('button', { name: 'Cancelar' }),
    ).toHaveFocus()
    expect(h.runtime.playback.meta().plan.events).toHaveLength(2)
    await h.user.click(
        within(dialog).getByRole('button', { name: 'Confirmar' }),
    )
    await waitFor(() => expect(h.runtime.catalog.get().entries).toHaveLength(7))
    expect(h.runtime.playback.meta().plan.events).toHaveLength(0)
    expect(h.runtime.catalog.get().playlists[0].trackIds).toEqual(['t1'])
})
test('storage switch resets views, selection and native snapshot after confirmed success', async () => {
    const h = await mount()
    await h.user.click(
        screen.getByRole('checkbox', { name: 'Selecionar Águas do Céu' }),
    )
    await h.user.type(screen.getByRole('searchbox'), 'aguas')
    await h.user.click(screen.getByRole('button', { name: 'Armazenamento' }))
    const dialog = screen.getByRole('alertdialog')
    await h.user.click(
        within(dialog).getByRole('button', { name: 'Escolher pasta' }),
    )
    await screen.findByRole('heading', {
        name: 'Seu próximo acorde começa aqui',
    })
    expect(h.runtime.views.size).toBe(0)
    expect(h.runtime.catalog.get().entries).toEqual([])
    await h.user.click(screen.getByRole('link', { name: 'Biblioteca' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(screen.queryByText('1 selecionadas')).not.toBeInTheDocument()
})
test('missing playlist references stay visible and a failed rename leaves confirmed title intact', async () => {
    const h = await mount('/playlists/p')
    act(() =>
        h.setPlaylists([
            {
                id: 'p',
                name: 'Minha playlist',
                trackIds: ['t0', 'missing'],
                createdAt: '',
            },
        ]),
    )
    await act(() => h.runtime.catalog.reload())
    expect(
        screen.getByRole('button', { name: /^Música indisponível/ }),
    ).toBeDisabled()
    h.fail('playlist_rename')
    await h.user.click(
        screen.getByRole('button', { name: 'Opções da playlist' }),
    )
    await h.user.click(
        screen.getByRole('menuitem', { name: 'Renomear playlist' }),
    )
    await h.user.clear(screen.getByLabelText('Nome'))
    await h.user.type(screen.getByLabelText('Nome'), 'Novo nome')
    await h.user.click(screen.getByRole('button', { name: 'Salvar' }))
    await waitFor(() =>
        expect(
            within(screen.getByRole('dialog')).getByRole('alert'),
        ).toHaveTextContent('Falha'),
    )
    expect(h.runtime.catalog.get().playlists[0].name).toBe('Minha playlist')
})
