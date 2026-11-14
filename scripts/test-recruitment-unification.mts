import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { applyRoute, safeApplyReturnTo } from "../src/lib/applyReturn.ts";
import { pendingRecruitment, pendingRecruitmentMessage } from "../src/lib/recruitmentPending.ts";
import { corporateNotificationTab, notificationDestination } from "../src/lib/notificationNavigation.ts";
import { CompanyRecruitmentNotice } from "../src/components/admin/CompanyRecruitmentNotice.tsx";

// Where the recruitment form returns to: only the app's own driver/onboarding screens.
for (const ok of ["/driver/companies", "/driver/join", "/driver/profile", "/pending-applications", "/select-profile"]) assert.equal(safeApplyReturnTo({ returnTo: ok }), ok, ok);
for (const bad of ["https://evil.example/", "//evil.example", "/admin/senior", "/driver/../admin", "/driver/a b", "javascript:alert(1)", "", 7, null, undefined, "/" + "x".repeat(200)])
  assert.equal(safeApplyReturnTo({ returnTo: bad }), "", String(bad));
assert.equal(safeApplyReturnTo(undefined), ""); assert.equal(safeApplyReturnTo("/driver/companies"), "", "state must be an object");
assert.deepEqual(applyRoute("c 1/x", "/driver/companies"), { to: "/apply/c%201%2Fx", state: { returnTo: "/driver/companies" } });

// Pending counts for the company's managers.
const apps = [
  { companyId: "a", status: "pending", isCurrent: true, type: "driver_application" }, { companyId: "a", status: "pending" },
  { companyId: "a", status: "withdrawn", isCurrent: false }, { companyId: "a", status: "approved" }, { companyId: "a", status: "pending", isCurrent: false },
  { companyId: "a", status: "pending", type: "company_registration" }, { companyId: "b", status: "pending" },
];
const reqs = [{ empresaId: "a", status: "pending" }, { empresaId: "a", status: "approved" }, { empresaId: "b", status: "pending" }];
assert.deepEqual(pendingRecruitment("a", apps, reqs), { applications: 2, legacyRequests: 1 });
assert.deepEqual(pendingRecruitment("", apps, reqs), { applications: 0, legacyRequests: 0 });
assert.equal(pendingRecruitmentMessage({ applications: 2, legacyRequests: 1 }), "2 inscrições aguardando análise · 1 solicitação antiga de entrada");
assert.equal(pendingRecruitmentMessage({ applications: 1, legacyRequests: 0 }), "1 inscrição aguardando análise");
assert.equal(pendingRecruitmentMessage({ applications: 0, legacyRequests: 3 }), "3 solicitações antigas de entrada");

// The company profile notice: hidden when nothing waits, otherwise says what and offers the right tabs.
const render = (applications: any[], requests: any[]) => renderToString(React.createElement(MemoryRouter, null, React.createElement(CompanyRecruitmentNotice, { companyId: "a", applications, requests })));
assert.equal(render([], []), "");
let html = render(apps, reqs);
assert.match(html, /2 inscrições aguardando análise/); assert.match(html, /1 solicitação antiga de entrada/);
assert.match(html, /Abrir Recursos Humanos/); assert.match(html, /Ver solicitações/);
html = render([apps[0]], []);
assert.match(html, /1 inscrição aguardando análise/); assert.doesNotMatch(html, /Ver solicitações/);

// Notification destination: applications -> RH, old join requests -> Motoristas, work requests -> operations.
assert.equal(corporateNotificationTab({ type: "RH_APPLICATION" }), "hr");
assert.equal(corporateNotificationTab({ type: "WORK_REQUEST", dedupeKey: "JOIN_COMPANY_a_u1_owner" }), "drivers");
assert.equal(corporateNotificationTab({ type: "WORK_REQUEST", dedupeKey: "WORK_REQUEST_demand1_owner" }), "operations");
assert.equal(corporateNotificationTab({ type: "WORK_REQUEST" }), "operations");
assert.equal(corporateNotificationTab({ tipo: "OPERATION_COMPLETED" }), "operations");
assert.equal(corporateNotificationTab({ type: "SOMETHING_ELSE" }), undefined);
const target = notificationDestination({ userId: "m1", type: "WORK_REQUEST", dedupeKey: "JOIN_COMPANY_a_u1_m1", targetProfile: "corporate", companyId: "a" }, "m1");
assert.equal(target?.activeTab, "drivers");
console.log("RECRUITMENT_UNIFICATION_PASS");
