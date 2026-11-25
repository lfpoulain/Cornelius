import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import lunaCard from '../schemas/luna-card.schema.json' with { type: 'json' };
import ambientPresentation from '../schemas/ambient-presentation.schema.json' with { type: 'json' };
import moduleCard from '../schemas/module-card.schema.json' with { type: 'json' };
import presenceState from '../schemas/presence-state.schema.json' with { type: 'json' };
import moduleSnapshot from '../schemas/module-snapshot.schema.json' with { type: 'json' };
import memoryChanges from '../schemas/memory-changes.schema.json' with { type: 'json' };
import visionObservation from '../schemas/vision-observation.schema.json' with { type: 'json' };
import toolResult from '../schemas/tool-result.schema.json' with { type: 'json' };
import imageCard from '../schemas/image-card.schema.json' with { type: 'json' };
import addonPlayback from '../schemas/addon-playback.schema.json' with { type: 'json' };
import type { MemoryProposal } from './memory.js';
import type { ImageCard, LunaCardRequest } from './types.js';
import type { AddonAmbientPresentation, AddonPlayback, ModuleCard } from './addons.js';

// Conditional schemas intentionally refine fields defined by their parent.
const ajv = new Ajv2020({ allErrors: true, strict: true, strictTypes: false });
addFormats(ajv);
export const validators = {
  ambientPresentation: ajv.compile<AddonAmbientPresentation>(ambientPresentation),
  lunaCard: ajv.compile<LunaCardRequest>(lunaCard),
  imageCard: ajv.compile<ImageCard>(imageCard),
  moduleCard: ajv.compile<ModuleCard>(moduleCard),
  addonPlayback: ajv.compile<AddonPlayback>(addonPlayback),
  presenceState: ajv.compile(presenceState),
  moduleSnapshot: ajv.compile(moduleSnapshot),
  memoryChanges: ajv.compile<MemoryProposal>(memoryChanges),
  visionObservation: ajv.compile(visionObservation),
  toolResult: ajv.compile(toolResult),
};

export function compile<T>(schema: object) {
  return ajv.compile<T>(schema);
}
