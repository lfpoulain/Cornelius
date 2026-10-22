import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  LoaderCircle,
  LogOut,
  Monitor,
  WifiOff,
  X,
} from 'lucide-react';
import { readinessChecklist, readinessComplete } from '../../shared/readiness';
import type { MirrorCommand } from '../../shared/types';
import { api, errorMessage } from '../api';
import type { MirrorConnection } from '../useMirror';
import { Memory } from './admin/Memory';
import { Personality } from './admin/Personality';
import { Profiles } from './admin/Profiles';
import { Addons } from './admin/Addons';
import { Agents } from './admin/Agents';
import { Diagnostics } from './admin/Diagnostics';
import { AdminPasswordCard, RestartServerCard } from './admin/ServerControls';
import { VoiceSettings } from './admin/VoiceSettings';
import { OrbScaleSettings } from './admin/OrbScaleSettings';
import { Secrets } from './admin/Secrets';
import { NetworkAccess } from './admin/NetworkAccess';
import { Satellites } from './admin/Satellites';
import { GettingStarted, remainingSteps } from './admin/GettingStarted';
import { SessionControls } from './admin/SessionControls';
import { activateMirror } from './admin/activate-mirror';
import { Devices } from './admin/Devices';
import { FaceEnrollment, faceEnrollmentBlocker } from './admin/FaceEnrollment';
import { Logs } from './admin/Logs';
import { LoadingCard } from './admin/shared';
import type { RunAction } from './admin/types';
import { createRunQueue } from './admin/run-queue';
import { UnsavedChangesContext } from './admin/unsaved';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { openMirrorWindow } from '../mirror-window';
import './Admin.css';

const sections = [
  {
    id: 'start',
    group: 'Premiers réglages',
    label: 'Mise en route',
    description: 'Ce qu’il reste à faire avant la première conversation, étape par étape.',
  },
  {
    id: 'audio',
    group: 'Premiers réglages',
    label: 'Micro et haut-parleurs',
    description: 'Par où Cornelius vous entend, et par où il vous répond.',
  },
  {
    id: 'camera',
    group: 'Premiers réglages',
    label: 'Caméra et reconnaissance',
    description: 'La caméra du miroir, la reconnaissance des visages et le regard.',
  },
  {
    id: 'profiles',
    group: 'Premiers réglages',
    label: 'Le foyer et les visages',
    description: 'Les personnes que Cornelius connaît, et le visage de chacune.',
  },
  {
    id: 'voice',
    group: 'Premiers réglages',
    label: 'Quand il écoute',
    description: 'Ce qui ouvre la conversation, qui peut l’ouvrir et quand elle se termine.',
  },
  {
    id: 'satellites',
    group: 'Premiers réglages',
    label: 'Satellites audio',
    description: 'Les micros et haut-parleurs des autres pièces, qui répondent à « Cornelius ».',
  },
  {
    id: 'personality',
    group: 'Au quotidien',
    label: 'Personnaliser Cornelius',
    description:
      'Son caractère pour toute la maison, sa façon de parler à chacun et la taille de son orbe.',
  },
  {
    id: 'modules',
    group: 'Au quotidien',
    label: 'Modules',
    description: 'Les sources de ses réponses et les commandes qu’il peut lancer.',
  },
  {
    id: 'agents',
    group: 'Au quotidien',
    label: 'Agents',
    description: 'Les agents personnels reliés au miroir, et vos demandes en cours.',
  },
  {
    id: 'memory',
    group: 'Au quotidien',
    label: 'Mémoire',
    description: 'Les souvenirs de chaque personne, à consulter, corriger ou oublier.',
  },
  {
    id: 'diagnostic',
    group: 'Diagnostic',
    label: 'État du système',
    description: 'À consulter quand quelque chose ne répond pas.',
  },
  {
    id: 'logs',
    group: 'Diagnostic',
    label: 'Journal',
    description: 'Tout ce que fait Cornelius, dans l’ordre, à joindre à une demande d’aide.',
  },
] as const;
type Section = (typeof sections)[number]['id'];
type ModuleView = 'information' | 'commands';
const groups = ['Premiers réglages', 'Au quotidien', 'Diagnostic'];
// Rubriques de lecture seule : hors connexion, leurs filtres, leur recherche et leur export
// restent utilisables. Ailleurs, les réglages sont grisés tant que le serveur ne répond pas.
const readingSections: ReadonlySet<Section> = new Set(['diagnostic', 'logs']);

