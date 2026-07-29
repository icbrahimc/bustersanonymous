// Join a path onto the configured base path so links work whether the site is
// served from a domain root ("/") or a project subpath ("/busters-league/").
const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export function href(path = '/') {
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${BASE}${clean}` || '/';
}
