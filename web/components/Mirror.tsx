import { memo, useEffect, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { TriangleAlert } from 'lucide-react';
import { mirrorBlocker, type MirrorBlockerId } from '../../shared/readiness';
import type { DisplayCard, SessionPhase, VoiceActivity } from '../../shared/types';
import type { MirrorConnection } from '../useMirror';
import { BrowserCamera } from '../camera/BrowserCamera';
import { Orb } from './Orb';
import { AmbientModules } from './AmbientModules';
import { Screensaver, type ScreensaverScene } from './Screensaver';
import { screensaverWoken } from './screensaver-wake';
import { useVoice } from '../audio/useVoice';
import {
  audioPreparation,
  subscribeAudioPreparation,
  prepareAudio,
  restoreAudioPermission,
} from '../audio/preparation';
import { useMeasures } from '../audio/useMeasures';

export const phaseLabels: Record<SessionPhase, string> = {
  idle: 'En veille',
  connecting: 'Connexion en cours',
  ready: 'Prêt',
  closing: 'Fermeture en cours',
  blocked: 'Session indisponible',
};

/** Statut annoncé au lecteur d’écran, dans les mots du miroir. */
const mirrorPhaseLabels: Record<SessionPhase, string> = {
  idle: 'En veille.',
  connecting: 'Ouverture de la conversation…',
  ready: 'Conversation en cours.',
  closing: 'Fin de la conversation…',
  blocked: 'Conversation indisponible.',
};

/** Libellé discret sous l’orbe pendant la réflexion ; rien au repos, ni à l’écoute ni à la parole. */
const voiceLabels: Partial<Record<VoiceActivity['phase'], string>> = {
  thinking: 'Je réfléchis…',
};

/**
 * Garde le dernier libellé une seconde après le retour au repos : l’écoute et la parole
 * arrivent par petites touches et le texte ne doit pas clignoter entre deux.
 */
function useHeldLabel(label: string | null) {
  const [held, setHeld] = useState(label);
  useEffect(() => {
    if (label) return void setHeld(label);
    const timer = setTimeout(() => setHeld(null), 1_000);
    return () => clearTimeout(timer);
  }, [label]);
  return label ?? held;
}

/**
 * Regard tenu : une perte de regard plus courte qu’1,2 s ne fait pas repasser la personne au gris
 * (la détection hésite souvent une fraction de seconde). Le retour au vert reste immédiat.
 */
function useHeldEngagement(engaged: readonly string[]): Set<string> {
  const key = [...engaged].sort().join('\n');
  const [held, setHeld] = useState<Set<string>>(() => new Set(engaged));
  useEffect(() => {
    const now = new Set(key ? key.split('\n') : []);
    setHeld((previous) => new Set([...previous, ...now]));
    const timer = setTimeout(() => setHeld(now), 1_200);
    return () => clearTimeout(timer);
  }, [key]);
  return held;
}

/** Motifs dont le remède est dans l’administration : son adresse est donnée en texte. */
const adminRemedies = new Set<MirrorBlockerId>([
  'openai-key',
  'openai-blocked',
  'manual-stop',
  'camera',
]);

/** Vrai après 5 s sans état frais : une resynchronisation brève ne s’affiche pas. */
function useConnectionLost(fresh: boolean, interrupted: boolean) {
  const [lost, setLost] = useState(false);
  useEffect(() => {
    // Remis à zéro dès le retour : une nouvelle coupure attend à nouveau 5 s.
    if (fresh || interrupted) return void setLost(false);
    const timer = setTimeout(() => setLost(true), 5_000);
    return () => clearTimeout(timer);
  }, [fresh, interrupted]);
  return lost && !fresh && !interrupted;
}

/**
 * Écran de veille : vrai après `delayMs` de conditions réunies sans interruption ; faux dès
 * qu’elles cessent (une personne apparaît, une conversation s’ouvre).
 */
function useScreensaverActive(wanted: boolean, delayMs: number) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    if (!wanted) return void setActive(false);
    const timer = setTimeout(() => setActive(true), delayMs);
    return () => clearTimeout(timer);
  }, [wanted, delayMs]);
  return active && wanted;
}

