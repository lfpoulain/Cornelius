import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { BookOpen, ChevronDown, CircleDot, Lock, Plus, ScanFace } from 'lucide-react';
import type { Profile } from '../../../shared/types';
import {
  PERSONALITY_MAX_LENGTH,
  PERSONAL_CONTEXT_MAX_LENGTH,
  type PersonalityView,
} from '../../../shared/personality';
import { api } from '../../api';
import type { RunAction } from './types';
import { useAdminResource } from './useAdminResource';
import { KeepHeight, LoadError, LoadingCard, PersonPicker, SaveBar, StableMessage } from './shared';
import { Label } from '../ui/label';
import { personFromHash, personHref } from './person-links';
import { faceHref } from './FaceEnrollment';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { Alert, AlertDescription } from '../ui/alert';

// Idées insérées d’un clic dans les consignes : un point de départ pour qui ne sait pas
// quoi écrire. Rien n’est enregistré avant « Enregistrer », dans la barre commune.
interface Idea {
  label: string;
  text: string;
  /** Idée contraire : en ajouter une retire l’autre (on ne tutoie et vouvoie pas à la fois). */
  opposite?: string;
}
const householdIdeas: Idea[] = [
  { label: 'Tutoiement', text: 'Tutoie tout le monde.', opposite: 'Vouvoie tout le monde.' },
  { label: 'Vouvoiement', text: 'Vouvoie tout le monde.', opposite: 'Tutoie tout le monde.' },
  {
    label: 'Réponses courtes',
    text: 'Réponds en une ou deux phrases, sauf si on te demande des détails.',
  },
  { label: 'Humour léger', text: 'Fais preuve d’un humour léger, jamais de sarcasme.' },
  { label: 'Sans répétitions', text: 'Évite les formules toutes faites et les répétitions.' },
];
const personalIdeas: Idea[] = [
  { label: 'Tutoiement', text: 'Tutoie-moi.', opposite: 'Vouvoie-moi.' },
  { label: 'Vouvoiement', text: 'Vouvoie-moi.', opposite: 'Tutoie-moi.' },
  {
    label: 'Réponse courte d’abord',
    text: 'Donne d’abord la réponse courte, puis développe si je le demande.',
  },
  { label: 'Plus de détails', text: 'Explique davantage, avec des exemples concrets.' },
  { label: 'Ton direct', text: 'Sois direct, sans formules de politesse inutiles.' },
];

export function Personality({
  profiles,
  initialProfileId,
  run,
}: {
  profiles: Profile[];
  initialProfileId: string | null;
  run: RunAction;
}) {
  // Arrivée par « Écrire un fait permanent » (Mémoire) : la personne vient de l’adresse.
  const [linked] = useState(() => personFromHash('personality'));
  const [profileId, setProfileId] = useState(linked ?? initialProfileId);
  const [dirty, setDirty] = useState(false);
  const selected = profiles.find((profile) => profile.id === profileId);
  const scope = selected?.id ?? null;
  return (
    <div className="space-y-5">
      <PersonPicker
        id="personality-scope"
        label="Personnaliser pour"
        value={scope ?? ''}
        onChange={(value) => setProfileId(value || null)}
        profiles={profiles}
        options={[{ value: '', label: 'Tout le foyer' }]}
        disabled={dirty}
        description={
          selected
            ? `Vous réglez les préférences de ${selected.name}. Elles s’ajoutent au style du foyer, l’emportent en cas de désaccord et ne s’appliquent que lorsque Cornelius reconnaît ${selected.name}.`
            : 'Vous réglez le style commun : il s’applique à tout le monde, y compris aux personnes que Cornelius ne reconnaît pas. Choisissez une personne pour ajouter ses préférences et ses repères.'
        }
        help={
          <StableMessage
            active={dirty ? 1 : 0}
            options={[
              'Changer de personne affiche ses réglages, sans rien modifier.',
              <span className="inline-flex items-start gap-1.5 text-warning">
                <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Enregistrez ou annulez vos modifications avant de changer de personne.
              </span>,
            ]}
          />
        }
      />
      <KeepHeight holdKey={scope ?? 'household'}>
        <PersonalityLoader
          key={scope ?? 'household'}
          profileId={scope}
          name={selected?.name ?? null}
          focusContext={scope !== null && scope === linked}
          run={run}
          onDirty={setDirty}
        />
      </KeepHeight>
    </div>
  );
}

