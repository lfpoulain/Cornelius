import { useRef, useState, type FormEvent } from 'react';
import { RotateCw } from 'lucide-react';
import { api } from '../../api';
import type { RunAction } from './types';
import { ConfirmAction } from './shared';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

/** Mot de passe de l’administration, changé ici sans toucher au fichier .env. */
export function AdminPasswordCard({
  defaultPassword,
  run,
}: {
  defaultPassword: boolean;
  run: RunAction;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const mismatch = confirm.length > 0 && confirm !== next;
  const tooShort = next.length > 0 && next.length < 8;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(
      'Mot de passe changé. Les autres navigateurs devront se reconnecter.',
      () => api.changePassword(current, next),
    );
    if (ok) {
      setCurrent('');
      setNext('');
      setConfirm('');
    }
  };
  return (
    <Card id="admin-password">
      <CardHeader>
        <CardTitle>Mot de passe administrateur</CardTitle>
        <CardDescription>
          Remplace celui du fichier .env, sans redémarrer. Les autres navigateurs connectés devront
          se reconnecter.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {defaultPassword && (
          <p className="mb-3">
            <Badge variant="outline">Mot de passe de départ, à changer</Badge>
          </p>
        )}
        <form className="grid max-w-md gap-3" onSubmit={(event) => void submit(event)}>
          <label className="grid gap-1.5 text-sm">
            Mot de passe actuel
            <Input
              type="password"
              autoComplete="current-password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Nouveau mot de passe (8 caractères au moins)
            <Input
              type="password"
              autoComplete="new-password"
              value={next}
              aria-invalid={tooShort || undefined}
              onChange={(event) => setNext(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-sm">
            Nouveau mot de passe, une seconde fois
            <Input
              type="password"
              autoComplete="new-password"
              value={confirm}
              aria-invalid={mismatch || undefined}
              aria-describedby={mismatch ? 'admin-password-mismatch' : undefined}
              onChange={(event) => setConfirm(event.target.value)}
            />
          </label>
          {mismatch && (
            <p id="admin-password-mismatch" className="text-sm text-destructive">
              Les deux saisies ne sont pas identiques.
            </p>
          )}
          <div>
            <Button
              type="submit"
              size="sm"
              disabled={!current || next.length < 8 || next !== confirm}
            >
              Changer le mot de passe
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Relance le serveur : utile après une modification du fichier .env. */
export function RestartServerCard({ run }: { run: RunAction }) {
  const [confirming, setConfirming] = useState(false);
  // Le bouton cède sa place à la confirmation : la ref lui rend le focus après « Annuler ».
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Serveur</CardTitle>
        <CardDescription>
          Redémarrer relit le fichier .env. Le miroir et cette page se reconnectent seuls en
          quelques secondes ; il faudra se reconnecter à l’administration.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {confirming ? (
          <ConfirmAction
            message="Redémarrer le serveur maintenant ? Une conversation en cours sera coupée."
            confirmLabel="Redémarrer"
            returnFocusTo={trigger}
            onCancel={() => setConfirming(false)}
            onConfirm={() => {
              setConfirming(false);
              void run('Redémarrage du serveur…', () => api.restartServer());
            }}
          />
        ) : (
          <Button ref={trigger} variant="outline" size="sm" onClick={() => setConfirming(true)}>
            <RotateCw aria-hidden="true" />
            Redémarrer le serveur
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
