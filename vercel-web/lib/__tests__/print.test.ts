import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  openPrintWindow,
  preOpenPrintWindow,
  PRINT_POPUP_BLOCKED_MESSAGE,
  reportPrintBlocked
} from "@/lib/print";

describe("lib/print", () => {
  const openMock = vi.fn();

  beforeEach(() => {
    openMock.mockReset();
    vi.stubGlobal("window", {
      open: openMock
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preOpenPrintWindow opens about:blank with size features", () => {
    const doc = { write: vi.fn() };
    openMock.mockReturnValue({ document: doc });
    const win = preOpenPrintWindow();
    expect(win).toBeTruthy();
    expect(openMock).toHaveBeenCalledWith("about:blank", "_blank", "width=1024,height=820");
    expect(doc.write).toHaveBeenCalled();
  });

  it("openPrintWindow returns false when pop-up is blocked", () => {
    openMock.mockReturnValue(null);
    expect(openPrintWindow("Title", "<p>body</p>")).toBe(false);
  });

  it("openPrintWindow writes document and returns true", () => {
    const doc = {
      write: vi.fn(),
      close: vi.fn(),
      images: []
    };
    const printWindow = {
      document: doc,
      focus: vi.fn(),
      print: vi.fn()
    };
    openMock.mockReturnValue(printWindow);
    vi.useFakeTimers();
    expect(openPrintWindow("Receipt", "<p>Line</p>", printWindow as unknown as Window)).toBe(true);
    expect(doc.write).toHaveBeenCalled();
    expect(doc.close).toHaveBeenCalled();
    expect(printWindow.focus).toHaveBeenCalled();
    vi.runAllTimers();
    vi.useRealTimers();
  });

  it("reportPrintBlocked forwards the standard message", () => {
    const onBlocked = vi.fn();
    reportPrintBlocked(onBlocked);
    expect(onBlocked).toHaveBeenCalledWith(PRINT_POPUP_BLOCKED_MESSAGE);
  });
});