function PersonalityLoader({
  profileId,
  name,
  focusContext,
  run,
  onDirty,
}: {
  profileId: string | null;
  name: string | null;
  focusContext: boolean;
  run: RunAction;
  onDirty: (dirty: boolean) => void;
}) {
  const load = useCallback(() => api.personality(profileId), [profileId]);
  const resource = useAdminResource(load);
  // null : inconnu (lecture en cours ou impossible), rien n’est alors signalé.
  const [hasFace, setHasFace] = useState<boolean | null>(null);
  useEffect(() => {
    if (profileId === null) return;
    let current = true;
    api
      .devices()
      .then((status) => {
        if (current) setHasFace(status.perception.enrolledProfileIds.includes(profileId));
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [profileId]);
  useEffect(() => {
    onDirty(false);
  }, [onDirty]);
  if (resource.error)
    return (
      <LoadError error={resource.error} loading={resource.loading} onRetry={resource.reload} />
    );
  if (!resource.data) return <LoadingCard label="Chargement de la personnalité…" />;
  return (
    <PersonalityForm
      initial={resource.data}
      name={name}
      hasFace={hasFace}
      focusContext={focusContext}
      run={run}
      onDirty={onDirty}
    />
  );
}

function PersonalityForm({
  initial,
  name,
  hasFace,
  focusContext,
  run,
  onDirty,
}: {
  initial: PersonalityView;
  name: string | null;
  hasFace: boolean | null;
  focusContext: boolean;
  run: RunAction;
  onDirty: (dirty: boolean) => void;
}) {
  const [saved, setSaved] = useState(initial);
  const personal = saved.profileId !== null;
  const savedStyle = personal ? saved.personal : saved.household;
  const [style, setStyle] = useState(savedStyle);
  const [context, setContext] = useState(saved.personalContext);
  const styleInput = useRef<HTMLTextAreaElement>(null);
  const contextInput = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!focusContext) return;
    contextInput.current?.scrollIntoView({ block: 'center' });
    contextInput.current?.focus({ preventScroll: true });
  }, [focusContext]);
  const [saving, setSaving] = useState(false);
  const styleDirty = style !== savedStyle;
  const contextDirty = personal && context !== saved.personalContext;
  const dirty = styleDirty || contextDirty;
  // La barre d’enregistrement garde la sortie de rubrique ; le choix de la personne se verrouille.
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const example = personal
    ? 'Tutoie-moi. Sois direct, avec un humour discret. Donne d’abord la réponse courte, puis développe si je le demande.'
    : 'Sois un compagnon de maison curieux, chaleureux et malicieux. Fais preuve d’un humour léger, sans sarcasme. Évite les formules répétitives.';
  const ideas = personal ? personalIdeas : householdIdeas;
  const addIdea = ({ text, opposite }: Idea) => {
    setStyle((current) => {
      const kept = opposite
        ? current
            .split(opposite)
            .join('')
            .split('\n')
            .map((line) => line.trimEnd())
            .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
            .join('\n')
            .trim()
        : current.trimEnd();
      return kept ? kept + '\n' + text : text;
    });
    requestAnimationFrame(() => {
      const input = styleInput.current;
      if (!input) return;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    });
  };
  const note = personal
    ? `L’enregistrement s’applique aussitôt ; une conversation en cours avec ${name} redémarre.`
    : 'L’enregistrement s’applique aussitôt ; une conversation en cours redémarre.';
  const styleCleared = styleDirty && !style.trim();
  const contextCleared = contextDirty && !context.trim();
  // Ce qu’un champ vidé changera, dit dans la barre avant l’enregistrement.
  const cleared =
    styleCleared && contextCleared
      ? `Style et repères vidés : ${name} suivra le style du foyer, sans repères.`
      : styleCleared
        ? personal
          ? `Style vidé : ${name} suivra le style du foyer après enregistrement.`
          : 'Style vidé : caractère par défaut après enregistrement.'
        : contextCleared
          ? 'Repères vidés : ils seront supprimés à l’enregistrement.'
          : null;

  // Un seul bouton pour la personne, mais deux enregistrements côté serveur : le style est
  // une consigne, le contexte une donnée de référence, et le modèle les traite différemment.
  const save = () => {
    setSaving(true);
    void run(
      personal ? `Réglages de ${name} enregistrés.` : 'Style du foyer enregistré.',
      async () => {
        const values = { style, context };
        let result = saved;
        if (styleDirty) {
          result = await api.savePersonality(saved.profileId, values.style);
          setSaved(result);
        }
        if (contextDirty && saved.profileId)
          result = await api.savePersonalContext(saved.profileId, values.context);
        setSaved(result);
        setStyle(personal ? result.personal : result.household);
        setContext(result.personalContext);
      },
    ).finally(() => setSaving(false));
  };

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <p className="admin-eyebrow">
            {personal ? `Pour ${name} · s’ajoute au style du foyer` : 'Pour tout le monde'}
          </p>
          <CardTitle>{personal ? `Réglages de ${name}` : 'Style commun du foyer'}</CardTitle>
          <CardDescription>
            {personal
              ? `Deux choses à dire à Cornelius : comment parler à ${name}, et ce qu’il doit savoir pour bien comprendre ses demandes.`
              : 'Le ton, l’humour, le tutoiement ou le vouvoiement et la longueur des réponses, pour toute la maison.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {personal && hasFace === false && saved.profileId && (
            <Alert role="status">
              <AlertDescription className="gap-3">
                <p className="flex items-start gap-2">
                  <ScanFace className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden="true" />
                  <span>
                    Aucun visage mémorisé pour {name} : tant que Cornelius ne reconnaît pas {name},
                    ces réglages ne s’appliquent pas.
                  </span>
                </p>
                <Button asChild size="sm" variant="outline">
                  <a href={faceHref(saved.profileId)}>Mémoriser le visage de {name}</a>
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <div className="space-y-6">
            <TextBlock
              id="personality-instructions"
              label={personal ? `Comment parler à ${name}` : 'Comment parler à tout le monde'}
              description={
                personal
                  ? 'Tutoiement ou vouvoiement, longueur des réponses, ton, humour. En cas de désaccord, ce style l’emporte sur celui du foyer.'
                  : 'S’applique à toute la maison, y compris aux personnes que Cornelius ne reconnaît pas.'
              }
              action={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={!style}
                  title="Vide le champ ; enregistrez ensuite pour confirmer."
                  onClick={() => setStyle('')}
                >
                  {personal ? 'Revenir au style du foyer' : 'Revenir au caractère par défaut'}
                </Button>
              }
              footer={
                <Counter
                  length={style.length}
                  max={PERSONALITY_MAX_LENGTH}
                  hint={
                    personal
                      ? 'Laissez vide pour suivre simplement le style du foyer.'
                      : 'Laissez vide pour garder le caractère par défaut.'
                  }
                />
              }
            >
              {personal && !savedStyle.trim() && (
                <section
                  aria-label="Hérité du foyer"
                  className="space-y-1.5 rounded-lg border border-dashed px-4 py-3"
                >
                  <p className="admin-eyebrow">Hérité du foyer</p>
                  <p className="text-xs text-muted-foreground">
                    Tant que rien n’est enregistré ici, Cornelius parle à {name} avec le style du
                    foyer :
                  </p>
                  {saved.household.trim() ? (
                    <p className="text-sm break-words whitespace-pre-wrap">{saved.household}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">
                      Aucun style commun : le caractère par défaut de Cornelius.
                    </p>
                  )}
                </section>
              )}
              <div
                className="flex flex-wrap items-center gap-2"
                role="group"
                aria-label="Idées à ajouter"
              >
                <span className="text-xs text-muted-foreground">Idées :</span>
                {ideas.map((idea) => (
                  <Button
                    key={idea.label}
                    type="button"
                    size="sm"
                    variant="outline"
                    title={idea.text}
                    aria-label={
                      (idea.opposite && style.includes(idea.opposite)
                        ? 'Remplacer par : '
                        : 'Ajouter : ') + idea.text
                    }
                    disabled={style.includes(idea.text)}
                    onClick={() => addIdea(idea)}
                  >
                    <Plus />
                    {idea.label}
                  </Button>
                ))}
              </div>
              <Textarea
                id="personality-instructions"
                ref={styleInput}
                rows={5}
                maxLength={PERSONALITY_MAX_LENGTH}
                value={style}
                onChange={(event) => setStyle(event.target.value)}
                placeholder={'Par exemple : ' + example}
              />
            </TextBlock>

            {personal && (
              <div className="border-t pt-6">
                <TextBlock
                  id="personal-context"
                  label={`Ce qu’il faut savoir sur ${name}`}
                  description="Des faits, pas des consignes : lieux, surnoms, correspondances entre vos mots et vos pièces. Cornelius s’en sert pour comprendre, sans les réciter."
                  action={
                    <div className="flex flex-wrap gap-1">
                      <Button asChild type="button" variant="ghost" size="sm">
                        <a href={personHref('memory', saved.profileId!)}>
                          <BookOpen />
                          Voir ce que Cornelius a retenu
                        </a>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={!context}
                        title="Vide le champ ; enregistrez ensuite pour confirmer."
                        onClick={() => setContext('')}
                      >
                        Effacer les repères
                      </Button>
                    </div>
                  }
                  footer={
                    <Counter
                      length={context.length}
                      max={PERSONAL_CONTEXT_MAX_LENGTH}
                      hint="Transmis seulement lorsque la caméra reconnaît cette personne. N’autorise aucun appareil supplémentaire."
                    />
                  }
                >
                  <Textarea
                    id="personal-context"
                    ref={contextInput}
                    rows={4}
                    maxLength={PERSONAL_CONTEXT_MAX_LENGTH}
                    value={context}
                    onChange={(event) => setContext(event.target.value)}
                    placeholder={
                      'Par exemple :\nQuand je dis « mon bureau », je parle de la pièce appelée Pivoine.\n« Le grand » désigne mon fils Noé.'
                    }
                  />
                </TextBlock>
              </div>
            )}

            <SaveBar
              label={personal ? `Réglages de ${name}` : 'Style du foyer'}
              count={(styleDirty ? 1 : 0) + (contextDirty ? 1 : 0)}
              saving={saving}
              onSave={save}
              onCancel={() => {
                setStyle(savedStyle);
                setContext(saved.personalContext);
              }}
            >
              {cleared && (
                <p className="flex items-start gap-2 text-xs leading-relaxed text-warning">
                  <CircleDot className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>{cleared}</span>
                </p>
              )}
              <p className="text-xs leading-relaxed text-muted-foreground">{note}</p>
            </SaveBar>
          </div>
        </CardContent>
      </Card>

      <PromptPreview prompts={saved.prompts} />
    </div>
  );
}

