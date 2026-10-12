import { Link } from 'react-router';

import { PT_BR } from '../../shared/i18n/pt-br';

export function NotFoundPage() {
  return (
    <main className="imx-shell" data-imx-theme="light-glass">
      <section className="imx-glass-panel">
        <h1 className="imx-title">{PT_BR.notFound.title}</h1>
        <div className="imx-actions">
          <Link className="imx-glass-button" to="/">
            {PT_BR.notFound.backHome}
          </Link>
        </div>
      </section>
    </main>
  );
}
