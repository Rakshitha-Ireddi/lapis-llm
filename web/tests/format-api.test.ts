import { describe, expect, it } from "vitest";
import { sseEvents } from "../src/console/api";
import { ago, avgUtil, compact, esc, gib, percent, slugify } from "../src/lib/format";

describe("format", () => {
  it("compact", () => {
    expect(compact(950)).toBe("950");
    expect(compact(1500)).toBe("1.5k");
    expect(compact(2_000_000)).toBe("2M");
    expect(compact(123_456_789)).toBe("123M");
    expect(compact(Number.NaN)).toBe("–");
  });

  it("gib and percent", () => {
    expect(gib(5.789, 2)).toBe("5.79 GiB");
    expect(percent(3, 4)).toBe(75);
    expect(percent(5, 4)).toBe(100);
    expect(percent(1, 0)).toBe(0);
  });

  it("ago", () => {
    expect(ago(null)).toBe("never");
    expect(ago(100, 102)).toBe("just now");
    expect(ago(100, 130)).toBe("30s ago");
    expect(ago(0, 7200)).toBe("2h ago");
    expect(ago(0, 3 * 86400)).toBe("3d ago");
  });

  it("avgUtil averages every GPU, not just the first", () => {
    expect(avgUtil([{ utilization: 100 }, { utilization: 20 }])).toBe(60);
    expect(avgUtil([])).toBeNull();
  });

  it("slugify turns repos into model names", () => {
    expect(slugify("Qwen/Qwen2.5-7B-Instruct")).toBe("qwen2.5-7b-instruct");
    expect(slugify("  Hello World!! ")).toBe("hello-world");
  });

  it("esc neutralises HTML", () => {
    expect(esc(`<img src=x onerror="alert('x')">`)).toBe(
      "&lt;img src=x onerror=&quot;alert(&#39;x&#39;)&quot;&gt;",
    );
    expect(esc(null)).toBe("");
  });
});

describe("sseEvents", () => {
  it("splits data events across arbitrary chunk boundaries", async () => {
    const raw = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n';
    const chunks = [raw.slice(0, 7), raw.slice(7, 20), raw.slice(20)];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
        controller.close();
      },
    });
    const events: string[] = [];
    for await (const e of sseEvents(body)) events.push(e);
    expect(events).toEqual(['{"a":1}', '{"b":2}', "[DONE]"]);
  });
});
