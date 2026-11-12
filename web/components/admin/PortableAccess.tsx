import { useEffect, useId, useState } from 'react';
import qrcode from 'qrcode-generator';
import { LockKeyhole } from 'lucide-react';
import type { PortableStatus } from '../../../shared/portable';
import { api } from '../../api';
import { ConfirmAction } from './shared';
import type { RunAction } from './types';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';
import { Switch } from '../ui/switch';
import { Label } from '../ui/label';

/** Code QR dessiné en SVG, sur fond blanc pour rester lisible par un téléphone. */
function QrCode({ text, label }: { text: string; label: string }) {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  return (
    <div
      className="size-36 shrink-0 rounded-xl bg-white p-2.5 [&>svg]:size-full"
      role="img"
      aria-label={label}
      dangerouslySetInnerHTML={{
        __html: code.createSvgTag({ cellSize: 4, margin: 0, scalable: true }),
      }}
    />
  );
}

function Address({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-lg border bg-muted px-3 py-2.5">
      <span className="break-all font-mono text-[15px] text-secondary-foreground">{url}</span>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          void navigator.clipboard?.writeText(url).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
      >
        {copied ? 'Copié' : 'Copier'}
      </Button>
    </div>
  );
}

const ago = (iso: string | null) => {
  if (!iso) return 'jamais vu';
  const minutes = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 60) return `vu il y a ${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `vu il y a ${hours} h` : `vu il y a ${Math.round(hours / 24)} jours`;
};

/**
 * Cornelius portable : Cornelius sur les téléphones du foyer, partout, sans l'ouvrir à
 * Internet. Tout se fait ici : connexion du serveur au compte Tailscale, publication sur le
 * réseau privé avec un certificat reconnu, ajout des téléphones par code QR.
 */
export function PortableAccess({ run }: { run: RunAction }) {
  const [status, setStatus] = useState<PortableStatus | null>(null);
  const [confirming, setConfirming] = useState(false);
  const switchId = useId();

  // État suivi seul : vite pendant la connexion au compte, lentement ensuite.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try {
        const next = await api.portable();
        if (!stopped) setStatus(next);
        timer = setTimeout(
          refresh,
          next.state === 'needs-login' || next.state === 'starting' ? 2000 : 15000,
        );
      } catch {
        timer = setTimeout(refresh, 15000);
      }
    };
    void refresh();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  if (!status?.configured) return null;
  const update = (label: string, action: () => Promise<PortableStatus>) =>
    run(label, async () => setStatus(await action()));

  const badge =
    status.state === 'running'
      ? status.serving
        ? { text: 'Ouvert sur le réseau privé', ok: true }
        : { text: 'Serveur connecté', ok: true }
      : status.state === 'needs-login' && status.authUrl
        ? { text: 'Connexion en attente', ok: false }
        : status.state === 'unavailable'
          ? { text: 'Tailscale injoignable', ok: false }
          : { text: 'Non connecté', ok: false };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2.5">
          Cornelius portable
          <Badge variant={badge.ok ? 'secondary' : 'outline'}>{badge.text}</Badge>
        </CardTitle>
        <CardDescription>
          Utiliser Cornelius sur votre téléphone, à la maison comme ailleurs, sans l’ouvrir à
          Internet : le serveur et vos téléphones rejoignent un réseau privé chiffré (Tailscale,
          gratuit pour un usage personnel). Seuls vos appareils y accèdent.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {status.state === 'unavailable' && (
          <p className="text-muted-foreground">
            Tailscale ne répond pas sur ce serveur{status.error ? ` (${status.error})` : ''}.
            Vérifiez que son conteneur tourne, puis rouvrez cette page.
          </p>
        )}

        {(status.state === 'stopped' ||
          (status.state === 'needs-login' && !status.authUrl) ||
          status.state === 'starting') && (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>
                Connectez ce serveur à votre compte Tailscale, créé gratuitement à la première
                connexion.
              </li>
              <li>
                Ouvrez Cornelius portable : il reçoit une adresse privée, avec un vrai certificat.
              </li>
              <li>Ajoutez vos téléphones avec un code QR.</li>
            </ol>
            <Button
              onClick={() => void update('Lien de connexion prêt.', () => api.connectPortable())}
            >
              Connecter ce serveur à Tailscale
            </Button>
          </>
        )}

        {status.state === 'needs-login' && status.authUrl && (
          <div className="flex flex-wrap items-start gap-4">
            <QrCode text={status.authUrl} label="Code QR du lien de connexion à Tailscale" />
            <div className="min-w-60 flex-1 space-y-2">
              <p>
                Ouvrez ce lien, ou scannez le code avec votre téléphone, puis connectez-vous à votre
                compte Tailscale (Google, Microsoft, Apple ou GitHub).
              </p>
              <a
                className="block break-all font-mono text-secondary-foreground underline"
                href={status.authUrl}
                target="_blank"
                rel="noreferrer"
              >
                {status.authUrl}
              </a>
              <p className="text-muted-foreground">
                En attente de la connexion… Cette carte se met à jour seule.
              </p>
            </div>
          </div>
        )}

        {status.state === 'running' && (
          <>
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1">
              <dt className="text-muted-foreground">Réseau privé</dt>
              <dd className="font-mono">{status.tailnet ?? '—'}</dd>
              <dt className="text-muted-foreground">Ce serveur</dt>
              <dd className="font-mono">
                {status.dnsName ?? '—'}
                {status.ip ? ` · ${status.ip}` : ''}
              </dd>
            </dl>

            {!status.https && (
              <p className="rounded-lg border border-[#e8bc8866] bg-[#2a2519] px-3.5 py-3 text-[#f3d7b0]">
                Les certificats HTTPS ne sont pas encore permis sur votre réseau privé. Dans la
                console Tailscale, page DNS, activez « MagicDNS » puis « HTTPS Certificates », puis
                revenez ici.
              </p>
            )}

            <div className="flex items-start gap-3 rounded-md border p-3">
              <Switch
                id={switchId}
                checked={status.serving}
                disabled={!status.https}
                onCheckedChange={(on) =>
                  void update(on ? 'Cornelius portable ouvert.' : 'Cornelius portable fermé.', () =>
                    api.servePortable(on),
                  )
                }
              />
              <div className="space-y-1">
                <Label htmlFor={switchId}>Ouvrir Cornelius portable</Label>
                <p className="text-xs text-muted-foreground">
                  Publie le miroir et l’administration sur le réseau privé uniquement, avec un
                  certificat reconnu par les navigateurs. Rien n’est ouvert sur Internet.
                </p>
              </div>
            </div>

            {status.serving && status.url && (
              <>
                <div className="space-y-1.5">
                  <p>Adresse de Cornelius sur vos téléphones :</p>
                  <Address url={status.url} />
                </div>
                <h3 className="pt-1 font-medium">Ajouter un téléphone</h3>
                <div className="grid gap-3.5 sm:grid-cols-2">
                  <div className="space-y-2 rounded-xl border p-3.5">
                    <p className="font-medium">1. Installer Tailscale</p>
                    <QrCode
                      text="https://tailscale.com/download"
                      label="Code QR de la page de téléchargement de Tailscale"
                    />
                    <p className="text-xs text-muted-foreground">
                      Android ou iPhone. Connectez-vous avec le même compte que ce serveur. Conseil
                      : activez le « VPN permanent » du téléphone pour ne plus y penser.
                    </p>
                  </div>
                  <div className="space-y-2 rounded-xl border p-3.5">
                    <p className="font-medium">2. Ouvrir Cornelius</p>
                    <QrCode text={status.url} label="Code QR de l’adresse de Cornelius portable" />
                    <p className="text-xs text-muted-foreground">
                      Puis « Installer l’application » dans le menu du navigateur : Cornelius
                      s’ouvre en plein écran depuis l’écran d’accueil. Le mot de passe
                      administrateur est demandé une seule fois.
                    </p>
                  </div>
                </div>
              </>
            )}

            {status.devices.length > 0 && (
              <div>
                <h3 className="font-medium">Appareils du réseau privé</h3>
                <ul className="mt-1 divide-y" aria-label="Appareils du réseau privé">
                  {status.devices.map((device) => (
                    <li key={device.name} className="flex flex-wrap gap-x-3 py-1.5">
                      <span
                        className={`mt-1.5 inline-block size-2 rounded-full ${device.online ? 'bg-success' : 'bg-input'}`}
                        aria-hidden="true"
                      />
                      <span className="font-medium">{device.name}</span>
                      <span className="text-muted-foreground">
                        {device.os} · {device.online ? 'en ligne' : ago(device.lastSeen)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="flex items-start gap-2.5 rounded-lg border border-[#93e0cd44] bg-[#93e0cd0d] px-3.5 py-3 text-xs">
              <LockKeyhole className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <span>
                Cornelius reste fermé à Internet : seuls les appareils connectés à votre compte
                Tailscale voient cette adresse. Pour retirer un téléphone, déconnectez-le dans
                Tailscale.
              </span>
            </p>

            {confirming ? (
              <ConfirmAction
                message="Déconnecter ce serveur de Tailscale ? Les téléphones n’accéderont plus à Cornelius hors du réseau local."
                confirmLabel="Déconnecter"
                onCancel={() => setConfirming(false)}
                onConfirm={() => {
                  setConfirming(false);
                  void update('Serveur déconnecté de Tailscale.', () => api.logoutPortable());
                }}
              />
            ) : (
              <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                Déconnecter ce serveur de Tailscale
              </Button>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
