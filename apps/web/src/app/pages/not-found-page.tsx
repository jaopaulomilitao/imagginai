import { Link } from 'react-router';

import { PT_BR } from '../../shared/i18n/pt-br';

export function NotFoundPage() {
  return (
    <main>
      <h1>{PT_BR.notFound.title}</h1>
      <Link to="/">{PT_BR.notFound.backHome}</Link>
    </main>
  );
}
