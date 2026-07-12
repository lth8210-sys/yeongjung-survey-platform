import js from '@eslint/js';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';

export default [
  // functions/는 별도 Node.js 패키지(자체 package.json)라 이 브라우저 중심 설정이 아니라
  // functions/eslint.config.js로 독립 린트한다(SYNC 불필요 — 서로 다른 런타임 대상).
  { ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'functions/**'] },
  js.configs.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      react,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      // React 17+ JSX transform이라 import 없이 JSX 사용 가능
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      // 기존 JSX 텍스트의 " 등을 일괄로 &quot; 치환하는 리팩터링은 이번 범위 밖 — 표시만
      'react/no-unescaped-entities': 'warn',
      // Vite HMR과 함께 쓸 때 컴포넌트 파일에서 named export가 섞이면 경고만(에러 아님) —
      // 이 코드베이스는 SurveyResponsePage.jsx 등에서 헬퍼 함수를 테스트용으로 export한다.
      'react-refresh/only-export-components': 'warn',
      // 실제 버그를 잡는 규칙만 error, 스타일성 규칙은 warn으로 낮춰 대규모 기존 코드에
      // 일괄 수정을 강요하지 않는다.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-empty': 'warn',
      'no-constant-condition': ['error', { checkLoops: false }],
    },
  },
  {
    files: ['test/**/*.test.js'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
];
