import type { Opening } from '../shared/opening';
import type {
  DevicesStatus,
  EnrollmentMode,
  MirrorCommand,
  Profile,
  StateEvent,
  VisionDevice,
  VisionMode,
  VisionModel,
  ImageGenerationModel,
  ImageGenerationProvider,
  OpenAIImageModel,
  OpenAIImageQuality,
  ImageGenerationStatus,
  SecretView,
} from '../shared/types';
import type { DelegationMode } from '../shared/delegation';
import type { CardSettings } from '../shared/cards';
import type { AdmissionSound } from '../shared/admission-sound';
import type { GreetingMode, SilenceClose } from '../shared/conversation';
import type {
  AddonCatalog,
  AddonConfigError,
  AddonInstanceInput,
  AddonInstancePatch,
  AddonInstanceView,
  AddonSearchResultView,
  AddonTestResult,
  ActionConfirmationView,
  ActionRunView,
  ActionTestResultView,
  HttpActionInput,
  HttpActionPatch,
  HttpActionView,
} from './components/admin/types';

import type { HomeAssistantCommand, HomeAssistantView } from '../shared/home-assistant';
import type { AgentAdminView, AgentConnectionInput, AgentTaskView } from '../shared/agents';
import type { ToolResult } from '../shared/addons';
import type { MemoryView, MemoryEdit } from '../shared/memory';
import type { PersonalityView } from '../shared/personality';
import type { PendingSatelliteView, SatelliteView } from '../shared/satellites';

export type Role = 'admin' | 'kiosk';

/** Délai maximal d’une demande au serveur local, réponse comprise. */
export const REQUEST_TIMEOUT_MS = 15_000;
/**
 * Demandes qui attendent un service extérieur (test de source, agent, Home Assistant) : le
 * serveur leur laisse jusqu’à 20 s, le navigateur attend un peu plus.
 */
export const SLOW_REQUEST_TIMEOUT_MS = 45_000;

export const WRITE_TIMEOUT_MESSAGE =
  'Le serveur ne répond pas : la modification n’a peut-être pas été enregistrée.';
export const READ_TIMEOUT_MESSAGE = 'Le serveur ne répond pas. Réessayez dans un instant.';

export interface RequestOptions extends RequestInit {
  /** Délai maximal en millisecondes ; REQUEST_TIMEOUT_MS par défaut. */
  timeoutMs?: number;
}

