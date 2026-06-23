import { describe, expect, test } from "vitest";
import { buildProgram } from "../src/main.js";

describe("cli", () => {
  test("registers the expected top-level commands", () => {
    const program = buildProgram();
    const names = program.commands.map((command) => command.name());
    expect(names).toEqual(
      expect.arrayContaining([
        "init",
        "desktop",
        "link",
        "sync",
        "connectors",
        "connections",
        "review",
        "rules",
        "budget",
        "recurrings",
        "proposals",
        "report",
        "export",
        "mcp"
      ])
    );
  });
});
