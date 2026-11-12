type ConnectionDotProps = {
  online: boolean;
  label: string;
  className?: string;
  decorative?: boolean;
  size?: 'sm' | 'md';
};

const ConnectionDot = ({
  online,
  label,
  className = '',
  decorative = false,
  size = 'sm',
}: ConnectionDotProps) => (
  <span
    role={decorative ? undefined : 'status'}
    data-presence={decorative ? undefined : online ? 'online' : 'offline'}
    aria-hidden={decorative ? true : undefined}
    aria-label={decorative ? undefined : label}
    title={decorative ? undefined : label}
    className={`inline-block shrink-0 rounded-full ${size === 'md' ? 'h-3 w-3' : 'h-2.5 w-2.5'} ${
      online
        ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.95)]'
        : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.95)]'
    } ${className}`.trim()}
  />
);

export default ConnectionDot;
