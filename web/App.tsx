import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { api, errorMessage, type Role } from './api';
const Admin = lazy(() =>
  import('./components/Admin').then((module) => ({ default: module.Admin })),
);
// Chargé à part lui aussi : l’administration ne télécharge ni three.js ni la pile audio.
const Mirror = lazy(() =>
  import('./components/Mirror').then((module) => ({ default: module.Mirror })),
);

import { useMirror } from './useMirror';

export function App() {
  const [role, setRole] = useState<Role>(() =>
    location.pathname.startsWith('/admin') ? 'admin' : 'kiosk',
  );
  const currentRole = useRef(role);
  currentRole.current = role;
  useEffect(() => {
    const sync = () => {
      // Les rubriques de l’admin changent seulement le fragment (#modules) : ne
      // réauthentifier que lorsque l’on passe réellement du miroir à l’admin.
      const next: Role = location.pathname.startsWith('/admin') ? 'admin' : 'kiosk';
      if (next === currentRole.current) return;
      setAuthenticated(null);
      setRole(next);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .auth(role)
      .then((auth) => {
        if (cancelled) return;
        // Un appareil du réseau local doit d’abord être autorisé comme miroir (role null).
        setAuthenticated(role === 'admin' ? auth.role === 'admin' : auth.role !== null);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        if (role === 'admin') {
          setAuthenticated(false);
          setError(errorMessage(failure));
        } else {
          // Le miroir reste accessible même si l’API n’a pas encore répondu.
          setAuthenticated(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [role]);

  if (authenticated === null && role === 'admin') return <AdminLoading />;
  if (authenticated === null) return <MirrorLoading />;
  if (!authenticated)
    return (
      <Login
        initialError={error}
        mirror={role === 'kiosk'}
        onLogin={() => {
          setError(null);
          setAuthenticated(true);
        }}
      />
    );
  return (
    <ConnectedApp
      key={role}
      role={role}
      onLogout={() => {
        setError(null);
        setAuthenticated(false);
      }}
      onAuthenticationExpired={() => {
        setError('Votre session a expiré ou le serveur a redémarré. Reconnectez cet espace.');
        setAuthenticated(false);
      }}
    />
  );
}

function ConnectedApp({
  role,
  onLogout,
  onAuthenticationExpired,
}: {
  role: Role;
  onLogout: () => void;
  onAuthenticationExpired: () => void;
}) {
  const connection = useMirror(role);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // L’administration nomme sa rubrique elle-même ; le miroir garde un titre neutre.
  useEffect(() => {
    if (role === 'kiosk') document.title = 'Cornelius';
  }, [role]);
  useEffect(() => {
    if (connection.authenticationExpired) onAuthenticationExpired();
  }, [connection.authenticationExpired, onAuthenticationExpired]);
  async function logout() {
    setBusy(true);
    try {
      await api.logout();
      onLogout();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {role === 'admin' ? (
        <Suspense fallback={<AdminLoading />}>
          <Admin connection={connection} onLogout={logout} loggingOut={busy} />
        </Suspense>
      ) : (
        // Même écran que pendant la connexion : pas de changement visible entre les deux attentes.
        <Suspense fallback={<MirrorLoading />}>
          <Mirror connection={connection} />
        </Suspense>
      )}
      {error && (
        <div className="toast error" role="alert">
          {error}
          <button aria-label="Fermer l’erreur" onClick={() => setError(null)}>
            ×
          </button>
        </div>
      )}
    </>
  );
}

/** Attente du miroir : réponse de l’authentification, puis chargement de son code. */
function MirrorLoading() {
  return (
    <main className="loading-screen">
      <span className="brand">
        cornelius<span> / </span>
      </span>
      <p>Connexion au miroir…</p>
    </main>
  );
}

// Même fond que l’admin : pas de flash noir du miroir entre la connexion et l’affichage.
function AdminLoading() {
  useEffect(() => {
    document.title = 'Administration Cornelius';
  }, []);
  return (
    <main className="admin-shell admin-login dark" aria-busy="true">
      <div className="admin-login-inner">
        <span className="admin-login-brand">
          <span className="admin-orb" aria-hidden="true" />
        </span>
        <p className="admin-eyebrow" role="status">
          Ouverture de l’administration…
        </p>
      </div>
    </main>
  );
}

function Login({
  initialError,
  mirror = false,
  onLogin,
}: {
  initialError: string | null;
  /** Miroir ouvert depuis un appareil du réseau local pas encore autorisé. */
  mirror?: boolean;
  onLogin: () => void;
}) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState(initialError);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    document.title = 'Connexion · Cornelius';
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.login(password);
      setPassword('');
      onLogin();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin-shell admin-login dark">
      <div className="admin-login-inner">
        <a href="/" className="admin-login-brand" aria-label="Ouvrir le miroir Cornelius">
          <span className="admin-orb" aria-hidden="true" />
        </a>
        <p className="admin-eyebrow">
          {mirror ? 'Miroir sur cet appareil' : 'Espace administration'}
        </p>
        <h1>Cornelius</h1>
        {mirror ? (
          <p className="admin-login-intro">
            Cet appareil n’est pas encore autorisé à afficher le miroir. Entrez une fois le mot de
            passe administrateur : il restera autorisé.
          </p>
        ) : (
          <p className="admin-login-intro">
            Réglages de votre assistant vocal.
            <br />
            Votre maison, en coulisses.
          </p>
        )}
        <form
          className="admin-login-form"
          onSubmit={(event) => {
            void submit(event);
          }}
        >
          <label htmlFor="admin-password">Mot de passe administrateur</label>
          <input
            id="admin-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Votre mot de passe"
            required
            disabled={busy}
            autoFocus
          />
          {error && (
            <p className="admin-login-error" role="alert">
              {error}
            </p>
          )}
          <button type="submit" disabled={busy || !password.trim()}>
            {busy ? 'Connexion…' : mirror ? 'Autoriser cet appareil' : 'Ouvrir cet espace'}
          </button>
          <p className="admin-login-help">
            Le mot de passe est défini par <code>CORNELIUS_ADMIN_PASSWORD</code> dans le fichier{' '}
            <code>.env</code> de votre serveur.
          </p>
        </form>
        {!mirror && (
          <a className="admin-login-link" href="/">
            Accéder au miroir <span aria-hidden="true">→</span>
          </a>
        )}
      </div>
    </main>
  );
}
