import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, AlertCircle, ExternalLink, LogOut } from 'lucide-react';
import { auth, settings as settingsApi, type EnvStatus } from '../lib/api.js';

const SUBTITLE_LANG_KEY = 'default_subtitle_language';
const PROWLARR_URL = 'http://127.0.0.1:9696';

export function Settings() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const settingsQuery = useQuery({
    queryKey: ['settings'],
    queryFn: () => settingsApi.get(),
  });

  const setMutation = useMutation({
    mutationFn: ({ key, value }: { key: string; value: string }) =>
      settingsApi.set(key, value),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const logoutMutation = useMutation({
    mutationFn: () => auth.logout(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      navigate('/login');
    },
  });

  const [subLang, setSubLang] = useState('en');

  useEffect(() => {
    const v = settingsQuery.data?.settings?.[SUBTITLE_LANG_KEY];
    if (typeof v === 'string') setSubLang(v);
  }, [settingsQuery.data]);

  const env: EnvStatus = settingsQuery.data?.env_status ?? {
    tmdb: false,
    prowlarr: false,
    opensubtitles: false,
    subdl: false,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 space-y-10">
      <div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-fg/60 mt-1">
          Manage integrations, preferences, and your session.
        </p>
      </div>

      <Section title="API status">
        <div className="rounded-lg border border-border/40 bg-surface overflow-hidden">
          <StatusRow label="TMDB" ok={env.tmdb} />
          <StatusRow label="Prowlarr" ok={env.prowlarr} />
          <StatusRow label="OpenSubtitles" ok={env.opensubtitles} />
          <StatusRow label="Subdl" ok={env.subdl} last />
        </div>
      </Section>

      <Section title="External UIs">
        <div className="rounded-lg border border-border/40 bg-surface p-4 space-y-3">
          <a
            href={PROWLARR_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 h-10 px-4 rounded-md bg-secondary/60 hover:bg-secondary text-fg font-medium transition-colors"
          >
            Open Prowlarr UI
            <ExternalLink size={14} />
          </a>
          <p className="text-xs text-fg/60 leading-relaxed">
            Prowlarr is bound to localhost only. Open this on the server itself; the
            link won&apos;t resolve from a remote browser.
          </p>
        </div>
      </Section>

      <Section title="Preferences">
        <div className="rounded-lg border border-border/40 bg-surface p-4 space-y-2">
          <label htmlFor="sub-lang" className="block text-sm font-medium text-fg">
            Default subtitle language
          </label>
          <input
            id="sub-lang"
            type="text"
            value={subLang}
            onChange={(e) => setSubLang(e.target.value)}
            onBlur={() => {
              const v = subLang.trim() || 'en';
              if (v !== settingsQuery.data?.settings?.[SUBTITLE_LANG_KEY]) {
                setMutation.mutate({ key: SUBTITLE_LANG_KEY, value: v });
              }
            }}
            placeholder="en"
            className="w-full sm:w-48 h-10 rounded-md bg-bg border border-border/40 px-3 text-fg placeholder:text-fg/40 focus:border-accent focus:outline-none transition-colors"
          />
          <p className="text-xs text-fg/60">
            Two-letter ISO code (e.g. <code className="text-fg/80">en</code>,{' '}
            <code className="text-fg/80">es</code>). Saves on blur.
          </p>
        </div>
      </Section>

      <Section title="Profiles">
        <div className="rounded-lg border border-border/40 bg-surface p-4 flex items-center justify-between gap-3">
          <p className="text-sm text-fg/70">
            Manage profiles in the profile picker.
          </p>
          <button
            type="button"
            onClick={() => navigate('/profiles')}
            className="h-10 px-4 rounded-md bg-secondary/60 hover:bg-secondary text-fg font-medium transition-colors whitespace-nowrap"
          >
            Manage profiles
          </button>
        </div>
      </Section>

      <Section title="Session">
        <button
          type="button"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
          className="inline-flex items-center gap-2 h-10 px-4 rounded-md border border-border/40 text-fg hover:bg-muted disabled:opacity-50 transition-colors"
        >
          <LogOut size={16} />
          {logoutMutation.isPending ? 'Signing out…' : 'Sign out'}
        </button>
      </Section>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h2 className="text-xs uppercase tracking-widest text-fg/50 font-medium">
        {title}
      </h2>
      {children}
    </section>
  );
}

function StatusRow({
  label,
  ok,
  last,
}: {
  label: string;
  ok: boolean;
  last?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between px-4 py-3 ${last ? '' : 'border-b border-border/40'}`}
    >
      <span className="text-sm text-fg">{label}</span>
      {ok ? (
        <span className="inline-flex items-center gap-1.5 text-sm text-emerald-400">
          <Check size={16} />
          <span className="sr-only sm:not-sr-only">Configured</span>
        </span>
      ) : (
        <span className="inline-flex items-center gap-1.5 text-sm text-destructive">
          <AlertCircle size={16} />
          <span className="sr-only sm:not-sr-only">Missing</span>
        </span>
      )}
    </div>
  );
}
