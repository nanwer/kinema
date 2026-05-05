import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, X } from 'lucide-react';
import { auth, profiles as profilesApi } from '../lib/api.js';
import { useProfileStore } from '../lib/profile-store.js';
import { ProfileAvatar } from '../components/ProfileAvatar.js';
import type { Profile } from '../../shared/types.js';

type ModalMode =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'edit'; profile: Profile };

export function ProfilePicker() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const setProfiles = useProfileStore((s) => s.setProfiles);
  const [modal, setModal] = useState<ModalMode>({ kind: 'closed' });

  const sessionQuery = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: () => auth.session(),
    staleTime: 10_000,
  });

  const profilesQuery = useQuery({
    queryKey: ['profiles'],
    queryFn: () => profilesApi.list(),
  });

  useEffect(() => {
    if (profilesQuery.data) setProfiles(profilesQuery.data.profiles);
  }, [profilesQuery.data, setProfiles]);

  const selectMutation = useMutation({
    mutationFn: (id: number) => auth.selectProfile(id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      navigate('/');
    },
  });

  const onSelect = (p: Profile) => {
    if (selectMutation.isPending) return;
    selectMutation.mutate(p.id);
  };

  const isAuthed = sessionQuery.data?.authed ?? false;
  const list = profilesQuery.data?.profiles ?? [];
  const empty = !profilesQuery.isLoading && list.length === 0;

  return (
    <div className="min-h-screen bg-bg text-fg flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-3xl">
        <div className="text-center mb-12">
          <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight">
            Who&apos;s watching?
          </h1>
          {!isAuthed && (
            <p className="mt-2 text-sm text-fg/60">Loading session…</p>
          )}
        </div>

        {empty ? (
          <div className="text-center space-y-6">
            <p className="text-fg/70">Create your first profile to get started.</p>
            <button
              type="button"
              onClick={() => setModal({ kind: 'create' })}
              className="inline-flex items-center gap-2 h-11 px-5 rounded-md bg-accent text-fg font-medium hover:bg-accent/90 transition-colors"
            >
              <Plus size={18} />
              Create your first profile
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center gap-6 sm:gap-10">
            {list.map((p) => (
              <ProfileTile
                key={p.id}
                profile={p}
                onSelect={() => onSelect(p)}
                onEdit={() => setModal({ kind: 'edit', profile: p })}
              />
            ))}
            <button
              type="button"
              onClick={() => setModal({ kind: 'create' })}
              className="flex flex-col items-center gap-3 group"
            >
              <div className="w-20 h-20 rounded-full border-2 border-dashed border-border/60 group-hover:border-accent flex items-center justify-center transition-colors">
                <Plus size={28} className="text-fg/60 group-hover:text-accent transition-colors" />
              </div>
              <span className="text-sm text-fg/70 group-hover:text-fg transition-colors">
                Add profile
              </span>
            </button>
          </div>
        )}
      </div>

      {modal.kind === 'create' && (
        <CreateModal onClose={() => setModal({ kind: 'closed' })} />
      )}
      {modal.kind === 'edit' && (
        <EditModal
          profile={modal.profile}
          onClose={() => setModal({ kind: 'closed' })}
        />
      )}
    </div>
  );
}

function ProfileTile({
  profile,
  onSelect,
  onEdit,
}: {
  profile: Profile;
  onSelect: () => void;
  onEdit: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 group relative">
      <button
        type="button"
        onClick={onSelect}
        className="rounded-full focus-visible:ring-2 focus-visible:ring-accent transition-transform hover:scale-105"
      >
        <ProfileAvatar
          name={profile.name}
          avatarUrl={profile.avatar_url}
          size="lg"
        />
      </button>
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium text-fg">{profile.name}</span>
        <button
          type="button"
          onClick={onEdit}
          aria-label={`Edit ${profile.name}`}
          className="p-1 rounded text-fg/50 hover:text-fg hover:bg-muted transition-colors"
        >
          <Pencil size={12} />
        </button>
      </div>
    </div>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm bg-surface border border-border/40 rounded-lg p-6 relative"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1 rounded text-fg/60 hover:text-fg hover:bg-muted transition-colors"
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function CreateModal({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (n: string) => profilesApi.create(n),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      onClose();
    },
    onError: () => setError('Failed to create profile.'),
  });

  return (
    <ModalShell title="New profile" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          mutation.mutate(name.trim());
        }}
        className="space-y-4"
      >
        <input
          type="text"
          autoFocus
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full h-11 rounded-md bg-bg border border-border/40 px-3 text-fg placeholder:text-fg/40 focus:border-accent focus:outline-none transition-colors"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={onClose}
            className="h-10 px-4 rounded-md text-fg/80 hover:text-fg hover:bg-muted transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={mutation.isPending || !name.trim()}
            className="h-10 px-4 rounded-md bg-accent text-fg font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
          >
            {mutation.isPending ? 'Creating…' : 'Create'}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function EditModal({
  profile,
  onClose,
}: {
  profile: Profile;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [name, setName] = useState(profile.name);
  const [error, setError] = useState<string | null>(null);

  const updateMutation = useMutation({
    mutationFn: (n: string) => profilesApi.update(profile.id, { name: n }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      onClose();
    },
    onError: () => setError('Failed to update profile.'),
  });

  const deleteMutation = useMutation({
    mutationFn: () => profilesApi.delete(profile.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['profiles'] });
      onClose();
    },
    onError: () => setError('Failed to delete profile.'),
  });

  return (
    <ModalShell title="Edit profile" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          updateMutation.mutate(name.trim());
        }}
        className="space-y-4"
      >
        <input
          type="text"
          autoFocus
          placeholder="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full h-11 rounded-md bg-bg border border-border/40 px-3 text-fg placeholder:text-fg/40 focus:border-accent focus:outline-none transition-colors"
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap gap-2 justify-between">
          <button
            type="button"
            onClick={() => {
              if (confirm(`Delete profile "${profile.name}"? Watch state will be lost.`)) {
                deleteMutation.mutate();
              }
            }}
            disabled={deleteMutation.isPending}
            className="h-10 px-4 rounded-md text-destructive hover:bg-destructive/10 disabled:opacity-50 transition-colors"
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-10 px-4 rounded-md text-fg/80 hover:text-fg hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={updateMutation.isPending || !name.trim()}
              className="h-10 px-4 rounded-md bg-accent text-fg font-medium hover:bg-accent/90 disabled:opacity-50 transition-colors"
            >
              {updateMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
