import type { HexDescription } from './describe';

export function HexCard({ d, extra }: { d: HexDescription | undefined; extra?: React.ReactNode }) {
  if (!d) return null;
  return (
    <div className="hex-card">
      <div className="hex-card-head">
        <span className="hex-id mono">{d.id}</span>
        <span>{d.terrain}</span>
      </div>
      {d.details.map((x) => (
        <div key={x} className="hex-card-line dim">
          {x}
        </div>
      ))}
      {extra}
    </div>
  );
}
