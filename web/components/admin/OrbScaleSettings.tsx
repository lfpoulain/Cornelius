import { useEffect, useRef, useState } from 'react';
import type { MirrorState } from '../../../shared/types';
import { ORB_SCALE_MAX, ORB_SCALE_MIN } from '../../../shared/display';
import { api } from '../../api';
import type { RunAction } from './types';
import { Button } from '../ui/button';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '../ui/card';

/** Taille de l’orbe sur le miroir, appliquée en direct pendant le réglage. */
export function OrbScaleSettings({ state, run }: { state: MirrorState; run: RunAction }) {
  const saved = state.orbScale ?? 100;
  const [value, setValue] = useState(saved);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setValue(saved), [saved]);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  // Enregistré une fois le curseur posé, pas à chaque cran.
  const save = (scale: number) => {
    setValue(scale);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void run(`Taille de l’orbe : ${scale} %.`, () => api.orbScale(scale), {
        key: 'orb-scale',
        payload: scale,
      });
    }, 400);
  };
  return (
    <Card>
      <CardHeader>
        <CardTitle>Taille de l’orbe</CardTitle>
        <CardDescription id="orb-scale-detail">
          Sur le miroir, en pourcentage de sa taille d’origine. Les cartes et les informations se
          placent autour d’elle.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4">
          <label htmlFor="orb-scale" className="sr-only">
            Taille de l’orbe
          </label>
          <input
            id="orb-scale"
            type="range"
            className="w-full max-w-sm accent-primary"
            min={ORB_SCALE_MIN}
            max={ORB_SCALE_MAX}
            step={5}
            value={value}
            aria-describedby="orb-scale-detail"
            aria-valuetext={`${value} %`}
            onChange={(event) => save(Number(event.target.value))}
          />
          <output htmlFor="orb-scale" className="w-14 text-right tabular-nums">
            {value} %
          </output>
        </div>
        {value !== 100 && (
          <Button variant="outline" size="sm" onClick={() => save(100)}>
            Revenir à 100 %
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
