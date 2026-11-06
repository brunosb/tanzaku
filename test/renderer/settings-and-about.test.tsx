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
import { defaultShortcuts } from '../../src/shared/api/settings-defaults'
import { harness } from '../support/helpers'

const disposers: (() => void)[] = []
afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
})
async function mount(path = '/settings') {
    window.location.hash = path
    const h = harness(8)
    disposers.push(() => h.runtime.dispose())
    render(<App runtime={h.runtime} />)
    await h.api.ready
    await screen.findByRole('heading', {
        name: path === '/about' ? 'Sobre' : 'Configurações',
    })
    if (path === '/settings')
        await screen.findByRole('button', { name: 'Salvar configurações' })
    return { ...h, user: userEvent.setup() }
}

test('settings save the start mode and edited shortcuts and restore defaults', async () => {
    const h = await mount()
    await h.user.click(
        screen.getByRole('combobox', { name: 'Início da reprodução' }),
    )
    await h.user.click(
        screen.getByRole('option', { name: 'Contagem de 3 segundos' }),
    )
    const pause = within(screen.getByRole('group', { name: 'Pausar' }))
    await h.user.click(pause.getByRole('checkbox', { name: 'Ativo' }))
    await h.user.click(
        screen.getByRole('button', { name: 'Salvar configurações' }),
    )
    await waitFor(() =>
        expect(
            h.calls.find((c) => c.command === 'settings_update')?.args,
        ).toEqual({
            value: {
                startMode: 'countdown',
                shortcuts: { ...defaultShortcuts, pause: null },
            },
        }),
    )
    expect((await h.api.settings.get()).shortcuts.pause).toBeNull()
    await h.user.click(
        screen.getByRole('button', { name: 'Restaurar padrões de atalhos' }),
    )
    await h.user.click(
        screen.getByRole('button', { name: 'Salvar configurações' }),
    )
    await waitFor(async () =>
        expect((await h.api.settings.get()).shortcuts).toEqual(
            defaultShortcuts,
        ),
    )
})

test('failed settings save retains the draft and leaves confirmed preferences intact', async () => {
    const h = await mount()
    await h.user.click(
        within(screen.getByRole('group', { name: 'Pausar' })).getByRole(
            'checkbox',
            { name: 'Ativo' },
        ),
    )
    h.fail('settings_update')
    await h.user.click(
        screen.getByRole('button', { name: 'Salvar configurações' }),
    )
    expect(await screen.findByRole('alert')).toHaveTextContent(
        'Falha de gravação simulada',
    )
    expect(
        within(screen.getByRole('group', { name: 'Pausar' })).getByRole(
            'checkbox',
            { name: 'Ativo' },
        ),
    ).not.toBeChecked()
    expect((await h.api.settings.get()).shortcuts.pause).toBe(
        defaultShortcuts.pause,
    )
})

test('about reads the native version and opens project links through the bridge', async () => {
    const h = await mount('/about')
    expect(await screen.findByText('9.8.7')).toBeInTheDocument()
    expect(screen.getByText('brunosb')).toBeInTheDocument()
    await h.user.click(
        screen.getByRole('button', { name: 'GitHub · brunosb/tanzaku' }),
    )
    await h.user.click(
        screen.getByRole('button', { name: 'Reportar um problema' }),
    )
    expect(
        h.calls
            .filter((c) => c.command === 'app_open_project_link')
            .map((c) => c.args),
    ).toEqual([{ target: 'repository' }, { target: 'issues' }])
})

test('waiting for game remains cancellable and background scrubbing never pauses', async () => {
    const h = await mount()
    await act(() => h.api.library.open('t0'))
    act(() => h.state({ status: 'waiting-for-game' }))
    expect(screen.getByText('Aguardando foco no jogo')).toBeInTheDocument()
    expect(
        screen.getByRole('slider', { name: 'Posição da música' }),
    ).toBeDisabled()
    await h.user.click(screen.getByRole('button', { name: 'Pausar' }))
    expect(h.calls.filter((c) => c.command === 'playback_pause')).toHaveLength(
        1,
    )
    act(() => h.state({ status: 'playing', position: 0.1 }))
    const seek = screen.getByRole('slider', { name: 'Posição da música' })
    fireEvent.pointerDown(seek, { pointerId: 1 })
    fireEvent.input(seek, { target: { value: '1.2' } })
    expect(h.calls.filter((c) => c.command === 'playback_pause')).toHaveLength(
        1,
    )
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
