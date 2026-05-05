import { useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ApiError, auth } from '../lib/api.js';

export function Login() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (pw: string) => auth.login(pw),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['auth', 'session'] });
      navigate('/profiles');
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        if (err.status === 401) setError('Wrong password.');
        else if (err.status === 429)
          setError('Too many attempts. Try again in a few minutes.');
        else setError('Something went wrong. Please try again.');
      } else {
        setError('Network error. Please try again.');
      }
    },
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!password) return;
    mutation.mutate(password);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-bg text-fg px-6">
      <div className="absolute inset-0 pointer-events-none bg-gradient-to-b from-secondary/10 via-transparent to-transparent" />
      <div className="relative w-full max-w-sm">
        <div className="text-center mb-10">
          <h1 className="text-5xl font-semibold tracking-tight">
            stream<span className="text-accent">.</span>
          </h1>
          <p className="mt-3 text-sm text-fg/60">Enter the password to continue.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="password" className="sr-only">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={mutation.isPending}
              placeholder="Password"
              className="w-full h-12 rounded-md bg-surface border border-border/40 px-4 text-fg placeholder:text-fg/40 focus:border-accent focus:outline-none transition-colors"
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={mutation.isPending || password.length === 0}
            className="w-full h-12 rounded-md bg-accent text-fg font-medium hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {mutation.isPending ? 'Signing in…' : 'Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
