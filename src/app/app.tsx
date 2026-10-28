import {
    ArrowLeft,
    ArrowRight,
    FolderCog,
    Library,
    ListMusic,
    Maximize2,
    Minus,
    Music2,
    X,
} from 'lucide-react'
import {
    useEffect,
    useLayoutEffect,
    useRef,
    useState,
    useSyncExternalStore,
} from 'react'
import { toast } from 'sonner'
import {
    CatalogError,
    type DialogAction,
    LibraryPage,
    PlaylistPage,
    PlaylistsPage,
    useCatalog,
} from '../features/catalog/catalog'
import { collator } from '../features/catalog/model/catalog-model'
import {
    navigate,
    Player,
    reportError,
    run,
    Transport,
} from '../features/playback/components/player'
import { Button } from '../shared/ui/button'
import {
    Sidebar,
    SidebarContent,
    SidebarFooter,
    SidebarGroup,
    SidebarGroupContent,
    SidebarGroupLabel,
    SidebarHeader,
    SidebarMenu,
    SidebarMenuButton,
    SidebarMenuItem,
    SidebarProvider,
} from '../shared/ui/sidebar'
import { Toaster } from '../shared/ui/sonner'
import { TooltipProvider } from '../shared/ui/tooltip'
import { AppDialog } from './dialogs/app-dialog'
import type { Runtime } from './runtime'

const subscribeRoute = (fn: () => void) => {
    window.addEventListener('hashchange', fn)
    return () => window.removeEventListener('hashchange', fn)
}
const getRoute = () => window.location.hash.slice(1) || '/player'
function ScrollPage({
    runtime,
    route,
    children,
}: {
    runtime: Runtime
    route: string
    children: React.ReactNode
}) {
    const ref = useRef<HTMLElement>(null)
    useLayoutEffect(() => {
        ref.current!.scrollTop = runtime.scrolls.get(route) ?? 0
    }, [runtime, route])
    return (
        <main
            ref={ref}
            tabIndex={-1}
            className={`main-content ${route === '/player' ? 'player-page' : ''}`}
            onScroll={(e) =>
                runtime.scrolls.set(route, e.currentTarget.scrollTop)
            }
        >
            {children}
        </main>
    )
}
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
            .then((s) => setStorageRoot(s.storageRoot))
            .catch(reportError)
    }, [runtime])
    useEffect(() => {
        if (
            !['/player', '/library', '/playlists'].includes(route) &&
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
                .mutate(() => runtime.api.library.import())
                .then((entry) => {
                    if (entry)
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
                <header className="window-chrome">
                    <div className="window-drag" data-tauri-drag-region>
                        <span className="window-mark" data-tauri-drag-region>
                            T
                        </span>
                        <span data-tauri-drag-region>Tanzaku</span>
                    </div>
                    <div className="window-actions">
                        <button
                            aria-label="Minimizar"
                            className="window-action"
                            onClick={() => run(runtime.api.window.minimize())}
                        >
                            <Minus size={14} />
                        </button>
                        <button
                            aria-label="Maximizar"
                            className="window-action"
                            onClick={() =>
                                run(runtime.api.window.toggleMaximize())
                            }
                        >
                            <Maximize2 size={12} />
                        </button>
                        <button
                            aria-label="Fechar"
                            className="window-action close"
                            onClick={() => run(runtime.api.window.close())}
                        >
                            <X size={16} />
                        </button>
                    </div>
                </header>
                <SidebarProvider className="app-shell">
                    <Sidebar collapsible="none" className="navigation">
                        <SidebarHeader>
                            <button
                                className="brand"
                                onClick={() => navigate('/player')}
                            >
                                <span className="brand-mark">T</span>
                                <span className="brand-copy">
                                    <strong>Tanzaku</strong>
                                    <small>Seu espaço musical</small>
                                </span>
                            </button>
                        </SidebarHeader>
                        <SidebarContent>
                            <SidebarGroup>
                                <SidebarGroupLabel>NAVEGAR</SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {[
                                            {
                                                path: '/player',
                                                name: 'Tocador',
                                                icon: Music2,
                                            },
                                            {
                                                path: '/library',
                                                name: 'Biblioteca',
                                                icon: Library,
                                            },
                                            {
                                                path: '/playlists',
                                                name: 'Playlists',
                                                icon: ListMusic,
                                            },
                                        ].map((item) => (
                                            <SidebarMenuItem key={item.path}>
                                                <SidebarMenuButton
                                                    asChild
                                                    isActive={
                                                        route === item.path ||
                                                        (item.path ===
                                                            '/playlists' &&
                                                            !!playlistId)
                                                    }
                                                >
                                                    <a
                                                        href={`#${item.path}`}
                                                        title={item.name}
                                                    >
                                                        <item.icon />
                                                        <span>{item.name}</span>
                                                    </a>
                                                </SidebarMenuButton>
                                            </SidebarMenuItem>
                                        ))}
                                    </SidebarMenu>
                                </SidebarGroupContent>
                            </SidebarGroup>
                            <SidebarGroup className="quick-playlists">
                                <SidebarGroupLabel>
                                    SUAS PLAYLISTS
                                </SidebarGroupLabel>
                                <SidebarGroupContent>
                                    <SidebarMenu>
                                        {[...catalog.playlists]
                                            .sort((a, b) =>
                                                collator.compare(
                                                    a.name,
                                                    b.name,
                                                ),
                                            )
                                            .slice(0, 8)
                                            .map((p) => (
                                                <SidebarMenuItem key={p.id}>
                                                    <SidebarMenuButton
                                                        asChild
                                                        isActive={
                                                            playlistId === p.id
                                                        }
                                                    >
                                                        <a
                                                            href={`#/playlists/${encodeURIComponent(p.id)}`}
                                                            title={p.name}
                                                        >
                                                            <ListMusic />
                                                            <span>
                                                                {p.name}
                                                            </span>
                                                        </a>
                                                    </SidebarMenuButton>
                                                </SidebarMenuItem>
                                            ))}
                                    </SidebarMenu>
                                    <Button
                                        variant="link"
                                        className="view-all"
                                        onClick={() => navigate('/playlists')}
                                    >
                                        Ver todas
                                    </Button>
                                </SidebarGroupContent>
                            </SidebarGroup>
                        </SidebarContent>
                        <SidebarFooter>
                            <Button
                                variant="ghost"
                                className="storage-button"
                                onClick={() => openDialog({ kind: 'storage' })}
                            >
                                <FolderCog />
                                <span>Armazenamento</span>
                            </Button>
                            <small title={storageRoot} id="folder-name">
                                {storageRoot}
                            </small>
                        </SidebarFooter>
                    </Sidebar>
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
                            key={`${runtime.epoch}:${route}`}
                            runtime={runtime}
                            route={route}
                        >
                            {route === '/library' ? (
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
