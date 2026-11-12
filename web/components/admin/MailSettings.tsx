import { useCallback, useState, type ReactNode } from 'react';
import { Mail } from 'lucide-react';
import {
  MAIL_PRESETS,
  MAIL_RECIPIENTS_MAX,
  type MailRecipient,
  type MailSettings as MailServerSettings,
  type MailView,
} from '../../../shared/mail';
import { profileNameKey } from '../../../shared/profile-names';
import type { Profile } from '../../../shared/types';
import { api, errorMessage } from '../../api';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Switch } from '../ui/switch';
import {
  ConfirmAction,
  Field,
  LoadError,
  LoadingCard,
  ModulePanel,
  PresetButton,
  SaveBar,
} from './shared';
import type { RunAction } from './types';
import { useAdminResource } from './useAdminResource';

type ServerDraft = Omit<MailServerSettings, 'enabled'>;
type RecipientDraft = Pick<MailRecipient, 'name' | 'address' | 'profileId'>;

const serverFields = ['host', 'port', 'security', 'fromAddress', 'username', 'fromName'] as const;
const emptyRecipient: RecipientDraft = { name: '', address: '', profileId: null };

const dateTime = (at: number) =>
  new Intl.DateTimeFormat('fr-FR', { dateStyle: 'short', timeStyle: 'short' }).format(at);

