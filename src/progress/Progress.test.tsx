import { act, fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { SavedResult } from "../domain/contract";
import { todaysRoutine } from "../home/routine";
import { translator } from "../i18n";
import { boot, goTo, stage } from "../test/driveApp";
import { backend, PROFILE, savedResult } from "../test/fakeBackend";

const t = translator("en");
/** The morning routine opens with a warm-up, so this depends on the hour the tests run. */
const routineStart = () =>
  todaysRoutine(PROFILE.goals, [], new Date()).next?.id ?? "pitch_awareness";
const DAY = 86_400;
const NOW = Math.floor(Date.now() / 1000);

async function open(results: readonly SavedResult[]) {
  backend.respond("get_results", results);
  await boot();
  await act(async () => {
    await Promise.resolve();
  });
  goTo("Progress");
}

const session = (daysAgo: number, part: Partial<SavedResult> = {}) =>
  savedResult({
    id: 1000 - daysAgo,
    exerciseId: "pitch_awareness",
    createdAt: NOW - daysAgo * DAY,
    ...part,
  });

describe("with no sessions", () => {
  it("teaches instead of showing an empty chart", async () => {
    await open([]);
    expect(stage().getByText(t("progress.empty"))).toBeInTheDocument();
    expect(stage().queryByRole("table")).toBeNull();
    fireEvent.click(
      stage().getByRole("button", { name: t("home.openPractice") }),
    );
    expect(stage().getByRole("heading", { level: 1 })).toHaveTextContent(
      t(`exercise.${routineStart()}.name`),
    );
  });
});

describe("totals", () => {
  it("counts every session and the time, old ones included", async () => {
    await open([
      session(1, { durationS: 120 }),
      session(2, { durationS: 120, scoringVersion: 1 }),
    ]);
    expect(
      stage().getByText(t("progress.totalSessions", { count: 2 })),
    ).toBeInTheDocument();
    expect(
      stage().getByText(t("progress.totalTime", { minutes: 4 })),
    ).toBeInTheDocument();
  });
});

describe("the trend", () => {
  it("is in plain words", async () => {
    await open([
      session(4, { score: 40 }),
      session(3, { score: 40 }),
      session(2, { score: 80 }),
      session(1, { score: 80 }),
    ]);
    expect(stage().getAllByText(t("progress.trendUp"))).not.toHaveLength(0);
  });

  it("ignores sessions measured the old way", async () => {
    await open([
      session(6, { score: 100, scoringVersion: 1 }),
      session(5, { score: 100, scoringVersion: 1 }),
      session(4, { score: 40 }),
      session(3, { score: 40 }),
      session(2, { score: 40 }),
      session(1, { score: 40 }),
    ]);
    expect(stage().getAllByText(t("progress.trendFlat"))).not.toHaveLength(0);
    expect(stage().queryByText(t("progress.trendDown"))).toBeNull();
  });

  it("waits for enough sessions before saying anything", async () => {
    await open([session(1)]);
    expect(stage().getAllByText(t("progress.trendUnknown"))).not.toHaveLength(
      0,
    );
  });
});

describe("old sessions", () => {
  it("stay visible and are marked, on the chart and in the table", async () => {
    await open([session(2, { scoringVersion: 1 }), session(1)]);
    expect(stage().getByText(t("progress.oldNote"))).toBeInTheDocument();
    expect(document.querySelectorAll('[data-mark="old"]')).toHaveLength(1);
    const table = within(stage().getByRole("table"));
    expect(table.getByText(t("progress.legendOld"))).toBeInTheDocument();
  });

  it("never join the line", async () => {
    await open([session(3, { scoringVersion: 1 }), session(2), session(1)]);
    const line = document.querySelector(".chart-line");
    expect(line?.getAttribute("d")?.match(/[ML]/g)).toHaveLength(2);
  });

  it("hide the note when there are none", async () => {
    await open([session(1)]);
    expect(stage().queryByText(t("progress.oldNote"))).toBeNull();
  });
});

describe("the chart", () => {
  it("follows the chosen exercise", async () => {
    await open([
      session(2, { exerciseId: "glides" }),
      session(1, { exerciseId: "pitch_awareness" }),
      session(3, { exerciseId: "pitch_awareness" }),
    ]);
    expect(document.querySelectorAll("[data-mark]")).toHaveLength(2);
    fireEvent.change(
      stage().getByRole("combobox", { name: t("progress.exercise") }),
      { target: { value: "glides" } },
    );
    expect(document.querySelectorAll("[data-mark]")).toHaveLength(1);
  });

  it("has a text alternative with the count and trend", async () => {
    await open([session(1)]);
    expect(
      stage().getByRole("img", {
        name: t("progress.chartLabel", {
          name: "Pitch awareness",
          count: 1,
          trend: t("progress.trendUnknown"),
        }),
      }),
    ).toBeInTheDocument();
  });

  it("shows a practice row with no score as no score, never as 0", async () => {
    await open([session(1, { exerciseId: "resonance", score: null })]);
    const table = within(stage().getByRole("table"));
    expect(table.getByText(t("progress.noScore"))).toBeInTheDocument();
    expect(table.queryByText(/^0/)).toBeNull();
  });

  it("names the session under the pointer", async () => {
    await open([session(1, { score: 72 })]);
    const hit = document.querySelector(".chart-hit");
    if (hit === null) throw new Error("no hit target");
    fireEvent.pointerEnter(hit);
    expect(screen.getByTestId("chart-tip")).toHaveTextContent("72%");
    fireEvent.pointerLeave(hit);
    expect(screen.queryByTestId("chart-tip")).toBeNull();
  });
});

describe("the table toggle", () => {
  it("draws its own marker", async () => {
    await open([session(1, { score: 72 })]);
    expect(document.querySelector("summary svg.icon")).not.toBeNull();
  });
});

describe("the tooltip near an edge", () => {
  it("stays inside the chart", async () => {
    await open([session(1, { score: 72 }), session(9, { score: 60 })]);
    const hits = document.querySelectorAll(".chart-hit");
    const last = hits[hits.length - 1];
    if (last === undefined) throw new Error("no hit target");
    fireEvent.pointerEnter(last);
    const { left } = screen.getByTestId("chart-tip").style;
    expect(parseFloat(left)).toBeLessThanOrEqual(560 - 60);
  });
});

describe("the moon month", () => {
  it("fills a moon for a day with any session, scored or not", async () => {
    await open([session(0, { score: null })]);
    expect(
      document.querySelectorAll(
        '.moon-month [data-moon="full"], .moon-month [data-moon="waxing"]',
      ),
    ).toHaveLength(1);
  });

  it("draws no moon for days still to come", async () => {
    await open([session(0)]);
    const today = new Date().getDate();
    expect(document.querySelectorAll(".moon-month [data-moon]")).toHaveLength(
      today,
    );
  });
});

describe("the words", () => {
  it("keeps S10 close and never talks about streaks", async () => {
    await open([session(1)]);
    expect(stage().getByText(t("safety.s10"))).toBeInTheDocument();
    expect(screen.getByRole("main").textContent).not.toMatch(
      /streak|fail|pass/i,
    );
  });
});
