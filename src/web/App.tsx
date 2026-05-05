import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { PasswordGate } from './components/PasswordGate.js';
import { Login } from './pages/Login.js';
import { ProfilePicker } from './pages/ProfilePicker.js';
import { Settings } from './pages/Settings.js';

const Home = lazy(() => import('./pages/Home.js').then((m) => ({ default: m.Home })));
const Search = lazy(() =>
  import('./pages/Search.js').then((m) => ({ default: m.Search })),
);
const Movie = lazy(() =>
  import('./pages/Movie.js').then((m) => ({ default: m.Movie })),
);
const Show = lazy(() => import('./pages/Show.js').then((m) => ({ default: m.Show })));
const Player = lazy(() =>
  import('./pages/Player.js').then((m) => ({ default: m.Player })),
);

function PageFallback() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <div
        className="h-8 w-8 rounded-full border-2 border-border/40 border-t-accent animate-pulse"
        aria-label="Loading"
      />
    </div>
  );
}

function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center text-center">
      <div>
        <div className="text-xs uppercase tracking-widest text-fg/50">stream.</div>
        <h1 className="mt-2 text-2xl font-semibold">Not found</h1>
        <p className="mt-1 text-fg/60 text-sm">That page doesn&apos;t exist.</p>
      </div>
    </div>
  );
}

function Shelled({ children }: { children: React.ReactNode }) {
  return (
    <PasswordGate>
      <AppShell>
        <Suspense fallback={<PageFallback />}>{children}</Suspense>
      </AppShell>
    </PasswordGate>
  );
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route
        path="/profiles"
        element={
          <PasswordGate>
            <ProfilePicker />
          </PasswordGate>
        }
      />
      <Route path="/" element={<Shelled><Home /></Shelled>} />
      <Route path="/search" element={<Shelled><Search /></Shelled>} />
      <Route path="/movie/:tmdbId" element={<Shelled><Movie /></Shelled>} />
      <Route path="/show/:tmdbId" element={<Shelled><Show /></Shelled>} />
      <Route path="/watch/movie/:tmdbId" element={<Shelled><Player /></Shelled>} />
      <Route
        path="/watch/show/:tmdbId/:season/:episode"
        element={<Shelled><Player /></Shelled>}
      />
      <Route path="/settings" element={<Shelled><Settings /></Shelled>} />
      <Route
        path="*"
        element={
          <Shelled>
            <NotFound />
          </Shelled>
        }
      />
    </Routes>
  );
}
