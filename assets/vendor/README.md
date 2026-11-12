# Vendored libraries

`supabase.js` is the browser build of `@supabase/supabase-js` version 2.119.0 (MIT license,
copyright Supabase), copied unchanged from the npm package (`dist/umd/supabase.js`).

It is served from this site rather than a CDN so that the reviewer dashboard, like the rest of the
site, makes no third-party script requests. Only `admin/index.html` loads it.

To update: `npm pack @supabase/supabase-js@2`, extract, and copy `dist/umd/supabase.js` here.
