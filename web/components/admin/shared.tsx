/**
 * Briques communes de l’administration.
 *
 * Règle des retours : où dire qu’une action a marché ou échoué.
 * - Action ponctuelle (bouton, interrupteur, choix enregistré aussitôt) : message bref en bas
 *   à droite, via run() (voir types.ts). Rien d’autre dans la page.
 * - Erreur de champ (valeur refusée, doublon, connexion impossible) : sous le champ ou le
 *   formulaire, reliée au contrôle (Field, ou run() avec onError), sans message en bas à droite.
 * - Formulaire long (plusieurs champs enregistrés ensemble) ou valeur chiffrée : SaveBar,
 *   « 2 modifications non enregistrées · Enregistrer · Annuler », puis le message de réussite
 *   via run().
 * - Lecture au serveur (liste, état) : ResourceState, chargement, erreur avec « Réessayer »,
 *   vide avec une action.
 */
import {
  cloneElement,
  Fragment,
  isValidElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  RefreshCw,
  Search,
  type LucideIcon,
} from 'lucide-react';
import type { Profile } from '../../../shared/types';
import { cn } from '@/lib/utils';
import { Alert, AlertDescription } from '../ui/alert';
import { Button } from '../ui/button';
import { Card, CardContent, CardDescription, CardTitle } from '../ui/card';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { decimalText, parseDecimal, plural } from './format';
import { useUnsavedChanges } from './unsaved';
import type { AdminResource } from './useAdminResource';

export function LoadingCard({ label }: { label: string }) {
  return (
    <Card data-admin-loading="" aria-busy="true">
      <CardContent className="admin-loading">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <p role="status">{label}</p>
      </CardContent>
    </Card>
  );
}

/**
 * Lecture au serveur ratée : la raison et « Réessayer ». `stale` : des données déjà lues restent
 * affichées dessous. Seule, pour une rubrique qui garde sa propre mise en page (LoadingCard
 * pendant la lecture) ; sinon ResourceState s’en charge.
 */
