# ui

The shared design system for this monorepo's front-ends — `web-verifier` and
`status-page`. It owns the [shadcn/ui](https://ui.shadcn.com) primitives, the
Tailwind v4 theme (Miden orange, Geist, the radius scale), and the app chrome
(navbar, theme provider and toggle).

The style is **`base-lyra`**, which is backed by
[Base UI](https://base-ui.com) rather than Radix — primitives import from
`@base-ui/react/*`, and Base UI's `render` prop replaces Radix's `asChild`.

## Consuming it

Add the dependency and import from the package root:

```jsonc
// apps/<app>/package.json
"dependencies": {
  "miden-source-code-verification-ui": "workspace:*"
}
```

```tsx
import { Card, CardContent, Navbar } from "miden-source-code-verification-ui";
```

Pull in the theme from the app's CSS entry — this is the only stylesheet an app
needs, and it already `@import`s Tailwind itself:

```css
@import "miden-source-code-verification-ui/styles.css";
```

The package ships raw `.tsx` (no build step), so each consuming app must map the
package-internal `@ui` alias in **both** its Vite and TypeScript config:

```ts
// vite.config.ts
resolve: {
  alias: {
    "@": path.resolve(__dirname, "./src"),
    "@ui": path.resolve(__dirname, "../../packages/ui/src"),
  },
}
```

```jsonc
// tsconfig.app.json
"paths": {
  "@/*": ["./src/*"],
  "@ui/*": ["../../packages/ui/src/*"]
}
```

## Why `@ui` and not `@`

Every app already binds `@` to its own `src`. If this package's primitives kept
the stock shadcn `@/lib/utils` import, Vite would resolve it against the *app's*
`src` and fail. `@ui` is a separate namespace that never collides, and it keeps
the shadcn CLI usable — see below.

## Adding a component

Run the CLI from this directory so it reads `components.json` here (correct
style, correct aliases) and writes into `src/components/ui/`:

```bash
cd packages/ui
npx shadcn@4.16.1 add <component>
```

Then re-export it from `src/index.ts`. Generated files land under
`src/components/ui/`, which Biome deliberately ignores (`"!**/components/ui"` in
the root `biome.json`) — don't reformat them.

## Tailwind content scanning

`src/styles.css` carries an explicit `@source "./";`. Tailwind v4 auto-detects
sources relative to the importing app but skips `node_modules`, which is where
pnpm symlinks this package — without that directive the shared components'
utilities are never generated and both apps render unstyled.
