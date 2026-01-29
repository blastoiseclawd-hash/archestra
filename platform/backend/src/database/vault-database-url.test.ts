import { describe, expect, it } from "vitest";
import { parseDatabaseUrlVaultRef } from "./vault-database-url";

describe("parseDatabaseUrlVaultRef", () => {
  it("parses valid path#key format", () => {
    const result = parseDatabaseUrlVaultRef(
      "secret/data/archestra/config#database_url",
    );
    expect(result).toEqual({
      path: "secret/data/archestra/config",
      key: "database_url",
    });
  });

  it("handles path with multiple segments", () => {
    const result = parseDatabaseUrlVaultRef(
      "secret/data/team/prod/database#connection_string",
    );
    expect(result).toEqual({
      path: "secret/data/team/prod/database",
      key: "connection_string",
    });
  });

  it("handles key with hash character (uses last hash as separator)", () => {
    const result = parseDatabaseUrlVaultRef("secret/data/config#key#with#hash");
    expect(result).toEqual({
      path: "secret/data/config#key#with",
      key: "hash",
    });
  });

  it("returns null for string without hash separator", () => {
    const result = parseDatabaseUrlVaultRef("secret/data/config");
    expect(result).toBeNull();
  });

  it("returns null for empty path (hash at start)", () => {
    const result = parseDatabaseUrlVaultRef("#key");
    expect(result).toBeNull();
  });

  it("returns null for empty key (hash at end)", () => {
    const result = parseDatabaseUrlVaultRef("secret/data/config#");
    expect(result).toBeNull();
  });
});
