import { FolderCog, Library, ListMusic, Music2 } from 'lucide-react'
import { collator } from '@/features/catalog/model/catalog-model'
import { Button } from '@/shared/ui/button'
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
} from '@/shared/ui/sidebar'
import type { DialogAction } from '../dialogs/app-dialog'
import { navigate } from '../navigation/navigation-store'
import type { Runtime } from '../runtime'

export function AppSidebar({
    catalog,
    route,
    playlistId,
    storageRoot,
    openDialog,
}: {
    catalog: ReturnType<Runtime['catalog']['get']>
    route: string
    playlistId: string
    storageRoot: string
    openDialog: (action: DialogAction) => void
}) {
    return (
        <Sidebar collapsible="none" className="navigation">
            <SidebarHeader>
                <button className="brand" onClick={() => navigate('/player')}>
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
                                            (item.path === '/playlists' &&
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
                    <SidebarGroupLabel>SUAS PLAYLISTS</SidebarGroupLabel>
                    <SidebarGroupContent>
                        <SidebarMenu>
                            {[...catalog.playlists]
                                .sort((a, b) =>
                                    collator.compare(a.name, b.name),
                                )
                                .slice(0, 8)
                                .map((p) => (
                                    <SidebarMenuItem key={p.id}>
                                        <SidebarMenuButton
                                            asChild
                                            isActive={playlistId === p.id}
                                        >
                                            <a
                                                href={`#/playlists/${encodeURIComponent(p.id)}`}
                                                title={p.name}
                                            >
                                                <ListMusic />
                                                <span>{p.name}</span>
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
    )
}