export function LoadError({
  error,
  loading = false,
  onRetry,
  stale = false,
}: {
  error: string;
  loading?: boolean;
  onRetry: () => unknown;
  stale?: boolean;
}) {
  return (
    <Alert variant="destructive">
      <CircleAlert aria-hidden="true" />
      <AlertDescription className="gap-3">
        <p>
          {stale ? 'Actualisation impossible' : 'Lecture impossible'} : {error}
          {stale ? ' Les informations affichées peuvent être anciennes.' : ''}
        </p>
        <Button
          variant="outline"
          size="sm"
          className="text-foreground"
          disabled={loading}
          onClick={() => void onRetry()}
        >
          <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden="true" />
          {loading ? 'Nouvel essai…' : 'Réessayer'}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

/**
 * Lecture au serveur, dans une carte ou une section : chargement, erreur avec « Réessayer »,
 * vide avec une action, sinon le contenu. Des données déjà lues restent affichées quand une
 * actualisation échoue, avec l’erreur au-dessus.
 *
 *   const sources = useAdminResource(api.addons);
 *   <ResourceState resource={sources} loadingLabel="Lecture des sources…"
 *     isEmpty={(data) => !data.length} empty={{ title: 'Aucune source', action: … }}>
 *     {(data) => <SourceList sources={data} />}
 *   </ResourceState>
 */
export function ResourceState<T>({
  resource: { data, error, loading, reload },
  loadingLabel,
  isEmpty,
  empty,
  children,
}: {
  resource: AdminResource<T>;
  loadingLabel: string;
  isEmpty?: (data: T) => boolean;
  empty?: { title: ReactNode; description?: ReactNode; action?: ReactNode };
  children: (data: T) => ReactNode;
}) {
  if (data === null && !error)
    return (
      <div className="admin-loading" data-admin-loading="" aria-busy="true">
        <LoaderCircle className="size-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
        <p role="status">{loadingLabel}</p>
      </div>
    );
  return (
    <>
      {error && (
        <LoadError error={error} loading={loading} onRetry={reload} stale={data !== null} />
      )}
      {data !== null &&
        (empty && isEmpty?.(data) ? (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-5">
            <p className="text-sm font-medium">{empty.title}</p>
            {empty.description && (
              <p className="text-sm leading-relaxed text-muted-foreground">{empty.description}</p>
            )}
            {empty.action && <div className="mt-1">{empty.action}</div>}
          </div>
        ) : (
          children(data)
        ))}
    </>
  );
}

/**
 * Barre d’enregistrement commune : « 2 modifications non enregistrées · Enregistrer · Annuler »,
 * pour un formulaire long comme pour une valeur chiffrée (voir FineTuning). Visible tant qu’il
 * reste des modifications, collée au bas de l’écran pendant le défilement du formulaire. Elle
 * signale aussi le brouillon : quitter la rubrique demande confirmation.
 */
export function SaveBar({
  count,
  onSave,
  onCancel,
  saving = false,
  saveDisabled = false,
  error,
  label,
  children,
}: {
  count: number;
  onSave: () => void;
  onCancel: () => void;
  saving?: boolean;
  saveDisabled?: boolean;
  /** Saisie invalide : la raison, sous la barre, et « Enregistrer » reste grisé. */
  error?: ReactNode;
  /** Ce qui est modifié (« Délais de présence ») : nomme la zone pour un lecteur d’écran. */
  label?: string;
  /** Précisions sous la barre (avertissement, conséquence de l’enregistrement). */
  children?: ReactNode;
}) {
  useUnsavedChanges(count > 0);
  if (count <= 0) return null;
  return (
    <div
      role="region"
      // Nom fixe, quel que soit le nombre : la zone se retrouve toujours sous le même nom.
      aria-label={
        label ? label + ' : modifications non enregistrées' : 'Modifications non enregistrées'
      }
      className="admin-save-bar"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium" aria-live="polite">
          {plural(count, 'modification')} non enregistrée{count > 1 ? 's' : ''}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={saving || saveDisabled || !!error} onClick={onSave}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
          <Button size="sm" variant="ghost" disabled={saving} onClick={onCancel}>
            Annuler
          </Button>
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {children}
    </div>
  );
}

/**
 * Conserve la hauteur du panneau précédent pendant qu’un panneau rechargé (changement
 * de personne, par exemple) affiche son chargement : la page ne se replie pas et le
 * défilement ne remonte pas.
 */
export function KeepHeight({ holdKey, children }: { holdKey: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const lastHeight = useRef(0);
  const mounted = useRef(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!element.style.minHeight) lastHeight.current = element.offsetHeight;
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const loading = () => element?.querySelector('[data-admin-loading]') != null;
    if (!element || !lastHeight.current || !loading()) return;
    element.style.minHeight = lastHeight.current + 'px';
    const release = () => {
      element.style.minHeight = '';
      mutations.disconnect();
      clearTimeout(timer);
    };
    const mutations = new MutationObserver(() => {
      if (!loading()) release();
    });
    mutations.observe(element, { childList: true, subtree: true });
    const timer = setTimeout(release, 8_000);
    return release;
  }, [holdKey]);
  return <div ref={ref}>{children}</div>;
}

/**
 * Superpose les messages possibles dans une même cellule : la place réservée est celle du
 * plus long, et passer de l’un à l’autre ne décale plus la page.
 */
export function StableMessage({
  options,
  active,
  className,
}: {
  options: ReactNode[];
  active: number;
  className?: string;
}) {
  return (
    <span className={cn('admin-swap', className)}>
      {options.map((option, index) => (
        <span key={index} data-active={index === active}>
          {option}
        </span>
      ))}
    </span>
  );
}

/**
 * Libellé, contrôle, erreur et aide d’un champ. Avec un `id`, l’erreur (`${id}-error`) et
 * l’aide (`${id}-help`) sont reliées au contrôle par aria-describedby, et une erreur le
 * marque aria-invalid.
 */
export function Field({
  id,
  label,
  help,
  error,
  className,
  children,
}: {
  id?: string;
  label: ReactNode;
  help?: ReactNode;
  error?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const errorId = id && error ? `${id}-error` : undefined;
  const helpId = id && help ? `${id}-help` : undefined;
  const described = [errorId, helpId].filter(Boolean).join(' ');
  let control = children;
  if (isValidElement<Record<string, unknown>>(children) && children.type !== Fragment) {
    const own = children.props['aria-describedby'];
    const describedBy = [typeof own === 'string' ? own : '', described].filter(Boolean).join(' ');
    if (describedBy || error)
      control = cloneElement(children, {
        'aria-describedby': describedBy || undefined,
        ...(error ? { 'aria-invalid': true } : {}),
      });
  }
  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={id}>{label}</Label>
      {control}
      {error && (
        <p id={errorId} className="text-xs leading-relaxed text-destructive">
          {error}
        </p>
      )}
      {help && (
        <p id={helpId} className="text-xs leading-relaxed text-muted-foreground">
          {help}
        </p>
      )}
    </div>
  );
}

/**
 * Valeur décimale (délai, exigence) : champ texte au clavier décimal sur téléphone, qui accepte
 * la virgule comme le point. La valeur s’affiche avec decimalText() et se lit avec
 * parseDecimal() (format.ts) ; la plage autorisée se dit dans l’aide du champ.
 */
export function DecimalInput(props: Omit<ComponentProps<typeof Input>, 'type' | 'inputMode'>) {
  return <Input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} {...props} />;
}

