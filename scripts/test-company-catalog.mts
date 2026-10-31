import assert from "node:assert/strict";
import { companyApplyState, isCompanyListable, isRecruitmentOpen, toApplicationDate } from "../src/lib/companyCatalog";

const co = (extra: Record<string, unknown> = {}) => ({ id: "c1", companyName: "X", ...extra });
let checks = 0;
const check = (name: string, run: () => void) => { run(); checks++; console.log("PASS " + name); };

check("Only usable companies are listed", () => {
  assert.equal(isCompanyListable(co()), true);
  assert.equal(isCompanyListable(co({ status: "approved" })), true);
  for (const bad of [{ deleted: true }, { isDeleted: true }, { softDeleted: true }, { active: false }, { isActive: false },
    { status: "deleted" }, { status: "Archived" }, { status: "pending" }, { status: "rejected" }, { status: "suspended" }, { status: "blocked" }])
    assert.equal(isCompanyListable(co(bad)), false, JSON.stringify(bad));
  assert.equal(isCompanyListable(null), false);
});
check("Recruiting is open unless the company turned it off", () => {
  assert.equal(isRecruitmentOpen(co()), true);
  assert.equal(isRecruitmentOpen(co({ recruitmentSettings: {} })), true);
  assert.equal(isRecruitmentOpen(co({ recruitmentSettings: { isActive: true } })), true);
  assert.equal(isRecruitmentOpen(co({ recruitmentSettings: { isActive: false } })), false);
});
check("A link and a pending application win over the closed flag", () => {
  const closed = co({ recruitmentSettings: { isActive: false } });
  assert.equal(companyApplyState(closed, new Set(["c1"]), new Set()), "member");
  assert.equal(companyApplyState(closed, new Set(), new Set(["c1"])), "applied");
  assert.equal(companyApplyState(closed, new Set(), new Set()), "closed");
  assert.equal(companyApplyState(co(), new Set(), new Set()), "open");
  assert.equal(companyApplyState(co(), new Set(["c1"]), new Set(["c1"])), "member");
});
check("Application dates accept Timestamp, ISO, epoch and seconds", () => {
  const iso = "2026-10-25T12:00:00.000Z";
  assert.equal(toApplicationDate(iso)?.toISOString(), iso);
  assert.equal(toApplicationDate(Date.parse(iso))?.toISOString(), iso);
  assert.equal(toApplicationDate({ seconds: Date.parse(iso) / 1000 })?.toISOString(), iso);
  assert.equal(toApplicationDate({ _seconds: Date.parse(iso) / 1000 })?.toISOString(), iso);
  assert.equal(toApplicationDate({ toDate: () => new Date(iso) })?.toISOString(), iso);
  for (const bad of [null, undefined, "", "not a date", {}, NaN, { toDate: () => { throw Error("x"); } }]) assert.equal(toApplicationDate(bad), null, String(bad));
});
import fs from "node:fs";
check("Entry points: route /driver/companies, Profile buttons and the browse mode are wired", () => {
  const app = fs.readFileSync("src/App.tsx", "utf8"), profile = fs.readFileSync("src/pages/driver/Profile.tsx", "utf8"), join = fs.readFileSync("src/pages/driver/JoinCompany.tsx", "utf8");
  assert.match(app, /path="companies" element=\{<LazyRoute><JoinCompany mode="browse" \/><\/LazyRoute>\}/);
  assert.match(profile, /navigate\("\/driver\/companies"\)/); assert.match(profile, /navigate\("\/driver\/companies", \{ state: \{ focus: "applications" \} \}\)/);
  assert.match(join, /useEffect\(\(\) => \{ void loadCompanyCatalog\(\)\.catch/, "The screen loads the catalog by itself");
  assert.match(join, /if \(!browse && myPendingRequest\)/, "The first-access gate is unchanged for the join mode only");
  const layout = fs.readFileSync("src/layouts/DriverLayout.tsx", "utf8");
  assert.match(layout, /pathname\.includes\("\/driver\/join"\)/, "The redirect of /driver/join is untouched");
});
console.log(`COMPANY_CATALOG_PASS ${checks} checks`);

// One pending application per company: only a live pending driver application of that same company blocks a new one.
{
  const { hasPendingApplicationForCompany: blocked } = await import("../src/lib/companyCatalog.ts");
  const pending = { companyId: "a", status: "pending", isCurrent: true, type: "driver_application" };
  assert.equal(blocked([pending], "a"), true);
  assert.equal(blocked([pending], "b"), false, "another company's application does not block");
  assert.equal(blocked([{ ...pending, status: "withdrawn", isCurrent: false }], "a"), false, "a withdrawn one does not block");
  assert.equal(blocked([{ ...pending, status: "rejected" }, { ...pending, status: "approved" }], "a"), false);
  assert.equal(blocked([{ ...pending, isCurrent: false }], "a"), false, "a superseded one does not block");
  assert.equal(blocked([{ ...pending, type: "company_registration" }], "a"), false, "a company registration is another flow");
  assert.equal(blocked([{ companyId: "a", status: "pending" }], "a"), true, "legacy rows without type/isCurrent still block");
  console.log("PENDING_PER_COMPANY_PASS");
}
