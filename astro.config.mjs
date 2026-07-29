// @ts-check
import { defineConfig } from 'astro/config';

// For a GitHub *project* page the site lives at
//   https://<user>.github.io/<repo>/
// so `base` must be "/<repo>". For a user/org page (<user>.github.io)
// or a custom domain, set BASE_PATH="/" instead.
// Both are overridable via env so the workflow can inject the right values.
const SITE = process.env.SITE_URL || 'https://your-username.github.io';
const BASE = process.env.BASE_PATH || '/bustersanonymous';

// https://astro.build/config
export default defineConfig({
  site: SITE,
  base: BASE,
  trailingSlash: 'ignore',
});
