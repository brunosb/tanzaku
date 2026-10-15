export type Modifier = 'shift' | 'ctrl'

export type KeyboardStroke = {
    sc: number
    vk: number
    unicode: number
    modifier: Modifier | null
}

export type KeyboardEvent = {
    sc: number
    vk?: number
    unicode?: number
    up?: boolean
    extended?: boolean
}

type ModifierState = Record<Modifier, boolean>
type Send = (events: KeyboardEvent[], force?: boolean) => boolean | void
type Wait = (ms: number) => Promise<void>

const MOD_SCAN: Record<Modifier, number> = { shift: 0x2a, ctrl: 0x1d }
const MOD_VK: Record<Modifier, number> = { shift: 0xa0, ctrl: 0xa2 }
const MOD_UNICODE: Record<Modifier, number> = { shift: 0x10, ctrl: 0x11 }

/** Keeps modifier/key state consistent across notes, pauses and stops. */
export class KeyboardState {
    private readonly held = new Map<
        number,
        { owner: number; modifier: Modifier | null }
    >()
    private readonly timers = new Set<ReturnType<typeof setTimeout>>()
    private readonly modifiers: ModifierState = { shift: false, ctrl: false }
    private token = 0
    private generation = 0

    constructor(
        private readonly send: Send,
        private readonly wait: Wait,
        private readonly modifierGapMs = 12,
    ) {}

    private modifierEvent(modifier: Modifier, up: boolean): KeyboardEvent {
        return {
            sc: MOD_SCAN[modifier],
            vk: MOD_VK[modifier],
            unicode: MOD_UNICODE[modifier],
            up,
        }
    }

    private emit(events: KeyboardEvent[], force = false) {
        return this.send(events, force) !== false
    }

    private async setModifier(modifier: Modifier | null) {
        const current =
            (Object.keys(this.modifiers) as Modifier[]).find(
                (name) => this.modifiers[name],
            ) ?? null
        const events: KeyboardEvent[] = []
        if (current) {
            events.push(this.modifierEvent(current, true))
            this.modifiers[current] = false
        }
        // A soltura deve alcançar a janela originalmente travada mesmo se o foco
        // mudou durante a duração da nota; caso contrário a tecla pode ficar presa.
        if (events.length && !this.emit(events, true)) return false
        if (modifier) {
            if (!this.emit([this.modifierEvent(modifier, false)])) return false
            this.modifiers[modifier] = true
            await this.wait(this.modifierGapMs)
        }
        return true
    }

    private releaseOwner(owner: number) {
        const events: KeyboardEvent[] = []
        for (const [sc, state] of this.held) {
            if (state.owner === owner) {
                events.push({ sc, up: true })
                this.held.delete(sc)
            }
        }
        if (events.length) this.emit(events, true)
        if (!this.held.size && owner === this.token) this.releaseModifiers(true)
    }

    private releaseModifiers(force: boolean) {
        const events: KeyboardEvent[] = []
        for (const modifier of ['shift', 'ctrl'] as Modifier[]) {
            if (force || this.modifiers[modifier])
                events.push(this.modifierEvent(modifier, true))
            this.modifiers[modifier] = false
        }
        if (events.length) this.emit(events, true)
    }

    async press(strokes: KeyboardStroke[], holdMs: number) {
        if (!strokes.length) return
        const owner = ++this.token
        const generation = this.generation
        const byModifier = new Map<Modifier | null, KeyboardStroke[]>()
        for (const stroke of strokes) {
            const group = byModifier.get(stroke.modifier) ?? []
            group.push(stroke)
            byModifier.set(stroke.modifier, group)
        }

        for (const [modifier, group] of byModifier) {
            if (generation !== this.generation) return
            if (!(await this.setModifier(modifier))) return
            if (generation !== this.generation) return
            for (const stroke of group) {
                if (this.held.has(stroke.sc)) {
                    // Do not batch a replacement with the new down event. Some games
                    // lose the musical key when modifier and note transitions share a
                    // SendInput batch.
                    this.emit(
                        [
                            {
                                sc: stroke.sc,
                                vk: stroke.vk,
                                unicode: stroke.unicode,
                                up: true,
                            },
                        ],
                        true,
                    )
                    this.held.delete(stroke.sc)
                }
                if (
                    this.emit([
                        {
                            sc: stroke.sc,
                            vk: stroke.vk,
                            unicode: stroke.unicode,
                        },
                    ])
                ) {
                    this.held.set(stroke.sc, { owner, modifier })
                }
            }
            // Keep the modifier down until the note timer releases the musical key.
            // The next group explicitly releases and re-arms it in setModifier(),
            // so consecutive semitones do not inherit a stale modifier state.
        }

        const timer = setTimeout(
            () => {
                this.timers.delete(timer)
                if (generation === this.generation) this.releaseOwner(owner)
            },
            Math.max(0, holdMs),
        )
        this.timers.add(timer)
    }

    reset() {
        this.generation++
        for (const timer of this.timers) clearTimeout(timer)
        this.timers.clear()
        const events: KeyboardEvent[] = [...this.held.keys()].map((sc) => ({
            sc,
            up: true,
        }))
        this.held.clear()
        if (events.length) this.emit(events, true)
        // Force both key-up events even when our bookkeeping says they are already up.
        this.releaseModifiers(true)
    }
}