/** Délai dépassé côté navigateur : la demande est peut-être arrivée au serveur. */
export class RequestTimeoutError extends Error {
  override name = 'TimeoutError';
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { timeoutMs = REQUEST_TIMEOUT_MS, ...init } = options;
  // AbortSignal.timeout et AbortSignal.any manquent aux navigateurs anciens : sans eux, la
  // demande garde seulement le signal de l’appelant.
  const timeout =
    typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(timeoutMs) : undefined;
  const signal =
    timeout && init.signal
      ? typeof AbortSignal.any === 'function'
        ? AbortSignal.any([init.signal, timeout])
        : init.signal
      : (timeout ?? init.signal);
  try {
    const response = await fetch(path, {
      ...init,
      signal,
      credentials: 'same-origin',
      headers: {
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      const body: unknown = await response.json().catch(() => null);
      const message =
        body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `La demande a échoué (${response.status}).`;
      throw new Error(message);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  } catch (failure) {
    // Un abandon voulu par l’appelant garde son erreur ; seul le délai dépassé est traduit.
    if (timeout?.aborted && !init.signal?.aborted)
      throw new RequestTimeoutError(
        (init.method ?? 'GET').toUpperCase() === 'GET'
          ? READ_TIMEOUT_MESSAGE
          : WRITE_TIMEOUT_MESSAGE,
      );
    throw failure;
  }
}

const post = <T>(path: string, body: unknown, options: RequestOptions = {}) =>
  request<T>(path, { ...options, method: 'POST', body: JSON.stringify(body) });
const slow = { timeoutMs: SLOW_REQUEST_TIMEOUT_MS };

export const api = {
  agent: (profileId: string) =>
    request<AgentAdminView>('/api/admin/agents/' + encodeURIComponent(profileId)),
  saveAgent: (profileId: string, input: AgentConnectionInput) =>
    request<AgentAdminView>('/api/admin/agents/' + encodeURIComponent(profileId), {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  removeAgent: (profileId: string, revision: number) =>
    request<AgentAdminView>('/api/admin/agents/' + encodeURIComponent(profileId), {
      method: 'DELETE',
      body: JSON.stringify({ revision }),
    }),
  discoverAgent: (profileId: string) =>
    post<AgentAdminView>(
      '/api/admin/agents/' + encodeURIComponent(profileId) + '/discover',
      {},
      slow,
    ),
  refreshAgent: (profileId: string) =>
    post<AgentAdminView>(
      '/api/admin/agents/' + encodeURIComponent(profileId) + '/refresh',
      {},
      slow,
    ),
  messageAgent: (profileId: string, message: string, taskId: string | null) =>
    post<ToolResult>(
      '/api/admin/agents/' + encodeURIComponent(profileId) + '/message',
      { message, taskId },
      slow,
    ),
  stopAgent: (profileId: string, taskId: string) =>
    post<AgentTaskView>(
      '/api/admin/agents/' +
        encodeURIComponent(profileId) +
        '/tasks/' +
        encodeURIComponent(taskId) +
        '/stop',
      {},
    ),
  approveAgent: (profileId: string, taskId: string, requestId: string, choice: 'once' | 'deny') =>
    post<AgentTaskView>(
      '/api/admin/agents/' +
        encodeURIComponent(profileId) +
        '/tasks/' +
        encodeURIComponent(taskId) +
        '/approval',
      { requestId, choice },
    ),
  homeAssistant: () => request<HomeAssistantView>('/api/admin/home-assistant'),
  connectHomeAssistant: (input: { url: string; token?: string; revision: number }) =>
    request<HomeAssistantView>('/api/admin/home-assistant', {
      ...slow,
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  selectHomeAssistant: (input: { selected: string[]; revision: number }) =>
    request<HomeAssistantView>('/api/admin/home-assistant/selection', {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  homeAssistantAccess: (input: {
    enabled?: boolean;
    knownPeopleOnly?: boolean;
    revision: number;
  }) =>
    request<HomeAssistantView>('/api/admin/home-assistant/access', {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  refreshHomeAssistant: () =>
    post<HomeAssistantView>('/api/admin/home-assistant/refresh', {}, slow),
  importHomeAssistantAssist: () =>
    post<{ selected: string[]; warning: string | null }>(
      '/api/admin/home-assistant/assist',
      {},
      slow,
    ),
  controlHomeAssistant: (input: HomeAssistantCommand) =>
    post<ToolResult>('/api/admin/home-assistant/control', input, slow),
  disconnectHomeAssistant: (revision: number) =>
    request<HomeAssistantView>('/api/admin/home-assistant', {
      method: 'DELETE',
      body: JSON.stringify({ revision }),
    }),
  memory: (profileId: string) =>
    request<MemoryView>('/api/admin/memory/' + encodeURIComponent(profileId)),
  memoryEnabled: (profileId: string, enabled: boolean, version: number) =>
    request<MemoryView>('/api/admin/memory/' + encodeURIComponent(profileId), {
      method: 'PATCH',
      body: JSON.stringify({ enabled, version }),
    }),
  editMemory: (profileId: string, id: string, edit: MemoryEdit) =>
    request<MemoryView>(
      '/api/admin/memory/' + encodeURIComponent(profileId) + '/' + encodeURIComponent(id),
      { method: 'PUT', body: JSON.stringify(edit) },
    ),
  forgetMemory: (profileId: string, id: string | null, version: number) =>
    request<MemoryView>(
      '/api/admin/memory/' +
        encodeURIComponent(profileId) +
        (id ? '/' + encodeURIComponent(id) : ''),
      { method: 'DELETE', body: JSON.stringify({ version }) },
    ),
  personality: (profileId: string | null) =>
    request<PersonalityView>(
      '/api/admin/personality/' + encodeURIComponent(profileId ?? 'household'),
    ),
  savePersonalContext: (profileId: string, context: string) =>
    request<PersonalityView>(
      '/api/admin/personality/' + encodeURIComponent(profileId) + '/context',
      {
        method: 'PUT',
        body: JSON.stringify({ context }),
      },
    ),
  savePersonality: (profileId: string | null, instructions: string) =>
    request<PersonalityView>(
      '/api/admin/personality/' + encodeURIComponent(profileId ?? 'household'),
      {
        method: 'PUT',
        body: JSON.stringify({ instructions }),
      },
    ),
  blockOpenAI: (blocked: boolean) => post<StateEvent>('/api/admin/openai', { blocked }),
  privacy: (enabled: boolean) =>
    request<StateEvent>('/api/admin/privacy', {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  auth: (role: Role) => request<{ role: Role | null }>(`/api/auth?role=${role}`),
  login: (password: string) => post<{ role: Role }>('/api/login', { password }),
  logout: () => post<void>('/api/logout', {}),
  state: () => request<StateEvent>('/api/state'),
  command: (command: MirrorCommand) => post<StateEvent>('/api/commands', command),
  opening: (opening: Opening) =>
    request<StateEvent>('/api/admin/opening', {
      method: 'PATCH',
      body: JSON.stringify(opening),
    }),
  delegationMode: (mode: DelegationMode) =>
    request<StateEvent>('/api/admin/delegation-mode', {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    }),
  cards: (settings: CardSettings) =>
    request<StateEvent>('/api/admin/cards', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),
  voiceProvider: (provider: string) =>
    request<StateEvent>('/api/admin/voice-provider', {
      method: 'PATCH',
      body: JSON.stringify({ provider }),
    }),
  speechVoice: (voice: string) =>
    request<StateEvent>('/api/admin/voice', {
      method: 'PATCH',
      body: JSON.stringify({ voice }),
    }),
  orbScale: (scale: number) =>
    request<StateEvent>('/api/admin/orb-scale', {
      method: 'PATCH',
      body: JSON.stringify({ scale }),
    }),
  advancedAudioBuffer: (enabled: boolean) =>
    request<StateEvent>('/api/admin/advanced-audio-buffer', {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  admissionSound: (settings: AdmissionSound) =>
    request<StateEvent>('/api/admin/admission-sound', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),
  webSearch: (enabled: boolean) =>
    request<StateEvent>('/api/admin/web-search', {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    }),
  greeting: (mode: GreetingMode) =>
    request<StateEvent>('/api/admin/greeting', {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    }),
  silenceClose: (settings: SilenceClose) =>
    request<StateEvent>('/api/admin/silence-close', {
      method: 'PATCH',
      body: JSON.stringify(settings),
    }),
  visionMode: (mode: VisionMode) =>
    request<{ ok: boolean }>('/api/admin/vision', {
      method: 'PATCH',
      body: JSON.stringify({ mode }),
    }),
  visionModel: (model: VisionModel) =>
    request<{ ok: boolean }>('/api/admin/vision/model', {
      method: 'PATCH',
      body: JSON.stringify({ model }),
    }),
  visionDevice: (device: VisionDevice) =>
    request<{ ok: boolean }>('/api/admin/vision/device', {
      method: 'PATCH',
      body: JSON.stringify({ device }),
    }),
  imageGeneration: (patch: {
    enabled?: boolean;
    preload?: boolean;
    model?: ImageGenerationModel;
    sanaSteps?: 2 | 4;
    illustrateCards?: boolean;
    provider?: ImageGenerationProvider;
    openaiModel?: OpenAIImageModel;
    openaiQuality?: OpenAIImageQuality;
  }) =>
    request<ImageGenerationStatus>('/api/admin/image-generation', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  installImageGeneration: () =>
    post<ImageGenerationStatus>('/api/admin/image-generation/install', {}),
  profiles: () => request<Profile[]>('/api/admin/profiles'),
  addProfile: (name: string, memoryEnabled = true) =>
    post<Profile>('/api/admin/profiles', { name, memoryEnabled }),
  renameProfile: (id: string, name: string) =>
    request<Profile>(`/api/admin/profiles/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  deleteProfile: (id: string) =>
    request<void>(`/api/admin/profiles/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Lecture ponctuelle de l’état des périphériques, dont les visages mémorisés. */
  devices: () => request<DevicesStatus>('/api/admin/devices'),
  enrollFace: (id: string, mode: EnrollmentMode) =>
    post<{ ok: boolean }>(`/api/admin/profiles/${encodeURIComponent(id)}/enroll`, { mode }),
  cancelEnrollment: () => request<{ ok: boolean }>('/api/admin/enrollment', { method: 'DELETE' }),
  secrets: () => request<{ secrets: SecretView[] }>('/api/admin/secrets'),
  saveSecret: (env: string, value: string) =>
    request<{ secrets: SecretView[] }>(`/api/admin/secrets/${encodeURIComponent(env)}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
  deleteSecret: (env: string) =>
    request<{ secrets: SecretView[] }>(`/api/admin/secrets/${encodeURIComponent(env)}`, {
      method: 'DELETE',
    }),
  changePassword: (current: string, next: string) =>
    post<{ ok: boolean }>('/api/admin/password', { current, next }),
  restartServer: () => post<{ ok: boolean }>('/api/admin/restart', {}),
  satellites: () =>
    request<{ satellites: SatelliteView[]; pending?: PendingSatelliteView[] }>(
      '/api/admin/satellites',
    ),
  acceptSatellite: (device: string, name: string) =>
    post<{ satellite: SatelliteView }>(
      '/api/admin/satellites/pending/' + encodeURIComponent(device) + '/accept',
      { name },
    ),
  identifySatellite: (device: string) =>
    post<{ ok: boolean }>(
      '/api/admin/satellites/pending/' + encodeURIComponent(device) + '/identify',
      {},
    ),
  rejectSatellite: (device: string) =>
    request<{ ok: boolean }>('/api/admin/satellites/pending/' + encodeURIComponent(device), {
      method: 'DELETE',
    }),
  createSatellite: (name: string) =>
    post<{ satellite: SatelliteView; token: string }>('/api/admin/satellites', { name }),
  updateSatellite: (
    id: string,
    patch: { name?: string; profileId?: string | null; volume?: number },
  ) =>
    request<{ satellite: SatelliteView }>('/api/admin/satellites/' + encodeURIComponent(id), {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  renewSatelliteToken: (id: string) =>
    post<{ token: string }>('/api/admin/satellites/' + encodeURIComponent(id) + '/token', {}),
  removeSatellite: (id: string) =>
    request<{ ok: boolean }>('/api/admin/satellites/' + encodeURIComponent(id), {
      method: 'DELETE',
    }),
  forgetTrustedDevices: () =>
    request<{ ok: boolean }>('/api/admin/trusted-devices', { method: 'DELETE' }),
  forgetFace: (id: string) =>
    request<{ ok: boolean }>(`/api/admin/profiles/${encodeURIComponent(id)}/face`, {
      method: 'DELETE',
    }),
  addons: () => request<AddonCatalog>('/api/admin/addons'),
  createAddonInstance: (input: AddonInstanceInput) =>
    post<AddonInstanceView>('/api/admin/addons/instances', input),
  updateAddonInstance: (id: string, input: AddonInstancePatch) =>
    request<AddonInstanceView>(`/api/admin/addons/instances/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  deleteAddonInstance: (id: string) =>
    request<void>(`/api/admin/addons/instances/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testAddonInstance: (id: string) =>
    post<AddonTestResult>(`/api/admin/addons/instances/${encodeURIComponent(id)}/test`, {}, slow),
  validateAddonConfig: (addonId: string, config: Record<string, unknown>) =>
    post<{ errors: AddonConfigError[] }>(
      `/api/admin/addons/${encodeURIComponent(addonId)}/validate`,
      { config },
    ),
  searchAddon: (
    addonId: string,
    input: { kind: string; query?: string; values?: Record<string, unknown> },
  ) =>
    post<{ results: AddonSearchResultView[] }>(
      `/api/admin/addons/${encodeURIComponent(addonId)}/search`,
      input,
      slow,
    ),
  actions: () => request<HttpActionView[]>('/api/admin/actions'),
  createAction: (input: HttpActionInput) => post<HttpActionView>('/api/admin/actions', input),
  updateAction: (id: string, patch: HttpActionPatch) =>
    request<HttpActionView>(`/api/admin/actions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  deleteAction: (id: string) =>
    request<void>(`/api/admin/actions/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  testAction: (id: string) =>
    post<ActionTestResultView>(`/api/admin/actions/${encodeURIComponent(id)}/test`, {}, slow),
  actionConfirmations: () => request<ActionConfirmationView[]>('/api/admin/actions/confirmations'),
  actionRuns: () => request<ActionRunView[]>('/api/admin/actions/runs'),
  rejectActionConfirmation: (id: string) =>
    post<{ ok: boolean }>(`/api/admin/actions/confirmations/${encodeURIComponent(id)}/reject`, {}),
  approveActionConfirmation: (id: string) =>
    post<{ ok: boolean }>(`/api/admin/actions/confirmations/${encodeURIComponent(id)}/approve`, {}),
};

export function errorMessage(error: unknown): string {
  if (error instanceof RequestTimeoutError) return error.message;
  // DOMException n’hérite pas d’Error partout : le nom suffit à reconnaître ces erreurs.
  const name =
    typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
  if (name === 'TimeoutError') return WRITE_TIMEOUT_MESSAGE;
  if (name === 'AbortError') return 'Demande interrompue avant la réponse du serveur.';
  if (error instanceof SyntaxError)
    return 'Réponse illisible du serveur. Réessayez, puis consultez le Journal si cela persiste.';
  return error instanceof TypeError
    ? 'Le serveur est injoignable. Vérifiez la connexion locale.'
    : error instanceof Error
      ? error.message
      : 'Une erreur est survenue. Réessayez.';
}
