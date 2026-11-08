import type { Language } from "../domain/contract";
import { en } from "./en";
import { enExercises } from "./en.exercises";
import { enSafety } from "./en.safety";
import { es } from "./es";
import { esExercises } from "./es.exercises";
import { esSafety } from "./es.safety";

const ENGLISH = { ...en, ...enSafety, ...enExercises };
const SPANISH = { ...es, ...esSafety, ...esExercises };

export type MessageKey = keyof typeof ENGLISH;

export const MESSAGES: Readonly<
  Record<Language, Readonly<Record<MessageKey, string>>>
> = {
  en: ENGLISH,
  es: SPANISH,
};

export type MessageParams = Readonly<Record<string, string | number>>;

/** Fills `{name}` placeholders. A placeholder without a value is a bug, so it throws. */
export function translate(
  language: Language,
  key: MessageKey,
  params: MessageParams = {},
): string {
  return MESSAGES[language][key].replace(/\{(\w+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined)
      throw new RangeError(`message "${key}" needs a value for {${name}}`);
    return String(value);
  });
}

export type Translator = (key: MessageKey, params?: MessageParams) => string;

export function translator(language: Language): Translator {
  return (key, params) => translate(language, key, params);
}
