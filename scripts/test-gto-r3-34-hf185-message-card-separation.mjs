import fs from "node:fs";

const service = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java", "utf8");
const overlay = fs.readFileSync("android/app/src/main/java/com/nvu/operacional/GtoOverlayLayoutPolicy.java", "utf8");
const checks = [];
const check = (name, ok) => {
  checks.push(Boolean(ok));
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

const chipStart = service.indexOf("private void showStatusChip(");
const chipEnd = service.indexOf("private void announceDriverStage", chipStart);
const chip = chipStart >= 0 && chipEnd > chipStart ? service.slice(chipStart, chipEnd) : "";
const layoutStart = service.indexOf("private void adjustOpenMenuLayoutAfterMeasure");
const layoutEnd = service.indexOf("private boolean shouldMinimizeMenuForConfirmedExternalApp", layoutStart);
const layout = layoutStart >= 0 && layoutEnd > layoutStart ? service.slice(layoutStart, layoutEnd) : "";
const hideStart = service.indexOf("private void hideStatusChipViewOnly");
const hideEnd = service.indexOf("private void hideStatusChip()", hideStart);
const hide = hideStart >= 0 && hideEnd > hideStart ? service.slice(hideStart, hideEnd) : "";

check("message window remains non-touchable", chip.includes("FLAG_NOT_TOUCHABLE"));
check("message has a measured attached view before reserving space", chip.includes("visualView.post(this::adjustOpenMenuLayoutAfterMeasure)") && chip.includes("statusChipView = visualView"));
check("layout detects an attached visible message", layout.includes("messageBandReserved") && layout.includes("statusChipView.isAttachedToWindow()") && layout.includes("statusChipView.getHeight() > 0"));
check("layout reserves message bottom plus a gap", layout.includes("statusChipParams.y + statusChipView.getHeight()") && layout.includes("messageGap = dp(10)") && layout.includes("messageBottom + messageGap"));
check("card top is computed from the reserved message band", layout.includes("centeredMenuYBesideBubble(") && layout.includes("messageReservedTop, safeBottom"));
check("card geometry records whether the message band is reserved", layout.includes("putBoolean(\"menuMessageBandReserved\", messageBandReserved)"));
check("message removal requests normal card reflow", hide.includes("mainHandler.post(this::adjustOpenMenuLayoutAfterMeasure)"));
check("saved bubble position is not overwritten by message reflow", layout.includes("bubbleYBeforeMenuOpen") && layout.includes("persistPreferredGtoBubblePosition") === false && service.includes("Automatic docking is intentionally NOT persisted"));
check("normal card side/selection geometry remains unchanged", layout.includes("menuXBesideBubble") && layout.includes("bubbleXForMenuSide") && overlay.includes("centeredMenuYBesideBubble"));
check("message/card separation does not change detection or trip state", !chip.includes("setTripState(") && !layout.includes("setTripState("));

const failed = checks.filter((ok) => !ok).length;
console.log(`\n${checks.length - failed}/${checks.length} HF185 message-card-separation checks passed.`);
if (failed) process.exit(1);
