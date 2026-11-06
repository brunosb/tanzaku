import { ArrowLeft, ArrowRight } from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { AboutPage } from '@/features/about/about-page'
import { CatalogError } from '@/features/catalog/components/catalog-controls'
import { LibraryPage } from '@/features/catalog/library/library-page'
import { useCatalog } from '@/features/catalog/model/hooks'
import { PlaylistPage } from '@/features/catalog/playlists/playlist-page'
import { PlaylistsPage } from '@/features/catalog/playlists/playlists-page'
import { Player } from '@/features/playback/components/player'
import { Transport } from '@/features/playback/components/transport'
import { SettingsPage } from '@/features/settings/settings-page'
import { reportError, run } from '@/shared/lib/report-error'
import { Button } from '../shared/ui/button'
import { SidebarProvider } from '../shared/ui/sidebar'
import { Toaster } from '../shared/ui/sonner'
import { TooltipProvider } from '../shared/ui/tooltip'
import type { DialogAction } from './dialogs/app-dialog'
import { AppDialog } from './dialogs/app-dialog'
import { AppSidebar } from './layout/app-sidebar'
import { WindowChrome } from './layout/window-chrome'
import {
    getRoute,
    navigate,
    subscribeRoute,
} from './navigation/navigation-store'
import { ScrollPage } from './navigation/scroll-page'
import type { Runtime } from './runtime'

export function App({ runtime }: { runtime: Runtime }) {
    const catalog = useCatalog(runtime)
    const route = useSyncExternalStore(subscribeRoute, getRoute)
    const [dialog, setDialog] = useState<DialogAction | null>(null),
        [storageRoot, setStorageRoot] = useState('')
    const returnFocus = useRef<HTMLElement | null>(null)
    const openDialog = (action: DialogAction) => {
        returnFocus.current =
            document.querySelector<HTMLElement>(
                '[data-slot="dropdown-menu-trigger"][data-state="open"]',
            ) ?? (document.activeElement as HTMLElement)
        setDialog(action)
    }
    let playlistId = ''
    try {
        if (route.startsWith('/playlists/'))
            playlistId = decodeURIComponent(route.slice(11))
    } catch {}
    const playlist = catalog.playlists.find((p) => p.id === playlistId)
    useEffect(() => {
        void runtime.api.ready
            .then(() => runtime.catalog.reload())
            .catch(reportError)
        void runtime.api.settings
            .get()
            .then((s) => {
                setStorageRoot(s.storageRoot)
                if (s.shortcutWarnings?.length)
                    toast.warning('Alguns atalhos estão indisponíveis.', {
                        description: s.shortcutWarnings.join('\n'),
                    })
            })
            .catch(reportError)
    }, [runtime])
    useEffect(() => {
        if (
            ![
                '/player',
                '/library',
                '/playlists',
                '/settings',
                '/about',
            ].includes(route) &&
            !playlistId
        ) {
            window.history.replaceState(null, '', '#/player')
            window.dispatchEvent(new HashChangeEvent('hashchange'))
        } else if (
            playlistId &&
            !catalog.loading &&
            !catalog.error &&
            !playlist
        )
            navigate('/playlists')
    }, [route, playlistId, playlist, catalog.loading, catalog.error])
    useEffect(() => {
        const handle = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key.toLowerCase() === 'f' && !dialog) {
                const field =
                    document.querySelector<HTMLInputElement>(
                        '[data-page-search]',
                    )
                if (field) {
                    e.preventDefault()
                    field.focus()
                    field.select()
                }
            }
        }
        window.addEventListener('keydown', handle)
        return () => window.removeEventListener('keydown', handle)
    }, [dialog])
    const importMidi = () =>
        run(
            runtime.catalog
                .mutate(() => runtime.api.library.importMany())
                .then((report) => {
                    if (!report) return
                    if (report.failed.length)
                        openDialog({ kind: 'import-report', report })
                    const entry = report.imported[0]
                    if (report.imported.length === 1 && entry)
                        toast.success('Música importada.', {
                            action: {
                                label: 'Abrir no tocador',
                                onClick: () =>
                                    run(
                                        runtime.api.library
                                            .open(entry.id)
                                            .then(() => navigate('/player')),
                                    ),
                            },
                        })
                    else if (report.imported.length > 1)
                        toast.success(
                            `${report.imported.length} músicas importadas.`,
                            {
                                action: {
                                    label: 'Ver na biblioteca',
                                    onClick: () => navigate('/library'),
                                },
                            },
                        )
                }),
        )
    const close = () => {
        setDialog(null)
        requestAnimationFrame(() => {
            ;(returnFocus.current?.isConnected
                ? returnFocus.current
                : document.querySelector<HTMLElement>('main')
            )?.focus()
        })
        void runtime.api.settings
            .get()
            .then((s) => setStorageRoot(s.storageRoot))
            .catch(reportError)
    }
    const props = { runtime, open: openDialog, importMidi }
    return (
        <TooltipProvider>
            <div className="desktop-shell">
                <WindowChrome api={runtime.api} />
                <SidebarProvider className="app-shell">
                    <AppSidebar
                        {...{
                            catalog,
                            route,
                            playlistId,
                            storageRoot,
                        }}
                    />
                    <div className="workspace">
                        <div className="navigation-history">
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Voltar"
                                onClick={() => window.history.back()}
                            >
                                <ArrowLeft />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label="Avançar"
                                onClick={() => window.history.forward()}
                            >
                                <ArrowRight />
                            </Button>
                        </div>
                        <ScrollPage
                            key={`${runtime.navigation.epoch}:${route}`}
                            runtime={runtime}
                            route={route}
                        >
                            {route === '/settings' ? (
                                <SettingsPage
                                    api={runtime.api}
                                    storageRoot={storageRoot}
                                    chooseDirectory={() =>
                                        openDialog({ kind: 'storage' })
                                    }
                                />
                            ) : route === '/about' ? (
                                <AboutPage api={runtime.api} />
                            ) : route === '/library' ? (
                                <LibraryPage {...props} />
                            ) : route === '/playlists' ? (
                                <PlaylistsPage {...props} />
                            ) : playlist ? (
                                <PlaylistPage {...props} playlist={playlist} />
                            ) : playlistId ? (
                                <CatalogError runtime={runtime} />
                            ) : (
                                <Player
                                    runtime={runtime}
                                    importMidi={importMidi}
                                />
                            )}
                        </ScrollPage>
                    </div>
                </SidebarProvider>
                <Transport runtime={runtime} />
                {dialog && (
                    <AppDialog
                        key={`${dialog.kind}:${'playlist' in dialog ? dialog.playlist.id : ''}`}
                        runtime={runtime}
                        action={dialog}
                        close={close}
                    />
                )}
                <Toaster position="top-right" closeButton richColors />
            </div>
        </TooltipProvider>
    )
}
