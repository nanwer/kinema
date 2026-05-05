import { Search } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useProfileStore } from '../lib/profile-store.js';
import { ProfileAvatar } from './ProfileAvatar.js';

type Props = { children: React.ReactNode };

export function AppShell({ children }: Props) {
  const navigate = useNavigate();
  const { currentProfileId, profiles } = useProfileStore();
  const current = profiles.find((p) => p.id === currentProfileId) ?? null;

  return (
    <div className="min-h-screen flex flex-col bg-bg text-fg">
      <header className="sticky top-0 z-40 bg-surface/80 backdrop-blur border-b border-border/50">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 h-14 sm:h-16 flex items-center justify-between gap-3">
          <Link to="/" className="font-semibold text-lg sm:text-xl tracking-tight">
            stream<span className="text-accent">.</span>
          </Link>

          <div className="flex items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() => navigate('/search')}
              className="inline-flex items-center gap-2 rounded-full border border-border/40 bg-muted/50 hover:bg-muted text-fg/80 hover:text-fg h-9 px-3 sm:px-4 text-sm transition-colors"
              aria-label="Search"
            >
              <Search size={16} />
              <span className="hidden sm:inline">Search</span>
            </button>

            <button
              type="button"
              onClick={() => navigate('/profiles')}
              className="rounded-full focus-visible:ring-2 focus-visible:ring-accent"
              aria-label="Switch profile"
            >
              {current ? (
                <ProfileAvatar
                  name={current.name}
                  avatarUrl={current.avatar_url}
                  size="sm"
                />
              ) : (
                <ProfileAvatar name="?" size="sm" />
              )}
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">{children}</main>
    </div>
  );
}
