import { useState } from 'react';
import { MobileAccess } from './MobileAccess';
import { TriangleAlert } from 'lucide-react';
import type { NetworkStatus } from '../../../shared/types';
import { api } from '../../api';
import { plural } from './format';
import { ConfirmAction } from './shared';
import type { RunAction } from './types';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

/** Adresses à saisir sur un téléphone, une tablette ou un autre ordinateur du réseau local. */
export function NetworkAccess({
  network,
  defaultPassword,
  run,
}: {
  network: NetworkStatus | undefined;
  defaultPassword: boolean;
  run: RunAction;
}) {
  const [confirming, setConfirming] = useState(false);
  if (!network) return null;
  const trusted = network.trustedDevices ?? 0;
  return (
    <>
    <Card>
      <CardHeader>
        <CardTitle>Accès depuis le réseau local</CardTitle>
        <CardDescription>
          {network.lan
            ? 'Le miroir et l’administration s’ouvrent aussi depuis un autre appareil connecté à la même box.'
            : 'Désactivé (CORNELIUS_LAN=0) : seul cet ordinateur ouvre Cornelius.'}
        </CardDescription>
      </CardHeader>
      {network.lan && (
        <CardContent className="space-y-3 text-sm">
          {network.urls.length > 0 ? (
            <ul className="space-y-1" aria-label="Adresses sur le réseau local">
              {network.urls.map((url) => (
                <li key={url} className="font-mono">
                  {url}/ <span className="text-muted-foreground">(miroir)</span> · {url}/admin{' '}
                  <span className="text-muted-foreground">(administration)</span>
                </li>
              ))}
            </ul>
          ) : (
            <p>Aucune adresse de réseau local détectée sur cet ordinateur (câble ou Wi‑Fi).</p>
          )}
          <p className="text-muted-foreground">
            Le navigateur avertit une première fois : le certificat est créé par Cornelius, pas par
            une autorité. Acceptez-le après avoir vérifié son empreinte SHA‑256 :
          </p>
          {network.fingerprint && (
            <p className="break-all font-mono text-xs" aria-label="Empreinte du certificat">
              {network.fingerprint}
            </p>
          )}
          <p className="text-muted-foreground">
            Sur un autre appareil, le miroir demande une seule fois le mot de passe administrateur :
            l’appareil reste ensuite autorisé.{' '}
            {trusted > 0
              ? `${plural(trusted, 'appareil autorisé', 'appareils autorisés')} pour l’instant.`
              : 'Aucun appareil autorisé pour l’instant.'}
          </p>
          {trusted > 0 &&
            (confirming ? (
              <ConfirmAction
                message="Retirer l’autorisation de tous les appareils du réseau ? Chacun devra se reconnecter."
                confirmLabel="Retirer les autorisations"
                onCancel={() => setConfirming(false)}
                onConfirm={() => {
                  setConfirming(false);
                  void run('Autorisations retirées.', () => api.forgetTrustedDevices());
                }}
              />
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                Retirer les autorisations
              </Button>
            ))}
          {defaultPassword && (
            <p className="flex items-start gap-2.5 rounded-lg border border-[#e8bc8866] bg-[#2a2519] px-3.5 py-3 text-[#f3d7b0]">
              <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Le mot de passe de départ est refusé depuis un autre appareil : changez-le dans la
                carte « Mot de passe administrateur » ci-dessus.
              </span>
            </p>
          )}
        </CardContent>
      )}
    </Card>
    <MobileAccess defaultPassword={defaultPassword} />
    </>
  );
}
