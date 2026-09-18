package com.nvu.operacional;
public final class GtoR333FlowInvariantTest {
 private static void require(boolean c,String m){if(!c)throw new AssertionError(m);}
 public static void main(String[] a){
  require(GtoDeterministicFlowPolicy.mayRepairWaitingToTrip("WAITING_FREIGHT",true,true),"locked durable freight repairs stale waiting");
  require(!GtoDeterministicFlowPolicy.mayRepairWaitingToTrip("WAITING_FREIGHT",false,true),"unlocked snapshot cannot repair");
  require(!GtoDeterministicFlowPolicy.mayRepairWaitingToTrip("WAITING_FREIGHT",true,false),"failed restore cannot repair");
  require(!GtoDeterministicFlowPolicy.mayRepairWaitingToTrip("TRIP_IN_PROGRESS",true,true),"repair is waiting-only");
  require(GtoDeterministicFlowPolicy.unknownScreenMustBeNeutral("TRIP_IN_PROGRESS"),"unknown neutral");
  require(GtoDeterministicFlowPolicy.mayInterpretResultScreen("TRIP_IN_PROGRESS"),"result valid from trip");
  System.out.println("GtoR333FlowInvariantTest: PASS");
 }}