function ProfileSelect({
  id,
  value,
  onChange,
  profiles,
}: {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  profiles: readonly Profile[];
}) {
  return (
    <NativeSelect
      id={id}
      wrapperClassName="w-full"
      className="w-full"
      value={value ?? ''}
      onChange={(event) => onChange(event.target.value || null)}
    >
      <NativeSelectOption value="">Aucun profil</NativeSelectOption>
      {profiles.map((profile) => (
        <NativeSelectOption key={profile.id} value={profile.id}>
          {profile.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** Une ligne de la liste : nom à dire, adresse, profil relié ; essai et retrait. */
function RecipientRow({
  recipient,
  profiles,
  run,
  onView,
}: {
  recipient: MailRecipient;
  profiles: readonly Profile[];
  run: RunAction;
  onView: (view: MailView) => void;
}) {
  const [draft, setDraft] = useState<RecipientDraft>(recipient);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [trial, setTrial] = useState<{ ok: boolean; summary: string } | null>(null);
  const changed =
    draft.name !== recipient.name ||
    draft.address !== recipient.address ||
    draft.profileId !== recipient.profileId;
  const id = `mail-recipient-${recipient.id}`;
  return (
    <li className="space-y-3 rounded-lg border p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field id={`${id}-name`} label="Nom">
          <Input
            id={`${id}-name`}
            value={draft.name}
            maxLength={40}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
        </Field>
        <Field id={`${id}-address`} label="Adresse e-mail">
          <Input
            id={`${id}-address`}
            type="email"
            autoComplete="off"
            value={draft.address}
            maxLength={254}
            onChange={(event) => setDraft({ ...draft, address: event.target.value })}
          />
        </Field>
        <Field
          id={`${id}-profile`}
          label="Profil relié"
          help="« Envoie-moi » : la première adresse de ce profil."
        >
          <ProfileSelect
            id={`${id}-profile`}
            value={draft.profileId}
            onChange={(profileId) => setDraft({ ...draft, profileId })}
            profiles={profiles}
          />
        </Field>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {trial && (
        <p className={trial.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}>
          {trial.summary}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {changed && (
          <Button
            size="sm"
            onClick={() =>
              void run(
                'Destinataire enregistré.',
                async () => {
                  setError(null);
                  onView(await api.updateMailRecipient(recipient.id, draft));
                },
                { onError: (failure) => setError(errorMessage(failure)) },
              )
            }
          >
            Enregistrer
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={changed}
          aria-label={`Envoyer un e-mail d’essai à ${recipient.name}`}
          onClick={() =>
            void run('Essai terminé.', async () => {
              setTrial(null);
              const result = await api.testMail(recipient.id);
              setTrial(result);
              onView(result.mail);
            })
          }
        >
          Envoyer un essai
        </Button>
        <Button
          size="sm"
          variant="danger-outline"
          aria-label={`Retirer ${recipient.name} des destinataires`}
          onClick={() => setConfirming(true)}
        >
          Retirer
        </Button>
      </div>
      {confirming && (
        <ConfirmAction
          message={`Retirer ${recipient.name} ? Cornelius ne pourra plus lui envoyer d’e-mail.`}
          confirmLabel="Retirer"
          onCancel={() => setConfirming(false)}
          onConfirm={() =>
            void run('Destinataire retiré.', async () =>
              onView(await api.deleteMailRecipient(recipient.id)),
            )
          }
        />
      )}
    </li>
  );
}

/** Module natif « E-mail » : envoyer une image ou un message sur le téléphone du foyer. */
export function MailSettings({
  profiles,
  run,
  hidden,
  action,
}: {
  profiles: readonly Profile[];
  run: RunAction;
  hidden?: boolean;
  action?: ReactNode;
}) {
  const load = useCallback(() => api.mail(), []);
  const { data, error: loadError, loading, reload } = useAdminResource<MailView>(load);
  const [view, setView] = useState<MailView | null>(null);
  const current = view ?? data;
  const [draft, setDraft] = useState<ServerDraft | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [added, setAdded] = useState<RecipientDraft>(emptyRecipient);
  const [addError, setAddError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; summary: string } | null>(null);

  const badge = !current ? null : current.ready ? (
    <Badge variant="secondary">Prêt</Badge>
  ) : current.settings.enabled ? (
    <Badge variant="outline">À compléter</Badge>
  ) : (
    <Badge variant="outline">Désactivé</Badge>
  );

  const panel = (children: ReactNode) => (
    <ModulePanel
      id="module-mail"
      icon={Mail}
      title="E-mail"
      subtitle="Envoyer une image ou un message sur le téléphone d’une personne du foyer"
      badge={badge}
      action={action}
      hidden={hidden}
    >
      {children}
    </ModulePanel>
  );
  if (!current)
    return panel(
      loadError ? (
        <LoadError error={loadError} loading={loading} onRetry={reload} />
      ) : (
        <LoadingCard label="Lecture des réglages d’e-mail…" />
      ),
    );

  const saved = current.settings;
  const form: ServerDraft = draft ?? saved;
  const changes = serverFields.filter((field) => form[field] !== saved[field]).length;
  const preset = MAIL_PRESETS.find(
    (entry) =>
      entry.host === form.host && entry.port === form.port && entry.security === form.security,
  );
  const edit = (patch: Partial<ServerDraft>) => {
    setServerError(null);
    setDraft({ ...form, ...patch });
  };
  const taken = (name: string) =>
    current.recipients.some((r) => profileNameKey(r.name) === profileNameKey(name));
  const addedProfile = profiles.find((profile) => profile.id === added.profileId) ?? null;
  const show = (next: MailView) => {
    setView(next);
    setCheck(null);
  };

  return panel(
    <>
      <p className="text-sm text-muted-foreground">
        « Envoie-moi cette image », « envoie l’image du phare à Baptiste », « envoie-moi l’adresse »
        : Cornelius envoie par e-mail l’image affichée, l’une des trois dernières images créées, ou
        un court message. Les adresses restent sur cet ordinateur : la conversation ne connaît que
        les noms de la liste, et Cornelius n’écrit à personne d’autre. Une photo de la caméra ne
        s’envoie jamais.
      </p>

      <section className="space-y-4 rounded-lg border p-4" aria-labelledby="mail-account">
        <h4 id="mail-account" className="font-medium">
          Compte d’envoi
        </h4>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Fournisseur">
          {MAIL_PRESETS.map((entry) => (
            <PresetButton
              key={entry.id}
              active={preset?.id === entry.id}
              onClick={() => edit({ host: entry.host, port: entry.port, security: entry.security })}
            >
              {entry.label}
            </PresetButton>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="mail-host" label="Serveur SMTP" className="sm:col-span-2">
            <Input
              id="mail-host"
              value={form.host}
              placeholder="ex. smtp.gmail.com"
              autoComplete="off"
              spellCheck={false}
              maxLength={253}
              onChange={(event) => edit({ host: event.target.value })}
            />
          </Field>
          <Field id="mail-port" label="Port">
            <Input
              id="mail-port"
              inputMode="numeric"
              value={String(form.port)}
              onChange={(event) =>
                edit({ port: Number(event.target.value.replace(/\D/gu, '')) || 0 })
              }
            />
          </Field>
          <Field
            id="mail-security"
            label="Chiffrement"
            help="465 : TLS ; 587 : STARTTLS. Jamais sans chiffrement."
          >
            <NativeSelect
              id="mail-security"
              wrapperClassName="w-full"
              className="w-full"
              value={form.security}
              onChange={(event) =>
                edit({ security: event.target.value === 'starttls' ? 'starttls' : 'tls' })
              }
            >
              <NativeSelectOption value="tls">TLS</NativeSelectOption>
              <NativeSelectOption value="starttls">STARTTLS</NativeSelectOption>
            </NativeSelect>
          </Field>
          <Field
            id="mail-from"
            label="Adresse d’envoi"
            help="Celle du compte : les e-mails partent de cette adresse."
          >
            <Input
              id="mail-from"
              type="email"
              autoComplete="off"
              value={form.fromAddress}
              placeholder="ex. cornelius.maison@gmail.com"
              maxLength={254}
              onChange={(event) => edit({ fromAddress: event.target.value })}
            />
          </Field>
          <Field id="mail-name" label="Nom de l’expéditeur">
            <Input
              id="mail-name"
              value={form.fromName}
              maxLength={60}
              onChange={(event) => edit({ fromName: event.target.value })}
            />
          </Field>
          <Field
            id="mail-username"
            label="Identifiant SMTP"
            help="Vide : l’adresse d’envoi, comme chez la plupart des fournisseurs."
            className="sm:col-span-3"
          >
            <Input
              id="mail-username"
              autoComplete="off"
              value={form.username}
              maxLength={254}
              onChange={(event) => edit({ username: event.target.value })}
            />
          </Field>
        </div>
        <SaveBar
          label="Compte d’envoi"
          count={changes}
          error={serverError}
          saveDisabled={form.port < 1 || form.port > 65535}
          onCancel={() => {
            setDraft(null);
            setServerError(null);
          }}
          onSave={() =>
            void run(
              'Compte d’envoi enregistré.',
              async () => {
                show(await api.saveMailSettings(form));
                setDraft(null);
              },
              { onError: (failure) => setServerError(errorMessage(failure)) },
            )
          }
        />

        <div className="space-y-2">
          <Label htmlFor="mail-password">Mot de passe</Label>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {current.password.configured
              ? `Enregistré${current.password.hint ? ` (se termine par ${current.password.hint})` : ''}${current.password.source === 'env' ? ', lu dans le fichier .env' : ''}.`
              : 'Aucun mot de passe.'}{' '}
            Gmail et iCloud demandent un mot de passe d’application, créé dans le compte
            {preset?.passwordUrl ? (
              <>
                {' '}
                (
                <a className="underline" href={preset.passwordUrl} target="_blank" rel="noreferrer">
                  page du fournisseur
                </a>
                )
              </>
            ) : null}
            . Ses espaces sont retirés.
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              id="mail-password"
              type="password"
              autoComplete="new-password"
              className="max-w-xs"
              value={password}
              aria-invalid={passwordError ? true : undefined}
              onChange={(event) => {
                setPassword(event.target.value);
                setPasswordError(null);
              }}
            />
            <Button
              size="sm"
              disabled={!password.trim()}
              onClick={() =>
                void run(
                  'Mot de passe enregistré.',
                  async () => {
                    show(await api.saveMailPassword(password));
                    setPassword('');
                  },
                  { onError: (failure) => setPasswordError(errorMessage(failure)) },
                )
              }
            >
              Enregistrer
            </Button>
            {current.password.source === 'admin' && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() =>
                  void run('Mot de passe retiré.', async () => show(await api.deleteMailPassword()))
                }
              >
                Retirer
              </Button>
            )}
          </div>
          {passwordError && <p className="text-sm text-destructive">{passwordError}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            disabled={changes > 0}
            onClick={() =>
              void run('Essai terminé.', async () => {
                setCheck(null);
                const result = await api.testMail(null);
                setView(result.mail);
                setCheck(result);
              })
            }
          >
            Tester la connexion
          </Button>
          {check && (
            <p
              className={check.ok ? 'text-sm text-muted-foreground' : 'text-sm text-destructive'}
              role="status"
            >
              {check.summary}
            </p>
          )}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="mail-recipients">
        <div className="space-y-1">
          <h4 id="mail-recipients" className="font-medium">
            Destinataires
          </h4>
          <p className="text-sm text-muted-foreground">
            Seules ces adresses peuvent recevoir un e-mail de Cornelius. Le nom est celui que vous
            dites : « envoie l’image à Baptiste ». Relier un profil permet de dire « envoie-moi »
            quand Cornelius reconnaît la personne ; une deuxième adresse du même profil prend un
            autre nom, par exemple « Artus travail ».
          </p>
        </div>
        {current.recipients.length > 0 && (
          <ul className="space-y-3">
            {current.recipients.map((recipient) => (
              <RecipientRow
                key={`${recipient.id}-${recipient.name}-${recipient.address}-${recipient.profileId}`}
                recipient={recipient}
                profiles={profiles}
                run={run}
                onView={show}
              />
            ))}
          </ul>
        )}
        {current.recipients.length < MAIL_RECIPIENTS_MAX && (
          <div className="space-y-3 rounded-lg border border-dashed p-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Field id="mail-new-profile" label="Profil relié">
                <ProfileSelect
                  id="mail-new-profile"
                  value={added.profileId}
                  profiles={profiles}
                  onChange={(profileId) => {
                    const profile = profiles.find((entry) => entry.id === profileId);
                    setAddError(null);
                    // Le nom du profil se propose seulement s’il n’est pas déjà dans la liste.
                    setAdded({
                      ...added,
                      profileId,
                      name:
                        added.name.trim() || !profile || taken(profile.name)
                          ? added.name
                          : profile.name,
                    });
                  }}
                />
              </Field>
              <Field
                id="mail-new-name"
                label="Nom"
                help="Celui que vous dites : « envoie l’image à Baptiste »."
              >
                <Input
                  id="mail-new-name"
                  value={added.name}
                  placeholder={
                    addedProfile && taken(addedProfile.name)
                      ? `ex. ${addedProfile.name} travail`
                      : 'ex. Baptiste'
                  }
                  maxLength={40}
                  onChange={(event) => {
                    setAddError(null);
                    setAdded({ ...added, name: event.target.value });
                  }}
                />
              </Field>
              <Field id="mail-new-address" label="Adresse e-mail">
                <Input
                  id="mail-new-address"
                  type="email"
                  autoComplete="off"
                  value={added.address}
                  placeholder="ex. baptiste@exemple.fr"
                  maxLength={254}
                  onChange={(event) => {
                    setAddError(null);
                    setAdded({ ...added, address: event.target.value });
                  }}
                />
              </Field>
            </div>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
            <Button
              size="sm"
              disabled={!added.name.trim() || !added.address.trim()}
              onClick={() =>
                void run(
                  'Destinataire ajouté.',
                  async () => {
                    show(await api.addMailRecipient(added));
                    setAdded(emptyRecipient);
                  },
                  { onError: (failure) => setAddError(errorMessage(failure)) },
                )
              }
            >
              Ajouter le destinataire
            </Button>
          </div>
        )}
      </section>

      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="mail-enabled">Autoriser l’envoi par e-mail</Label>
          <p className="text-xs text-muted-foreground">
            {current.ready
              ? 'Cornelius peut envoyer. Une conversation en cours redémarre pour en tenir compte.'
              : current.missing.length
                ? `À compléter : ${current.missing.join(', ')}.`
                : 'Désactivé : Cornelius ne propose pas d’envoyer.'}
          </p>
        </div>
        <Switch
          id="mail-enabled"
          checked={saved.enabled}
          onCheckedChange={(enabled) =>
            void run(
              enabled ? 'Envoi par e-mail activé.' : 'Envoi par e-mail désactivé.',
              async () => show(await api.saveMailSettings({ enabled })),
            )
          }
        />
      </div>

      {current.lastSend && (
        <p className="text-sm text-muted-foreground">
          Dernier envoi, le {dateTime(current.lastSend.at)} :{' '}
          {current.lastSend.status === 'sent'
            ? current.lastSend.summary
            : `${current.lastSend.status === 'unknown' ? 'incertain' : 'échec'} pour ${current.lastSend.recipient}. ${current.lastSend.summary}`}
        </p>
      )}
    </>,
  );
}
