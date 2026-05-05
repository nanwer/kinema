import { useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { auth } from '../lib/api.js';
import { useProfileStore } from '../lib/profile-store.js';

type Props = { children: React.ReactNode };

export function PasswordGate({ children }: Props) {
  const location = useLocation();
  const setCurrent = useProfileStore((s) => s.setCurrent);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['auth', 'session'],
    queryFn: () => auth.session(),
    staleTime: 10_000,
  });

  useEffect(() => {
    if (data) setCurrent(data.profileId);
  }, [data, setCurrent]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div
          className="h-10 w-10 rounded-full border-2 border-border/40 border-t-accent animate-pulse"
          aria-label="Loading"
        />
      </div>
    );
  }

  if (isError || !data || !data.authed) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (data.profileId == null && location.pathname !== '/profiles') {
    return <Navigate to="/profiles" replace />;
  }

  return <>{children}</>;
}
