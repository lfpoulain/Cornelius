import { googlePhotosMigration } from './google-photos.js';
import { isVoiceProvider, type VoiceProvider } from '../shared/voice-provider.js';
import { ORB_SCALE_MAX, ORB_SCALE_MIN } from '../shared/display.js';
import { DEFAULT_CARD_SETTINGS, type CardSettings } from '../shared/cards.js';
import { DEFAULT_LIVE_VOICE, isLiveVoice, type LiveVoice } from '../shared/voices.js';
import { openingFromSettings, sameOpeningSettings, settingsForOpening } from '../shared/opening.js';
import {
  DEFAULT_PRESENCE_TIMINGS,
  isPresenceTimings,
  type PresenceTimings,
} from '../shared/presence-timings.js';
import { randomUUID } from 'node:crypto';
import {
  DEFAULT_DELEGATION_MODE,
  isDelegationMode,
  type DelegationMode,
} from '../shared/delegation.js';
import {
  DEFAULT_ADMISSION_SOUND,
  isAdmissionSoundId,
  type AdmissionSound,
} from '../shared/admission-sound.js';
import {
  DEFAULT_GREETING_MODE,
  DEFAULT_SILENCE_CLOSE,
  isGreetingMode,
  isSilenceClose,
  type GreetingMode,
  type SilenceClose,
} from '../shared/conversation.js';
import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { memoryMigration } from './memory-store.js';
import { homeAssistantMigration } from './home-assistant-store.js';
import { agentsMigration } from './agents-store.js';
import { addonRefsMigration } from './addons/migrations.js';
import { adminPasswordMigration } from './admin-password.js';
import { secretsMigration } from './secrets.js';
import { mailMigration, mailRecipientsMigration } from './mail-store.js';
import { trustedDevicesMigration } from './trusted-devices.js';
import { satellitesMigration } from './satellites-store.js';
import {
  screensaverChoicesMigration,
  screensaverDurationMigration,
  screensaverLayoutMigration,
  screensaverMigration,
  screensaverSizesMigration,
} from './screensaver.js';
import {
  DEFAULT_SCREENSAVER,
  SCREENSAVER_FITS,
  SCREENSAVER_TRANSITIONS,
  SCREENSAVER_WAKES,
  isScreensaverSettings,
  type ScreensaverSettings,
} from '../shared/screensaver.js';
import { rotateMigrationBackups } from './backups.js';

import type { Profile } from '../shared/types.js';
import { sameNameProfile } from '../shared/profile-names.js';
import { addonScope } from '../shared/addons.js';
import type {
  ActionRun,
  AddonInstance,
  HttpActionDefinition,
  ModuleSnapshot,
} from '../shared/addons.js';

