import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import type {
    AppSettings,
    ShortcutAction,
    TanzakuApi,
} from '@/shared/api/contracts'
import {
    defaultShortcuts,
    shortcutLabels,
} from '@/shared/api/settings-defaults'
import { Button } from '@/shared/ui/button'
import { Checkbox } from '@/shared/ui/checkbox'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/shared/ui/select'

const keys = [
    'Home',
    'End',
    'Insert',
    'PageUp',
    'PageDown',
    'ArrowLeft',
    'ArrowRight',
    'ArrowUp',
    'ArrowDown',
    'Space',
    'Pause',
    'Delete',
    'Enter',
    'Escape',
    'Tab',
    'Backspace',
    ...Array.from({ length: 24 }, (_, i) => `F${i + 1}`),
    ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((k) => `Key${k}`),
    ...'0123456789'.split('').map((k) => `Digit${k}`),
]
const modifiers = ['Control', 'Alt', 'Shift', 'Super']
const modifierLabels = ['Ctrl', 'Alt', 'Shift', 'Win']
function ShortcutEditor({
    action,
    value,
    change,
    disabled,
}: {
    action: ShortcutAction
    value: string | null
    change: (value: string | null) => void
    disabled: boolean
}) {
    const parts = (value ?? defaultShortcuts[action] ?? '').split('+')
    const key = parts.at(-1) ?? 'Home'
    const selected = parts.slice(0, -1)
    return (
        <fieldset className="shortcut-row" disabled={disabled}>
            <legend>{shortcutLabels[action]}</legend>
            <label className="shortcut-enabled">
                <Checkbox
                    checked={value !== null}
                    onCheckedChange={(checked) =>
                        change(
                            checked === true ? defaultShortcuts[action] : null,
                        )
                    }
                />
                Ativo
            </label>
            <div className="shortcut-modifiers">
                {modifiers.map((modifier, index) => (
                    <label key={modifier}>
                        <Checkbox
                            aria-label={`${modifierLabels[index]} — ${shortcutLabels[action]}`}
                            checked={selected.includes(modifier)}
                            disabled={disabled || value === null}
                            onCheckedChange={(checked) => {
                                const next = modifiers.filter((m) =>
                                    m === modifier
                                        ? checked === true
                                        : selected.includes(m),
                                )
                                change([...next, key].join('+'))
                            }}
                        />
                        {modifierLabels[index]}
                    </label>
                ))}
            </div>
            <Select
                value={key}
                disabled={disabled || value === null}
                onValueChange={(key) => change([...selected, key].join('+'))}
            >
                <SelectTrigger aria-label={`Tecla — ${shortcutLabels[action]}`}>
                    <SelectValue />
                </SelectTrigger>
                <SelectContent>
                    {[...new Set([...keys, key])].map((key) => (
                        <SelectItem key={key} value={key}>
                            {key.replace(/^Key|^Digit/, '')}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </fieldset>
    )
}

export function SettingsPage({
    api,
    storageRoot,
    chooseDirectory,
}: {
    api: TanzakuApi
    storageRoot: string
    chooseDirectory: () => void
}) {
    const [settings, setSettings] = useState<AppSettings | null>(null)
    const [error, setError] = useState('')
    const [pending, setPending] = useState(false)
    useEffect(() => {
        let alive = true
        setSettings(null)
        setError('')
        void api.settings
            .get()
            .then((value) => {
                if (alive) setSettings(value)
            })
            .catch((e) => {
                if (alive) setError(String(e))
            })
        return () => {
            alive = false
        }
    }, [api, storageRoot])
    const save = async () => {
        if (!settings || pending) return
        setPending(true)
        setError('')
        try {
            setSettings(
                await api.settings.update({
                    startMode: settings.startMode,
                    shortcuts: settings.shortcuts,
                }),
            )
            toast.success('Configurações salvas.')
        } catch (error) {
            setError(String(error))
        } finally {
            setPending(false)
        }
    }
    return (
        <>
            <header className="page-heading">
                <div>
                    <span className="eyebrow">PREFERÊNCIAS</span>
                    <h1>Configurações</h1>
                </div>
            </header>
            {error && (
                <p className="dialog-error" role="alert">
                    {error}
                </p>
            )}
            {!settings ? (
                error ? (
                    <Button variant="outline" onClick={chooseDirectory}>
                        Alterar pasta
                    </Button>
                ) : (
                    <p>Carregando configurações…</p>
                )
            ) : (
                <div className="settings-sections">
                    <section className="settings-card">
                        <h2>Reprodução</h2>
                        <p>
                            Escolha como começar uma nova sessão. A mudança vale
                            no próximo início.
                        </p>
                        <Select
                            value={settings.startMode}
                            disabled={pending}
                            onValueChange={(value) =>
                                setSettings({
                                    ...settings,
                                    startMode:
                                        value as AppSettings['startMode'],
                                })
                            }
                        >
                            <SelectTrigger aria-label="Início da reprodução">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="game-focus">
                                    Ao focar o jogo
                                </SelectItem>
                                <SelectItem value="countdown">
                                    Contagem de 3 segundos
                                </SelectItem>
                            </SelectContent>
                        </Select>
                        <p>
                            Após clicar em Reproduzir, foque Where Winds Meet
                            (wwm.exe). Em segundo plano, uma sessão válida
                            continua sem espera.
                        </p>
                    </section>
                    <section className="settings-card">
                        <h2>Armazenamento</h2>
                        <p>
                            MIDIs, playlists e preferências ficam juntos nesta
                            biblioteca.
                        </p>
                        <code className="storage-path">
                            {settings.storageRoot}
                        </code>
                        <Button
                            variant="outline"
                            disabled={pending}
                            onClick={chooseDirectory}
                        >
                            Alterar pasta
                        </Button>
                        <p>
                            Escolher outra pasta abre a biblioteca do destino.
                            Os arquivos atuais permanecem na pasta original.
                        </p>
                    </section>
                    <section className="settings-card">
                        <h2>Atalhos globais</h2>
                        <p>
                            Funcionam com o jogo ou outro programa em foco. Use
                            combinações diferentes das teclas musicais.
                        </p>
                        {settings.shortcutWarnings?.map((warning) => (
                            <p
                                key={warning}
                                role="alert"
                                className="dialog-error"
                            >
                                {warning}
                            </p>
                        ))}
                        {(Object.keys(shortcutLabels) as ShortcutAction[]).map(
                            (action) => (
                                <ShortcutEditor
                                    key={action}
                                    action={action}
                                    value={settings.shortcuts[action]}
                                    disabled={pending}
                                    change={(value) =>
                                        setSettings({
                                            ...settings,
                                            shortcuts: {
                                                ...settings.shortcuts,
                                                [action]: value,
                                            },
                                        })
                                    }
                                />
                            ),
                        )}
                        <Button
                            variant="outline"
                            disabled={pending}
                            onClick={() =>
                                setSettings({
                                    ...settings,
                                    shortcuts: { ...defaultShortcuts },
                                })
                            }
                        >
                            Restaurar padrões de atalhos
                        </Button>
                    </section>
                    <div className="settings-save">
                        <Button disabled={pending} onClick={() => void save()}>
                            {pending ? 'Salvando…' : 'Salvar configurações'}
                        </Button>
                    </div>
                </div>
            )}
        </>
    )
}
