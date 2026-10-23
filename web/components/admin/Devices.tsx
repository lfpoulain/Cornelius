import { useState } from 'react';
import { ScanFace, SlidersHorizontal } from 'lucide-react';
import { PresenceTimingSettings } from './PresenceTimingSettings';
import type { DevicesStatus, MirrorState } from '../../../shared/types';
import type { RunAction } from './types';
import { isSessionActive } from './format';
import { AudioDevices } from './AudioDevices';
import { Camera } from './Camera';
import { EngagementSettings } from './EngagementSettings';
import { RecognitionSettings } from './RecognitionSettings';
import { PrivacyMode } from './PrivacyMode';
import { SessionMode } from './SessionMode';
import { AdmissionSoundSettings } from './AdmissionSoundSettings';
import { GreetingSettings } from './GreetingSettings';
import { SilenceCloseSettings } from './SilenceCloseSettings';
import { DelegationSettings } from './DelegationSettings';
import { AdvancedAudioBuffer } from './AdvancedAudioBuffer';
import { RecognitionTester } from './RecognitionTester';
import { CollapsibleSection } from './shared';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

export function Devices({
  section,
  state,
  status,
  run,
}: {
  section: 'voice' | 'camera' | 'audio';
  state: MirrorState;
  status: DevicesStatus | null;
  run: RunAction;
}) {
  if (section === 'audio') return <AudioDevices active={isSessionActive(state)} run={run} />;
  if (section === 'camera')
    return (
      <div className="space-y-5">
        <Camera state={state} status={status} run={run} />
        <Card>
          <CardHeader>
            <CardTitle>Exigence de la reconnaissance</CardTitle>
            <CardDescription>
              La ressemblance que Cornelius demande avant de reconnaître une personne.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <RecognitionSettings status={status} run={run} />
            <LiveTest state={state} status={status} />
          </CardContent>
        </Card>
        <EngagementSettings status={status} run={run} />
      </div>
    );
  return (
    <div className="space-y-5">
      <SessionMode state={state} status={status} run={run} />
      <SilenceCloseSettings state={state} run={run} />
      <PrivacyMode state={state} run={run} />
      <div className="admin-voice-columns">
        <GreetingSettings state={state} run={run} />
        <AdmissionSoundSettings state={state} run={run} />
      </div>
      <CollapsibleSection
        icon={SlidersHorizontal}
        title="Réglages avancés"
        description="Micro gardé prêt, délais de présence et modèle confié aux recherches et aux actions."
        defaultOpen={false}
      >
        <AdvancedAudioBuffer state={state} run={run} />
        <PresenceTimingSettings status={status} run={run} />
        {state.voiceProvider !== 'mistral' && <DelegationSettings state={state} run={run} />}
      </CollapsibleSection>
      <p className="text-xs text-muted-foreground">
        Ces réglages sont enregistrés sur le serveur et conservés après un redémarrage.
      </p>
    </div>
  );
}

function LiveTest({ state, status }: { state: MirrorState; status: DevicesStatus | null }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-3 border-t pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs leading-relaxed text-muted-foreground">
          Vérifiez l’effet d’un réglage en direct : score de chaque personne face à l’exigence.
        </p>
        <Button
          variant="outline"
          size="sm"
          aria-expanded={open}
          disabled={!status?.perception.connected || state.session.mode === 4}
          onClick={() => setOpen((value) => !value)}
        >
          <ScanFace />
          {open ? 'Arrêter le test' : 'Tester en direct'}
        </Button>
      </div>
      {open && <RecognitionTester profiles={state.profiles} />}
    </div>
  );
}
