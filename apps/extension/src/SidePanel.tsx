import { strings } from './strings.js';

export function SidePanel() {
  return (
    <main>
      <p className="eyebrow">{strings.milestone}</p>
      <h1>{strings.title}</h1>
      <p>{strings.description}</p>
    </main>
  );
}
