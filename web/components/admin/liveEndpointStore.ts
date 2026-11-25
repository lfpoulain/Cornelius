import { useEffect, useSyncExternalStore } from 'react';
import type { LiveEndpointView } from '../../../shared/live-endpoint';
import { api, errorMessage } from '../../api';

/**
 * Serveur Live partagé par les cartes Voix et Délégation : changer d’adresse dans l’une met
 * l’autre à jour sans recharger la page.
 */
interface Snapshot {
  view: LiveEndpointView | null;
  error: string | null;
}

let snapshot: Snapshot = { view: null, error: null };
let loading: Promise<void> | null = null;
/** Adresse dont la liste de modèles a déjà été demandée automatiquement. */
let listedFor: string | null = null;
const listeners = new Set<() => void>();

function publish(next: Snapshot) {
  snapshot = next;
  for (const listener of listeners) listener();
}

/** Remplace la vue du serveur Live (après un enregistrement ou une lecture de modèles). */
export function setLiveEndpoint(view: LiveEndpointView) {
  publish({ view, error: null });
}

export function reloadLiveEndpoint(): Promise<void> {
  loading ??= api
    .liveEndpoint()
    .then(setLiveEndpoint)
    .catch((failure) => publish({ ...snapshot, error: errorMessage(failure) }))
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Relit la liste des modèles du serveur ; la vue partagée suit (Localive est reconnu ainsi). */
export async function loadLiveModels(): Promise<LiveEndpointView> {
  const view = await api.liveModels();
  setLiveEndpoint(view);
  return view;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLiveEndpoint(): Snapshot {
  const current = useSyncExternalStore(subscribe, () => snapshot);
  useEffect(() => {
    if (!snapshot.view) void reloadLiveEndpoint();
  }, []);
  // Serveur personnalisé jamais lu : sa liste dit s’il s’agit de Localive et quels modèles
  // il propose. Une seule tentative silencieuse par adresse ; « Relire » refait la lecture.
  const view = current.view;
  useEffect(() => {
    if (!view || view.kind === 'openai' || view.models.length > 0) return;
    if (listedFor === view.effectiveBaseUrl) return;
    listedFor = view.effectiveBaseUrl;
    void loadLiveModels().catch(() => {});
  }, [view]);
  return current;
}