/** Un texte à rédiger : titre, explication et action de remise à zéro sur une même ligne. */
function TextBlock({
  id,
  label,
  description,
  action,
  footer,
  children,
}: {
  id: string;
  label: string;
  description: string;
  action: ReactNode;
  footer: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-72 space-y-1.5">
          <Label htmlFor={id} className="text-[15px]">
            {label}
          </Label>
          <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {action}
      </div>
      {children}
      <p className="text-xs leading-relaxed text-muted-foreground">{footer}</p>
    </div>
  );
}

function Counter({ length, max, hint }: { length: number; max: number; hint: string }) {
  return (
    <span className="flex flex-wrap justify-between gap-x-4 gap-y-1">
      <span>{hint}</span>
      <span className={length > max * 0.9 ? 'text-warning' : undefined}>
        {length.toLocaleString('fr-FR')} / {max.toLocaleString('fr-FR')} caractères
      </span>
    </span>
  );
}

/**
 * Les textes complets transmis au modèle. Vos réglages étant ajoutés à la fin des règles
 * de base, on n’affiche que la version «  avec vos préférences  », partie ajoutée surlignée.
 */
function PromptPreview({ prompts }: { prompts: PersonalityView['prompts'] }) {
  const withPreferences = prompts
    .filter((prompt) => prompt.title.startsWith('Avec vos préférences'))
    .map((prompt) => {
      const base = prompts.find(
        (candidate) =>
          candidate.title ===
          prompt.title.replace('Avec vos préférences enregistrées', 'Sans vos préférences'),
      );
      const added =
        base && prompt.content.startsWith(base.content)
          ? prompt.content.slice(base.content.length)
          : null;
      return { ...prompt, base: added === null ? prompt.content : base!.content, added };
    });
  // Format inattendu : afficher les textes tels quels plutôt que rien.
  const entries =
    withPreferences.length && withPreferences.every((entry) => entry.added !== null)
      ? withPreferences
      : prompts.map((prompt) => ({ ...prompt, base: prompt.content, added: null }));
  return (
    <Card>
      <CardHeader>
        <p className="admin-eyebrow">Aperçu · réglages enregistrés</p>
        <CardTitle>Ce que Cornelius reçoit</CardTitle>
        <CardDescription>
          Le texte complet transmis au modèle au début de chaque conversation. Vos réglages
          apparaissent surlignés, à la fin. Cornelius ne prononce jamais ces textes. « Luna » y
          désigne le modèle chargé des recherches et des actions (« Délégation », dans « Quand il
          écoute »).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="admin-knowhow">
          <li>
            Vos consignes règlent le style : elles ne changent jamais les règles de silence, de
            confidentialité ni les confirmations des actions.
          </li>
          <li>Elles sont conservées sur ce miroir et transmises à OpenAI pour la conversation.</li>
        </ul>
        <div className="space-y-3">
          {entries.map((prompt) => (
            <PromptDetails key={prompt.title} {...prompt} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function PromptDetails({
  title,
  base,
  added,
}: {
  title: string;
  base: string;
  added: string | null;
}) {
  const pre = useRef<HTMLPreElement>(null);
  const label = promptLabel(title);
  const kind = title.endsWith('conversation')
    ? 'réponses orales'
    : title.endsWith('recherches et actions')
      ? 'demandes qui utilisent des outils'
      : null;
  return (
    <details
      className="admin-prompt"
      onToggle={(event) => {
        // Amener directement la partie ajoutée par vos réglages sous les yeux.
        if (event.currentTarget.open && added && pre.current)
          pre.current.scrollTop = pre.current.scrollHeight;
      }}
    >
      <summary>
        <span>
          {label}
          {kind && <span className="admin-prompt-kind"> · {kind}</span>}
        </span>
        <span className="admin-prompt-meta">
          {added !== null && (
            <span className="admin-prompt-badge">
              {added.trim() ? 'vos réglages surlignés' : 'aucun réglage enregistré'}
            </span>
          )}
          <ChevronDown className="admin-prompt-chevron" aria-hidden="true" />
        </span>
      </summary>
      <pre ref={pre}>
        {base}
        {added && <mark>{added}</mark>}
      </pre>
    </details>
  );
}

/** « Avec vos préférences enregistrées : conversation » devient « Conversation ». */
function promptLabel(title: string): string {
  const [head = '', part] = title.split(' : ');
  if (!part) return title;
  const name = part.charAt(0).toLocaleUpperCase('fr') + part.slice(1);
  return head.startsWith('Sans') ? name + ', sans vos préférences' : name;
}
