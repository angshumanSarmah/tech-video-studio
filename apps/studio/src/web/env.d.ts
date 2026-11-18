// Fallback for tools that don't understand SFCs (e.g. typescript-eslint's project service).
// vue-tsc resolves real .vue files first, so component types stay precise there.
declare module '*.vue' {
  import type { DefineComponent } from 'vue';
  const component: DefineComponent;
  export default component;
}
