import { createHighlighterCore } from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import css from 'shiki/langs/css.mjs'
import diff from 'shiki/langs/diff.mjs'
import javascript from 'shiki/langs/javascript.mjs'
import json from 'shiki/langs/json.mjs'
import jsonc from 'shiki/langs/jsonc.mjs'
import jsx from 'shiki/langs/jsx.mjs'
import markdown from 'shiki/langs/markdown.mjs'
import python from 'shiki/langs/python.mjs'
import shellscript from 'shiki/langs/shellscript.mjs'
import toml from 'shiki/langs/toml.mjs'
import tsx from 'shiki/langs/tsx.mjs'
import typescript from 'shiki/langs/typescript.mjs'
import yaml from 'shiki/langs/yaml.mjs'
import githubDark from 'shiki/themes/github-dark.mjs'
import githubLight from 'shiki/themes/github-light.mjs'

export const createCodeHighlighter = () =>
  createHighlighterCore({
    themes: [githubLight, githubDark],
    langs: [
      css,
      diff,
      javascript,
      json,
      jsonc,
      jsx,
      markdown,
      python,
      shellscript,
      toml,
      tsx,
      typescript,
      yaml,
    ],
    engine: createJavaScriptRegexEngine(),
  })