/** Ordre définitif : une migration publiée n’est jamais modifiée, la suivante s’ajoute à la fin. */
export const migrations: readonly string[] = [
  `CREATE TABLE profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;`,
  `CREATE TABLE session_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    manual_stop INTEGER NOT NULL CHECK (manual_stop IN (0, 1))
  ) STRICT;
  INSERT INTO session_preferences (id, manual_stop) VALUES (1, 0);`,
  `CREATE TABLE profile_faces (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    embedding TEXT NOT NULL,
    enrolled_at INTEGER NOT NULL
  ) STRICT;`,
  `CREATE TABLE camera_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    device_id TEXT
  ) STRICT;
  INSERT INTO camera_preferences (id, device_id) VALUES (1, NULL);`,
  `ALTER TABLE camera_preferences ADD COLUMN recognition_threshold REAL NOT NULL DEFAULT 0.42 CHECK (recognition_threshold BETWEEN 0.35 AND 0.65);`,
  `ALTER TABLE session_preferences ADD COLUMN openai_blocked INTEGER NOT NULL DEFAULT 0 CHECK (openai_blocked IN (0, 1));`,
  `ALTER TABLE profile_faces ADD COLUMN templates TEXT NOT NULL DEFAULT '[]';`,
  `CREATE TABLE camera_preferences_updated (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    device_id TEXT,
    recognition_threshold REAL NOT NULL DEFAULT 0.42 CHECK (recognition_threshold BETWEEN 0.20 AND 0.65)
  ) STRICT;
  INSERT INTO camera_preferences_updated SELECT id, device_id, recognition_threshold FROM camera_preferences;
  DROP TABLE camera_preferences;
  ALTER TABLE camera_preferences_updated RENAME TO camera_preferences;`,
  `ALTER TABLE camera_preferences ADD COLUMN engagement_settings TEXT NOT NULL DEFAULT '{"poseTolerance":0.3,"minFaceRatio":0.14}';`,
  `ALTER TABLE session_preferences ADD COLUMN privacy_mode INTEGER NOT NULL DEFAULT 0 CHECK (privacy_mode IN (0, 1));`,
  `CREATE TABLE addon_instances (
    id TEXT PRIMARY KEY,
    addon_id TEXT NOT NULL,
    profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
    ref TEXT,
    label TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    config TEXT NOT NULL DEFAULT '{}',
    config_version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX addon_instances_ref_unique
    ON addon_instances(addon_id, IFNULL(profile_id, ''), ref) WHERE ref IS NOT NULL;
  CREATE INDEX addon_instances_owner ON addon_instances(addon_id, profile_id);`,
  `CREATE TABLE addon_states (
    instance_id TEXT PRIMARY KEY REFERENCES addon_instances(id) ON DELETE CASCADE,
    snapshot_id TEXT,
    cache_key TEXT,
    revision INTEGER NOT NULL DEFAULT 0,
    data_version INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'error' CHECK (status IN ('ready', 'empty', 'stale', 'error')),
    data TEXT,
    source_provider TEXT,
    source_id TEXT,
    fetched_at INTEGER,
    observed_at INTEGER,
    valid_until INTEGER,
    error_code TEXT,
    error_message TEXT,
    error_retryable INTEGER,
    error_at INTEGER,
    updated_at INTEGER NOT NULL
  ) STRICT;`,
  `CREATE TABLE http_actions (
    id TEXT PRIMARY KEY,
    ref TEXT NOT NULL,
    label TEXT NOT NULL,
    method TEXT NOT NULL CHECK (method IN ('GET', 'POST')),
    url TEXT NOT NULL,
    profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
    headers TEXT NOT NULL DEFAULT '{}',
    body TEXT,
    confirmation TEXT NOT NULL DEFAULT 'required' CHECK (confirmation IN ('required', 'none')),
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE UNIQUE INDEX http_actions_ref_unique
    ON http_actions(IFNULL(profile_id, ''), ref);
  CREATE INDEX http_actions_owner ON http_actions(profile_id);
  CREATE TABLE action_runs (
    id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL REFERENCES http_actions(id) ON DELETE CASCADE,
    profile_id TEXT,
    interaction_id TEXT,
    idempotency_key TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'unknown', 'pending_confirmation', 'cancelled')),
    request_summary TEXT,
    response_status INTEGER,
    response_summary TEXT,
    error_code TEXT,
    error_message TEXT,
    started_at INTEGER NOT NULL,
    finished_at INTEGER,
    UNIQUE (action_id, idempotency_key)
  ) STRICT;
  CREATE INDEX action_runs_action ON action_runs(action_id, started_at);
  CREATE TABLE action_confirmations (
    id TEXT PRIMARY KEY,
    action_id TEXT NOT NULL REFERENCES http_actions(id) ON DELETE CASCADE,
    profile_id TEXT,
    interaction_id TEXT,
    params TEXT NOT NULL DEFAULT '{}',
    params_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  ) STRICT;
  CREATE INDEX action_confirmations_expiry ON action_confirmations(expires_at);`,
  `ALTER TABLE action_confirmations ADD COLUMN approved_at INTEGER;`,
  `ALTER TABLE http_actions ADD COLUMN description TEXT NOT NULL DEFAULT '';`,
  `ALTER TABLE session_preferences ADD COLUMN session_mode INTEGER NOT NULL DEFAULT 3 CHECK (session_mode IN (1, 2, 3));`,
  `ALTER TABLE camera_preferences ADD COLUMN vision_mode TEXT NOT NULL DEFAULT 'engagement' CHECK (vision_mode IN ('off', 'engagement', 'tool', 'continuous'));`,
  `CREATE TABLE camera_preferences_vision (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    device_id TEXT,
    recognition_threshold REAL NOT NULL DEFAULT 0.42 CHECK (recognition_threshold BETWEEN 0.20 AND 0.65),
    engagement_settings TEXT NOT NULL DEFAULT '{"poseTolerance":0.3,"minFaceRatio":0.14}',
    vision_mode TEXT NOT NULL DEFAULT 'engagement' CHECK (vision_mode IN ('off', 'engagement', 'tool', 'continuous', 'arrival'))
  ) STRICT;
  INSERT INTO camera_preferences_vision
    SELECT id, device_id, recognition_threshold, engagement_settings, vision_mode FROM camera_preferences;
  DROP TABLE camera_preferences;
  ALTER TABLE camera_preferences_vision RENAME TO camera_preferences;`,
  `CREATE TABLE camera_preferences_vision_v2 (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    device_id TEXT,
    recognition_threshold REAL NOT NULL DEFAULT 0.42 CHECK (recognition_threshold BETWEEN 0.20 AND 0.65),
    engagement_settings TEXT NOT NULL DEFAULT '{"poseTolerance":0.3,"minFaceRatio":0.14}',
    vision_mode TEXT NOT NULL DEFAULT 'scene' CHECK (vision_mode IN ('off', 'scene', 'tool')),
    vision_model TEXT NOT NULL DEFAULT '450m' CHECK (vision_model IN ('450m', '1.6b', '3b'))
  ) STRICT;
  INSERT INTO camera_preferences_vision_v2
    SELECT id, device_id, recognition_threshold, engagement_settings,
      CASE vision_mode WHEN 'engagement' THEN 'scene' WHEN 'continuous' THEN 'scene' WHEN 'arrival' THEN 'scene' ELSE vision_mode END,
      '450m'
    FROM camera_preferences;
  DROP TABLE camera_preferences;
  ALTER TABLE camera_preferences_vision_v2 RENAME TO camera_preferences;`,
  `ALTER TABLE camera_preferences
    ADD COLUMN vision_device TEXT NOT NULL DEFAULT 'auto'
    CHECK (vision_device IN ('auto', 'gpu', 'cpu'));`,
  `ALTER TABLE addon_instances ADD COLUMN display_enabled INTEGER NOT NULL DEFAULT 0 CHECK (display_enabled IN (0, 1));`,
  `CREATE TABLE household_personality (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    instructions TEXT NOT NULL DEFAULT '' CHECK (length(instructions) <= 4000)
  ) STRICT;
  INSERT INTO household_personality (id) VALUES (1);
  CREATE TABLE profile_personality (
    profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
    instructions TEXT NOT NULL CHECK (length(instructions) <= 4000)
  ) STRICT;`,
  memoryMigration,
  homeAssistantMigration,
  `ALTER TABLE profile_personality ADD COLUMN context TEXT NOT NULL DEFAULT ''
    CHECK (length(context) <= 4000);`,
  `CREATE TABLE image_generation_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    model TEXT NOT NULL DEFAULT 'flux2-klein-4b'
      CHECK (model IN ('flux2-klein-4b', 'z-image-turbo'))
  ) STRICT;
  INSERT INTO image_generation_preferences (id) VALUES (1);`,
  agentsMigration,
  `CREATE TABLE image_generation_preferences_v2 (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    model TEXT NOT NULL DEFAULT 'flux2-klein-4b'
      CHECK (model IN ('sdxl-turbo', 'flux2-klein-4b', 'z-image-turbo'))
  ) STRICT;
  INSERT INTO image_generation_preferences_v2 (id, enabled, model)
    SELECT id, enabled, model FROM image_generation_preferences;
  DROP TABLE image_generation_preferences;
  ALTER TABLE image_generation_preferences_v2 RENAME TO image_generation_preferences;`,
  `CREATE TABLE image_generation_preferences_v3 (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    model TEXT NOT NULL DEFAULT 'flux2-klein-4b'
      CHECK (model IN ('sdxl-turbo', 'sana-sprint-0.6b', 'flux2-klein-4b', 'z-image-turbo'))
  ) STRICT;
  INSERT INTO image_generation_preferences_v3 (id, enabled, model)
    SELECT id, enabled, model FROM image_generation_preferences;
  DROP TABLE image_generation_preferences;
  ALTER TABLE image_generation_preferences_v3 RENAME TO image_generation_preferences;`,
  `ALTER TABLE session_preferences ADD COLUMN presence_timings TEXT NOT NULL DEFAULT '{"presenceMs":400,"absenceMs":1500,"engagementMs":350,"disengagementMs":8000}';`,
  `ALTER TABLE image_generation_preferences ADD COLUMN sana_steps INTEGER NOT NULL DEFAULT 2
    CHECK (sana_steps IN (2, 4));`,
  `ALTER TABLE image_generation_preferences ADD COLUMN illustrate_cards INTEGER NOT NULL DEFAULT 0
    CHECK (illustrate_cards IN (0, 1));`,
  `ALTER TABLE session_preferences ADD COLUMN wake_word_enabled INTEGER NOT NULL DEFAULT 0
    CHECK (wake_word_enabled IN (0, 1));`,
  `CREATE TABLE session_preferences_voice_mode (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    manual_stop INTEGER NOT NULL CHECK (manual_stop IN (0, 1)),
    openai_blocked INTEGER NOT NULL CHECK (openai_blocked IN (0, 1)),
    privacy_mode INTEGER NOT NULL CHECK (privacy_mode IN (0, 1)),
    session_mode INTEGER NOT NULL DEFAULT 3 CHECK (session_mode IN (1, 2, 3, 4)),
    presence_timings TEXT NOT NULL,
    wake_word_enabled INTEGER NOT NULL CHECK (wake_word_enabled IN (0, 1))
  ) STRICT;
  INSERT INTO session_preferences_voice_mode
    SELECT id, manual_stop, openai_blocked, privacy_mode, session_mode, presence_timings, wake_word_enabled
    FROM session_preferences;
  DROP TABLE session_preferences;
  ALTER TABLE session_preferences_voice_mode RENAME TO session_preferences;`,
  `UPDATE session_preferences SET presence_timings = CASE
    WHEN json_valid(presence_timings)
      THEN json_set(presence_timings, '$.speechIdleMs', 15000)
    ELSE '{"presenceMs":400,"absenceMs":1500,"engagementMs":350,"disengagementMs":8000,"speechIdleMs":15000}'
  END;`,
  `ALTER TABLE session_preferences ADD COLUMN advanced_audio_buffer INTEGER NOT NULL DEFAULT 0
    CHECK (advanced_audio_buffer IN (0, 1));`,
  `ALTER TABLE session_preferences ADD COLUMN delegation_mode TEXT NOT NULL DEFAULT 'fast'
    CHECK (delegation_mode IN ('normal', 'fast', 'ultrafast'));`,
  `UPDATE session_preferences SET presence_timings = CASE
    WHEN json_valid(presence_timings)
      THEN json_set(presence_timings, '$.identityHoldMs', 8000)
    ELSE '{"presenceMs":400,"absenceMs":1500,"engagementMs":350,"disengagementMs":8000,"identityHoldMs":8000,"speechIdleMs":15000}'
  END;`,
  // Son choisi validé par le code : un son ajouté plus tard n’exige pas de migration.
  `CREATE TABLE IF NOT EXISTS admission_sound_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
    sound TEXT NOT NULL DEFAULT 'carillon' CHECK (length(sound) <= 32)
  ) STRICT;
  INSERT OR IGNORE INTO admission_sound_preferences (id) VALUES (1);`,
  `CREATE TABLE IF NOT EXISTS image_generation_preload (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1))
  ) STRICT;
  INSERT OR IGNORE INTO image_generation_preload (id) VALUES (1);`,
  // Recherche web activée, accueil « Bonjour Prénom » et ouverture pour tous : le comportement
  // existant par défaut. Migration rejouable, comme les deux précédentes.
  `CREATE TABLE IF NOT EXISTS conversation_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    web_search INTEGER NOT NULL DEFAULT 1 CHECK (web_search IN (0, 1)),
    greeting TEXT NOT NULL DEFAULT 'name' CHECK (greeting IN ('name', 'free', 'off')),
    known_people_only INTEGER NOT NULL DEFAULT 0 CHECK (known_people_only IN (0, 1))
  ) STRICT;
  INSERT OR IGNORE INTO conversation_preferences (id) VALUES (1);`,
  // Home Assistant réservé aux personnes reconnues, fermeture après silence devant le miroir et
  // reconnaissance au mot d’appel : désactivés, le comportement existant reste. Rejouable.
  `CREATE TABLE IF NOT EXISTS home_assistant_access (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    known_people_only INTEGER NOT NULL DEFAULT 0 CHECK (known_people_only IN (0, 1))
  ) STRICT;
  INSERT OR IGNORE INTO home_assistant_access (id) VALUES (1);
  CREATE TABLE IF NOT EXISTS listening_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    silence_close INTEGER NOT NULL DEFAULT 0 CHECK (silence_close IN (0, 1)),
    silence_close_ms INTEGER NOT NULL DEFAULT 20000
      CHECK (silence_close_ms BETWEEN 3000 AND 300000),
    voice_recognition INTEGER NOT NULL DEFAULT 0 CHECK (voice_recognition IN (0, 1))
  ) STRICT;
  INSERT OR IGNORE INTO listening_preferences (id) VALUES (1);`,
  // Un seul réglage de fin sur silence : le délai propre au mode voix rejoint « Fin de parole ».
  `UPDATE listening_preferences SET silence_close_ms = (
    SELECT MIN(300000, MAX(3000, CAST(json_extract(presence_timings, '$.speechIdleMs') AS INTEGER)))
    FROM session_preferences WHERE id = 1
  )
  WHERE id = 1 AND silence_close = 0 AND EXISTS (
    SELECT 1 FROM session_preferences
    WHERE id = 1 AND session_mode = 4 AND json_valid(presence_timings)
      AND json_type(presence_timings, '$.speechIdleMs') IN ('integer', 'real')
  );
  UPDATE session_preferences SET presence_timings = json_remove(presence_timings, '$.speechIdleMs')
  WHERE json_valid(presence_timings);`,
  // Sources sans identifiant : un identifiant tiré de leur nom, pour que la voix choisisse.
  addonRefsMigration,
  // Appareils du réseau local autorisés comme miroir.
  trustedDevicesMigration,
  // Clé OpenAI et jetons des modules saisis dans l’administration.
  secretsMigration,
  // Mot de passe administrateur choisi dans l’administration (empreinte seulement).
  adminPasswordMigration,
  // Affichage du miroir : taille de l’orbe, en pourcentage.
  `CREATE TABLE IF NOT EXISTS display_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    orb_scale INTEGER NOT NULL DEFAULT 100 CHECK (orb_scale BETWEEN ${ORB_SCALE_MIN} AND ${ORB_SCALE_MAX})
  ) STRICT;
  INSERT OR IGNORE INTO display_preferences (id) VALUES (1);`,
  // Résolution et cadence de la caméra choisies dans l’administration (NULL : valeur par défaut).
  `CREATE TABLE IF NOT EXISTS camera_mode (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT
  ) STRICT;
  INSERT OR IGNORE INTO camera_mode (id) VALUES (1);`,
  // Voix de Cornelius (GPT-Live), choisie dans l’administration.
  `CREATE TABLE IF NOT EXISTS voice_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    voice TEXT NOT NULL DEFAULT 'cedar'
  ) STRICT;
  INSERT OR IGNORE INTO voice_preferences (id) VALUES (1);`,
  // Module « Cartes » : nombre de cartes, cartes secondaires raccourcies, durée d’affichage.
  `CREATE TABLE IF NOT EXISTS card_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    max_cards INTEGER NOT NULL DEFAULT 3 CHECK (max_cards BETWEEN 1 AND 4),
    compact_secondary INTEGER NOT NULL DEFAULT 1 CHECK (compact_secondary IN (0, 1)),
    lifetime_ms INTEGER NOT NULL DEFAULT 60000 CHECK (lifetime_ms BETWEEN 15000 AND 600000)
  ) STRICT;
  INSERT OR IGNORE INTO card_preferences (id) VALUES (1);`,
  // Modèle et qualité OpenAI vérifiés par le serveur : la liste suit les modèles de l’API.
  `CREATE TABLE IF NOT EXISTS image_generation_provider (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL DEFAULT 'local' CHECK (provider IN ('local', 'openai')),
    openai_model TEXT NOT NULL DEFAULT 'gpt-image-2.5-flare',
    openai_quality TEXT NOT NULL DEFAULT 'low'
  ) STRICT;
  INSERT OR IGNORE INTO image_generation_provider (id) VALUES (1);`,
  // Satellites audio : micro et haut-parleur d’une autre pièce, associés dans l’administration.
  satellitesMigration,
  // Écran de veille : peintures et photos quand personne n’est devant le miroir.
  screensaverMigration,
  // Écran de veille : transition choisie et ce qui fait revenir l’orbe (validés par le code).
  screensaverChoicesMigration,
  // Écran de veille : durée de l’effet de transition.
  screensaverDurationMigration,
  // Écran de veille : image entière, posée comme une toile ou plein écran.
  screensaverLayoutMigration,
  // Écran de veille : dimensions des images, pour les trier par sens.
  screensaverSizesMigration,
  // Source indépendante du périphérique local : le retour au serveur retrouve son choix.
  `CREATE TABLE IF NOT EXISTS camera_source (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    source TEXT NOT NULL DEFAULT 'server' CHECK (source IN ('server', 'browser'))
  ) STRICT;
  INSERT OR IGNORE INTO camera_source (id) VALUES (1);`,
  // Envoi par e-mail : serveur SMTP du foyer et destinataires, hors de la table des profils.
  mailMigration,
  // Envoi par e-mail : plusieurs adresses pour un même profil.
  mailRecipientsMigration,
  `CREATE TABLE IF NOT EXISTS voice_provider_preferences (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    provider TEXT NOT NULL DEFAULT 'openai' CHECK (provider IN ('openai', 'mistral'))
  ) STRICT;
  INSERT OR IGNORE INTO voice_provider_preferences (id) VALUES (1);`,
  googlePhotosMigration,
];

