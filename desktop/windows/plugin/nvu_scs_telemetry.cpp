// NVU read-only SCS Telemetry SDK 1.01 plugin. Headers distributed under SCS MIT license.
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shlobj.h>
#include <objbase.h>
#include <atomic>
#include <chrono>
#include <cmath>
#include <fstream>
#include <filesystem>
#include <mutex>
#include <sstream>
#include <string>
#include <thread>
#include <vector>
#include <cstring>
#include "scssdk_telemetry.h"
#include "common/scssdk_telemetry_common_configs.h"
#include "common/scssdk_telemetry_truck_common_channels.h"
#include "common/scssdk_telemetry_common_gameplay_events.h"

namespace {
namespace fs = std::filesystem;
std::mutex guard;
std::atomic<bool> stopping{true};
std::thread worker;
scs_log_t gameLog = nullptr;
std::atomic<int> bridgeState{2};
int reportedBridgeState = -1;
fs::path directory;
std::string game, boot, job, origin, destination, fingerprint, jobState = "idle";
bool paused = true, completed = false, jobAvailable = false;
unsigned long long sequence = 0;
double remainingKm = -1, plannedKm = -1;
long long millis() { return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count(); }
std::string guid() {
  GUID value; if (FAILED(CoCreateGuid(&value))) throw std::runtime_error("guid");
  char b[37]; snprintf(b, sizeof b, "%08lx-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x", value.Data1, value.Data2, value.Data3,
    value.Data4[0], value.Data4[1], value.Data4[2], value.Data4[3], value.Data4[4], value.Data4[5], value.Data4[6], value.Data4[7]); return b;
}
bool validGuid(const std::string& s) {
  if (s.size() != 36) return false;
  for (size_t i = 0; i < s.size(); ++i) {
    if (i == 8 || i == 13 || i == 18 || i == 23) { if (s[i] != '-') return false; }
    else if (!((s[i] >= 'a' && s[i] <= 'f') || (s[i] >= '0' && s[i] <= '9'))) return false;
  }
  return true;
}
std::string quote(const std::string& s) {
  std::string out = "\"";
  for (unsigned char c : s) { if (c == '"' || c == '\\') { out += '\\'; out += c; }
    else if (c < 32) { char b[7]; snprintf(b, sizeof b, "\\u%04x", c); out += b; } else out += c; }
  return out + '"';
}
std::string token() { std::ifstream in(directory / "bridge.token"); std::string t; in >> t; return t.size() == 64 ? t : ""; }
void durable(const fs::path& to, const std::string& body) {
  const fs::path temp = to.wstring() + L".tmp";
  HANDLE f = CreateFileW(temp.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
  if (f == INVALID_HANDLE_VALUE) throw std::runtime_error("journal open");
  DWORD written = 0; bool ok = WriteFile(f, body.data(), static_cast<DWORD>(body.size()), &written, nullptr) && written == body.size();
  ok = FlushFileBuffers(f) && ok; CloseHandle(f);
  if (!ok || !MoveFileExW(temp.c_str(), to.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH)) throw std::runtime_error("journal flush");
}
const scs_value_t* value(const scs_named_value_t* list, const char* name) {
  for (auto p = list; p && p->name; ++p) if (std::strcmp(p->name, name) == 0) return &p->value;
  return nullptr;
}
std::string stringValue(const scs_named_value_t* a, const char* name) {
  auto v = value(a, name); return v && v->type == SCS_VALUE_TYPE_string && v->value_string.value ? v->value_string.value : "";
}
unsigned int uintValue(const scs_named_value_t* a, const char* name) {
  auto v = value(a, name); return v && v->type == SCS_VALUE_TYPE_u32 ? v->value_u32.value : 0;
}
std::string distanceJson(double km) { return std::isfinite(km) && km >= 0 && km <= 50000 ? std::to_string(km) : "null"; }
SCSAPI_VOID navigation(const scs_string_t, const scs_u32_t, const scs_value_t* const v, const scs_context_t) {
  std::lock_guard<std::mutex> lock(guard);
  remainingKm = v && v->type == SCS_VALUE_TYPE_float && std::isfinite(v->value_float.value) && v->value_float.value >= 0 && v->value_float.value <= 50000000 ? v->value_float.value / 1000.0 : -1;
}
void clearRoute() { origin.clear(); destination.clear(); remainingKm = plannedKm = -1; }
void pulse() {
  try {
    auto t = token(); if (t.empty()) { bridgeState = 2; return; }
    std::string body;
    {
    std::lock_guard<std::mutex> lock(guard);
    const bool active = !completed && jobAvailable && !job.empty() && jobState == "active";
    body = "{\"version\":1,\"token\":" + quote(t) + ",\"simulatorKey\":" + quote(game)
      + ",\"bootId\":" + quote(boot) + ",\"sequence\":" + std::to_string(++sequence) + ",\"at\":" + std::to_string(millis())
      + ",\"online\":" + (stopping ? "false" : "true") + ",\"paused\":" + (paused ? "true" : "false")
      + ",\"jobId\":" + quote(active ? job : "") + ",\"jobState\":" + quote(jobState)
      + ",\"pluginVersion\":\"0.1.4\",\"origin\":" + quote(active ? origin : "") + ",\"destination\":" + quote(active ? destination : "")
      + ",\"remainingDistanceKm\":" + (active ? distanceJson(remainingKm) : "null") + ",\"plannedDistanceKm\":" + (active ? distanceJson(plannedKm) : "null") + "}";
    }
    // Flush the snapshot outside the callback mutex: slow storage must not
    // hold the game thread once per heartbeat.
    durable(directory / (game + ".heartbeat.json"), body);
    bridgeState = 0;
  } catch (...) { bridgeState = 1; /* Report on a game callback; SDK APIs are not thread safe. */ }
}
SCSAPI_VOID callback(const scs_event_t event, const void* const info, const scs_context_t) {
  try {
    std::lock_guard<std::mutex> lock(guard);
    const int bridge = bridgeState.load();
    if (gameLog && bridge != reportedBridgeState) {
      gameLog(bridge == 1 ? SCS_LOG_TYPE_warning : SCS_LOG_TYPE_message,
        bridge == 1 ? "[NVU PRO 0.1.4] Local bridge write failed; check user permissions."
        : bridge == 2 ? "[NVU PRO 0.1.4] Waiting for the NVU application."
        : "[NVU PRO 0.1.4] Local telemetry bridge active.");
      reportedBridgeState = bridge;
    }
    if (event == SCS_TELEMETRY_EVENT_frame_end) return;
    if (event == SCS_TELEMETRY_EVENT_started) { paused = false; return; }
    if (event == SCS_TELEMETRY_EVENT_paused) { paused = true; return; }
    if (event == SCS_TELEMETRY_EVENT_configuration) {
      const auto c = static_cast<const scs_telemetry_configuration_t*>(info);
      if (!c || !c->id || std::strcmp(c->id, SCS_TELEMETRY_CONFIG_job)) return;
      if (!c->attributes || !c->attributes->name) { jobAvailable = false; remainingKm = plannedKm = -1; if (!completed) jobState = "idle"; return; }
      const std::string src = stringValue(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_city);
      const std::string dst = stringValue(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_city);
      const std::string fp = stringValue(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_city_id) + "|"
        + stringValue(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_city_id) + "|"
        + stringValue(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_cargo_id) + "|"
        + stringValue(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_source_company_id) + "|"
        + stringValue(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_destination_company_id) + "|"
        + std::to_string(uintValue(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_delivery_time));
      // Repeated terminal configuration must not create a second identity for
      // the same delivery. A new empty-job transition permits a new freight.
      if (completed && jobAvailable && fp == fingerprint) return;
      jobAvailable = true;
      jobState = "active";
      if (job.empty()) {
        std::ifstream in(directory / (game + ".active")); std::string oldfp, oldjob; std::getline(in, oldfp); std::getline(in, oldjob);
        if (oldfp == fp && validGuid(oldjob)) { fingerprint = oldfp; job = oldjob; }
      }
      if (completed || job.empty() || fp != fingerprint) {
        job = guid(); fingerprint = fp; completed = false; remainingKm = -1;
        durable(directory / (game + ".active"), fp + "\n" + job + "\n");
      }
      origin = src; destination = dst; const auto planned = uintValue(c->attributes, SCS_TELEMETRY_CONFIG_ATTRIBUTE_planned_distance_km); plannedKm = planned > 0 && planned <= 50000 ? planned : -1; return;
    }
    if (event != SCS_TELEMETRY_EVENT_gameplay) return;
    const auto e = static_cast<const scs_telemetry_gameplay_event_t*>(info);
    if (!e || !e->id) return;
    if (std::strcmp(e->id, SCS_TELEMETRY_GAMEPLAY_EVENT_job_cancelled) == 0) {
      completed = true; jobState = "cancelled"; clearRoute(); std::error_code ec; fs::remove(directory / (game + ".active"), ec); return;
    }
    if (std::strcmp(e->id, SCS_TELEMETRY_GAMEPLAY_EVENT_job_delivered) || completed || job.empty()) return;
    const auto revenue = value(e->attributes, SCS_TELEMETRY_GAMEPLAY_EVENT_ATTRIBUTE_revenue);
    const auto distance = value(e->attributes, SCS_TELEMETRY_GAMEPLAY_EVENT_ATTRIBUTE_distance_km);
    // SCS revenue is s64 in native whole currency units, not the offered income.
    const auto paid = revenue && revenue->type == SCS_VALUE_TYPE_s64 ? revenue->value_s64.value : -1;
    const double km = distance && distance->type == SCS_VALUE_TYPE_float ? distance->value_float.value : -1;
    const std::string amountJson = paid > 0 && paid <= 10000000 ? std::to_string(paid * 100) : "null";
    const std::string distanceJson = std::isfinite(km) && km > 0 && km <= 50000 ? std::to_string(km) : "null";
    const std::string t = token(); if (t.empty()) return;
    const std::string body = "{\"version\":1,\"token\":" + quote(t) + ",\"type\":\"job.delivered\",\"simulatorKey\":" + quote(game)
      + ",\"eventId\":" + quote(job) + ",\"capturedAt\":" + std::to_string(millis()) + ",\"origin\":" + quote(origin)
      + ",\"destination\":" + quote(destination) + ",\"amountCents\":" + amountJson
      + ",\"currency\":" + quote(game == "ets2" ? "EUR" : "USD") + ",\"distanceKm\":" + distanceJson + "}";
    durable(directory / (game + "-" + job + ".delivery.json"), body);
    completed = true; jobState = "delivered"; clearRoute(); std::error_code ec; fs::remove(directory / (game + ".active"), ec);
  } catch (...) { /* A telemetry failure must never crash the game. */ }
}
}
extern "C" __declspec(dllexport) SCSAPI_RESULT scs_telemetry_init(const scs_u32_t version, const scs_telemetry_init_params_t* const params) {
  if (version != SCS_TELEMETRY_VERSION_1_01 || !params || !stopping) return SCS_RESULT_unsupported;
  const auto p = static_cast<const scs_telemetry_init_params_v101_t*>(params);
  std::vector<scs_event_t> registered;
  try {
    if (!p->common.game_id) return SCS_RESULT_unsupported;
    gameLog = p->common.log;
    if (std::strcmp(p->common.game_id, "eut2") == 0) game = "ets2";
    else if (std::strcmp(p->common.game_id, "ats") == 0) game = "ats";
    else return SCS_RESULT_unsupported;
    PWSTR local = nullptr; if (FAILED(SHGetKnownFolderPath(FOLDERID_LocalAppData, 0, nullptr, &local))) return SCS_RESULT_generic_error;
    directory = fs::path(local) / "NVU" / "pro-telemetry"; CoTaskMemFree(local);
    fs::create_directories(directory); boot = guid(); job.clear(); fingerprint.clear(); jobState = "idle"; completed = false; jobAvailable = false; paused = true; sequence = 0; remainingKm = plannedKm = -1; bridgeState = 2; reportedBridgeState = -1;
    for (auto event : { SCS_TELEMETRY_EVENT_started, SCS_TELEMETRY_EVENT_paused, SCS_TELEMETRY_EVENT_configuration, SCS_TELEMETRY_EVENT_gameplay, SCS_TELEMETRY_EVENT_frame_end }) {
      if (p->register_for_event(event, callback, nullptr) != SCS_RESULT_ok) {
        for (auto old : registered) p->unregister_from_event(old);
        if (gameLog) gameLog(SCS_LOG_TYPE_error, "[NVU PRO 0.1.4] Required SDK event registration failed.");
        return SCS_RESULT_unsupported;
      }
      registered.push_back(event);
    }
    if (p->register_for_channel(SCS_TELEMETRY_TRUCK_CHANNEL_navigation_distance, SCS_U32_NIL, SCS_VALUE_TYPE_float,
      SCS_TELEMETRY_CHANNEL_FLAG_no_value, navigation, nullptr) != SCS_RESULT_ok && gameLog)
      gameLog(SCS_LOG_TYPE_warning, "[NVU PRO 0.1.4] Navigation distance unavailable; planned job distance remains optional.");
    stopping = false;
    worker = std::thread([] { while (!stopping) { pulse(); std::this_thread::sleep_for(std::chrono::milliseconds(1000)); } });
    if (gameLog) gameLog(SCS_LOG_TYPE_message, game == "ats" ? "[NVU PRO 0.1.4] ATS telemetry initialized." : "[NVU PRO 0.1.4] ETS2 telemetry initialized.");
    return SCS_RESULT_ok;
  } catch (...) { stopping = true; for (auto old : registered) p->unregister_from_event(old); if (gameLog) gameLog(SCS_LOG_TYPE_error, "[NVU PRO 0.1.4] Plugin initialization failed."); return SCS_RESULT_generic_error; }
}
extern "C" __declspec(dllexport) SCSAPI_VOID scs_telemetry_shutdown() {
  stopping = true; if (worker.joinable()) worker.join(); pulse();
}
