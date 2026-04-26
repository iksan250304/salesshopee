import firebaseRulesPlugin from '@firebase/eslint-plugin-security-rules';
import globals from "globals";

export default [
  {
    files: ["**/*.rules"],
    plugins: {
      "@firebase/security-rules": firebaseRulesPlugin
    },
    rules: {
      ...firebaseRulesPlugin.configs['flat/recommended'].rules
    },
    languageOptions: {
      globals: {
          ...globals.node,
      }
    }
  },
  {
    ignores: ['dist/**/*']
  }
];
