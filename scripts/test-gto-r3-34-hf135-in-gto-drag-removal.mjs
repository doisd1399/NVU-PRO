import fs from "node:fs";

const read = relative => fs.readFileSync(relative, "utf8");
const service = read("android/app/src/main/java/com/nvu/operacional/GtoObserverService.java");
const policy = read("android/app/src/main/java/com/nvu/operacional/GtoBubbleDismissPolicy.java");
const parser = read("android/app/src/main/java/com/nvu/operacional/GtoPauseLocationParser.java");
const verifyScript = String(JSON.parse(read("package.json")).scripts["verify:release"] || "");
const checks = [];
const check = (name, ok) => {
  checks.push({ name, ok: Boolean(ok) });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};

check("policy has an explicit drag/drop safety boundary", policy.includes("dragRemovalArmed") && policy.includes("eligibleOrigin"));
check("normal drag remains non-destructive in both contexts", policy.includes("boolean eligibleOrigin = dragging") && policy.includes("return gestureActive && dragging"));
check("commit requires complete drop validation in either context", policy.includes("!gestureActive || !dragging") && policy.includes("pointerMatches") && policy.includes("generationMatches") && policy.includes("geometryInside") && policy.includes("releaseFreshnessMs"));
check("service keeps arm state separate from long-press display state", service.includes("bubbleDragRemovalArmed") && service.includes("bubbleLongPressTriggered"));
check("long press remains an independent card action", service.includes("bubbleLongPressTriggered = true;") && service.includes("openMenu();") && service.includes("postDelayed(bubbleLongPressRunnable, 520L)"));
check("first real drag shows target without long press", service.includes("if (!bubbleDragging && Math.hypot(dx, dy) >= touchSlop)") && service.includes("showBubbleRemoveTarget(bubbleActiveGestureGeneration)") && policy.includes("return gestureActive && dragging"));
check("ordinary touch does not arm removal", service.includes("bubbleDragRemovalArmed = false;") && service.includes("if (!bubbleDragging && Math.hypot(dx, dy) >= touchSlop)"));
check("the same first-drag rule applies inside and outside GTO", service.includes("boolean eligibleOrigin = bubbleDragging") && !service.includes("boolean eligibleOrigin = bubbleDragRemovalArmed") && policy.includes("boolean eligibleOrigin = dragging"));
check("drop geometry is independent of GTO foreground", service.includes("isBubbleDroppedOnRemoveTarget") && !service.includes("isCurrentBubbleGtoContext(System.currentTimeMillis()) && !bubbleDragRemovalArmed"));
check("target is hidden on gesture cancellation", service.includes("bubbleDragRemovalArmed = false;") && service.includes("hideBubbleRemoveTarget();"));
check("foreground/lifecycle disarm clears the armed gesture", service.includes("boolean wasDestructive = bubbleGestureStartedOutsideGto || bubbleDragRemovalArmed") && service.includes("bubbleDragRemovalArmed = false;"));
check("target text clearly communicates the destructive action", service.includes('target.setText("Remover e parar NVU")') && service.includes('inside ? "Solte para remover" : "Remover e parar NVU"'));
check("card contains no destructive removal action", !service.includes("stopObserverFromMenuRemoval") && !service.includes("Remover botão flutuante"));
check("only the validated floating gesture dispatches stop", service.includes("stopObserverFromFloatingBubble(releaseGeneration)") && service.includes("dispatchObserverStop(") && service.includes("setAction(ACTION_STOP)"));
check("Pause parser remains isolated", !parser.includes("dragRemovalArmed") && !parser.includes("dispatchObserverStop") && !parser.includes("Remover e parar NVU"));
check("canonical field authorities remain in the card path", service.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleOrigin(") && service.includes("GtoAcceptedFreightFieldPolicy.acceptedVisibleDestination(") && service.includes("canonicalFreight"));
check("HF135 is registered in the release gate", verifyScript.includes("test:gto-r3.34-hf135-in-gto-drag-removal"));
check("outside-GTO first drag is not gated by long press", policy.includes("boolean eligibleOrigin = dragging") && service.includes("showBubbleRemoveTarget(bubbleActiveGestureGeneration)") && !service.includes("showBubbleRemoveTarget(longPressGeneration)"));

const failed = checks.filter(item => !item.ok);
console.log(`\n${checks.length - failed.length}/${checks.length} HF135 in-GTO drag-removal checks passed.`);
if (failed.length) process.exitCode = 1;