export function Mirror({ connection }: { connection: MirrorConnection }) {
  const { state, fresh, now, interrupted, reconnect } = connection;
  const preparation = useSyncExternalStore(subscribeAudioPreparation, audioPreparation);
  // Tant que la voix n’est pas prête, réessayer seul : si le navigateur autorise déjà le micro
  // et le son pour ce site, un rechargement de page n’exige pas de nouveau clic.
  useEffect(() => {
    if (preparation.ready || preparation.busy) return;
    void restoreAudioPermission();
    const retry = setInterval(() => void restoreAudioPermission(), 5000);
    return () => clearInterval(retry);
  }, [preparation.ready, preparation.busy]);
  const { readAudio, audioLocked } = useVoice(state, fresh);
  useMeasures(state, fresh, readAudio);
  // Une conversation tenue par un satellite : le miroir reste au repos et dit seulement où.
  const satelliteName =
    fresh &&
    state?.session.satellite &&
    ['connecting', 'ready', 'closing'].includes(state.session.phase)
      ? state.session.satellite.name
      : null;
  const phase = fresh && state && !satelliteName ? state.session.phase : 'idle';
  const present = fresh && state?.presence.health === 'ok' && state.presence.state !== 'absent';
  const voiceOnlyActive =
    fresh && state?.session.mode === 4 && ['connecting', 'ready', 'closing'].includes(phase);
  const recognizedId =
    present && state.selection === 'automatic' && state.presence.peopleCount === 1
      ? (state.activeProfile?.id ?? null)
      : null;
  // Les cartes quittent immédiatement le DOM dès que leur portée ou leur fraîcheur change.
  const cards =
    fresh && state
      ? state.cards
          .filter(
            (card) =>
              card.expiresAt > now &&
              state.session.interactionId !== null &&
              card.interactionId === state.session.interactionId &&
              card.profileEpoch === state.session.profileEpoch &&
              card.contextVersion === state.session.contextVersion &&
              (!card.profileId || card.profileId === state.activeProfile?.id),
          )
          .slice(0, 3)
      : [];
  const peopleVisible = !!(
    state &&
    state.presence.health === 'ok' &&
    state.presence.people.length > 0
  );
  const imageActivity = fresh ? (state?.imageGeneration ?? null) : null;
  const connectionLost = useConnectionLost(fresh, interrupted);
  // Une seule ligne d’état, en langage courant ; le bouton « Activer la voix » dit déjà le
  // motif « voice », et l’onglet supplanté a son propre message dans le pied de page.
  const blocker = fresh && state ? mirrorBlocker(state, { fresh }) : null;
  const line = interrupted
    ? null
    : !fresh
      ? connectionLost
        ? { text: 'Connexion au serveur perdue, nouvelle tentative…', admin: false }
        : null
      : blocker && blocker.id !== 'voice'
        ? { text: blocker.reason, admin: adminRemedies.has(blocker.id) }
        : null;
  const waitingForWakeWord =
    fresh && phase === 'idle' && !blocker && state?.wakeWord.enabled && state.wakeWord.ready;
  // Même règle que l’orbe : une activité vocale expirée vaut le repos.
  const voice = fresh && phase === 'ready' ? state?.voice : null;
  const heldVoiceLabel = useHeldLabel(
    voice && (!voice.endsAt || voice.endsAt > now) ? (voiceLabels[voice.phase] ?? null) : null,
  );
  const voiceLabel = fresh && phase === 'ready' ? heldVoiceLabel : null;
  const engagedPeople = useHeldEngagement(
    (state?.presence.people ?? [])
      .filter((person) => person.engaged)
      .map((person) => person.trackId),
  );
  const activationShown = (!preparation.ready || audioLocked) && fresh && !state?.openaiBlocked;
  // Peintures tant que l’orbe n’a pas à s’éveiller (voir screensaverWoken) et que rien n’attend
  // un regard (carte, image en cours). Le bouton « Activer la voix » ne sert qu’à une personne
  // présente : sa venue le fait revenir.
  const screensaver = state?.screensaver;
  const [screensaverScene, setScreensaverScene] = useState<ScreensaverScene>('off');
  const screensaverActive = useScreensaverActive(
    !!screensaver?.enabled &&
      screensaver.imageCount > 0 &&
      // Un état brièvement ancien (resynchronisation) garde la peinture ; une coupure de plus
      // de 5 s (connectionLost) la retire pour laisser voir la ligne d’état.
      !!state &&
      !screensaverWoken(state, phase) &&
      !voiceOnlyActive &&
      !satelliteName &&
      !imageActivity &&
      cards.length === 0 &&
      !interrupted &&
      !connectionLost,
    screensaver?.returnDelayMs ?? 0,
  );
  const mainCard = cards[0];
  const secondaryCards = cards.slice(1);

  return (
    <main
      className="mirror-page"
      aria-label="Miroir Cornelius"
      // Taille de l’orbe choisie dans l’administration (100 % : taille d’origine).
      style={{ '--orb-user-scale': (state?.orbScale ?? 100) / 100 } as CSSProperties}
      data-screensaver={screensaverScene}
    >
      <div className="mirror-top">
        <header className="mirror-header">
          <h1 className="sr-only">Cornelius</h1>
          <span className="mirror-wordmark" aria-hidden="true">
            cornelius<span> /</span>
          </span>
          {/* Adresse en texte : le miroir n’a ni souris ni clavier pour suivre un lien. */}
          <p className="mirror-line" role="status">
            {line?.text}
            {line?.admin && (
              <>
                {' '}
                Adresse : <span className="mirror-line-address">{location.origin}/admin</span>
              </>
            )}
          </p>
        </header>
        {fresh && state && <AmbientModules state={state} now={now} />}
      </div>

      {/* Monté tant qu’il est activé ou encore visible : la sortie se joue jusqu’au bout. */}
      {(screensaver?.enabled || screensaverScene !== 'off') && (
        <Screensaver
          active={screensaverActive}
          revision={screensaver?.revision ?? ''}
          intervalMs={screensaver?.intervalMs ?? 300_000}
          transition={screensaver?.transition ?? 'vortex'}
          durationMs={screensaver?.durationMs ?? 1_000}
          fit={screensaver?.fit ?? 'canvas'}
          onSceneChange={setScreensaverScene}
        />
      )}
      <div className="mirror-orb-anchor" data-testid="mirror-orb" />
      <Orb
        fullscreen
        readAudio={readAudio}
        phase={phase}
        activity={fresh && !satelliteName ? state?.voice : null}
        now={now}
        presence={!present && !voiceOnlyActive ? 'sleeping' : recognizedId ? 'recognized' : 'aware'}
        recognitionKey={recognizedId}
        webSearchActive={fresh && state?.webSearchActive === true}
      />
      {/* Une ligne au plus, sous l’orbe ; l’invite d’activation, quand elle est là, passe avant. */}
      {voiceLabel && !activationShown && (
        <p className="mirror-voice-state" aria-hidden="true">
          {voiceLabel}
        </p>
      )}
      <p className="sr-only" role="status">
        {!fresh
          ? interrupted
            ? ''
            : 'Connexion au miroir interrompue.'
          : phase === 'ready'
            ? (voiceLabel ?? mirrorPhaseLabels.ready)
            : waitingForWakeWord
              ? 'En attente du mot d’appel « Cornelius ».'
              : mirrorPhaseLabels[phase]}
      </p>

      {/* Cartes puis pied de page : pile sous l’orbe en portrait, grille en paysage. */}
      <div className="mirror-stack">
        {mainCard && (
          <section
            className="mirror-card-rail mirror-card-rail-main"
            aria-label="Carte principale"
            aria-live="polite"
          >
            <div className="mirror-card-slot" key={mainCard.id}>
              <Card card={mainCard} />
            </div>
          </section>
        )}
        {secondaryCards.length > 0 && (
          <section
            className="mirror-card-rail mirror-card-rail-secondary"
            data-count={secondaryCards.length}
            aria-label="Cartes complémentaires"
            aria-live="polite"
          >
            {secondaryCards.map((card) => (
              <div className="mirror-card-slot" key={card.id}>
                <Card card={card} secondary={state?.cardSettings?.compactSecondary !== false} />
              </div>
            ))}
          </section>
        )}
        <div className="mirror-footer">
          <BrowserCamera config={connection.cameraConfig} active={fresh && !interrupted} />
          {interrupted && (
            // Le serveur a donné la main à un autre onglet : ne la reprendre qu’à la demande.
            <div className="mirror-hint">
              <p role="status">Ce miroir est affiché dans un autre onglet.</p>
              <button className="mirror-activate" onClick={reconnect}>
                Afficher ici
              </button>
            </div>
          )}
          {activationShown && (
            <div className="mirror-hint">
              <button
                className="mirror-activate"
                disabled={preparation.busy}
                onClick={() => {
                  void prepareAudio().catch(() => {});
                }}
              >
                {preparation.busy ? 'Autorisation du microphone…' : 'Activer la voix'}
              </button>
              {/* Un seul paragraphe annoncé : l’aide, ou l’erreur placée au-dessus du bouton. */}
              <p className={preparation.error ? 'mirror-hint-error' : undefined} role="status">
                {preparation.error && (
                  <TriangleAlert className="mirror-hint-icon" aria-hidden="true" />
                )}
                {preparation.error ??
                  'Touchez pour autoriser le micro et le son. À refaire après un redémarrage du navigateur.'}
              </p>
            </div>
          )}
          {fresh && state && (peopleVisible || imageActivity || satelliteName) && (
            <div className="mirror-status">
              {satelliteName && (
                <span className="mirror-activity" role="status">
                  <span className="mirror-activity-dot" aria-hidden="true" />
                  Conversation en cours : {satelliteName}
                </span>
              )}
              {imageActivity && (
                <span className="mirror-activity" role="status">
                  <span className="mirror-activity-dot" aria-hidden="true" />
                  {imageActivity.kind === 'illustration'
                    ? 'Illustration en cours'
                    : 'Image en création'}
                </span>
              )}
              {peopleVisible && (
                <aside className="mirror-presence" aria-label="Personnes détectées">
                  {state.presence.people.map((person) => {
                    const profile = person.profileId
                      ? (state.profiles.find((candidate) => candidate.id === person.profileId) ??
                        null)
                      : null;
                    const classes = [
                      'mirror-person',
                      engagedPeople.has(person.trackId) ? 'is-engaged' : '',
                      profile && profile.id === state.activeProfile?.id ? 'is-active' : '',
                    ]
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <span key={person.trackId} className={classes}>
                        <span className="mirror-person-dot" aria-hidden="true" />
                        {profile ? profile.name : 'Personne inconnue'}
                        {engagedPeople.has(person.trackId) && (
                          <span className="sr-only">, vous regarde</span>
                        )}
                      </span>
                    );
                  })}
                </aside>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

const addonLabels: Record<string, string> = {
  clock: 'Heure',
  weather: 'Météo',
  transit: 'Transports',
};
const addonKinds: Record<string, string> = { clock: 'clock', weather: 'weather', transit: 'bus' };

/** Famille de la carte : teinte du verre et de la pastille, lue aussi par la scène WebGL. */
function cardKind(card: DisplayCard): string {
  const content = card.content;
  if (content.cardType === 'image') return 'image';
  if (content.cardType === 'module') return addonKinds[content.addonId] ?? 'module';
  return card.sources.some((source) => source.url) ? 'web' : 'luna';
}

function cardKicker(card: DisplayCard): string {
  const content = card.content;
  const label =
    content.cardType === 'module' ? (addonLabels[content.addonId] ?? 'Module') : 'Réponse';
  return card.stale || (content.cardType === 'module' && content.stale)
    ? `${label} · hors ligne`
    : label;
}

const Card = memo(function Card({
  card,
  secondary = false,
}: {
  card: DisplayCard;
  secondary?: boolean;
}) {
  const content = card.content;
  // Une image s’affiche seule : ni titre, ni prompt (parfois en anglais pour le modèle).
  if (content.cardType === 'image')
    return (
      <article
        className={`display-card display-card-image ${secondary ? 'display-card-secondary' : 'display-card-main'}`}
        data-kind="image"
      >
        <div className="card-surface">
          <img
            className="card-generated-image"
            src={content.imageUrl}
            alt="Image créée par Cornelius"
            width={content.width}
            height={content.height}
          />
        </div>
      </article>
    );
  return (
    <article
      className={`display-card ${secondary ? 'display-card-secondary' : 'display-card-main'}`}
      data-kind={cardKind(card)}
    >
      <div className="card-surface">
        <header className="card-heading">
          <span className="card-kicker">{cardKicker(card)}</span>
          <h2>{content.title}</h2>
        </header>

        <div className="card-body">
          {content.primaryValue && <p className="card-value">{content.primaryValue}</p>}
          {content.subtitle && <p className="card-subtitle">{content.subtitle}</p>}
          {content.description && <p className="card-description">{content.description}</p>}
          {content.items.length > 0 && (
            <dl className="card-items">
              {content.items.map((item, index) => (
                <div key={`${item.label}-${index}`}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
        {card.sources.length > 0 && (
          <div className="card-source">
            <span>
              {card.sources.map((source, index) => (
                <span key={source.id}>
                  {index > 0 && ' · '}
                  {source.url && /^https?:\/\//i.test(source.url) ? (
                    <a href={source.url} target="_blank" rel="noopener noreferrer">
                      {source.title}
                    </a>
                  ) : (
                    source.title
                  )}
                </span>
              ))}
            </span>
            <span className="card-source-mark" aria-hidden="true">
              ✧
            </span>
          </div>
        )}
      </div>
    </article>
  );
});
