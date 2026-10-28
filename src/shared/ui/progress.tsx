import { Progress as ProgressPrimitive } from 'radix-ui'
import * as React from 'react'
import { cn } from '@/shared/lib/utils'

function Progress({
    className,
    value,
    ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
    return (
        <ProgressPrimitive.Root
            data-slot="progress"
            value={value}
            className={cn(
                'relative h-2 w-full overflow-hidden rounded-full bg-primary/20',
                className,
            )}
            {...props}
        >
            <ProgressPrimitive.Indicator
                data-slot="progress-indicator"
                className={cn(
                    'h-full w-full flex-1 bg-primary transition-all motion-reduce:transition-none',
                    value == null && 'progress-indeterminate',
                )}
                style={
                    value == null
                        ? undefined
                        : { transform: `translateX(-${100 - value}%)` }
                }
            />
        </ProgressPrimitive.Root>
    )
}

export { Progress }