/** The server owns this connection. Backups include WAL changes via SQLite itself. */
export function openDatabase(path: string): DatabaseSync {
  const memory = path === ':memory:';
  const filename = memory ? path : resolve(path);
  const hadData = !memory && existsSync(filename) && statSync(filename).size > 0;
  if (!memory) mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(filename);
  try {
    // secure_delete : une donnée supprimée (visage, souvenir) est effacée du fichier, pas
    // seulement marquée comme libre.
    db.exec(
      'PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA secure_delete = ON;',
    );
    const version = Number(db.prepare('PRAGMA user_version').get()?.user_version);
    if (version > migrations.length)
      throw new Error('La base vient d’une version plus récente de Cornelius.');
    if (version < migrations.length) {
      if (hadData) {
        const backup = `${filename}.backup-v${version}-${Date.now()}-${randomUUID()}.sqlite`;
        db.prepare('VACUUM INTO ?').run(backup);
        chmodSync(backup, 0o600);
      }
      db.exec('BEGIN IMMEDIATE');
      try {
        for (let index = version; index < migrations.length; index++) {
          db.exec(migrations[index]!);
          db.exec(`PRAGMA user_version = ${index + 1}`);
        }
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
    if (!memory) {
      chmodSync(filename, 0o600);
      // Les copies plus anciennes gardaient indéfiniment visages et souvenirs supprimés.
      rotateMigrationBackups(filename);
    }
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

export class PersonalityRepository {
  constructor(private readonly db: DatabaseSync) {}
  get(profileId: string | null) {
    return {
      household: String(
        this.db.prepare('SELECT instructions FROM household_personality WHERE id = 1').get()!
          .instructions,
      ),
      personal: profileId
        ? String(
            this.db
              .prepare('SELECT instructions FROM profile_personality WHERE profile_id = ?')
              .get(profileId)?.instructions ?? '',
          )
        : '',
      personalContext: profileId
        ? String(
            this.db
              .prepare('SELECT context FROM profile_personality WHERE profile_id = ?')
              .get(profileId)?.context ?? '',
          )
        : '',
    };
  }
  setContext(profileId: string, context: string): void {
    this.db
      .prepare(
        `INSERT INTO profile_personality (profile_id, instructions, context) VALUES (?, '', ?)
      ON CONFLICT(profile_id) DO UPDATE SET context = excluded.context`,
      )
      .run(profileId, context);
  }
  set(profileId: string | null, instructions: string): void {
    if (profileId === null) {
      this.db
        .prepare('UPDATE household_personality SET instructions = ? WHERE id = 1')
        .run(instructions);
    } else {
      this.db
        .prepare(
          `INSERT INTO profile_personality (profile_id, instructions) VALUES (?, ?)
        ON CONFLICT(profile_id) DO UPDATE SET instructions = excluded.instructions`,
        )
        .run(profileId, instructions);
    }
  }
}

/** Réécrit une ancienne combinaison d’ouverture dans sa forme unique (voir shared/opening.ts). */
export function normalizeOpening(preferences: SessionPreferences): boolean {
  const current = {
    mode: preferences.getSessionMode(),
    knownPeopleOnly: preferences.getKnownPeopleOnly(),
    wakeWord: preferences.getWakeWordEnabled(),
    voiceRecognition: preferences.getVoiceRecognition(),
  };
  const target = settingsForOpening(openingFromSettings(current));
  if (sameOpeningSettings(current, target)) return false;
  preferences.setSessionMode(target.mode);
  preferences.setKnownPeopleOnly(target.knownPeopleOnly);
  preferences.setWakeWordEnabled(target.wakeWord);
  preferences.setVoiceRecognition(target.voiceRecognition);
  return true;
}

export class SessionPreferences {
  constructor(private readonly db: DatabaseSync) {}

  getDelegationMode(): DelegationMode {
    const value = this.db
      .prepare('SELECT delegation_mode FROM session_preferences WHERE id = 1')
      .get()?.delegation_mode;
    return isDelegationMode(value) ? value : DEFAULT_DELEGATION_MODE;
  }

  setDelegationMode(mode: DelegationMode): void {
    if (!isDelegationMode(mode)) throw new Error('Mode de délégation invalide.');
    this.db.prepare('UPDATE session_preferences SET delegation_mode = ? WHERE id = 1').run(mode);
  }

  getOpenAIBlocked(): boolean {
    return (
      this.db.prepare('SELECT openai_blocked FROM session_preferences WHERE id = 1').get()
        ?.openai_blocked === 1
    );
  }

  setOpenAIBlocked(blocked: boolean): void {
    this.db
      .prepare('UPDATE session_preferences SET openai_blocked = ? WHERE id = 1')
      .run(Number(blocked));
  }

  getManualStop(): boolean {
    return (
      this.db.prepare('SELECT manual_stop FROM session_preferences WHERE id = 1').get()
        ?.manual_stop === 1
    );
  }

  setManualStop(stopped: boolean): void {
    this.db
      .prepare('UPDATE session_preferences SET manual_stop = ? WHERE id = 1')
      .run(Number(stopped));
  }

  getPrivacyMode(): boolean {
    return (
      this.db.prepare('SELECT privacy_mode FROM session_preferences WHERE id = 1').get()
        ?.privacy_mode === 1
    );
  }

  setPrivacyMode(enabled: boolean): void {
    this.db
      .prepare('UPDATE session_preferences SET privacy_mode = ? WHERE id = 1')
      .run(Number(enabled));
  }

  getPresenceTimings(): PresenceTimings {
    try {
      const value: unknown = JSON.parse(
        String(
          this.db.prepare('SELECT presence_timings FROM session_preferences WHERE id = 1').get()
            ?.presence_timings,
        ),
      );
      if (isPresenceTimings(value)) return value;
    } catch {
      /* Fall back to known defaults if a stored value is invalid. */
    }
    return { ...DEFAULT_PRESENCE_TIMINGS };
  }

  setPresenceTimings(settings: PresenceTimings): void {
    if (!isPresenceTimings(settings)) throw new Error('Délais de présence invalides.');
    this.db
      .prepare('UPDATE session_preferences SET presence_timings = ? WHERE id = 1')
      .run(JSON.stringify(settings));
  }
  getSessionMode(): 1 | 2 | 3 | 4 {
    const value = this.db
      .prepare('SELECT session_mode FROM session_preferences WHERE id = 1')
      .get()?.session_mode;
    return value === 1 || value === 2 || value === 4 ? value : 3;
  }

  setSessionMode(mode: 1 | 2 | 3 | 4): void {
    this.db.prepare('UPDATE session_preferences SET session_mode = ? WHERE id = 1').run(mode);
  }

  getWakeWordEnabled(): boolean {
    return (
      this.db.prepare('SELECT wake_word_enabled FROM session_preferences WHERE id = 1').get()
        ?.wake_word_enabled === 1
    );
  }

  setWakeWordEnabled(enabled: boolean): void {
    this.db
      .prepare('UPDATE session_preferences SET wake_word_enabled = ? WHERE id = 1')
      .run(Number(enabled));
  }
  getCardSettings(): CardSettings {
    const row = this.db
      .prepare(
        'SELECT max_cards, compact_secondary, lifetime_ms FROM card_preferences WHERE id = 1',
      )
      .get();
    if (!row) return { ...DEFAULT_CARD_SETTINGS };
    return {
      maxCards: Number(row.max_cards),
      compactSecondary: row.compact_secondary === 1,
      lifetimeMs: Number(row.lifetime_ms),
    };
  }
  setCardSettings(settings: CardSettings): void {
    this.db
      .prepare(
        'UPDATE card_preferences SET max_cards = ?, compact_secondary = ?, lifetime_ms = ? WHERE id = 1',
      )
      .run(settings.maxCards, Number(settings.compactSecondary), settings.lifetimeMs);
  }
  getVoiceProvider(): VoiceProvider {
    const value = this.db
      .prepare('SELECT provider FROM voice_provider_preferences WHERE id = 1')
      .get()?.provider;
    return isVoiceProvider(value) ? value : 'openai';
  }
  setVoiceProvider(provider: VoiceProvider): void {
    this.db
      .prepare('UPDATE voice_provider_preferences SET provider = ? WHERE id = 1')
      .run(provider);
  }
  getSpeechVoice(): LiveVoice {
    const voice = this.db.prepare('SELECT voice FROM voice_preferences WHERE id = 1').get()?.voice;
    return isLiveVoice(voice) ? voice : DEFAULT_LIVE_VOICE;
  }
  setSpeechVoice(voice: LiveVoice): void {
    this.db.prepare('UPDATE voice_preferences SET voice = ? WHERE id = 1').run(voice);
  }
  getOrbScale(): number {
    return Number(
      this.db.prepare('SELECT orb_scale FROM display_preferences WHERE id = 1').get()?.orb_scale ??
        100,
    );
  }
  setOrbScale(scale: number): void {
    this.db.prepare('UPDATE display_preferences SET orb_scale = ? WHERE id = 1').run(scale);
  }
  getScreensaver(): ScreensaverSettings {
    const row = this.db
      .prepare(
        `SELECT enabled, interval_ms, return_delay_ms, transition, wake, duration_ms, fit
         FROM screensaver_preferences JOIN screensaver_choices USING (id)
           JOIN screensaver_duration USING (id) JOIN screensaver_layout USING (id) WHERE id = 1`,
      )
      .get();
    // Une transition ou un réveil inconnu (retiré depuis) retombe sur la valeur par défaut seul.
    const known = <T>(values: readonly T[], value: unknown, fallback: T): T =>
      values.includes(value as T) ? (value as T) : fallback;
    const settings = {
      enabled: row?.enabled === 1,
      intervalMs: Number(row?.interval_ms),
      returnDelayMs: Number(row?.return_delay_ms),
      transition: known(SCREENSAVER_TRANSITIONS, row?.transition, DEFAULT_SCREENSAVER.transition),
      durationMs: Number(row?.duration_ms),
      wake: known(SCREENSAVER_WAKES, row?.wake, DEFAULT_SCREENSAVER.wake),
      fit: known(SCREENSAVER_FITS, row?.fit, DEFAULT_SCREENSAVER.fit),
    };
    return isScreensaverSettings(settings) ? settings : { ...DEFAULT_SCREENSAVER };
  }
  setScreensaver(settings: ScreensaverSettings): void {
    this.db
      .prepare(
        'UPDATE screensaver_preferences SET enabled = ?, interval_ms = ?, return_delay_ms = ? WHERE id = 1',
      )
      .run(Number(settings.enabled), settings.intervalMs, settings.returnDelayMs);
    this.db
      .prepare('UPDATE screensaver_choices SET transition = ?, wake = ? WHERE id = 1')
      .run(settings.transition, settings.wake);
    this.db
      .prepare('UPDATE screensaver_duration SET duration_ms = ? WHERE id = 1')
      .run(settings.durationMs);
    this.db.prepare('UPDATE screensaver_layout SET fit = ? WHERE id = 1').run(settings.fit);
  }
  getAdvancedAudioBuffer(): boolean {
    return (
      this.db.prepare('SELECT advanced_audio_buffer FROM session_preferences WHERE id = 1').get()
        ?.advanced_audio_buffer === 1
    );
  }
  setAdvancedAudioBuffer(enabled: boolean): void {
    this.db
      .prepare('UPDATE session_preferences SET advanced_audio_buffer = ? WHERE id = 1')
      .run(Number(enabled));
  }
  getAdmissionSound(): AdmissionSound {
    const row = this.db
      .prepare('SELECT enabled, sound FROM admission_sound_preferences WHERE id = 1')
      .get();
    return {
      enabled: row?.enabled === 1,
      sound: isAdmissionSoundId(row?.sound) ? row.sound : DEFAULT_ADMISSION_SOUND.sound,
    };
  }
  setAdmissionSound(settings: AdmissionSound): void {
    this.db
      .prepare('UPDATE admission_sound_preferences SET enabled = ?, sound = ? WHERE id = 1')
      .run(Number(settings.enabled), settings.sound);
  }
  getKnownPeopleOnly(): boolean {
    return (
      this.db.prepare('SELECT known_people_only FROM conversation_preferences WHERE id = 1').get()
        ?.known_people_only === 1
    );
  }
  setKnownPeopleOnly(enabled: boolean): void {
    this.db
      .prepare('UPDATE conversation_preferences SET known_people_only = ? WHERE id = 1')
      .run(Number(enabled));
  }
  getWebSearchEnabled(): boolean {
    return (
      this.db.prepare('SELECT web_search FROM conversation_preferences WHERE id = 1').get()
        ?.web_search !== 0
    );
  }
  setWebSearchEnabled(enabled: boolean): void {
    this.db
      .prepare('UPDATE conversation_preferences SET web_search = ? WHERE id = 1')
      .run(Number(enabled));
  }
  getGreetingMode(): GreetingMode {
    const value = this.db
      .prepare('SELECT greeting FROM conversation_preferences WHERE id = 1')
      .get()?.greeting;
    return isGreetingMode(value) ? value : DEFAULT_GREETING_MODE;
  }
  setGreetingMode(mode: GreetingMode): void {
    this.db.prepare('UPDATE conversation_preferences SET greeting = ? WHERE id = 1').run(mode);
  }
  getSilenceClose(): SilenceClose {
    const row = this.db
      .prepare('SELECT silence_close, silence_close_ms FROM listening_preferences WHERE id = 1')
      .get();
    const settings = { enabled: row?.silence_close === 1, delayMs: Number(row?.silence_close_ms) };
    return isSilenceClose(settings) ? settings : { ...DEFAULT_SILENCE_CLOSE };
  }
  setSilenceClose(settings: SilenceClose): void {
    if (!isSilenceClose(settings)) throw new Error('Fermeture après silence invalide.');
    this.db
      .prepare(
        'UPDATE listening_preferences SET silence_close = ?, silence_close_ms = ? WHERE id = 1',
      )
      .run(Number(settings.enabled), settings.delayMs);
  }
  /** Mode voix : la caméra reconnaît la personne qui a dit « Cornelius ». */
  getVoiceRecognition(): boolean {
    return (
      this.db.prepare('SELECT voice_recognition FROM listening_preferences WHERE id = 1').get()
        ?.voice_recognition === 1
    );
  }
  setVoiceRecognition(enabled: boolean): void {
    this.db
      .prepare('UPDATE listening_preferences SET voice_recognition = ? WHERE id = 1')
      .run(Number(enabled));
  }
}

export class ProfileRepository {
  constructor(private readonly db: DatabaseSync) {}

  list(): Profile[] {
    return this.db
      .prepare('SELECT id, name, created_at AS createdAt FROM profiles ORDER BY created_at, id')
      .all() as unknown as Profile[];
  }

  get(id: string): Profile | null {
    return (
      (this.db
        .prepare('SELECT id, name, created_at AS createdAt FROM profiles WHERE id = ?')
        .get(id) as unknown as Profile | undefined) ?? null
    );
  }

  /** Profil déjà nommé ainsi, sans tenir compte de la casse ni des accents. */
  sameName(name: string, exceptId: string | null = null): Profile | null {
    return sameNameProfile(this.list(), name, exceptId);
  }

  create(name: string): Profile {
    const profile = { id: randomUUID(), name: profileName(name), createdAt: Date.now() };
    this.db
      .prepare('INSERT INTO profiles (id, name, created_at) VALUES (?, ?, ?)')
      .run(profile.id, profile.name, profile.createdAt);
    return profile;
  }

  rename(id: string, name: string): Profile {
    const validatedName = profileName(name);
    const result = this.db
      .prepare('UPDATE profiles SET name = ? WHERE id = ?')
      .run(validatedName, id);
    if (result.changes === 0) throw new Error('Profil introuvable.');
    return this.get(id)!;
  }

  delete(id: string): void {
    this.db.prepare('DELETE FROM profiles WHERE id = ?').run(id);
  }
}

function profileName(name: string): string {
  if (
    typeof name !== 'string' ||
    !name.trim() ||
    name.trim().length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new Error(
      'Le nom du profil doit contenir entre 1 et 80 caractères, sans caractère de contrôle.',
    );
  }
  return name.trim();
}

interface AddonInstanceRow {
  id: string;
  addon_id: string;
  profile_id: string | null;
  ref: string | null;
  label: string;
  enabled: number;
  display_enabled: number;
  config: string;
  config_version: number;
  created_at: number;
  updated_at: number;
}

interface AddonStateRow {
  instance_id: string;
  snapshot_id: string | null;
  cache_key: string | null;
  revision: number;
  data_version: number;
  status: ModuleSnapshot['status'];
  data: string | null;
  source_provider: string | null;
  source_id: string | null;
  fetched_at: number | null;
  observed_at: number | null;
  valid_until: number | null;
  error_code: string | null;
  error_message: string | null;
  error_retryable: number | null;
  error_at: number | null;
  updated_at: number;
}

export interface StoredAddonError {
  code: string;
  message: string;
  retryable: boolean;
  at: number;
}

function instanceOf(row: AddonInstanceRow): AddonInstance {
  return {
    id: row.id,
    addonId: row.addon_id,
    profileId: row.profile_id,
    ref: row.ref,
    label: row.label,
    enabled: row.enabled === 1,
    displayEnabled: row.display_enabled === 1,
    config: JSON.parse(row.config) as Record<string, unknown>,
    configVersion: row.config_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Instances and last-known snapshots. The core owns the envelope and the owner. */
export class AddonRepository {
  constructor(private readonly db: DatabaseSync) {}

  listInstances(): AddonInstance[] {
    return (
      this.db
        .prepare('SELECT * FROM addon_instances ORDER BY addon_id, created_at, id')
        .all() as unknown as AddonInstanceRow[]
    ).map(instanceOf);
  }

  getInstance(id: string): AddonInstance | null {
    const row = this.db.prepare('SELECT * FROM addon_instances WHERE id = ?').get(id) as unknown as
      AddonInstanceRow | undefined;
    return row ? instanceOf(row) : null;
  }

  /** Instances autorisées pour ce propriétaire : foyer + profil actif. */
  instancesFor(addonId: string, profileId: string | null): AddonInstance[] {
    const rows = profileId
      ? (this.db
          .prepare(
            'SELECT * FROM addon_instances WHERE addon_id = ? AND (profile_id IS NULL OR profile_id = ?) ORDER BY profile_id IS NOT NULL, created_at, id',
          )
          .all(addonId, profileId) as unknown as AddonInstanceRow[])
      : (this.db
          .prepare(
            'SELECT * FROM addon_instances WHERE addon_id = ? AND profile_id IS NULL ORDER BY created_at, id',
          )
          .all(addonId) as unknown as AddonInstanceRow[]);
    return rows.map(instanceOf);
  }

  createInstance(input: {
    enabled?: boolean;
    displayEnabled?: boolean;
    addonId: string;
    profileId: string | null;
    ref: string | null;
    label: string;
    config: Record<string, unknown>;
    configVersion: number;
  }): AddonInstance {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO addon_instances (id, addon_id, profile_id, ref, label, enabled, display_enabled, config, config_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.addonId,
        input.profileId,
        input.ref,
        input.label,
        Number(input.enabled ?? true),
        Number(input.displayEnabled ?? false),
        JSON.stringify(input.config),
        input.configVersion,
        now,
        now,
      );
    return this.getInstance(id)!;
  }

  updateInstance(
    id: string,
    patch: {
      label?: string;
      ref?: string | null;
      enabled?: boolean;
      displayEnabled?: boolean;
      profileId?: string | null;
      config?: Record<string, unknown>;
      configVersion?: number;
    },
  ): AddonInstance {
    const existing = this.getInstance(id);
    if (!existing) throw new Error('Instance introuvable.');
    this.db
      .prepare(
        'UPDATE addon_instances SET label = ?, ref = ?, enabled = ?, display_enabled = ?, profile_id = ?, config = ?, config_version = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        patch.label ?? existing.label,
        patch.ref === undefined ? existing.ref : patch.ref,
        Number(patch.enabled ?? existing.enabled),
        Number(patch.displayEnabled ?? existing.displayEnabled),
        patch.profileId === undefined ? existing.profileId : patch.profileId,
        JSON.stringify(patch.config ?? existing.config),
        patch.configVersion ?? existing.configVersion,
        Date.now(),
        id,
      );
    return this.getInstance(id)!;
  }

  deleteInstance(id: string): void {
    this.db.prepare('DELETE FROM addon_instances WHERE id = ?').run(id);
  }

  getSnapshot(instance: AddonInstance): ModuleSnapshot | null {
    const row = this.db
      .prepare('SELECT * FROM addon_states WHERE instance_id = ?')
      .get(instance.id) as unknown as AddonStateRow | undefined;
    if (!row) return null;
    return {
      schemaVersion: 1,
      snapshotId: row.snapshot_id ?? instance.id,
      cacheKey: row.cache_key ?? instance.id,
      revision: row.revision,
      moduleId: instance.addonId,
      dataVersion: row.data_version,
      scope: addonScope(instance),
      source:
        row.source_provider && row.source_id
          ? { provider: row.source_provider, sourceId: row.source_id }
          : null,
      fetchedAt: row.fetched_at === null ? null : new Date(row.fetched_at).toISOString(),
      observedAt: row.observed_at === null ? null : new Date(row.observed_at).toISOString(),
      validUntil: row.valid_until === null ? null : new Date(row.valid_until).toISOString(),
      status: row.status,
      data: row.data === null ? null : (JSON.parse(row.data) as Record<string, unknown>),
    };
  }

  getError(instanceId: string): StoredAddonError | null {
    const row = this.db
      .prepare(
        'SELECT error_code, error_message, error_retryable, error_at FROM addon_states WHERE instance_id = ?',
      )
      .get(instanceId) as unknown as
      | Pick<AddonStateRow, 'error_code' | 'error_message' | 'error_retryable' | 'error_at'>
      | undefined;
    if (!row || row.error_code === null) return null;
    return {
      code: row.error_code,
      message: row.error_message ?? '',
      retryable: row.error_retryable === 1,
      at: row.error_at ?? 0,
    };
  }

  saveSnapshot(
    instance: AddonInstance,
    snapshot: ModuleSnapshot,
    error?: { code: string; message: string; retryable: boolean } | null,
  ): void {
    const now = Date.now();
    const values = [
      instance.id,
      snapshot.snapshotId,
      snapshot.cacheKey,
      snapshot.revision,
      snapshot.dataVersion,
      snapshot.status,
      snapshot.data === null ? null : JSON.stringify(snapshot.data),
      snapshot.source?.provider ?? null,
      snapshot.source?.sourceId ?? null,
      snapshot.fetchedAt === null ? null : Date.parse(snapshot.fetchedAt),
      snapshot.observedAt === null ? null : Date.parse(snapshot.observedAt),
      snapshot.validUntil === null ? null : Date.parse(snapshot.validUntil),
      error?.code ?? null,
      error?.message ?? null,
      error ? Number(error.retryable) : null,
      error ? now : null,
      now,
    ];
    this.db
      .prepare(
        `INSERT INTO addon_states (instance_id, snapshot_id, cache_key, revision, data_version, status, data, source_provider, source_id, fetched_at, observed_at, valid_until, error_code, error_message, error_retryable, error_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(instance_id) DO UPDATE SET
           snapshot_id = excluded.snapshot_id, cache_key = excluded.cache_key,
           revision = excluded.revision, data_version = excluded.data_version,
           status = excluded.status, data = excluded.data,
           source_provider = excluded.source_provider, source_id = excluded.source_id,
           fetched_at = excluded.fetched_at, observed_at = excluded.observed_at,
           valid_until = excluded.valid_until, error_code = excluded.error_code,
           error_message = excluded.error_message, error_retryable = excluded.error_retryable,
           error_at = excluded.error_at, updated_at = excluded.updated_at`,
      )
      .run(...values);
  }

  clearState(instanceId: string): void {
    this.db.prepare('DELETE FROM addon_states WHERE instance_id = ?').run(instanceId);
  }
}

interface HttpActionRow {
  id: string;
  ref: string;
  label: string;
  description: string;
  method: 'GET' | 'POST';
  url: string;
  profile_id: string | null;
  headers: string;
  body: string | null;
  confirmation: 'required' | 'none';
  enabled: number;
  created_at: number;
  updated_at: number;
}

function actionOf(row: HttpActionRow): HttpActionDefinition {
  return {
    id: row.id,
    ref: row.ref,
    label: row.label,
    description: row.description ?? '',
    method: row.method,
    url: row.url,
    profileId: row.profile_id,
    headers: JSON.parse(row.headers) as Record<string, string>,
    body: row.body,
    confirmation: row.confirmation,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface ActionRunRow {
  id: string;
  action_id: string;
  profile_id: string | null;
  interaction_id: string | null;
  idempotency_key: string;
  status: ActionRun['status'];
  request_summary: string | null;
  response_status: number | null;
  response_summary: string | null;
  error_code: string | null;
  error_message: string | null;
  started_at: number;
  finished_at: number | null;
}

function runOf(row: ActionRunRow): ActionRun {
  return {
    id: row.id,
    actionId: row.action_id,
    profileId: row.profile_id,
    interactionId: row.interaction_id,
    idempotencyKey: row.idempotency_key,
    status: row.status,
    requestSummary: row.request_summary,
    responseStatus: row.response_status,
    responseSummary: row.response_summary,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

/** Destinations GET/POST enregistrées par l'admin, jamais fournies par le modèle. */
export class ActionRepository {
  constructor(private readonly db: DatabaseSync) {}

  listActions(): HttpActionDefinition[] {
    return (
      this.db
        .prepare('SELECT * FROM http_actions ORDER BY created_at, id')
        .all() as unknown as HttpActionRow[]
    ).map(actionOf);
  }

  /** Destinations autorisées pour ce propriétaire : foyer + profil actif. */
  actionsFor(profileId: string | null): HttpActionDefinition[] {
    const rows = profileId
      ? this.db
          .prepare(
            'SELECT * FROM http_actions WHERE profile_id IS NULL OR profile_id = ? ORDER BY created_at, id',
          )
          .all(profileId)
      : this.db
          .prepare('SELECT * FROM http_actions WHERE profile_id IS NULL ORDER BY created_at, id')
          .all();
    return (rows as unknown as HttpActionRow[]).map(actionOf);
  }

  getAction(id: string): HttpActionDefinition | null {
    const row = this.db.prepare('SELECT * FROM http_actions WHERE id = ?').get(id) as unknown as
      HttpActionRow | undefined;
    return row ? actionOf(row) : null;
  }

  createAction(input: {
    enabled?: boolean;
    ref: string;
    label: string;
    description?: string;
    method: 'GET' | 'POST';
    url: string;
    profileId: string | null;
    headers: Record<string, string>;
    body: string | null;
    confirmation: 'required' | 'none';
  }): HttpActionDefinition {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO http_actions (id, ref, label, description, method, url, profile_id, headers, body, confirmation, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.ref,
        input.label,
        input.description ?? '',
        input.method,
        input.url,
        input.profileId,
        JSON.stringify(input.headers),
        input.body,
        input.confirmation,
        Number(input.enabled ?? true),
        now,
        now,
      );
    return this.getAction(id)!;
  }

  updateAction(
    id: string,
    patch: {
      ref?: string;
      label?: string;
      description?: string;
      method?: 'GET' | 'POST';
      url?: string;
      profileId?: string | null;
      headers?: Record<string, string>;
      body?: string | null;
      confirmation?: 'required' | 'none';
      enabled?: boolean;
    },
  ): HttpActionDefinition {
    const existing = this.getAction(id);
    if (!existing) throw new Error('Action introuvable.');
    this.db
      .prepare(
        'UPDATE http_actions SET ref = ?, label = ?, description = ?, method = ?, url = ?, profile_id = ?, headers = ?, body = ?, confirmation = ?, enabled = ?, updated_at = ? WHERE id = ?',
      )
      .run(
        patch.ref ?? existing.ref,
        patch.label ?? existing.label,
        patch.description ?? existing.description,
        patch.method ?? existing.method,
        patch.url ?? existing.url,
        patch.profileId === undefined ? existing.profileId : patch.profileId,
        JSON.stringify(patch.headers ?? existing.headers),
        patch.body === undefined ? existing.body : patch.body,
        patch.confirmation ?? existing.confirmation,
        Number(patch.enabled ?? existing.enabled),
        Date.now(),
        id,
      );
    return this.getAction(id)!;
  }

  deleteAction(id: string): void {
    this.db.prepare('DELETE FROM http_actions WHERE id = ?').run(id);
  }

  findRun(actionId: string, idempotencyKey: string): ActionRun | null {
    const row = this.db
      .prepare('SELECT * FROM action_runs WHERE action_id = ? AND idempotency_key = ?')
      .get(actionId, idempotencyKey) as unknown as ActionRunRow | undefined;
    return row ? runOf(row) : null;
  }

  createRun(input: {
    actionId: string;
    profileId: string | null;
    interactionId: string | null;
    idempotencyKey: string;
    status: ActionRun['status'];
    requestSummary: string | null;
  }): ActionRun {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO action_runs (id, action_id, profile_id, interaction_id, idempotency_key, status, request_summary, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.actionId,
        input.profileId,
        input.interactionId,
        input.idempotencyKey,
        input.status,
        input.requestSummary,
        Date.now(),
      );
    return this.getRun(id)!;
  }

  getRun(id: string): ActionRun | null {
    const row = this.db.prepare('SELECT * FROM action_runs WHERE id = ?').get(id) as unknown as
      ActionRunRow | undefined;
    return row ? runOf(row) : null;
  }

  /** Dernières exécutions, pour l'écran d'administration. */
  listRuns(limit = 20): ActionRun[] {
    const rows = this.db
      .prepare('SELECT * FROM action_runs ORDER BY started_at DESC LIMIT ?')
      .all(Math.max(1, Math.min(100, limit))) as unknown as ActionRunRow[];
    return rows.map(runOf);
  }

  finishRun(
    id: string,
    patch: {
      status: ActionRun['status'];
      responseStatus?: number | null;
      responseSummary?: string | null;
      errorCode?: string | null;
      errorMessage?: string | null;
    },
  ): ActionRun {
    this.db
      .prepare(
        'UPDATE action_runs SET status = ?, response_status = ?, response_summary = ?, error_code = ?, error_message = ?, finished_at = ? WHERE id = ?',
      )
      .run(
        patch.status,
        patch.responseStatus ?? null,
        patch.responseSummary ?? null,
        patch.errorCode ?? null,
        patch.errorMessage ?? null,
        Date.now(),
        id,
      );
    return this.getRun(id)!;
  }

  createConfirmation(input: {
    actionId: string;
    profileId: string | null;
    interactionId: string | null;
    params: Record<string, unknown>;
    paramsHash: string;
    expiresAt: number;
  }): string {
    const id = randomUUID();
    this.db
      .prepare(
        'INSERT INTO action_confirmations (id, action_id, profile_id, interaction_id, params, params_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        id,
        input.actionId,
        input.profileId,
        input.interactionId,
        JSON.stringify(input.params),
        input.paramsHash,
        input.expiresAt,
        Date.now(),
      );
    return id;
  }

  getConfirmation(id: string): {
    id: string;
    actionId: string;
    profileId: string | null;
    params: Record<string, unknown>;
    paramsHash: string;
    approvedAt: number | null;
    expiresAt: number;
  } | null {
    const row = this.db
      .prepare(
        'SELECT id, action_id, profile_id, params, params_hash, approved_at, expires_at FROM action_confirmations WHERE id = ?',
      )
      .get(id) as unknown as
      | {
          id: string;
          action_id: string;
          profile_id: string | null;
          params: string;
          params_hash: string;
          approved_at: number | null;
          expires_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      actionId: row.action_id,
      profileId: row.profile_id,
      params: JSON.parse(row.params) as Record<string, unknown>,
      paramsHash: row.params_hash,
      approvedAt: row.approved_at,
      expiresAt: row.expires_at,
    };
  }

  /** Validation par un canal authentifié (administration) : jamais par le modèle. */
  approveConfirmation(id: string, at: number): boolean {
    const result = this.db
      .prepare(
        'UPDATE action_confirmations SET approved_at = ? WHERE id = ? AND approved_at IS NULL AND expires_at > ?',
      )
      .run(at, id, at);
    return result.changes > 0;
  }

  deleteConfirmation(id: string): void {
    this.db.prepare('DELETE FROM action_confirmations WHERE id = ?').run(id);
  }

  purgeConfirmations(now: number): void {
    this.db.prepare('DELETE FROM action_confirmations WHERE expires_at <= ?').run(now);
  }

  /** Confirmations en attente ou validées, pour l'écran d'administration. */
  listConfirmations(now: number): {
    id: string;
    actionId: string;
    profileId: string | null;
    interactionId: string | null;
    approvedAt: number | null;
    expiresAt: number;
  }[] {
    const rows = this.db
      .prepare(
        'SELECT id, action_id, profile_id, interaction_id, approved_at, expires_at FROM action_confirmations WHERE expires_at > ? ORDER BY created_at',
      )
      .all(now) as unknown as {
      id: string;
      action_id: string;
      profile_id: string | null;
      interaction_id: string | null;
      approved_at: number | null;
      expires_at: number;
    }[];
    return rows.map((row) => ({
      id: row.id,
      actionId: row.action_id,
      profileId: row.profile_id,
      interactionId: row.interaction_id,
      approvedAt: row.approved_at,
      expiresAt: row.expires_at,
    }));
  }
}
