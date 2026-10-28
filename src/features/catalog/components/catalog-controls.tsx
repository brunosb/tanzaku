import { ChevronLeft, ChevronRight, Music2, Search } from 'lucide-react'
import { type CatalogContext } from '@/features/catalog/model/context'
import { useCatalog } from '@/features/catalog/model/hooks'
import { run } from '@/shared/lib/report-error'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import {
    Pagination,
    PaginationContent,
    PaginationItem,
} from '@/shared/ui/pagination'
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/shared/ui/select'
export function SearchField({
    value,
    onChange,
    placeholder = 'Buscar por nome…',
    autoFocus = false,
}: {
    value: string
    onChange: (value: string) => void
    placeholder?: string
    autoFocus?: boolean
}) {
    return (
        <div className="search-field">
            <Search size={17} />
            <Input
                type="search"
                data-page-search
                aria-label={placeholder}
                placeholder={placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                autoFocus={autoFocus}
            />
        </div>
    )
}
export function Choice({
    label,
    value,
    onChange,
    options,
}: {
    label: string
    value: string
    onChange: (v: string) => void
    options: [string, string][]
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger aria-label={label}>
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {options.map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                        {label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
export function Pages({
    total,
    page,
    pages,
    onPage,
    unit = 'músicas',
}: {
    total: number
    page: number
    pages: number
    onPage: (page: number) => void
    unit?: string
}) {
    return (
        <div className="page-pagination">
            <span>
                {total} {unit} encontradas
            </span>
            <Pagination aria-label="Paginação">
                <PaginationContent>
                    <PaginationItem>
                        <Button
                            variant="outline"
                            size="sm"
                            aria-label="Página anterior"
                            disabled={page <= 1}
                            onClick={() => onPage(page - 1)}
                        >
                            <ChevronLeft />
                        </Button>
                    </PaginationItem>
                    <PaginationItem>
                        <span className="page-number">
                            {page} / {pages}
                        </span>
                    </PaginationItem>
                    <PaginationItem>
                        <Button
                            variant="outline"
                            size="sm"
                            aria-label="Próxima página"
                            disabled={page >= pages}
                            onClick={() => onPage(page + 1)}
                        >
                            <ChevronRight />
                        </Button>
                    </PaginationItem>
                </PaginationContent>
            </Pagination>
        </div>
    )
}
export function Empty({
    title,
    children,
}: {
    title: string
    children?: React.ReactNode
}) {
    return (
        <div className="empty-state">
            <Music2 size={30} />
            <strong>{title}</strong>
            {children}
        </div>
    )
}
export function CatalogError({ runtime }: { runtime: CatalogContext }) {
    const catalog = useCatalog(runtime)
    return catalog.error ? (
        <div className="error-banner" role="alert">
            <span>{catalog.error}</span>
            <Button
                variant="outline"
                size="sm"
                onClick={() => run(runtime.catalog.reload())}
            >
                Tentar novamente
            </Button>
        </div>
    ) : catalog.loading ? (
        <div className="loading-state" role="status">
            Carregando biblioteca…
        </div>
    ) : null
}
export function selectPage(
    selected: string[],
    ids: string[],
    checked: boolean,
) {
    const next = new Set(selected)
    for (const id of ids) {
        if (checked) next.add(id)
        else next.delete(id)
    }
    return [...next]
}
