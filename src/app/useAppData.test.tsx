import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { backend, PROFILE } from "../test/fakeBackend";
import { useAppData } from "./useAppData";

const READ_ERROR = { kind: "io", message: "database is locked" };

async function mountWithFailedRead() {
  backend.fail("get_profile", READ_ERROR);
  const { result } = renderHook(() => useAppData());
  await waitFor(() => expect(result.current.profileRead).toBe("failed"));
  return result;
}

describe("saving the profile", () => {
  it("is refused while the first read is out", async () => {
    const release = backend.hold("get_profile", PROFILE);
    const { result } = renderHook(() => useAppData());
    await expect(result.current.saveProfile(PROFILE)).rejects.toThrow();
    expect(backend.callsTo("set_profile")).toHaveLength(0);
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it("is refused after a failed read", async () => {
    const result = await mountWithFailedRead();
    await expect(result.current.saveProfile(PROFILE)).rejects.toThrow();
    expect(backend.callsTo("set_profile")).toHaveLength(0);
  });

  it("is refused after a later read fails, though an old profile is in memory", async () => {
    const { result } = renderHook(() => useAppData());
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    backend.fail("get_profile", READ_ERROR);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.profileRead).toBe("failed"));
    await expect(result.current.saveProfile(PROFILE)).rejects.toThrow();
    act(() => result.current.updatePreferences({ theme: "light" }));
    expect(backend.callsTo("set_profile")).toHaveLength(0);
  });

  it("is refused during a read that replaces what's in memory", async () => {
    const { result } = renderHook(() => useAppData());
    await waitFor(() => expect(result.current.profile).not.toBeNull());
    const release = backend.hold("get_profile", PROFILE);
    act(() => result.current.reload());
    await expect(result.current.saveProfile(PROFILE)).rejects.toThrow();
    expect(backend.callsTo("set_profile")).toHaveLength(0);
    await act(async () => {
      release();
      await Promise.resolve();
    });
  });

  it("works again once a retry has read the profile", async () => {
    const result = await mountWithFailedRead();
    backend.respond("get_profile", PROFILE);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.profileRead).toBe("read"));
    await act(() => result.current.saveProfile(PROFILE));
    expect(backend.callsTo("set_profile")).toHaveLength(1);
  });

  it("works on a fresh install, where the read found nothing", async () => {
    backend.respond("get_profile", null);
    const { result } = renderHook(() => useAppData());
    await waitFor(() => expect(result.current.profileRead).toBe("read"));
    await act(() => result.current.saveProfile(PROFILE));
    expect(backend.callsTo("set_profile")).toHaveLength(1);
  });
});

describe("a language or theme change", () => {
  it("still applies on screen when nothing could be read", async () => {
    const result = await mountWithFailedRead();
    act(() => result.current.updatePreferences({ language: "es" }));
    expect(result.current.language).toBe("es");
    expect(backend.callsTo("set_profile")).toHaveLength(0);
  });
});
