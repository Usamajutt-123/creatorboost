import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';

const config = [
  ...nextCoreWebVitals,
  {
    // These React Compiler diagnostics remain visible while data-fetching
    // effects and server-time calculations are incrementally migrated. They
    // are warnings rather than silently disabled, so CI still reports them.
    rules: {
      'react-hooks/set-state-in-effect': 'warn',
      'react-hooks/purity': 'warn',
    },
  },
  {
    ignores: ['.next/**', 'node_modules/**', 'coverage/**', 'supabase/functions/**', 'public/sw.js'],
  },
];

export default config;
