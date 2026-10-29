import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test } from 'vitest'
import { App } from '../../src/app/app'
import type { PlaybackQueue } from '../../src/shared/api/contracts'
import { harness } from '../support/helpers'

const disposers: (() => void)[] = []
afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose()
})

test('auto advance reflects confirmed native state and does not change after a failed save', async () => {
    const h = await mount('/library', 8)
    const toggle = screen.getByRole('button', { name: 'Avanço automático' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await h.user.click(toggle)
    await waitFor(() => expect(toggle).toHaveAttribute('aria-pressed', 'true'))
    expect(h.calls.at(-1)).toEqual({
        command: 'playback_set_auto_advance',
        args: { enabled: true },
    })
    h.fail('playback_set_auto_advance')
    await h.user.click(toggle)
    await screen.findByText(/Falha de gravação simulada/)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
})
async function mount(path = '/library', count = 65) {
    window.location.hash = path
    const h = harness(count)
    disposers.push(() => h.runtime.dispose())
    render(<App runtime={h.runtime} />)
    await waitFor(() => expect(h.runtime.catalog.get().loading).toBe(false))
    return { ...h, user: userEvent.setup() }
}

test('library opening sends the full filtered order across pages and fallback opening uses A–Z', async () => {
    const h = await mount()
    await h.user.type(screen.getByRole('searchbox'), 'musica')
    await screen.findByRole('button', { name: 'Música 001', exact: true })
    await h.user.click(screen.getByRole('button', { name: 'Próxima página' }))
    await h.user.click(
        screen.getByRole('button', { name: 'Música 021', exact: true }),
    )
    const call = h.calls.find((call) => call.command === 'playback_load')!
    expect(call.args?.context).toEqual({
        kind: 'library',
        trackIds: Array.from({ length: 64 }, (_, index) => `t${index + 1}`),
    })
    expect(screen.getByText(/21 de 64/)).toBeInTheDocument()
    expect(
        screen.getByText('Música 022', { selector: '.queue-next strong' }),
    ).toBeInTheDocument()
    await act(async () => {
        await h.api.library.open('t0')
    })
    const fallback = h.calls.findLast(
        (call) => call.command === 'playback_load',
    )!
    expect((fallback.args?.context as { trackIds: string[] }).trackIds).toEqual(
        Array.from({ length: 65 }, (_, index) => `t${index}`),
    )
})

test('playlist context, queue controls and metadata updates preserve the chart plan and piano notes', async () => {
    const h = await mount('/playlists/p', 8)
    await h.user.click(
        screen.getByRole('button', { name: 'Águas do Céu', exact: true }),
    )
    expect(
        h.calls.find((call) => call.command === 'playback_load')?.args,
    ).toEqual({ id: 't0', context: { kind: 'playlist', playlistId: 'p' } })
    expect(
        screen.getByText('Playlist: Minha playlist', {
            selector: '.queue-source',
        }),
    ).toBeInTheDocument()
    const before = h.runtime.playback.meta()
    const notes = [...document.querySelectorAll('.note')]
    const queue: PlaybackQueue = { ...before.queue!, mode: 'shuffle' }
    act(() => h.queue(queue))
    expect(
        screen.getByRole('button', { name: 'Aleatório', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true')
    expect(h.runtime.playback.meta().version).toBe(before.version)
    expect(h.runtime.playback.meta().plan).toBe(before.plan)
    expect([...document.querySelectorAll('.note')]).toEqual(notes)
    await h.user.click(
        screen.getByRole('button', { name: 'Aleatório', exact: true }),
    )
    expect(h.calls.at(-1)).toEqual({
        command: 'playback_set_shuffle',
        args: { enabled: false },
    })
    expect(
        screen.getByRole('button', { name: 'Música anterior' }),
    ).toBeDisabled()
    await h.user.click(screen.getByRole('button', { name: 'Próxima música' }))
    expect(h.calls.at(-1)?.command).toBe('playback_next')
    act(() =>
        h.queue({
            ...queue,
            index: 1,
            previous: { id: 't0', title: 'Águas do Céu' },
            next: null,
        }),
    )
    expect(screen.getByText('Fim da fila')).toBeInTheDocument()
    expect(
        screen.getByRole('button', { name: 'Próxima música' }),
    ).toBeDisabled()
    await h.user.click(screen.getByRole('button', { name: 'Música anterior' }))
    expect(h.calls.at(-1)?.command).toBe('playback_previous')
    act(() => h.state({ status: 'countdown', countdownRemaining: 5 }))
    expect(
        screen.getByRole('button', { name: 'Música anterior' }),
    ).toBeDisabled()
    expect(
        screen.getByRole('button', { name: 'Aleatório', exact: true }),
    ).toBeDisabled()
})

test('seeking previews waveform progress and resumes after focus loss; stop cancels a pending seek gesture', async () => {
    const h = await mount('/library', 8)
    await h.user.click(
        screen.getByRole('button', { name: 'Águas do Céu', exact: true }),
    )
    act(() =>
        h.state({ status: 'paused', pauseReason: 'focus-lost', position: 0.1 }),
    )
    const seek = screen.getByRole('slider', { name: 'Posição da música' })
    fireEvent.pointerDown(seek, { pointerId: 1 })
    fireEvent.input(seek, { target: { value: '1.5' } })
    expect(
        document.querySelector<HTMLElement>('.waveform-played')!.style.clipPath,
    ).toBe('inset(0 25% 0 0)')
    fireEvent.keyUp(seek, { key: 'ArrowRight' })
    await waitFor(() =>
        expect(
            h.calls.find((call) => call.command === 'playback_seek')?.args,
        ).toEqual({ position: 1.5, resume: true }),
    )
    act(() => h.state({ status: 'paused', pauseReason: null }))
    fireEvent.pointerDown(seek, { pointerId: 2 })
    fireEvent.input(seek, { target: { value: '1' } })
    act(() => h.state({ status: 'stopped', position: 0 }))
    fireEvent.pointerUp(seek, { pointerId: 2 })
    expect(
        h.calls.filter((call) => call.command === 'playback_seek'),
    ).toHaveLength(1)
})
