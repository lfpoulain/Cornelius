import { useEffect, useState, type ReactNode } from 'react';
import {
  CheckCircle2,
  Cloud,
  Cpu,
  Download,
  RefreshCw,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';
import {
  IMAGE_GENERATION_MODEL_DEFAULT,
  IMAGE_GENERATION_MODELS,
  OPENAI_IMAGE_MODEL_DEFAULT,
  OPENAI_IMAGE_MODELS,
  OPENAI_IMAGE_QUALITIES,
  OPENAI_IMAGE_QUALITY_DEFAULT,
  type DevicesStatus,
  type ImageGenerationModel,
  type ImageGenerationProvider,
  type ImageGenerationStatus,
  type ModelDownload,
  type OpenAIImageModel,
  type OpenAIImageQuality,
} from '../../../shared/types';
import { api } from '../../api';
import { cn } from '@/lib/utils';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Label } from '../ui/label';
import { NativeSelect, NativeSelectOption } from '../ui/native-select';
import { Switch } from '../ui/switch';
import {
  InstallConfirm,
  InstallFailure,
  InstallProgress,
  ModelChoices,
  SetupStep,
  SetupSteps,
  TechnicalDetails,
  downloadDuration,
  gigabytes,
  isInstalled,
  isInstalling,
  megabytes,
  type ModelOption,
} from './ModelInstall';
import { ModulePanel } from './shared';
import type { RunAction } from './types';

/** Estimations : poids publiés des modèles et mémoire graphique observée au chargement. */
const options: readonly ModelOption<ImageGenerationModel>[] = [
  {
    id: 'sdxl-turbo',
    tier: 'Léger',
    name: 'SDXL Turbo',
    summary: 'Le plus rapide et le moins gourmand.',
    memoryGb: 7,
    diskGb: 7,
  },
  {
    id: 'sana-sprint-0.6b',
    tier: 'Équilibré',
    name: 'SANA-Sprint 0.6B',
    summary: 'Plus de détails, toujours rapide.',
    memoryGb: 9,
    diskGb: 9,
  },
  {
    id: 'flux2-klein-4b',
    tier: 'Précis',
    name: 'FLUX.2 Klein 4B',
    summary: 'Des images plus fidèles à la description.',
    memoryGb: 13,
    diskGb: 16,
  },
  {
    id: 'z-image-turbo',
    tier: 'Très précis',
    name: 'Z-Image Turbo',
    summary: 'Le plus détaillé, pour une carte graphique très bien dotée.',
    memoryGb: 20,
    diskGb: 43,
    downloadGb: 31,
  },
];
const optionOf = (model: ImageGenerationModel) =>
  options.find((option) => option.id === model) ?? options[2]!;
/** Modèles de l’API d’images d’OpenAI, du plus rapide au plus économique. */
export const openaiModelOptions: Record<OpenAIImageModel, { name: string; summary: string }> = {
  'gpt-image-2.5-flare': {
    name: 'GPT Image 2.5 Flare',
    summary: 'Le plus rapide, pour un usage courant (conseillé)',
  },
  'gpt-image-2.5-sunburst': {
    name: 'GPT Image 2.5 Sunburst',
    summary: 'Plus précis sur les détails et le texte, plus lent',
  },
  'gpt-image-1-mini': {
    name: 'GPT Image 1 mini',
    summary: 'Le plus économique, des images plus simples',
  },
};
const qualityLabels: Record<OpenAIImageQuality, string> = {
  low: 'Rapide (conseillé pour le miroir)',
  medium: 'Équilibrée',
  high: 'Soignée (plus lente et plus chère)',
};
const providers: {
  id: ImageGenerationProvider;
  name: string;
  summary: string;
  icon: typeof Cpu;
}[] = [
  {
    id: 'local',
    name: 'Sur ce PC',
    summary: 'Gratuit et privé, demande une carte graphique et un modèle installé.',
    icon: Cpu,
  },
  {
    id: 'openai',
    name: 'Avec OpenAI',
    summary: 'Rien à installer, utilise la clé OpenAI de Cornelius. Chaque image est facturée.',
    icon: Cloud,
  },
];