// La rubrique vit dans l’adresse (#modules, #modules/commandes) : un rechargement, une
// reconnexion ou le bouton Précédent ramènent au même endroit. Sans rubrique dans l’adresse,
// l’arrivée attend l’état du miroir (voir landing).
function readLocation(): { section: Section; moduleView: ModuleView; known: boolean } {
  const [id, view] = decodeURIComponent(location.hash.slice(1)).split('/');
  const match = sections.find((item) => item.id === id)?.id;
  const section = match ?? 'start';
  return {
    known: !!match,
    section,
    moduleView: section === 'modules' && view === 'commandes' ? 'commands' : 'information',
  };
}
function hashOf(section: Section, moduleView: ModuleView): string {
  return '#' + section + (section === 'modules' && moduleView === 'commands' ? '/commandes' : '');
}

export function Admin({
  connection,
  onLogout,
  loggingOut,
}: {
  connection: MirrorConnection;
  onLogout: () => Promise<void>;
  loggingOut: boolean;
}) {
  const [section, setSection] = useState<Section>(() => readLocation().section);
  const [moduleView, setModuleView] = useState<ModuleView>(() => readLocation().moduleView);
  // Arrivée sans rubrique dans l’adresse : « Mise en route » s’il reste une étape, sinon
  // « Quand il écoute ». Le choix attend l’état du miroir et celui des périphériques.
  const [landing, setLanding] = useState(() => !readLocation().known);
  const [devicesLate, setDevicesLate] = useState(false);
  const [personalityProfile, setPersonalityProfile] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [offline, setOffline] = useState(false);
  // Heure de la perte de connexion : les valeurs affichées datent de ce moment.
  const [lostAt, setLostAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const unsaved = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null);
  // Après un changement de rubrique, le focus passe au titre : un lecteur d’écran annonce la
  // nouvelle rubrique et la tabulation repart du haut du contenu.
  const focusHeading = useRef(false);
  const picked = useRef(false);
  const latest = useRef({ section, moduleView });
  latest.current = { section, moduleView };
  const { state, fresh, devices } = connection;
  const current = sections.find((item) => item.id === section)!;
  const readiness = useMemo(
    () =>
      state
        ? readinessChecklist({
            state,
            devices,
            defaultPassword: devices?.defaultPassword ?? false,
            enrolledFaces: devices?.enrolledFaces ?? 0,
          })
        : null,
    [state, devices],
  );
  const setupDone = readiness !== null && readinessComplete(readiness);
  const home: Section = setupDone ? 'voice' : 'start';
  // Une resynchronisation brève ne doit pas griser toute la page : seule une coupure
  // qui dure bloque les réglages.
  const connected = fresh || !offline;

  useEffect(() => {
    if (fresh) {
      setOffline(false);
      setLostAt(null);
      return;
    }
    const since = Date.now();
    const timeout = window.setTimeout(() => {
      setOffline(true);
      setLostAt(since);
    }, 1500);
    return () => window.clearTimeout(timeout);
  }, [fresh]);

  useEffect(() => {
    if (!landing) return;
    // Un serveur ancien n’envoie pas les périphériques : ne pas attendre indéfiniment.
    const timeout = window.setTimeout(() => setDevicesLate(true), 2000);
    return () => window.clearTimeout(timeout);
  }, [landing]);

  useEffect(() => {
    if (!landing || !readiness || (!devices && !devicesLate)) return;
    history.replaceState(null, '', hashOf(home, 'information'));
    setSection(home);
    setLanding(false);
  }, [landing, readiness, devices, devicesLate, home]);

  useEffect(() => {
    document.title = landing
      ? 'Administration Cornelius'
      : current.label + ' · Administration Cornelius';
  }, [landing, current.label]);

  useEffect(() => {
    if (!focusHeading.current) return;
    focusHeading.current = false;
    heading.current?.focus({ preventScroll: true });
  }, [section]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(null), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  useEffect(() => {
    if (!pending) {
      setSlow(false);
      return;
    }
    const timeout = window.setTimeout(() => setSlow(true), 400);
    return () => window.clearTimeout(timeout);
  }, [pending]);

  const registerUnsaved = useCallback((key: string, dirty: boolean) => {
    if (dirty) unsaved.current.add(key);
    else unsaved.current.delete(key);
  }, []);
  const confirmLeave = () =>
    unsaved.current.size === 0 ||
    window.confirm(
      'Des modifications ne sont pas enregistrées. Quitter cette rubrique sans les enregistrer ?',
    );

  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved.current.size) event.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const showTop = () => {
    const main = document.getElementById('admin-content');
    if (!main) return;
    // Sur mobile, la navigation précède le contenu : ne remonter que si on l’a dépassée.
    const top = main.getBoundingClientRect().top + window.scrollY;
    if (window.scrollY > top) window.scrollTo(0, top);
  };

  useEffect(() => {
    const sync = () => {
      const next = readLocation();
      const previous = latest.current;
      // Ancre interne (lien d’évitement…) : pas un changement de rubrique.
      if (!next.known) return;
      setLanding(false);
      if (next.section === previous.section && next.moduleView === previous.moduleView) return;
      if (next.section !== previous.section && !confirmLeave()) {
        history.pushState(null, '', hashOf(previous.section, previous.moduleView));
        return;
      }
      if (next.section !== previous.section) focusHeading.current = true;
      setSection(next.section);
      setModuleView(next.moduleView);
      setNotice(null);
      setError(null);
      if (next.section !== previous.section) showTop();
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, []);

  const go = (
    next: Section,
    view: ModuleView = next === 'modules' ? moduleView : 'information',
  ) => {
    // Un choix fait avant l’arrivée automatique l’emporte sur elle.
    if (landing) {
      setLanding(false);
      if (next === section) history.replaceState(null, '', hashOf(next, view));
    }
    if (next === section) {
      showTop();
      return;
    }
    if (!confirmLeave()) return;
    history.pushState(null, '', hashOf(next, view));
    focusHeading.current = true;
    setSection(next);
    setModuleView(view);
    setNotice(null);
    setError(null);
    showTop();
  };
  const goTo = (id: string) => {
    const target = sections.find((item) => item.id === id);
    if (target) go(target.id);
  };

  // Les enregistrements s’enchaînent sans griser la page ni retirer le focus : un double clic
  // est ignoré, deux choix rapides d’un même réglage sont enregistrés (voir run-queue).
  const [run] = useState<RunAction>(() =>
    createRunQueue({
      start: () => {
        setError(null);
        setNotice(null);
      },
      succeeded: setNotice,
      failed: (failure) => setError(errorMessage(failure)),
      busy: setPending,
    }),
  );
  const command = (value: MirrorCommand, label: string) =>
    run(label, async () => {
      connection.accept(await api.command(value));
    });

  return (
    <UnsavedChangesContext.Provider value={registerUnsaved}>
      <div className="admin-shell admin-layout dark">
        <a
          className="admin-skip"
          href="#admin-content"
          onClick={(event) => {
            event.preventDefault();
            document.getElementById('admin-content')?.focus();
          }}
        >
          Aller aux réglages
        </a>
        <aside className="admin-sidebar">
          <a
            href={hashOf(home, 'information')}
            className="admin-brand"
            onClick={(event) => {
              event.preventDefault();
              go(home);
            }}
          >
            <span className="admin-orb" aria-hidden="true" />
            <span>
              <strong>Cornelius</strong>
              <span className="admin-eyebrow">Administration</span>
            </span>
          </a>
          {/* Téléphone : un sélecteur remplace la bande de rubriques. */}
          <nav className="admin-section-picker" aria-label="Sections d’administration">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="admin-picker-trigger w-full justify-between">
                  <span className="min-w-0 truncate">
                    Rubrique : {landing ? 'chargement…' : current.label}
                  </span>
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="admin-shell dark w-(--radix-dropdown-menu-trigger-width)"
                onCloseAutoFocus={(event) => {
                  // Après un choix, le focus va au titre de la nouvelle rubrique : le menu,
                  // modal, le retenait jusqu’à sa fermeture.
                  if (!picked.current) return;
                  picked.current = false;
                  event.preventDefault();
                  heading.current?.focus({ preventScroll: true });
                }}
              >
                {groups.map((group, index) => (
                  <Fragment key={group}>
                    {index > 0 && <DropdownMenuSeparator />}
                    <DropdownMenuLabel className="admin-eyebrow">{group}</DropdownMenuLabel>
                    {sections
                      .filter((item) => item.group === group)
                      .map((item) => (
                        <DropdownMenuItem
                          key={item.id}
                          className="min-h-11 justify-between"
                          aria-current={!landing && section === item.id ? 'page' : undefined}
                          onSelect={() => {
                            picked.current = true;
                            go(item.id);
                          }}
                        >
                          {item.label}
                          {!landing && section === item.id && (
                            <Check className="text-primary" aria-hidden="true" />
                          )}
                        </DropdownMenuItem>
                      ))}
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </nav>
          <nav className="admin-navigation" aria-label="Sections d’administration">
            {groups.map((group) => (
              <div className="admin-nav-group" key={group}>
                <p className="admin-eyebrow">{group}</p>
                {sections
                  .filter((item) => item.group === group)
                  .map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="admin-nav-item"
                      aria-current={!landing && section === item.id ? 'page' : undefined}
                      onClick={() => go(item.id)}
                    >
                      {item.label}
                      <span className="admin-dot" aria-hidden="true" />
                    </button>
                  ))}
              </div>
            ))}
          </nav>
          <div className="admin-data-note">
            <p className="admin-eyebrow">Où vont les données</p>
            <p>
              Visages et description de la scène : traités chez vous. Seule la conversation parlée
              et son contexte passent par le fournisseur vocal choisi (OpenAI ou Mistral). Les
              demandes confiées à un agent connecté lui sont aussi transmises.
            </p>
          </div>
        </aside>
        <main className="admin-main" id="admin-content" tabIndex={-1}>
          <header className="admin-header">
            <div className="admin-header-inner">
              {landing ? (
                <div className="admin-heading">
                  <p className="admin-eyebrow">Cornelius</p>
                  <h1>Administration</h1>
                  <p>Récupération de l’état du miroir…</p>
                </div>
              ) : (
                <div className="admin-heading">
                  <p className="admin-eyebrow">{current.group}</p>
                  <h1 ref={heading} tabIndex={-1}>
                    {current.label}
                  </h1>
                  <p>{current.description}</p>
                </div>
              )}
              <div className="admin-header-actions">
                <span className="admin-connection" data-connected={connected} role="status">
                  <span className="admin-dot" aria-hidden="true" />
                  {connected ? 'Serveur connecté' : 'Reconnexion…'}
                </span>
                <Button variant="outline" asChild>
                  <a
                    href="/"
                    target="cornelius-mirror"
                    onClick={(event) => {
                      event.preventDefault();
                      openMirrorWindow();
                    }}
                  >
                    <Monitor aria-hidden="true" />
                    Voir le miroir
                  </a>
                </Button>
                <Button
                  variant="outline"
                  disabled={loggingOut}
                  onClick={() => {
                    if (confirmLeave()) void onLogout();
                  }}
                >
                  <LogOut aria-hidden="true" />
                  {loggingOut ? 'Déconnexion…' : 'Se déconnecter'}
                </Button>
              </div>
            </div>
          </header>
          <div className="admin-content">
            {offline && (
              // Seul signal hors connexion avec la pastille de l’en-tête ; il reste visible
              // pendant le défilement.
              <Alert
                role="status"
                className="sticky top-3 z-30 border-[#e8bc8866] bg-[#2a2519] text-[#f3d7b0] shadow-lg"
              >
                <WifiOff aria-hidden="true" />
                <AlertDescription className="text-[#f3d7b0]">
                  Connexion au serveur perdue. Les saisies non enregistrées seront perdues si le
                  serveur redémarre.
                </AlertDescription>
              </Alert>
            )}
            {connection.error && (
              <Alert variant="destructive">
                <AlertDescription>{connection.error}</AlertDescription>
              </Alert>
            )}
            {!state || landing ? (
              <LoadingCard label="Récupération de l’état du miroir…" />
            ) : (
              <>
                <SessionControls
                  state={state}
                  status={devices}
                  busy={slow}
                  fresh={connected}
                  run={run}
                  command={command}
                  // Complet sur « Quand il écoute » seulement : sur « Mise en route », les étapes
                  // disent déjà quoi faire, et chacune porte son action.
                  compact={section !== 'voice'}
                  remaining={readiness ? remainingSteps(readiness) : 0}
                  onShowStart={section === 'start' ? undefined : () => go('start')}
                />
                <fieldset
                  className="admin-settings"
                  disabled={offline && !readingSections.has(section)}
                  aria-label={current.label}
                  aria-busy={pending}
                >
                  {section === 'start' && readiness && (
                    <GettingStarted
                      items={readiness}
                      perceptionDiagnostic={devices?.perception.diagnostic ?? null}
                      openaiBlocked={state.openaiBlocked}
                      onGo={goTo}
                      onActivateMirror={() =>
                        activateMirror({
                          openaiBlocked: state.openaiBlocked,
                          run,
                        })
                      }
                      onAllowOpenAI={() =>
                        void run(
                          'Services IA autorisés. La conversation reprend automatiquement si le miroir est prêt.',
                          () => api.blockOpenAI(false),
                        )
                      }
                    />
                  )}
                  {section === 'start' && <Secrets run={run} />}
                  {section === 'start' && <VoiceSettings state={state} run={run} />}
                  {section === 'start' && devices && (
                    <AdminPasswordCard defaultPassword={devices.defaultPassword} run={run} />
                  )}
                  {section === 'start' && devices && (
                    <NetworkAccess
                      network={devices.network}
                      defaultPassword={devices.defaultPassword}
                      run={run}
                    />
                  )}
                  {(section === 'voice' || section === 'camera' || section === 'audio') && (
                    <Devices section={section} state={state} status={devices} run={run} />
                  )}
                  {section === 'profiles' && (
                    <div className="space-y-5">
                      <Profiles
                        profiles={state.profiles}
                        run={run}
                        faceBlocker={faceEnrollmentBlocker(state, devices)}
                        onPersonalize={(profileId) => {
                          setPersonalityProfile(profileId);
                          go('personality');
                        }}
                      />
                      <FaceEnrollment
                        state={state}
                        status={devices}
                        run={run}
                        onOpenCamera={() => go('camera')}
                      />
                    </div>
                  )}
                  {section === 'personality' && (
                    <div className="space-y-5">
                      <Personality
                        profiles={state.profiles}
                        initialProfileId={personalityProfile}
                        run={run}
                      />
                      <OrbScaleSettings state={state} run={run} />
                    </div>
                  )}
                  {section === 'modules' && (
                    <Addons
                      state={state}
                      run={run}
                      status={devices}
                      openCommands={moduleView === 'commands'}
                    />
                  )}
                  {section === 'satellites' && (
                    <Satellites profiles={state.profiles} network={devices?.network} run={run} />
                  )}
                  {section === 'memory' && <Memory profiles={state.profiles} run={run} />}
                  {section === 'agents' && <Agents profiles={state.profiles} run={run} />}
                  {section === 'diagnostic' && <RestartServerCard run={run} />}
                  {section === 'diagnostic' && (
                    <Diagnostics
                      connection={connection}
                      staleSince={offline ? lostAt : null}
                      readiness={readiness}
                      onShowStart={() => go('start')}
                    />
                  )}
                  {section === 'logs' && <Logs />}
                </fieldset>
              </>
            )}
            <footer className="admin-footer">
              <span>Cornelius · Un assistant, à la maison.</span>
              <span>Voix et caméra</span>
            </footer>
          </div>
        </main>
        <div className="admin-toast-region">
          {error && (
            <div className="admin-alert" role="alert">
              <CircleAlert className="admin-toast-icon" aria-hidden="true" />
              <p>{error}</p>
              <button
                type="button"
                className="admin-toast-close"
                aria-label="Fermer le message d’erreur"
                onClick={() => setError(null)}
              >
                <X aria-hidden="true" />
              </button>
            </div>
          )}
          <div role="status" aria-live="polite" aria-atomic="true">
            {notice ? (
              <div className="admin-toast">
                <CheckCircle2 className="admin-toast-icon" aria-hidden="true" />
                <p>{notice}</p>
                <button
                  type="button"
                  className="admin-toast-close"
                  aria-label="Fermer la notification"
                  onClick={() => setNotice(null)}
                >
                  <X aria-hidden="true" />
                </button>
              </div>
            ) : (
              pending &&
              slow && (
                <div className="admin-pending">
                  <LoaderCircle className="admin-toast-icon animate-spin" aria-hidden="true" />
                  <p>Enregistrement en cours…</p>
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </UnsavedChangesContext.Provider>
  );
}
