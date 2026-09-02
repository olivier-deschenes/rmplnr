import { cn } from '#/lib/utils.ts'
import { IconLoader } from '@tabler/icons-react'

function Spinner({ className, ...props }: React.ComponentProps<'svg'>) {
  return (
    <IconLoader
      data-slot="spinner"
      role="status"
      aria-label="Loading"
      className={cn(
        'size-4 animate-spin motion-reduce:animate-none',
        className,
      )}
      {...props}
    />
  )
}

export { Spinner }
