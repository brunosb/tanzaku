import { useEffect, useState } from 'react'
import type { AppInfo, TanzakuApi } from '@/shared/api/contracts'
import { run } from '@/shared/lib/report-error'
import { AppLogo } from '@/shared/ui/app-logo'
import { Button } from '@/shared/ui/button'

export function AboutPage({ api }: { api: TanzakuApi }) {
    const [info, setInfo] = useState<AppInfo | null>(null)
    const [error, setError] = useState('')
    useEffect(() => {
        let alive = true
        void api.app
            .info()
            .then((value) => {
                if (alive) setInfo(value)
            })
            .catch((e) => {
                if (alive) setError(String(e))
            })
        return () => {
            alive = false
        }
    }, [api])
    return (
        <>
            <header className="page-heading">
                <div>
                    <span className="eyebrow">O PROJETO</span>
                    <h1>Sobre</h1>
                </div>
            </header>
            <section className="settings-card about-card">
                <AppLogo className="about-logo" />
                <h2>Tanzaku</h2>
                <p>Seu espaço musical em Where Winds Meet.</p>
                {error && (
                    <p role="alert" className="dialog-error">
                        {error}
                    </p>
                )}
                {info && (
                    <>
                        <dl>
                            <dt>Autor</dt>
                            <dd>{info.author}</dd>
                            <dt>Versão</dt>
                            <dd>{info.version}</dd>
                            <dt>Licença</dt>
                            <dd>{info.license}</dd>
                        </dl>
                        <div className="actions">
                            <Button
                                variant="outline"
                                onClick={() =>
                                    run(api.app.openProjectLink('repository'))
                                }
                            >
                                GitHub · brunosb/tanzaku
                            </Button>
                            <Button
                                variant="outline"
                                onClick={() =>
                                    run(api.app.openProjectLink('issues'))
                                }
                            >
                                Reportar um problema
                            </Button>
                        </div>
                    </>
                )}
                <p>
                    Tanzaku é um projeto da comunidade, sem vínculo oficial com
                    Where Winds Meet.
                </p>
            </section>
        </>
    )
}