/**
 * Brouillon d’une valeur décimale enregistrée par SaveBar : le texte saisi, la valeur lue
 * (null si le champ est vide, NaN si la saisie n’est pas un nombre) et le retour à la valeur
 * enregistrée. Le texte suit la valeur enregistrée quand elle change, pas à chaque relecture.
 * `dirty` : « 0,420 » pour 0,42 n’est pas une modification ; une saisie invalide en est une.
 */
export function useDecimalDraft(saved: number | null | undefined) {
  const shown = saved == null ? '' : decimalText(saved);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const value = text.trim() ? parseDecimal(text) : null;
  return {
    text,
    setText,
    value,
    dirty: text !== shown && value !== (saved ?? null),
    reset: () => setText(shown),
  };
}

export function SearchInput({ className, ...props }: Omit<ComponentProps<typeof Input>, 'type'>) {
  return (
    <div className={cn('relative w-full', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input type="search" autoComplete="off" className="pl-9" {...props} />
    </div>
  );
}

/**
 * Panneau dépliable commun à tous les modules : mêmes marges, même colonne de badge
 * et même emplacement réservé à l’action (favori), pour que les lignes restent alignées.
 * Le titre est un h3 (la carte de rubrique porte le h2) : le contenu d’un <summary> admet
 * un titre, pas un bloc, d’où le titre et le sous-titre placés directement dans la grille.
 * Une carte ou une étape rangée dans le panneau prend donc un h4 (CardTitle as="h4").
 */
export function ModulePanel({
  id,
  icon: Icon,
  title,
  subtitle,
  badge,
  action,
  open,
  onOpenChange,
  hidden,
  children,
}: {
  id: string;
  icon: LucideIcon;
  title: ReactNode;
  subtitle: ReactNode;
  badge?: ReactNode;
  action?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  hidden?: boolean;
  children: ReactNode;
}) {
  return (
    <Card className="admin-module-card" hidden={hidden}>
      {action}
      <details
        className="admin-module"
        id={id}
        open={open}
        onToggle={onOpenChange ? (event) => onOpenChange(event.currentTarget.open) : undefined}
      >
        <summary>
          <Icon className="admin-module-icon" aria-hidden="true" />
          <h3 className="admin-module-title">{title}</h3>
          <span className="admin-module-subtitle">{subtitle}</span>
          {badge}
          <ChevronDown className="admin-module-chevron" aria-hidden="true" />
        </summary>
        <div className="admin-module-content">{children}</div>
      </details>
    </Card>
  );
}

/**
 * Repli commun : titre à gauche, chevron à droite qui pivote à l’ouverture, jamais le triangle
 * natif. `boxed` (par défaut) : un cadre sur toute la largeur (« Réglage fin », « Détails
 * techniques ») ; `inline` : un lien discret dans le texte (« Détails » d’une ligne du journal).
 * Ouvert ou fermé par la personne seulement : un nouvel affichage ne le referme pas.
 */
export function Fold({
  summary,
  hint,
  variant = 'boxed',
  defaultOpen = false,
  className,
  contentClassName,
  children,
}: {
  summary: ReactNode;
  /** Ce que contient le repli, à droite du titre, en plus discret. */
  hint?: ReactNode;
  variant?: 'boxed' | 'inline';
  defaultOpen?: boolean;
  className?: string;
  contentClassName?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const boxed = variant === 'boxed';
  return (
    <details
      className={cn('group', boxed && 'rounded-xl border px-4 py-3 text-sm', className)}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary
        className={cn(
          'cursor-pointer list-none [&::-webkit-details-marker]:hidden',
          boxed
            ? 'flex min-h-8 items-center justify-between gap-3 font-medium'
            : 'inline-flex w-fit items-center gap-1 text-muted-foreground hover:text-foreground',
        )}
      >
        <span className="min-w-0">
          {summary}
          {hint && <span className="ml-2 font-normal text-muted-foreground">{hint}</span>}
        </span>
        <ChevronDown
          className={cn(
            'shrink-0 transition-transform group-open:rotate-180',
            boxed ? 'size-4 text-muted-foreground' : 'size-3.5',
          )}
          aria-hidden="true"
        />
      </summary>
      <div className={cn(boxed ? 'mt-3 space-y-3' : 'mt-2', contentClassName)}>{children}</div>
    </details>
  );
}

export function CollapsibleSection({
  icon: Icon,
  title,
  description,
  defaultOpen = true,
  as: Heading = 'h3',
  children,
}: {
  icon?: LucideIcon;
  title: string;
  description: string;
  defaultOpen?: boolean;
  /** h4 pour un repli rangé dans un autre (ModulePanel, « Réglages avancés »). */
  as?: 'h3' | 'h4';
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className="admin-module"
    >
      <summary>
        {Icon ? (
          <Icon className="admin-module-icon" aria-hidden="true" />
        ) : (
          <span className="admin-module-icon" aria-hidden="true" />
        )}
        <Heading className="admin-module-title">{title}</Heading>
        <span className="admin-module-subtitle">{description}</span>
        <ChevronDown className="admin-module-chevron" aria-hidden="true" />
      </summary>
      <div className="admin-module-content">{children}</div>
    </details>
  );
}

/**
 * Confirmation d’une action définitive, affichée sous le bouton qui l’a demandée.
 *
 * - Le focus va sur « Annuler » : une validation par Entrée réflexe ne supprime rien.
 * - Échap annule, et le focus revient au bouton d’origine à la fermeture.
 * - Lecteur d’écran : boîte d’alerte nommée par sa question.
 *
 * Le bouton qui l’ouvre (« Supprimer », « Oublier »…) prend la variante `danger-outline` et un
 * aria-label qui commence par son texte visible : « Supprimer la commande Santé serveur ».
 */
export function ConfirmAction({
  message,
  confirmLabel = 'Confirmer',
  onConfirm,
  onCancel,
  returnFocusTo,
}: {
  message: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /**
   * Bouton d’origine quand la confirmation le remplace à l’écran : démonté pendant la question,
   * il est remonté (nouvel élément) à la fermeture, et c’est cette ref qui le retrouve.
   */
  returnFocusTo?: RefObject<HTMLElement | null>;
}) {
  const questionId = useId();
  const container = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const active = document.activeElement;
    const origin = active instanceof HTMLElement && active !== document.body ? active : null;
    cancel.current?.focus();
    return () => {
      // Ne reprend le focus que s’il était dans la confirmation (désormais retirée) : un clic
      // ailleurs entre-temps garde sa place. Après une suppression, l’origine a pu disparaître.
      const now = document.activeElement;
      const lost = !now || now === document.body || !now.isConnected;
      if (!lost && !container.current?.contains(now)) return;
      // Ce nettoyage passe après la mise à jour de la page : un bouton remonté est déjà là.
      const target = origin?.isConnected ? origin : returnFocusTo?.current;
      if (target?.isConnected) target.focus({ preventScroll: true });
    };
    // Une ref ne change pas d’identité : l’effet ne rejoue qu’au montage et au démontage.
  }, [returnFocusTo]);
  return (
    <Alert
      ref={container}
      variant="destructive"
      role="alertdialog"
      aria-labelledby={questionId}
      onKeyDown={(event) => {
        if (event.key !== 'Escape') return;
        event.stopPropagation();
        onCancel();
      }}
    >
      <AlertDescription className="space-y-3">
        <p id={questionId}>{message}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="destructive" size="sm" onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button
            ref={cancel}
            variant="outline"
            size="sm"
            className="text-foreground"
            onClick={onCancel}
          >
            Annuler
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * « Pour qui ? » : le choix de la personne en tête d’une rubrique (Personnaliser, Modules,
 * Agents, Mémoire), avec la même présentation partout. Le titre est commun ; le libellé du
 * champ dit ce qui change avec la personne (« Souvenirs de ») et nomme la liste pour un
 * lecteur d’écran. `options` place des choix avant les personnes (« Tout le foyer »).
 */
export function PersonPicker({
  id,
  label,
  value,
  onChange,
  profiles,
  options = [],
  description,
  help,
  disabled = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  profiles: readonly Profile[];
  options?: readonly { value: string; label: string }[];
  /** Ce que règle la rubrique pour la personne choisie. */
  description: ReactNode;
  /** Sous la liste : pourquoi elle est verrouillée, par exemple. */
  help?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <Card className="gap-0 py-5" data-person-picker="">
      <CardContent className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
        <div className="min-w-0 flex-[1_1_20rem] space-y-2">
          <CardTitle>Pour qui ?</CardTitle>
          <CardDescription className="leading-relaxed">{description}</CardDescription>
        </div>
        <Field id={id} label={label} help={help} className="w-full sm:w-72">
          <NativeSelect
            id={id}
            wrapperClassName="w-full"
            className="w-full"
            value={value}
            disabled={disabled}
            onChange={(event) => onChange(event.target.value)}
          >
            {options.map((option) => (
              <NativeSelectOption key={option.value} value={option.value}>
                {option.label}
              </NativeSelectOption>
            ))}
            {profiles.map((profile) => (
              <NativeSelectOption key={profile.id} value={profile.id}>
                {profile.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </CardContent>
    </Card>
  );
}

export function OwnerSelect({
  id,
  value,
  onChange,
  profiles,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  profiles: Profile[];
}) {
  return (
    <NativeSelect
      id={id}
      wrapperClassName="w-full"
      className="w-full"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <NativeSelectOption value="">Le foyer</NativeSelectOption>
      {profiles.map((profile) => (
        <NativeSelectOption key={profile.id} value={profile.id}>
          {profile.name}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

export function EnabledSelect({
  id,
  value,
  onChange,
}: {
  id?: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <NativeSelect
      id={id}
      wrapperClassName="w-full"
      className="w-full"
      value={value ? 'true' : 'false'}
      onChange={(event) => onChange(event.target.value === 'true')}
    >
      <NativeSelectOption value="true">Activée</NativeSelectOption>
      <NativeSelectOption value="false">Désactivée</NativeSelectOption>
    </NativeSelect>
  );
}

export function PresetButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? 'secondary' : 'outline'}
      aria-pressed={active}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}
