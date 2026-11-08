import { describe, expect, it } from "vitest";
import {
  CATEGORIES,
  EXERCISES,
  exerciseText,
  type Measure,
} from "../domain/exercises";
import { GOAL_IDS } from "../domain/plan";
import { NOTICE_MESSAGE } from "../domain/safety";
import { MESSAGES, translate, translator, type MessageKey } from "./index";

const keysOf = (messages: Readonly<Record<string, string>>) =>
  Object.keys(messages).sort();
const placeholders = (text: string) =>
  [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("wording", () => {
  const allSpanish = Object.values(MESSAGES.es).join("\n");

  it("uses one Spanish for everyone", () => {
    expect(allSpanish).not.toMatch(/ordenador|computadora|respald/i);
  });

  it("never tells someone to stop with a bare 'para', which can read as 'for'", () => {
    expect(allSpanish).not.toMatch(
      /\bpara (cuando|mucho antes|antes de quedarte|y descansa)/i,
    );
    expect(MESSAGES.es["exercise.warmup_hum.instructions"]).toContain(
      "Detente si algo te resulta incómodo.",
    );
  });

  it("calls goals metas everywhere", () => {
    expect(allSpanish).not.toMatch(/objetivo/i);
  });

  it("spells practice one way in English", () => {
    expect(Object.values(MESSAGES.en).join("\n")).not.toMatch(/practis/i);
  });

  it("does not read like logging in", () => {
    expect(MESSAGES.es["exercise.startSession"]).toBe("Empezar");
  });

  it("never pushes for length when a session was too short", () => {
    for (const key of [
      "result.notEnoughVoice",
      "result.notEnoughSound",
    ] as const) {
      expect(MESSAGES.en[key]).not.toMatch(/longer/i);
      expect(MESSAGES.es[key]).not.toMatch(/un poco más/i);
    }
  });

  it("names the one direction in the pitch goal: up", () => {
    expect(MESSAGES.en["goal.pitch"]).toMatch(/raise/i);
    expect(MESSAGES.es["goal.pitch"]).toMatch(/\bsubir\b/i);
  });

  it("never mentions lowering in a goal or in S12", () => {
    for (const language of ["en", "es"] as const) {
      const keys: readonly MessageKey[] = [
        ...GOAL_IDS.map((id): MessageKey => `goal.${id}`),
        "safety.s12",
      ];
      for (const key of keys)
        expect(MESSAGES[language][key], `${language} ${key}`).not.toMatch(
          /lower|grave|bajar/i,
        );
    }
  });

  it("says feminine only for the person's own aim and in the sources note", () => {
    for (const language of ["en", "es"] as const) {
      const saying = Object.entries(MESSAGES[language])
        .filter(([, text]) => /feminine|femenin/i.test(text))
        .map(([key]) => key)
        .sort();
      expect(saying, language).toEqual(["onboarding.intro", "range.sources"]);
    }
  });

  it("gives the research's disagreement on a minimum in the sources note", () => {
    for (const language of ["en", "es"] as const) {
      expect(MESSAGES[language]["range.sources"]).toContain("155");
      expect(MESSAGES[language]["range.sources"]).toContain("180");
    }
  });

  it("says plainly there is no clinical support and it does not replace a voice therapist", () => {
    expect(MESSAGES.en["safety.s1"]).toMatch(/clinical support/);
    expect(MESSAGES.en["safety.s1"]).toMatch(/voice therapist/);
    expect(MESSAGES.es["safety.s1"]).toMatch(/apoyo clínico/);
    expect(MESSAGES.es["safety.s1"]).toMatch(/terapia de voz/);
  });

  it("never shows the backend's raw words", () => {
    for (const messages of [MESSAGES.en, MESSAGES.es])
      expect(Object.values(messages).join("\n")).not.toContain("{message}");
  });
});

describe("message catalogues", () => {
  it("English and Spanish have exactly the same keys", () => {
    expect(keysOf(MESSAGES.es)).toEqual(keysOf(MESSAGES.en));
  });

  it("no message is empty", () => {
    for (const language of ["en", "es"] as const) {
      for (const [key, text] of Object.entries(MESSAGES[language])) {
        expect(text.trim(), `${language} ${key}`).not.toBe("");
      }
    }
  });

  it("each message has the same placeholders in both languages", () => {
    for (const key of Object.keys(MESSAGES.en) as MessageKey[]) {
      expect(placeholders(MESSAGES.es[key]), key).toEqual(
        placeholders(MESSAGES.en[key]),
      );
    }
  });

  it("only brand names and language names are the same in both languages", () => {
    const same = (Object.keys(MESSAGES.en) as MessageKey[]).filter(
      (key) => MESSAGES.en[key] === MESSAGES.es[key],
    );
    expect(same.sort()).toEqual(["app.title", "language.en", "language.es"]);
  });

  it("never claims to detect strain, damage or health, and avoids loaded words (English)", () => {
    const banned =
      /detect|feminiz|feminis|\bpassing\b|\bcorrect\b|\b(fe)?male voice\b|biological|disorder|problem voice|\bfix\b|\bhealthy\b|\bsafe\b|pass\/fail/i;
    for (const [key, text] of Object.entries(MESSAGES.en)) {
      expect(text, key).not.toMatch(banned);
    }
  });

  it("the same in Spanish", () => {
    const banned =
      /detect|feminiz|masculin|pasar por|correcto|biológic|trastorno|arreglar|\bseguro\b|\bsano\b/i;
    for (const [key, text] of Object.entries(MESSAGES.es)) {
      expect(text, key).not.toMatch(banned);
    }
  });

  it("has the research's safety texts S1 to S17 in both languages", () => {
    for (let n = 1; n <= 17; n++) {
      const key = `safety.s${n}` as MessageKey;
      expect(MESSAGES.en[key], key).toBeTruthy();
      expect(MESSAGES.es[key], key).toBeTruthy();
    }
    expect(MESSAGES.en["safety.s4"]).toBe(
      "Stop and rest if it hurts, your voice turns hoarse or raspy, your throat feels raw or achy, talking takes effort, or you keep clearing your throat.",
    );
    expect(MESSAGES.es["safety.s9"]).toBe(
      "Hablar de una forma nueva puede resultar raro al principio. Que resulte raro está bien. El dolor es la señal para parar.",
    );
  });

  it("no exercise text promises a result or says the app can tell how the body is", () => {
    for (const language of ["en", "es"] as const) {
      for (const [key, text] of Object.entries(MESSAGES[language])) {
        if (key.startsWith("exercise.")) {
          expect(text, key).not.toMatch(
            /guarantee|garantiz|will make|cure|cura\b/i,
          );
        }
      }
    }
  });

  it("Spanish addresses the reader as tú, never usted or vos", () => {
    const formal = /\b(usted|ustedes|vos|tenés|podés)\b/i;
    for (const text of Object.values(MESSAGES.es))
      expect(text).not.toMatch(formal);
  });
});

describe("coverage of the app's own data", () => {
  it("has a name, description and instructions for every exercise", () => {
    for (const exercise of EXERCISES) {
      const { name, description, instructions } = exerciseText(exercise.id);
      for (const key of [name, description, instructions]) {
        expect(MESSAGES.en[key], key).toBeTruthy();
        expect(MESSAGES.es[key], key).toBeTruthy();
      }
    }
  });

  it("has a label for every category and every measure", () => {
    const measures = new Set<Measure>(EXERCISES.map((e) => e.measure));
    for (const category of CATEGORIES)
      expect(MESSAGES.en[`category.${category}`]).toBeTruthy();
    for (const measure of measures)
      expect(MESSAGES.en[`measure.${measure}.label`]).toBeTruthy();
  });
});

describe("translate", () => {
  it("fills placeholders in the chosen language", () => {
    expect(translate("en", "exercise.timeLeft", { seconds: 12 })).toBe(
      "Time left: 12 s",
    );
    expect(translate("es", "exercise.timeLeft", { seconds: 12 })).toBe(
      "Tiempo restante: 12 s",
    );
  });

  it("throws when a placeholder has no value", () => {
    expect(() => translate("en", "exercise.timeLeft")).toThrow(RangeError);
  });

  it("translator binds the language", () => {
    expect(translator("es")("nav.settings")).toBe("Ajustes");
  });
});

describe("exercise instructions", () => {
  const LONGEST = 150;
  it.each(["en", "es"] as const)(
    "fit the two lines kept for them in %s",
    (lang) => {
      const t = translator(lang);
      for (const { id } of EXERCISES)
        expect(t(exerciseText(id).instructions).length).toBeLessThanOrEqual(
          LONGEST,
        );
    },
  );
});

describe("the message for audio lost from a recording", () => {
  it.each(["en", "es"] as const)(
    "does not send someone to check their disk in %s",
    (lang) => {
      expect(MESSAGES[lang]["error.audio_lost"]).not.toMatch(
        /disk|disco|space|espacio/i,
      );
    },
  );

  it("stays true after the take stops, in the word the app uses for it", () => {
    expect(MESSAGES.en["error.audio_lost"]).toMatch(/recording/i);
    expect(MESSAGES.en["error.audio_lost"]).not.toMatch(/still going/i);
    expect(MESSAGES.es["error.audio_lost"]).toMatch(/grabación/i);
    expect(MESSAGES.es["error.audio_lost"]).not.toMatch(/sigue grabando/i);
  });
});

describe("the strip under the trace", () => {
  const LONGEST = 190;
  it.each(["en", "es"] as const)(
    "has room for every notice in %s, in its four lines",
    (lang) => {
      const t = translator(lang);
      for (const key of Object.values(NOTICE_MESSAGE))
        expect(t(key).length).toBeLessThanOrEqual(LONGEST);
    },
  );

  it.each(["en", "es"] as const)(
    "has room for a finished session's notes in %s",
    (lang) => {
      const t = translator(lang);
      const notes = `${t("result.oneTake")} ${t("safety.s3")}`;
      expect(notes.length).toBeLessThanOrEqual(LONGEST);
    },
  );
});
