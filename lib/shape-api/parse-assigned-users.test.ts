import { describe, expect, it } from "vitest";
import { parseAssignedUsers, primaryAssignedUserId } from "./parse-assigned-users";

describe("parseAssignedUsers", () => {
  it("parses Search API AssignedUsers array", () => {
    expect(parseAssignedUsers(["depursLi:3", "depursPo:22"])).toEqual({
      depursLi: "3",
      depursPo: "22",
    });
  });

  it("returns primary user id in department priority order", () => {
    expect(primaryAssignedUserId({ depursLi: "3", depursPo: "22" })).toBe("3");
    expect(primaryAssignedUserId({ depursLo: "34", depursLi: "3" })).toBe("34");
  });
});
