/**
 * Dépôts git distants lus en HTTPS, sans git installé (l'application Home Assistant n'en a
 * pas) : la liste des branches par le protocole « smart HTTP » que toutes les forges servent
 * (`info/refs`), puis l'archive .tar.gz d'un commit précis. GitHub, Gitea, Forgejo, Codeberg
 * et GitLab sont couverts.
 */

export type Fetch = typeof fetch;

export class RemoteError extends Error {}

const userAgent = 'git/2.47 (Cornelius)';
const maxArchiveBytes = 50 * 1024 * 1024;
const shaPattern = /^[0-9a-f]{40}$/u;
const branchPattern = /^[A-Za-z0-9._\-/]{1,100}$/u;

/**
 * Adresse canonique d'un dépôt : https, sans « .git » ni barre finale, au moins
 * « propriétaire/nom ». `null` si l'adresse ne convient pas.
 */
export function normalizeRepositoryUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    return null;
  const parts = url.pathname
    .replace(/\/+$/u, '')
    .replace(/\.git$/u, '')
    .split('/')
    .filter(Boolean);
  if (parts.length < 2 || parts.some((part) => part === '.' || part === '..')) return null;
  return `https://${url.host.toLowerCase()}/${parts.join('/')}`;
}

export function validBranch(branch: string): boolean {
  return branchPattern.test(branch) && !branch.includes('..') && !branch.startsWith('/');
}

export interface RemoteRefs {
  /** Branche par défaut du dépôt (HEAD), si la forge l'annonce. */
  defaultBranch: string | null;
  /** Commit de chaque branche. */
  branches: Map<string, string>;
}

/** Lignes « pkt-line » : 4 chiffres hexadécimaux de longueur, puis la donnée. */
export function parseRefAdvertisement(body: string): RemoteRefs {
  const branches = new Map<string, string>();
  let defaultBranch: string | null = null;
  let head: string | null = null;
  let offset = 0;
  while (offset + 4 <= body.length) {
    const length = Number.parseInt(body.slice(offset, offset + 4), 16);
    if (!Number.isFinite(length)) throw new RemoteError('Réponse du dépôt illisible.');
    if (length === 0) {
      offset += 4;
      continue;
    }
    const line = body.slice(offset + 4, offset + length).replace(/\n$/u, '');
    offset += length;
    if (line.startsWith('#')) continue;
    const [ref, capabilities = ''] = line.split('\0');
    const [sha, name] = (ref ?? '').split(' ');
    if (!sha || !name || !shaPattern.test(sha)) continue;
    const symref = /(?:^| )symref=HEAD:refs\/heads\/(\S+)/u.exec(capabilities);
    if (symref) defaultBranch = symref[1]!;
    if (name === 'HEAD') head = sha;
    else if (name.startsWith('refs/heads/')) branches.set(name.slice('refs/heads/'.length), sha);
  }
  // Forge muette sur symref : la branche dont le commit est celui de HEAD.
  if (!defaultBranch && head)
    defaultBranch = [...branches].find(([, sha]) => sha === head)?.[0] ?? null;
  return { defaultBranch, branches };
}

async function request(fetcher: Fetch, url: string, timeoutMs: number): Promise<Response> {
  try {
    return await fetcher(url, {
      headers: { 'User-Agent': userAgent },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new RemoteError(
      (error as Error)?.name === 'TimeoutError'
        ? 'Le dépôt ne répond pas.'
        : 'Dépôt injoignable : vérifiez l’adresse et la connexion.',
    );
  }
}

export async function listRemoteRefs(fetcher: Fetch, repository: string): Promise<RemoteRefs> {
  const response = await request(
    fetcher,
    `${repository}.git/info/refs?service=git-upload-pack`,
    15_000,
  );
  if (response.status === 401 || response.status === 403 || response.status === 404)
    throw new RemoteError('Dépôt introuvable ou privé : seuls les dépôts publics sont pris.');
  if (!response.ok) throw new RemoteError(`Le dépôt a répondu ${response.status}.`);
  const refs = parseRefAdvertisement(await response.text());
  if (refs.branches.size === 0) throw new RemoteError('Ce dépôt n’a aucune branche.');
  return refs;
}

/** Commit de la branche demandée, ou de la branche par défaut. */
export async function resolveBranch(
  fetcher: Fetch,
  repository: string,
  branch: string | null,
): Promise<{ branch: string; commit: string }> {
  const refs = await listRemoteRefs(fetcher, repository);
  const name = branch ?? refs.defaultBranch ?? (refs.branches.has('main') ? 'main' : null);
  if (!name) throw new RemoteError('Branche par défaut inconnue : précisez-la.');
  const commit = refs.branches.get(name);
  if (!commit) throw new RemoteError(`Branche « ${name} » introuvable dans ce dépôt.`);
  return { branch: name, commit };
}

async function readLimited(response: Response): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > maxArchiveBytes) throw new RemoteError('Archive du dépôt trop volumineuse.');
  if (!response.body) return Buffer.from(await response.arrayBuffer());
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    size += chunk.byteLength;
    if (size > maxArchiveBytes) throw new RemoteError('Archive du dépôt trop volumineuse.');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** Archive .tar.gz d'un commit : schéma GitHub/Gitea/Forgejo, puis celui de GitLab. */
export async function downloadArchive(
  fetcher: Fetch,
  repository: string,
  commit: string,
): Promise<Buffer> {
  if (!shaPattern.test(commit)) throw new RemoteError('Commit invalide.');
  const name = repository.split('/').at(-1)!;
  const candidates = [
    `${repository}/archive/${commit}.tar.gz`,
    `${repository}/-/archive/${commit}/${name}-${commit}.tar.gz`,
  ];
  let status = 0;
  for (const url of candidates) {
    const response = await request(fetcher, url, 60_000);
    if (response.ok) return readLimited(response);
    status = response.status;
    await response.body?.cancel().catch(() => {});
    if (status !== 404) break;
  }
  throw new RemoteError(
    status === 404
      ? 'Cette forge ne fournit pas d’archive du dépôt.'
      : `Téléchargement refusé par le dépôt (${status}).`,
  );
}
