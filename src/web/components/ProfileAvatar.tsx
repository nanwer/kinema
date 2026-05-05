type Size = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<Size, number> = { sm: 32, md: 48, lg: 80 };

const PALETTE = [
  'bg-accent',
  'bg-secondary',
  'bg-border',
  'bg-primary',
  'bg-destructive',
];

function pickBg(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) {
    h = (h * 31 + name.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(h) % PALETTE.length;
  return PALETTE[idx] ?? 'bg-accent';
}

type Props = {
  name: string;
  avatarUrl?: string | null;
  size?: Size;
};

export function ProfileAvatar({ name, avatarUrl, size = 'md' }: Props) {
  const px = SIZE_PX[size];
  const initial = (name.trim()[0] ?? '?').toUpperCase();
  const fontPx = Math.round(px * 0.45);

  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt={name}
        width={px}
        height={px}
        className="rounded-full object-cover border border-border/40"
        style={{ width: px, height: px }}
      />
    );
  }

  return (
    <div
      className={`${pickBg(name)} rounded-full flex items-center justify-center text-fg font-semibold border border-border/40 select-none`}
      style={{ width: px, height: px, fontSize: fontPx }}
      aria-label={name}
    >
      {initial}
    </div>
  );
}
