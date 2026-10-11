import { PT_BR } from '../../shared/i18n/pt-br';

export function HomePage() {
  return (
    <main>
      <h1>{PT_BR.home.title}</h1>
      <p>{PT_BR.home.subtitle}</p>
      <a href="/zone.html">{PT_BR.home.openDemoZone}</a>
    </main>
  );
}
