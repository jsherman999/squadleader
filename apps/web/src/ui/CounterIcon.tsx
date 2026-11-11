import { useEffect, useRef } from 'react';
import type { Nation, UnitType, VehicleType } from '@squadwar/engine';
import { drawUnitFace, drawVehicleFace } from '../board/counterFace';

/**
 * One counter as it looks on the board, drawn on a small canvas: a squad, crew or
 * leader (`unit`), or a tank, gun or other vehicle (`vehicle`). `label` says in
 * words what it is, for screen readers and as the tooltip.
 */
export function CounterIcon({
  nation,
  unit,
  vehicle,
  name,
  weapons,
  size = 50,
  label,
}: {
  nation: Nation;
  unit?: UnitType | undefined;
  vehicle?: VehicleType | undefined;
  name?: string | undefined;
  /** Support weapon kinds on the counter (LMG, MMG…). */
  weapons?: readonly string[] | undefined;
  size?: number;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const kinds = (weapons ?? []).join(',');
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const px = Math.round(size * Math.min(3, window.devicePixelRatio || 1));
    cv.width = px;
    cv.height = px;
    const c = cv.getContext('2d');
    if (!c) return;
    c.setTransform(px / 44, 0, 0, px / 44, 0, 0);
    c.clearRect(0, 0, 44, 44);
    if (vehicle) drawVehicleFace(c, nation, vehicle);
    else if (unit) drawUnitFace(c, { nation, type: unit, name, weapons: kinds ? kinds.split(',') : [] });
  }, [nation, unit, vehicle, name, kinds, size]);
  return <canvas ref={ref} className="counter-icon" style={{ width: size, height: size }} role="img" aria-label={label} title={label} />;
}