/**
 * Où créer les images : sur ce PC ou par l’API d’images d’OpenAI. Le choix fait reste coché
 * jusqu’à ce que l’état du serveur le confirme, ou revient à la valeur enregistrée s’il échoue.
 */
function ProviderChoice({
  value,
  disabled,
  onChange,
}: {
  value: ImageGenerationProvider;
  disabled?: boolean;
  onChange: (provider: ImageGenerationProvider) => Promise<boolean>;
}) {
  const [shown, setShown] = useState<ImageGenerationProvider | null>(null);
  // L’état du serveur a changé (ce choix confirmé, ou un autre fait ailleurs) : il l’emporte.
  useEffect(() => setShown(null), [value]);
  const current = shown ?? value;
  return (
    <fieldset className="space-y-2" disabled={disabled}>
      <legend className="text-sm font-medium">Où créer les images</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {providers.map((provider) => {
          const Icon = provider.icon;
          return (
            <label
              key={provider.id}
              className={cn(
                'flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50',
                disabled && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="radio"
                name="image-generation-provider"
                value={provider.id}
                checked={current === provider.id}
                aria-labelledby={`image-provider-${provider.id}-label`}
                aria-describedby={`image-provider-${provider.id}-detail`}
                className="mt-1 size-4 shrink-0 accent-primary"
                onChange={() => {
                  setShown(provider.id);
                  void onChange(provider.id).then((ok) => {
                    if (!ok) setShown(null);
                  });
                }}
              />
              <span className="min-w-0 space-y-1">
                <span
                  id={`image-provider-${provider.id}-label`}
                  className="flex items-center gap-2 text-sm font-medium"
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {provider.name}
                </span>
                <span
                  id={`image-provider-${provider.id}-detail`}
                  className="block text-xs text-muted-foreground"
                >
                  {provider.summary}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

/** Mise en place avec OpenAI : la clé, le modèle et la qualité, puis l’activation. */
function OpenAISteps({
  generation,
  run,
  toggles,
}: {
  generation: ImageGenerationStatus;
  run: RunAction;
  toggles: ReactNode;
}) {
  const unavailable = generation.openaiUnavailable;
  const model = generation.openaiModel ?? OPENAI_IMAGE_MODEL_DEFAULT;
  const quality = generation.openaiQuality ?? OPENAI_IMAGE_QUALITY_DEFAULT;
  return (
    <SetupSteps label="Mise en place de la génération d’image avec OpenAI">
      <SetupStep number={1} title="Clé OpenAI" done={!unavailable}>
        {unavailable ? (
          <p className="flex items-start gap-2 text-sm">
            <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-300" aria-hidden="true" />
            <span>
              {unavailable}{' '}
              <a className="font-medium text-primary underline underline-offset-4" href="#start">
                Renseigner la clé dans la mise en route
              </a>
            </span>
          </p>
        ) : (
          <p className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />
            La clé OpenAI de Cornelius sert aussi aux images.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          OpenAI peut demander de vérifier votre organisation (platform.openai.com, rubrique
          Organization) avant d’autoriser ses modèles d’image.
        </p>
      </SetupStep>
      <SetupStep number={2} title="Choisir le modèle et la qualité" done>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="openai-image-model">Modèle OpenAI</Label>
            <NativeSelect
              id="openai-image-model"
              wrapperClassName="w-full"
              className="w-full"
              value={model}
              disabled={generation.busy}
              onChange={(event) => {
                const openaiModel = event.target.value as OpenAIImageModel;
                void run(
                  'Modèle « ' + openaiModelOptions[openaiModel].name + ' » utilisé.',
                  () => api.imageGeneration({ openaiModel }),
                  { key: 'image-generation-openai', payload: { openaiModel } },
                );
              }}
            >
              {OPENAI_IMAGE_MODELS.map((id) => (
                <NativeSelectOption key={id} value={id}>
                  {openaiModelOptions[id].name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">{openaiModelOptions[model].summary}.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="openai-image-quality">Qualité</Label>
            <NativeSelect
              id="openai-image-quality"
              wrapperClassName="w-full"
              className="w-full"
              value={quality}
              disabled={generation.busy}
              onChange={(event) => {
                const openaiQuality = event.target.value as OpenAIImageQuality;
                void run('Qualité enregistrée.', () => api.imageGeneration({ openaiQuality }), {
                  key: 'image-generation-openai',
                  payload: { openaiQuality },
                });
              }}
            >
              {OPENAI_IMAGE_QUALITIES.map((id) => (
                <NativeSelectOption key={id} value={id}>
                  {qualityLabels[id]}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <p className="text-xs text-muted-foreground">
              Une qualité plus élevée ajoute des détails, mais l’image arrive plus tard et coûte
              plus cher.
            </p>
          </div>
        </div>
      </SetupStep>
      <SetupStep number={3} title="Activer" done={generation.enabled && !unavailable}>
        {toggles}
      </SetupStep>
    </SetupSteps>
  );
}

/** Outils de calcul (Python, PyTorch, Diffusers) installés avec le premier modèle. */
const environmentGb = 4;

function installStep(download: ModelDownload): string {
  if (download.state === 'checking') return 'Préparation de l’installation…';
  return download.completed >= 1
    ? 'Étape 2 sur 2 : téléchargement du modèle'
    : 'Étape 1 sur 2 : outils de calcul';
}

export function ImageGenerationSettings({
  status,
  run,
  hidden,
  action,
}: {
  status: DevicesStatus | null;
  run: RunAction;
  hidden?: boolean;
  action?: ReactNode;
}) {
  const generation = status?.imageGeneration;
  const installations = generation?.installations;
  const current = generation?.model ?? IMAGE_GENERATION_MODEL_DEFAULT;
  // Choisir un modèle ne fait rien : l’installation attend une confirmation explicite.
  const [choice, setChoice] = useState<ImageGenerationModel | null>(null);
  const [confirming, setConfirming] = useState(false);
  const installing = IMAGE_GENERATION_MODELS.find((model) => isInstalling(installations?.[model]));
  const progress = installing ? installations?.[installing] : undefined;
  // Pendant une installation, le choix affiché est le modèle en cours d’installation.
  const chosen = installing ?? choice ?? current;
  const chosenOption = optionOf(chosen);
  const chosenInstall = installations?.[chosen];
  const currentInstall = installations?.[current];
  const currentInstalled = isInstalled(currentInstall);
  const firstInstall = !IMAGE_GENERATION_MODELS.some((model) =>
    isInstalled(installations?.[model]),
  );
  const locked = !generation || !!installing || generation.busy;

  const install = (model: ImageGenerationModel) =>
    run(
      'Installation de « ' + optionOf(model).tier + ' » lancée. La progression s’affiche ici.',
      async () => {
        if (model !== current) await api.imageGeneration({ model });
        await api.installImageGeneration();
      },
      { key: 'image-generation-model', payload: { install: model } },
    ).then((ok) => {
      if (!ok) return;
      setConfirming(false);
      setChoice(null);
    });
  const use = (model: ImageGenerationModel) =>
    run('Modèle « ' + optionOf(model).tier + ' » utilisé.', () => api.imageGeneration({ model }), {
      key: 'image-generation-model',
      payload: { use: model },
    }).then((ok) => {
      if (ok) setChoice(null);
    });
  const provider = generation?.provider ?? 'local';
  const openai = provider === 'openai';
  // Avec OpenAI, rien à installer : seuls la clé et l’activation comptent.
  const ready = openai || currentInstalled;
  const enabledSwitch = (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor="image-generation-enabled">Autoriser la création d’images</Label>
        <p className="text-xs text-muted-foreground">
          Cornelius crée une image quand vous le lui demandez.
        </p>
      </div>
      <Switch
        id="image-generation-enabled"
        checked={generation?.enabled ?? false}
        disabled={!generation || !ready || !!installing}
        onCheckedChange={(enabled) => {
          void run(enabled ? 'Génération d’image activée.' : 'Génération d’image désactivée.', () =>
            api.imageGeneration({ enabled }),
          );
        }}
      />
    </div>
  );
  const illustrateSwitch = (
    <div className="flex items-center justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor="image-generation-illustrate-cards">
          Illustrer automatiquement les cartes
        </Label>
        <p className="text-xs text-muted-foreground">
          Après une carte descriptive de Cornelius ou d’un module, une image s’affiche en seconde
          carte. Les cartes seulement chiffrées, périmées ou hors ligne restent sans image, comme
          quand le générateur est occupé.
        </p>
      </div>
      <Switch
        id="image-generation-illustrate-cards"
        checked={generation?.illustrateCards ?? false}
        disabled={!generation || !ready}
        onCheckedChange={(illustrateCards) => {
          void run(
            illustrateCards
              ? 'Illustration automatique des cartes activée.'
              : 'Illustration automatique des cartes désactivée.',
            () => api.imageGeneration({ illustrateCards }),
          );
        }}
      />
    </div>
  );
  const download = chosenOption.downloadGb ?? chosenOption.diskGb;
  const total = download + (firstInstall ? environmentGb : 0);

  return (
    <ModulePanel
      id="module-image-generation"
      icon={WandSparkles}
      title="Génération d’image"
      subtitle={
        generation && openai
          ? 'OpenAI · ' +
            openaiModelOptions[generation.openaiModel ?? OPENAI_IMAGE_MODEL_DEFAULT].name +
            (generation.openaiUnavailable ? ' · clé à vérifier' : '')
          : generation
            ? 'Modèle ' +
              optionOf(current).tier.toLocaleLowerCase('fr') +
              (currentInstalled ? '' : ' · à installer')
            : 'Images créées sur ce PC'
      }
      badge={
        <Badge variant={generation?.enabled ? 'secondary' : 'outline'}>
          {generation?.enabled ? 'Activée' : 'Désactivée'}
        </Badge>
      }
      action={action}
      hidden={hidden}
    >
      <p className="text-sm text-muted-foreground">
        {openai
          ? 'Créer une image à la voix : Cornelius envoie votre description à OpenAI, qui crée une image carrée affichée ensuite sur le miroir. Chaque image est facturée sur votre compte OpenAI.'
          : 'Créer une image à la voix : Cornelius dessine sur ce PC une image carrée à partir de votre description, puis l’affiche sur le miroir. La description et l’image ne sont envoyées à aucun service d’image en ligne.'}
      </p>
      <ProviderChoice
        value={provider}
        disabled={!generation || generation.busy}
        onChange={(next) =>
          run(
            next === 'openai'
              ? 'Les images seront créées par OpenAI.'
              : 'Les images seront créées sur ce PC.',
            () => api.imageGeneration({ provider: next }),
            { key: 'image-generation-provider', payload: { provider: next } },
          )
        }
      />
      {openai && generation ? (
        <OpenAISteps
          generation={generation}
          run={run}
          toggles={
            <>
              {enabledSwitch}
              {illustrateSwitch}
            </>
          }
        />
      ) : (
        <SetupSteps label="Mise en place de la génération d’image">
          <SetupStep number={1} title="Choisir le modèle" done={currentInstalled && !choice}>
            <ModelChoices
              legend="Modèle de génération d’image"
              name="image-generation-model"
              options={options}
              value={chosen}
              current={current}
              installed={(model) => isInstalled(installations?.[model])}
              memoryLabel="Mémoire graphique"
              disabled={locked}
              onChange={(model) => {
                setChoice(model === current ? null : model);
                setConfirming(false);
              }}
            />
            <p className="text-xs text-muted-foreground">
              Choisir un modèle ne télécharge rien. Plus il est précis, plus il demande de mémoire
              graphique et de place.
            </p>
          </SetupStep>
          <SetupStep number={2} title="Installer" done={isInstalled(chosenInstall) && !choice}>
            {installing && progress ? (
              <InstallProgress
                title={'Installation de « ' + optionOf(installing).tier + ' » en cours…'}
                step={installStep(progress)}
                percent={
                  progress.total
                    ? Math.min(100, Math.round((100 * progress.received) / progress.total))
                    : null
                }
                detail={
                  progress.total
                    ? megabytes(progress.received) + ' sur ' + megabytes(progress.total)
                    : 'Vous pouvez quitter cette page : l’installation continue sur le serveur.'
                }
              />
            ) : chosenInstall?.state === 'failed' ? (
              <InstallFailure
                title="L’installation a échoué"
                hint="Les fichiers déjà téléchargés sont conservés. Vérifiez la connexion à Internet et la place disponible, puis réessayez."
                output={chosenInstall.error}
                action={
                  <Button size="sm" disabled={locked} onClick={() => void install(chosen)}>
                    <RefreshCw />
                    Réessayer
                  </Button>
                }
              />
            ) : !isInstalled(chosenInstall) ? (
              confirming ? (
                <InstallConfirm
                  title={'Installer « ' + chosenOption.tier + ' » sur ce PC ?'}
                  onConfirm={() => void install(chosen)}
                  onCancel={() => setConfirming(false)}
                >
                  <p>
                    Environ {gigabytes(total)} à télécharger, {downloadDuration(total)} selon votre
                    connexion.
                  </p>
                  {/* Pourquoi ce total diffère de « Disque : environ … » affiché pour le modèle. */}
                  {firstInstall && (
                    <p>
                      Soit environ {gigabytes(download)} pour le modèle et{' '}
                      {gigabytes(environmentGb)} pour l’environnement de calcul (Python et
                      bibliothèques d’image), installé une seule fois avec le premier modèle : il ne
                      compte pas dans « Disque : environ {gigabytes(chosenOption.diskGb)} » affiché
                      pour le modèle.
                    </p>
                  )}
                  {chosenOption.downloadGb !== undefined &&
                    chosenOption.downloadGb !== chosenOption.diskGb && (
                      <p>
                        Une fois installé, le modèle occupe environ {gigabytes(chosenOption.diskGb)}{' '}
                        sur le disque : une copie adaptée à la carte graphique est préparée au
                        premier chargement.
                      </p>
                    )}
                  {chosen !== current && generation?.enabled && (
                    <p>
                      La création d’images reste indisponible jusqu’à la fin de l’installation, puis
                      reprend avec ce modèle.
                    </p>
                  )}
                </InstallConfirm>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm text-muted-foreground">
                    « {chosenOption.tier} » n’est pas encore installé. Environ {gigabytes(total)} à
                    télécharger.
                  </p>
                  <Button size="sm" disabled={locked} onClick={() => setConfirming(true)}>
                    <Download />
                    Installer « {chosenOption.tier} »…
                  </Button>
                </div>
              )
            ) : chosen !== current ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  « {chosenOption.tier} » est déjà installé sur ce PC.
                </p>
                <Button size="sm" disabled={locked} onClick={() => void use(chosen)}>
                  Utiliser ce modèle
                </Button>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="size-4 text-primary" aria-hidden="true" />«{' '}
                  {chosenOption.tier} » est installé sur ce PC.
                </p>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={locked}
                  onClick={() => void install(current)}
                >
                  Vérifier l’installation
                </Button>
              </div>
            )}
            {!installing && currentInstalled && currentInstall?.error && chosen === current && (
              <InstallFailure
                title="Le générateur d’images s’est arrêté"
                hint="Cornelius le relance automatiquement. Si cela se répète, vérifiez l’installation."
                output={currentInstall.error}
              />
            )}
          </SetupStep>
          <SetupStep number={3} title="Activer" done={!!generation?.enabled && currentInstalled}>
            {!currentInstalled && (
              <p className="text-sm text-muted-foreground">
                Ces réglages sont disponibles une fois le modèle installé.
              </p>
            )}
            {enabledSwitch}
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label htmlFor="image-generation-preload">Charger le modèle dès le démarrage</Label>
                <p className="text-xs text-muted-foreground">
                  La première image arrive plus vite, mais la mémoire graphique reste occupée en
                  permanence. Sinon, le modèle se charge à la première demande.
                </p>
              </div>
              <Switch
                id="image-generation-preload"
                checked={generation?.preload ?? false}
                disabled={!generation || !currentInstalled}
                onCheckedChange={(preload) => {
                  void run(
                    preload
                      ? 'Le modèle sera chargé dès le démarrage.'
                      : 'Le modèle sera chargé à la première demande.',
                    () => api.imageGeneration({ preload }),
                  );
                }}
              />
            </div>
            {illustrateSwitch}
            {current === 'sana-sprint-0.6b' && (
              <div className="space-y-2">
                <Label htmlFor="sana-steps">Qualité du modèle équilibré</Label>
                <NativeSelect
                  id="sana-steps"
                  wrapperClassName="w-full"
                  className="w-full"
                  value={String(generation?.sanaSteps ?? 2)}
                  disabled={!generation || generation.busy || !currentInstalled}
                  onChange={(event) => {
                    const sanaSteps = Number(event.target.value) as 2 | 4;
                    void run('Qualité enregistrée.', () => api.imageGeneration({ sanaSteps }));
                  }}
                >
                  <NativeSelectOption value="2">
                    Rapide, 2 étapes (réglage conseillé)
                  </NativeSelectOption>
                  <NativeSelectOption value="4">Soignée, 4 étapes (plus lent)</NativeSelectOption>
                </NativeSelect>
                <p className="text-xs text-muted-foreground">
                  Quatre étapes peuvent améliorer certains détails, sans garantie pour chaque
                  description. Seule la prochaine image change.
                </p>
              </div>
            )}
          </SetupStep>
        </SetupSteps>
      )}
      <p className="text-xs text-muted-foreground">
        Les trois dernières images restent réaffichables à la voix (« remontre l’image du phare »),
        puis sont effacées au redémarrage du serveur.
        {generation ? ` Images gardées : ${generation.storedImages ?? 0} / 3.` : ''}
      </p>
      <TechnicalDetails>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">
            {openai
              ? 'Images créées par OpenAI'
              : generation?.connected
                ? 'Générateur connecté'
                : currentInstalled && generation?.enabled
                  ? 'Générateur en démarrage'
                  : 'Générateur arrêté'}
          </Badge>
          {generation?.busy && <Badge variant="secondary">Génération en cours</Badge>}
          {generation?.device && (
            <Badge variant="outline">
              {generation.device === 'cuda'
                ? 'GPU · CUDA'
                : generation.device === 'rocm'
                  ? 'GPU · ROCm (AMD)'
                  : generation.device.toUpperCase()}
            </Badge>
          )}
          {generation?.loadedModel && (
            <Badge variant="outline">Chargé : {optionOf(generation.loadedModel).name}</Badge>
          )}
        </div>
        {generation?.detail && <p className="text-xs text-muted-foreground">{generation.detail}</p>}
        <ul className="space-y-1 text-xs text-muted-foreground">
          {options.map((option) => (
            <li key={option.id}>
              {option.tier} : {option.name}, environ {gigabytes(option.memoryGb)} de VRAM
              {option.id === 'z-image-turbo'
                ? ' en bf16 (FP8 au-delà), 31 Go téléchargés puis une copie bf16 de 11,5 Go au premier chargement.'
                : '.'}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted-foreground">
          Avec OpenAI : image demandée en 1024 × 1024 (WebP) à l’API d’images, avec la clé OpenAI de
          Cornelius ; la description part chez OpenAI, le générateur local reste arrêté. Sur ce PC :
          les images sont enregistrées en WebP 512 × 512. SDXL Turbo calcule directement en 512 ×
          512 ; SANA-Sprint et Z-Image calculent en 1024 × 1024 puis réduisent l’image. SANA-Sprint
          est sous licence Apache 2.0. SDXL Turbo utilise la licence communautaire Stability AI, à
          vérifier pour un usage commercial. L’installation crée l’environnement Python .venv-image,
          télécharge le modèle depuis Hugging Face, puis lance le générateur d’images (Diffusers),
          relancé ensuite avec le serveur.
        </p>
      </TechnicalDetails>
    </ModulePanel>
  );
}
