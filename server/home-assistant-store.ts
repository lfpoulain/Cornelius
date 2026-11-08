import type { DatabaseSync } from 'node:sqlite';
import type { HomeAssistantEntity } from '../shared/home-assistant.js';

export const homeAssistantMigration = `CREATE TABLE home_assistant (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  url TEXT NOT NULL DEFAULT '',
  token TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  selected TEXT NOT NULL DEFAULT '[]',
  catalog TEXT NOT NULL DEFAULT '[]',
  revision INTEGER NOT NULL DEFAULT 0
) STRICT;
INSERT INTO home_assistant (id) VALUES (1);`;

export interface HomeAssistantConfig {
  url: string;
  token: string;
  enabled: boolean;
  selected: string[];
  catalog: HomeAssistantEntity[];
  revision: number;
  /** Outils de Luna masqués et refusés tant qu’aucune personne reconnue n’est active. */
  knownPeopleOnly: boolean;
  /** Luna peut régler la consigne des thermostats cochés ; sinon ils restent en lecture. */
  climateControl: boolean;
}

/** Secret serveur : jamais sérialisé dans une réponse API ou un outil. */
export class HomeAssistantRepository {
  constructor(private readonly db: DatabaseSync) {}
  get(): HomeAssistantConfig {
    const row = this.db.prepare('SELECT * FROM home_assistant WHERE id = 1').get()!;
    return {
      url: String(row.url),
      token: String(row.token),
      enabled: Boolean(row.enabled),
      selected: JSON.parse(String(row.selected)),
      catalog: JSON.parse(String(row.catalog)),
      revision: Number(row.revision),
      ...this.access(),
    };
  }
  private access() {
    return {
      knownPeopleOnly:
        this.db.prepare('SELECT known_people_only FROM home_assistant_access WHERE id = 1').get()
          ?.known_people_only === 1,
      climateControl:
        this.db.prepare('SELECT enabled FROM home_assistant_climate WHERE id = 1').get()
          ?.enabled === 1,
    };
  }
  save(config: HomeAssistantConfig): HomeAssistantConfig {
    const result = this.db
      .prepare(
        `UPDATE home_assistant SET url = ?, token = ?, enabled = ?,
      selected = ?, catalog = ?, revision = revision + 1 WHERE id = 1 AND revision = ?`,
      )
      .run(
        config.url,
        config.token,
        Number(config.enabled),
        JSON.stringify(config.selected),
        JSON.stringify(config.catalog),
        config.revision,
      );
    if (!result.changes) throw new Error('Configuration modifiée : actualisez la page.');
    this.db
      .prepare('UPDATE home_assistant_access SET known_people_only = ? WHERE id = 1')
      .run(Number(config.knownPeopleOnly));
    this.db
      .prepare('UPDATE home_assistant_climate SET enabled = ? WHERE id = 1')
      .run(Number(config.climateControl));
    return this.get();
  }
}
