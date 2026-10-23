import { useEffect, useState } from 'react';
import { request, errorMessage } from '../../api';
import type { MobileDevice } from '../../../shared/mobile';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

export function MobileAccess({ defaultPassword }: { defaultPassword: boolean }) {
  const [devices, setDevices] = useState<MobileDevice[]>([]);
  const [invitation, setInvitation] = useState<{
    link: string;
    svg: string;
    invitation: { expiresAt: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [remote, setRemote] = useState(false);
  const [localUrl, setLocalUrl] = useState(location.protocol === 'https:' ? location.origin : '');
  const refresh = async () => {
    const value = await request<{ devices: MobileDevice[]; remoteConfigured: boolean }>(
      '/api/admin/mobile',
    );
    setDevices(value.devices);
    setRemote(value.remoteConfigured);
  };
  useEffect(() => {
    void refresh().catch((failure) => setError(errorMessage(failure)));
  }, []);
  useEffect(() => {
    if (!invitation) return;
    const timer = setTimeout(
      () => setInvitation(null),
      Math.max(0, invitation.invitation.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [invitation]);
  return (
    <Card>
      <CardHeader>
        <CardTitle>App iPhone</CardTitle>
        <CardDescription>
          Le même miroir, avec le micro et la caméra de votre iPhone. Association unique, sans
          compte Cornelius.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <label className="block space-y-2">
          Adresse HTTPS du serveur sur le réseau local
          <input
            className="block w-full rounded-md border border-input bg-background px-3 py-2"
            type="url"
            placeholder="https://cornelius.local:3443"
            value={localUrl}
            onChange={(event) => setLocalUrl(event.target.value)}
          />
        </label>
        <p className="text-muted-foreground">
          Sur Unraid, utilisez l’adresse de l’hôte affichée dans votre navigateur, avec le port
          3443.
        </p>
        <Button
          disabled={defaultPassword || busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            setInvitation(null);
            try {
              setInvitation(
                await request('/api/admin/mobile/invitations', {
                  method: 'POST',
                  body: JSON.stringify(localUrl ? { localUrl } : {}),
                }),
              );
              await refresh();
            } catch (failure) {
              setError(errorMessage(failure));
            } finally {
              setBusy(false);
            }
          }}
        >
          Associer un iPhone
        </Button>
        {defaultPassword && <p>Changez d’abord le mot de passe administrateur.</p>}
        {invitation && (
          <div className="space-y-2">
            <img
              className="max-w-full rounded-lg bg-white p-3"
              width="320"
              height="320"
              alt="QR code d’association Cornelius, valable cinq minutes"
              src={'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(invitation.svg)}
            />
            <a className="underline" href={invitation.link}>
              Ouvrir dans Cornelius sur cet iPhone
            </a>
            <p className="text-muted-foreground">
              Scannez ce code dans l’app. Invitation personnelle, utilisable une fois et expirant
              après cinq minutes.
            </p>
          </div>
        )}
        {devices.length > 0 && (
          <ul className="space-y-2" aria-label="iPhone associés">
            {devices.map((device) => (
              <li key={device.id} className="flex items-center justify-between gap-3">
                <span>{device.name}</span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={async () => {
                    try {
                      await request('/api/admin/mobile/devices/' + device.id, { method: 'DELETE' });
                      await refresh();
                    } catch (failure) {
                      setError(errorMessage(failure));
                    }
                  }}
                >
                  Révoquer
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p>
          {remote
            ? 'Accès extérieur configuré : activez Tailscale sur votre iPhone.'
            : 'À l’extérieur : connectez Unraid et l’iPhone à Tailscale, puis suivez le guide iOS pour activer l’accès mobile privé.'}
        </p>
        <p className="text-muted-foreground">
          Une seule conversation à la fois dans le foyer. Les réglages du serveur restent dans cette
          administration.
        </p>
        {error && <p role="alert">{error}</p>}
      </CardContent>
    </Card>
  );
}
