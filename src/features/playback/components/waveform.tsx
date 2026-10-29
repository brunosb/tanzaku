import { memo, useEffect, useId, useMemo, useRef, useState } from 'react'
import { Bar, BarChart, XAxis, YAxis } from 'recharts'
import type { PlaybackPlan } from '@/shared/api/contracts'
import { buildWaveform } from '../model/waveform'

export const Waveform = memo(function Waveform({
    plan,
}: {
    plan: PlaybackPlan
}) {
    const root = useRef<HTMLDivElement>(null)
    const [size, setSize] = useState({ width: 0, height: 40 })
    const gradient = useId().replace(/:/g, '')
    useEffect(() => {
        const element = root.current!
        const resize = (width: number, height: number) => {
            width = Math.round(width)
            height = Math.round(height)
            setSize((previous) =>
                previous.width === width && previous.height === height
                    ? previous
                    : { width, height },
            )
        }
        const observer = new ResizeObserver(([entry]) => {
            if (entry) resize(entry.contentRect.width, entry.contentRect.height)
        })
        observer.observe(element)
        resize(element.clientWidth, element.clientHeight)
        return () => observer.disconnect()
    }, [])
    const count = Math.max(48, Math.min(240, Math.floor(size.width / 4)))
    const data = useMemo(() => buildWaveform(plan, count), [plan, count])
    const chart = (played: boolean) => (
        <BarChart
            width={size.width}
            height={size.height}
            data={data}
            margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
            barCategoryGap="22%"
            accessibilityLayer={false}
        >
            {played && (
                <defs>
                    <linearGradient
                        id={gradient}
                        gradientUnits="userSpaceOnUse"
                        x1={0}
                        y1={0}
                        x2={size.width}
                        y2={0}
                    >
                        <stop offset="0%" stopColor="#bd8430" />
                        <stop offset="60%" stopColor="#f5c451" />
                        <stop offset="100%" stopColor="#ffe7a3" />
                    </linearGradient>
                </defs>
            )}
            <XAxis dataKey="index" hide />
            <YAxis domain={[-1, 1]} hide allowDataOverflow />
            <Bar
                dataKey="range"
                fill={played ? `url(#${gradient})` : '#40515a'}
                radius={[2, 2, 2, 2]}
                isAnimationActive={false}
            />
        </BarChart>
    )
    return (
        <div className="waveform-art" ref={root} aria-hidden="true">
            <div className="waveform-base">
                {size.width > 0 && size.height > 0 && chart(false)}
            </div>
            <div className="waveform-played">
                {size.width > 0 && size.height > 0 && chart(true)}
            </div>
        </div>
    )
})
