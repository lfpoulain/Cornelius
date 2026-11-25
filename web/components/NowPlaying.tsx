import { useState } from 'react';
import type { PlayerContext, PlayerMirrorState } from '../../shared/player';
import { stopPlayer } from '../audio/player';

/** État lisible de ce qui joue : en direct, baissé, en pause pendant une conversation. */
export function nowPlayingState(player: PlayerMirrorState, context: PlayerContext): string {
  if (player.status === 'loading') return 'Connexion…';
  const quiet = context.conversation || context.speaking || context.alarm;
  if (quiet) return player.kind === 'file' ? 'En pause' : 'Son baissé';
  return player.kind === 'live' ? 'En direct' : 'Lecture';
}

/**
 * Ce qui joue sur le miroir, avec la typographie des informations permanentes : logo relayé
 * par le serveur, titre, précision et un bouton pour arrêter.
 */
export function NowPlaying({
  player,
  context,
}: {
  player: PlayerMirrorState | null;
  context: PlayerContext;
}) {
  const [brokenImage, setBrokenImage] = useState<string | null>(null);
  if (!player) return null;
  const image = player.image && brokenImage !== player.id;
  return (
    <aside className="mirror-ambient mirror-player" aria-label="En cours de lecture">
      <section className="ambient-module mirror-player-module" data-layout="metric">
        {image && (
          <img
            className="mirror-player-logo"
            src={`/api/player/${encodeURIComponent(player.id)}/image`}
            alt=""
            onError={() => setBrokenImage(player.id)}
          />
        )}
        <div className="mirror-player-text">
          <h2 className="ambient-heading">{nowPlayingState(player, context)}</h2>
          <p className="ambient-value mirror-player-title">{player.title}</p>
          {player.subtitle && <p className="ambient-subtitle">{player.subtitle}</p>}
        </div>
        <button
          type="button"
          className="mirror-player-stop"
          onClick={() => void stopPlayer()}
          aria-label={`Arrêter ${player.title}`}
        >
          Arrêter
        </button>
      </section>
    </aside>
  );
}
