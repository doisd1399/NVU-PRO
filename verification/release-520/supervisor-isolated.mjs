// qa:auth
var onAuthStateChanged = () => () => {
};

// src/lib/authLifecycle.ts
var isAuthTeardownActive = () => globalThis.__supervisor520.teardown;

// src/lib/firebase.ts
var auth = { currentUser: { uid: "driver" } };
var functions = {};

// src/lib/callableRegions.ts
var CALLABLE_PRIMARY_REGION = "southamerica-east1";
var CALLABLE_FALLBACK_REGION = "us-central1";
var DUAL_REGION_CALLABLES = [
  "operationalCommand",
  "prepareCompanyOperationalCommands",
  "getOperationalQueues",
  "configureOperationalQueues",
  "registerCanonicalSimpleTrip",
  "registerGtoProReceipt",
  "completeCanonicalOperation",
  "reconcileOperationTrips",
  "syncGtoTripState",
  "ensureCompanyAccess",
  "ensureRankingParticipantOperations",
  "manageFleetMembership",
  "manageCompanyGroup",
  "manageOperationalGoal",
  "updateWorkModeAvailability",
  "readPrivateUserProfiles",
  "authenticateSeniorAccess",
  "removeDriverFromFleetSenior",
  "suspendSeniorAccount",
  "reactivateSeniorAccount",
  "deleteSeniorProfile",
  "endSeniorOperationalSuspension",
  "reverseSeniorSuspension",
  "listSeniorSuspendedMembers",
  "approveDriverRequest",
  "rejectDriverRequest",
  "approveRecruitmentApplication",
  "rejectRecruitmentApplication",
  "repairApprovedMembership",
  "createPartnershipOffer",
  "respondPartnershipOffer",
  "cancelPartnershipOffer",
  "designatePartnershipDriver",
  "settlePartnershipPayment"
];
var WARMABLE_CALLABLES = [
  "operationalCommand",
  "registerCanonicalSimpleTrip",
  "completeCanonicalOperation",
  "reconcileOperationTrips",
  "ensureCompanyAccess"
];
var dual = new Set(DUAL_REGION_CALLABLES);
var isDualRegionCallable = (name3) => dual.has(name3);

// node_modules/@firebase/util/dist/postinstall.mjs
var getDefaultsFromPostinstall = () => void 0;

// node_modules/@firebase/util/dist/node-esm/index.node.esm.js
var CONSTANTS = {
  /**
   * @define {boolean} Whether this is the client Node.js SDK.
   */
  NODE_CLIENT: false,
  /**
   * @define {boolean} Whether this is the Admin Node.js SDK.
   */
  NODE_ADMIN: false,
  /**
   * Firebase SDK Version
   */
  SDK_VERSION: "${JSCORE_VERSION}"
};
var stringToByteArray$1 = function(str) {
  const out = [];
  let p = 0;
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c < 128) {
      out[p++] = c;
    } else if (c < 2048) {
      out[p++] = c >> 6 | 192;
      out[p++] = c & 63 | 128;
    } else if ((c & 64512) === 55296 && i + 1 < str.length && (str.charCodeAt(i + 1) & 64512) === 56320) {
      c = 65536 + ((c & 1023) << 10) + (str.charCodeAt(++i) & 1023);
      out[p++] = c >> 18 | 240;
      out[p++] = c >> 12 & 63 | 128;
      out[p++] = c >> 6 & 63 | 128;
      out[p++] = c & 63 | 128;
    } else {
      out[p++] = c >> 12 | 224;
      out[p++] = c >> 6 & 63 | 128;
      out[p++] = c & 63 | 128;
    }
  }
  return out;
};
var byteArrayToString = function(bytes) {
  const out = [];
  let pos = 0, c = 0;
  while (pos < bytes.length) {
    const c1 = bytes[pos++];
    if (c1 < 128) {
      out[c++] = String.fromCharCode(c1);
    } else if (c1 > 191 && c1 < 224) {
      const c2 = bytes[pos++];
      out[c++] = String.fromCharCode((c1 & 31) << 6 | c2 & 63);
    } else if (c1 > 239 && c1 < 365) {
      const c2 = bytes[pos++];
      const c3 = bytes[pos++];
      const c4 = bytes[pos++];
      const u = ((c1 & 7) << 18 | (c2 & 63) << 12 | (c3 & 63) << 6 | c4 & 63) - 65536;
      out[c++] = String.fromCharCode(55296 + (u >> 10));
      out[c++] = String.fromCharCode(56320 + (u & 1023));
    } else {
      const c2 = bytes[pos++];
      const c3 = bytes[pos++];
      out[c++] = String.fromCharCode((c1 & 15) << 12 | (c2 & 63) << 6 | c3 & 63);
    }
  }
  return out.join("");
};
var base64 = {
  /**
   * Maps bytes to characters.
   */
  byteToCharMap_: null,
  /**
   * Maps characters to bytes.
   */
  charToByteMap_: null,
  /**
   * Maps bytes to websafe characters.
   * @private
   */
  byteToCharMapWebSafe_: null,
  /**
   * Maps websafe characters to bytes.
   * @private
   */
  charToByteMapWebSafe_: null,
  /**
   * Our default alphabet, shared between
   * ENCODED_VALS and ENCODED_VALS_WEBSAFE
   */
  ENCODED_VALS_BASE: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789",
  /**
   * Our default alphabet. Value 64 (=) is special; it means "nothing."
   */
  get ENCODED_VALS() {
    return this.ENCODED_VALS_BASE + "+/=";
  },
  /**
   * Our websafe alphabet.
   */
  get ENCODED_VALS_WEBSAFE() {
    return this.ENCODED_VALS_BASE + "-_.";
  },
  /**
   * Whether this browser supports the atob and btoa functions. This extension
   * started at Mozilla but is now implemented by many browsers. We use the
   * ASSUME_* variables to avoid pulling in the full useragent detection library
   * but still allowing the standard per-browser compilations.
   *
   */
  HAS_NATIVE_SUPPORT: typeof atob === "function",
  /**
   * Base64-encode an array of bytes.
   *
   * @param input An array of bytes (numbers with
   *     value in [0, 255]) to encode.
   * @param webSafe Boolean indicating we should use the
   *     alternative alphabet.
   * @return The base64 encoded string.
   */
  encodeByteArray(input, webSafe) {
    if (!Array.isArray(input)) {
      throw Error("encodeByteArray takes an array as a parameter");
    }
    this.init_();
    const byteToCharMap = webSafe ? this.byteToCharMapWebSafe_ : this.byteToCharMap_;
    const output = [];
    for (let i = 0; i < input.length; i += 3) {
      const byte1 = input[i];
      const haveByte2 = i + 1 < input.length;
      const byte2 = haveByte2 ? input[i + 1] : 0;
      const haveByte3 = i + 2 < input.length;
      const byte3 = haveByte3 ? input[i + 2] : 0;
      const outByte1 = byte1 >> 2;
      const outByte2 = (byte1 & 3) << 4 | byte2 >> 4;
      let outByte3 = (byte2 & 15) << 2 | byte3 >> 6;
      let outByte4 = byte3 & 63;
      if (!haveByte3) {
        outByte4 = 64;
        if (!haveByte2) {
          outByte3 = 64;
        }
      }
      output.push(byteToCharMap[outByte1], byteToCharMap[outByte2], byteToCharMap[outByte3], byteToCharMap[outByte4]);
    }
    return output.join("");
  },
  /**
   * Base64-encode a string.
   *
   * @param input A string to encode.
   * @param webSafe If true, we should use the
   *     alternative alphabet.
   * @return The base64 encoded string.
   */
  encodeString(input, webSafe) {
    if (this.HAS_NATIVE_SUPPORT && !webSafe) {
      return btoa(input);
    }
    return this.encodeByteArray(stringToByteArray$1(input), webSafe);
  },
  /**
   * Base64-decode a string.
   *
   * @param input to decode.
   * @param webSafe True if we should use the
   *     alternative alphabet.
   * @return string representing the decoded value.
   */
  decodeString(input, webSafe) {
    if (this.HAS_NATIVE_SUPPORT && !webSafe) {
      return atob(input);
    }
    return byteArrayToString(this.decodeStringToByteArray(input, webSafe));
  },
  /**
   * Base64-decode a string.
   *
   * In base-64 decoding, groups of four characters are converted into three
   * bytes.  If the encoder did not apply padding, the input length may not
   * be a multiple of 4.
   *
   * In this case, the last group will have fewer than 4 characters, and
   * padding will be inferred.  If the group has one or two characters, it decodes
   * to one byte.  If the group has three characters, it decodes to two bytes.
   *
   * @param input Input to decode.
   * @param webSafe True if we should use the web-safe alphabet.
   * @return bytes representing the decoded value.
   */
  decodeStringToByteArray(input, webSafe) {
    this.init_();
    const charToByteMap = webSafe ? this.charToByteMapWebSafe_ : this.charToByteMap_;
    const output = [];
    for (let i = 0; i < input.length; ) {
      const byte1 = charToByteMap[input.charAt(i++)];
      const haveByte2 = i < input.length;
      const byte2 = haveByte2 ? charToByteMap[input.charAt(i)] : 0;
      ++i;
      const haveByte3 = i < input.length;
      const byte3 = haveByte3 ? charToByteMap[input.charAt(i)] : 64;
      ++i;
      const haveByte4 = i < input.length;
      const byte4 = haveByte4 ? charToByteMap[input.charAt(i)] : 64;
      ++i;
      if (byte1 == null || byte2 == null || byte3 == null || byte4 == null) {
        throw new DecodeBase64StringError();
      }
      const outByte1 = byte1 << 2 | byte2 >> 4;
      output.push(outByte1);
      if (byte3 !== 64) {
        const outByte2 = byte2 << 4 & 240 | byte3 >> 2;
        output.push(outByte2);
        if (byte4 !== 64) {
          const outByte3 = byte3 << 6 & 192 | byte4;
          output.push(outByte3);
        }
      }
    }
    return output;
  },
  /**
   * Lazy static initialization function. Called before
   * accessing any of the static map variables.
   * @private
   */
  init_() {
    if (!this.byteToCharMap_) {
      this.byteToCharMap_ = {};
      this.charToByteMap_ = {};
      this.byteToCharMapWebSafe_ = {};
      this.charToByteMapWebSafe_ = {};
      for (let i = 0; i < this.ENCODED_VALS.length; i++) {
        this.byteToCharMap_[i] = this.ENCODED_VALS.charAt(i);
        this.charToByteMap_[this.byteToCharMap_[i]] = i;
        this.byteToCharMapWebSafe_[i] = this.ENCODED_VALS_WEBSAFE.charAt(i);
        this.charToByteMapWebSafe_[this.byteToCharMapWebSafe_[i]] = i;
        if (i >= this.ENCODED_VALS_BASE.length) {
          this.charToByteMap_[this.ENCODED_VALS_WEBSAFE.charAt(i)] = i;
          this.charToByteMapWebSafe_[this.ENCODED_VALS.charAt(i)] = i;
        }
      }
    }
  }
};
var DecodeBase64StringError = class extends Error {
  constructor() {
    super(...arguments);
    this.name = "DecodeBase64StringError";
  }
};
var base64Encode = function(str) {
  const utf8Bytes = stringToByteArray$1(str);
  return base64.encodeByteArray(utf8Bytes, true);
};
var base64urlEncodeWithoutPadding = function(str) {
  return base64Encode(str).replace(/\./g, "");
};
var base64Decode = function(str) {
  try {
    return base64.decodeString(str, true);
  } catch (e) {
    console.error("base64Decode failed: ", e);
  }
  return null;
};
function getGlobal() {
  if (typeof self !== "undefined") {
    return self;
  }
  if (typeof window !== "undefined") {
    return window;
  }
  if (typeof global !== "undefined") {
    return global;
  }
  throw new Error("Unable to locate global object.");
}
var getDefaultsFromGlobal = () => getGlobal().__FIREBASE_DEFAULTS__;
var getDefaultsFromEnvVariable = () => {
  if (typeof process === "undefined" || typeof process.env === "undefined") {
    return;
  }
  const defaultsJsonString = process.env.__FIREBASE_DEFAULTS__;
  if (defaultsJsonString) {
    return JSON.parse(defaultsJsonString);
  }
};
var getDefaultsFromCookie = () => {
  if (typeof document === "undefined") {
    return;
  }
  let match;
  try {
    match = document.cookie.match(/__FIREBASE_DEFAULTS__=([^;]+)/);
  } catch (e) {
    return;
  }
  const decoded = match && base64Decode(match[1]);
  return decoded && JSON.parse(decoded);
};
var getDefaults = () => {
  try {
    return getDefaultsFromPostinstall() || getDefaultsFromGlobal() || getDefaultsFromEnvVariable() || getDefaultsFromCookie();
  } catch (e) {
    console.info(`Unable to get __FIREBASE_DEFAULTS__ due to: ${e}`);
    return;
  }
};
var getDefaultEmulatorHost = (productName) => getDefaults()?.emulatorHosts?.[productName];
var getDefaultEmulatorHostnameAndPort = (productName) => {
  const host = getDefaultEmulatorHost(productName);
  if (!host) {
    return void 0;
  }
  const separatorIndex = host.lastIndexOf(":");
  if (separatorIndex <= 0 || separatorIndex + 1 === host.length) {
    throw new Error(`Invalid host ${host} with no separate hostname and port!`);
  }
  const port = parseInt(host.substring(separatorIndex + 1), 10);
  if (host[0] === "[") {
    return [host.substring(1, separatorIndex - 1), port];
  } else {
    return [host.substring(0, separatorIndex), port];
  }
};
var getDefaultAppConfig = () => getDefaults()?.config;
var Deferred = class {
  constructor() {
    this.reject = () => {
    };
    this.resolve = () => {
    };
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
  }
  /**
   * Our API internals are not promisified and cannot because our callback APIs have subtle expectations around
   * invoking promises inline, which Promises are forbidden to do. This method accepts an optional node-style callback
   * and returns a node-style callback which will resolve or reject the Deferred's promise.
   */
  wrapCallback(callback) {
    return (error, value) => {
      if (error) {
        this.reject(error);
      } else {
        this.resolve(value);
      }
      if (typeof callback === "function") {
        this.promise.catch(() => {
        });
        if (callback.length === 1) {
          callback(error);
        } else {
          callback(error, value);
        }
      }
    };
  }
};
function isIndexedDBAvailable() {
  try {
    return typeof indexedDB === "object";
  } catch (e) {
    return false;
  }
}
function validateIndexedDBOpenable() {
  return new Promise((resolve, reject) => {
    try {
      let preExist = true;
      const DB_CHECK_NAME = "validate-browser-context-for-indexeddb-analytics-module";
      const request = self.indexedDB.open(DB_CHECK_NAME);
      request.onsuccess = () => {
        request.result.close();
        if (!preExist) {
          self.indexedDB.deleteDatabase(DB_CHECK_NAME);
        }
        resolve(true);
      };
      request.onupgradeneeded = () => {
        preExist = false;
      };
      request.onerror = () => {
        reject(request.error?.message || "");
      };
    } catch (error) {
      reject(error);
    }
  });
}
var ERROR_NAME = "FirebaseError";
var FirebaseError = class _FirebaseError extends Error {
  constructor(code, message, customData) {
    super(message);
    this.code = code;
    this.customData = customData;
    this.name = ERROR_NAME;
    Object.setPrototypeOf(this, _FirebaseError.prototype);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, ErrorFactory.prototype.create);
    }
  }
};
var ErrorFactory = class {
  constructor(service, serviceName, errors) {
    this.service = service;
    this.serviceName = serviceName;
    this.errors = errors;
  }
  create(code, ...data) {
    const customData = data[0] || {};
    const fullCode = `${this.service}/${code}`;
    const template = this.errors[code];
    const message = template ? replaceTemplate(template, customData) : "Error";
    const fullMessage = `${this.serviceName}: ${message} (${fullCode}).`;
    const error = new FirebaseError(fullCode, fullMessage, customData);
    return error;
  }
};
function replaceTemplate(template, data) {
  try {
    let ptr = 0;
    let result = "";
    while (ptr < template.length) {
      const start = template.indexOf("{$", ptr);
      if (start === -1) {
        result += template.substring(ptr);
        break;
      }
      const end = template.indexOf("}", start + 2);
      if (end === -1) {
        result += template.substring(ptr);
        break;
      }
      const key = template.substring(start + 2, end);
      const value = data[key];
      result += template.substring(ptr, start) + (value != null ? String(value) : `<${key}?>`);
      ptr = end + 1;
    }
    return result;
  } catch (e) {
    return template;
  }
}
function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  for (const k of aKeys) {
    if (!bKeys.includes(k)) {
      return false;
    }
    const aProp = a[k];
    const bProp = b[k];
    if (isObject(aProp) && isObject(bProp)) {
      if (!deepEqual(aProp, bProp)) {
        return false;
      }
    } else if (aProp !== bProp) {
      return false;
    }
  }
  for (const k of bKeys) {
    if (!aKeys.includes(k)) {
      return false;
    }
  }
  return true;
}
function isObject(thing) {
  return thing !== null && typeof thing === "object";
}
var MAX_VALUE_MILLIS = 4 * 60 * 60 * 1e3;
function getModularInstance(service) {
  if (service && service._delegate) {
    return service._delegate;
  } else {
    return service;
  }
}
function isCloudWorkstation(url) {
  try {
    const host = url.startsWith("http://") || url.startsWith("https://") ? new URL(url).hostname : url;
    return host.endsWith(".cloudworkstations.dev");
  } catch {
    return false;
  }
}
async function pingServer(endpoint) {
  const result = await fetch(endpoint, {
    credentials: "include"
  });
  return result.ok;
}
CONSTANTS.NODE_CLIENT = true;

// node_modules/@firebase/component/dist/esm/index.esm.js
var Component = class {
  /**
   *
   * @param name The public service name, e.g. app, auth, firestore, database
   * @param instanceFactory Service factory responsible for creating the public interface
   * @param type whether the service provided by the component is public or private
   */
  constructor(name3, instanceFactory, type) {
    this.name = name3;
    this.instanceFactory = instanceFactory;
    this.type = type;
    this.multipleInstances = false;
    this.serviceProps = {};
    this.instantiationMode = "LAZY";
    this.onInstanceCreated = null;
  }
  setInstantiationMode(mode) {
    this.instantiationMode = mode;
    return this;
  }
  setMultipleInstances(multipleInstances) {
    this.multipleInstances = multipleInstances;
    return this;
  }
  setServiceProps(props) {
    this.serviceProps = props;
    return this;
  }
  setInstanceCreatedCallback(callback) {
    this.onInstanceCreated = callback;
    return this;
  }
};
var DEFAULT_ENTRY_NAME = "[DEFAULT]";
var Provider = class {
  constructor(name3, container) {
    this.name = name3;
    this.container = container;
    this.component = null;
    this.instances = /* @__PURE__ */ new Map();
    this.instancesDeferred = /* @__PURE__ */ new Map();
    this.instancesOptions = /* @__PURE__ */ new Map();
    this.onInitCallbacks = /* @__PURE__ */ new Map();
  }
  /**
   * @param identifier A provider can provide multiple instances of a service
   * if this.component.multipleInstances is true.
   */
  get(identifier) {
    const normalizedIdentifier = this.normalizeInstanceIdentifier(identifier);
    if (!this.instancesDeferred.has(normalizedIdentifier)) {
      const deferred = new Deferred();
      this.instancesDeferred.set(normalizedIdentifier, deferred);
      if (this.isInitialized(normalizedIdentifier) || this.shouldAutoInitialize()) {
        try {
          const instance = this.getOrInitializeService({
            instanceIdentifier: normalizedIdentifier
          });
          if (instance) {
            deferred.resolve(instance);
          }
        } catch (e) {
        }
      }
    }
    return this.instancesDeferred.get(normalizedIdentifier).promise;
  }
  getImmediate(options) {
    const normalizedIdentifier = this.normalizeInstanceIdentifier(options?.identifier);
    const optional = options?.optional ?? false;
    if (this.isInitialized(normalizedIdentifier) || this.shouldAutoInitialize()) {
      try {
        return this.getOrInitializeService({
          instanceIdentifier: normalizedIdentifier
        });
      } catch (e) {
        if (optional) {
          return null;
        } else {
          throw e;
        }
      }
    } else {
      if (optional) {
        return null;
      } else {
        throw Error(`Service ${this.name} is not available`);
      }
    }
  }
  getComponent() {
    return this.component;
  }
  setComponent(component) {
    if (component.name !== this.name) {
      throw Error(`Mismatching Component ${component.name} for Provider ${this.name}.`);
    }
    if (this.component) {
      throw Error(`Component for ${this.name} has already been provided`);
    }
    this.component = component;
    if (!this.shouldAutoInitialize()) {
      return;
    }
    if (isComponentEager(component)) {
      try {
        this.getOrInitializeService({ instanceIdentifier: DEFAULT_ENTRY_NAME });
      } catch (e) {
      }
    }
    for (const [instanceIdentifier, instanceDeferred] of this.instancesDeferred.entries()) {
      const normalizedIdentifier = this.normalizeInstanceIdentifier(instanceIdentifier);
      try {
        const instance = this.getOrInitializeService({
          instanceIdentifier: normalizedIdentifier
        });
        instanceDeferred.resolve(instance);
      } catch (e) {
      }
    }
  }
  clearInstance(identifier = DEFAULT_ENTRY_NAME) {
    this.instancesDeferred.delete(identifier);
    this.instancesOptions.delete(identifier);
    this.instances.delete(identifier);
  }
  // app.delete() will call this method on every provider to delete the services
  // TODO: should we mark the provider as deleted?
  async delete() {
    const services = Array.from(this.instances.values());
    await Promise.all([
      ...services.filter((service) => "INTERNAL" in service).map((service) => service.INTERNAL.delete()),
      ...services.filter((service) => "_delete" in service).map((service) => service._delete())
    ]);
  }
  isComponentSet() {
    return this.component != null;
  }
  isInitialized(identifier = DEFAULT_ENTRY_NAME) {
    return this.instances.has(identifier);
  }
  getOptions(identifier = DEFAULT_ENTRY_NAME) {
    return this.instancesOptions.get(identifier) || {};
  }
  initialize(opts = {}) {
    const { options = {} } = opts;
    const normalizedIdentifier = this.normalizeInstanceIdentifier(opts.instanceIdentifier);
    if (this.isInitialized(normalizedIdentifier)) {
      throw Error(`${this.name}(${normalizedIdentifier}) has already been initialized`);
    }
    if (!this.isComponentSet()) {
      throw Error(`Component ${this.name} has not been registered yet`);
    }
    const instance = this.getOrInitializeService({
      instanceIdentifier: normalizedIdentifier,
      options
    });
    for (const [instanceIdentifier, instanceDeferred] of this.instancesDeferred.entries()) {
      const normalizedDeferredIdentifier = this.normalizeInstanceIdentifier(instanceIdentifier);
      if (normalizedIdentifier === normalizedDeferredIdentifier) {
        instanceDeferred.resolve(instance);
      }
    }
    return instance;
  }
  /**
   *
   * @param callback - a function that will be invoked  after the provider has been initialized by calling provider.initialize().
   * The function is invoked SYNCHRONOUSLY, so it should not execute any longrunning tasks in order to not block the program.
   *
   * @param identifier An optional instance identifier
   * @returns a function to unregister the callback
   */
  onInit(callback, identifier) {
    const normalizedIdentifier = this.normalizeInstanceIdentifier(identifier);
    const existingCallbacks = this.onInitCallbacks.get(normalizedIdentifier) ?? /* @__PURE__ */ new Set();
    existingCallbacks.add(callback);
    this.onInitCallbacks.set(normalizedIdentifier, existingCallbacks);
    const existingInstance = this.instances.get(normalizedIdentifier);
    if (existingInstance) {
      callback(existingInstance, normalizedIdentifier);
    }
    return () => {
      existingCallbacks.delete(callback);
    };
  }
  /**
   * Invoke onInit callbacks synchronously
   * @param instance the service instance`
   */
  invokeOnInitCallbacks(instance, identifier) {
    const callbacks = this.onInitCallbacks.get(identifier);
    if (!callbacks) {
      return;
    }
    for (const callback of callbacks) {
      try {
        callback(instance, identifier);
      } catch {
      }
    }
  }
  getOrInitializeService({ instanceIdentifier, options = {} }) {
    let instance = this.instances.get(instanceIdentifier);
    if (!instance && this.component) {
      instance = this.component.instanceFactory(this.container, {
        instanceIdentifier: normalizeIdentifierForFactory(instanceIdentifier),
        options
      });
      this.instances.set(instanceIdentifier, instance);
      this.instancesOptions.set(instanceIdentifier, options);
      this.invokeOnInitCallbacks(instance, instanceIdentifier);
      if (this.component.onInstanceCreated) {
        try {
          this.component.onInstanceCreated(this.container, instanceIdentifier, instance);
        } catch {
        }
      }
    }
    return instance || null;
  }
  normalizeInstanceIdentifier(identifier = DEFAULT_ENTRY_NAME) {
    if (this.component) {
      return this.component.multipleInstances ? identifier : DEFAULT_ENTRY_NAME;
    } else {
      return identifier;
    }
  }
  shouldAutoInitialize() {
    return !!this.component && this.component.instantiationMode !== "EXPLICIT";
  }
};
function normalizeIdentifierForFactory(identifier) {
  return identifier === DEFAULT_ENTRY_NAME ? void 0 : identifier;
}
function isComponentEager(component) {
  return component.instantiationMode === "EAGER";
}
var ComponentContainer = class {
  constructor(name3) {
    this.name = name3;
    this.providers = /* @__PURE__ */ new Map();
  }
  /**
   *
   * @param component Component being added
   * @param overwrite When a component with the same name has already been registered,
   * if overwrite is true: overwrite the existing component with the new component and create a new
   * provider with the new component. It can be useful in tests where you want to use different mocks
   * for different tests.
   * if overwrite is false: throw an exception
   */
  addComponent(component) {
    const provider = this.getProvider(component.name);
    if (provider.isComponentSet()) {
      throw new Error(`Component ${component.name} has already been registered with ${this.name}`);
    }
    provider.setComponent(component);
  }
  addOrOverwriteComponent(component) {
    const provider = this.getProvider(component.name);
    if (provider.isComponentSet()) {
      this.providers.delete(component.name);
    }
    this.addComponent(component);
  }
  /**
   * getProvider provides a type safe interface where it can only be called with a field name
   * present in NameServiceMapping interface.
   *
   * Firebase SDKs providing services should extend NameServiceMapping interface to register
   * themselves.
   */
  getProvider(name3) {
    if (this.providers.has(name3)) {
      return this.providers.get(name3);
    }
    const provider = new Provider(name3, this);
    this.providers.set(name3, provider);
    return provider;
  }
  getProviders() {
    return Array.from(this.providers.values());
  }
};

// node_modules/@firebase/logger/dist/esm/index.esm.js
var instances = [];
var LogLevel;
(function(LogLevel2) {
  LogLevel2[LogLevel2["DEBUG"] = 0] = "DEBUG";
  LogLevel2[LogLevel2["VERBOSE"] = 1] = "VERBOSE";
  LogLevel2[LogLevel2["INFO"] = 2] = "INFO";
  LogLevel2[LogLevel2["WARN"] = 3] = "WARN";
  LogLevel2[LogLevel2["ERROR"] = 4] = "ERROR";
  LogLevel2[LogLevel2["SILENT"] = 5] = "SILENT";
})(LogLevel || (LogLevel = {}));
var levelStringToEnum = {
  "debug": LogLevel.DEBUG,
  "verbose": LogLevel.VERBOSE,
  "info": LogLevel.INFO,
  "warn": LogLevel.WARN,
  "error": LogLevel.ERROR,
  "silent": LogLevel.SILENT
};
var defaultLogLevel = LogLevel.INFO;
var ConsoleMethod = {
  [LogLevel.DEBUG]: "log",
  [LogLevel.VERBOSE]: "log",
  [LogLevel.INFO]: "info",
  [LogLevel.WARN]: "warn",
  [LogLevel.ERROR]: "error"
};
var defaultLogHandler = (instance, logType, ...args) => {
  if (logType < instance.logLevel) {
    return;
  }
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const method = ConsoleMethod[logType];
  if (method) {
    console[method](`[${now}]  ${instance.name}:`, ...args);
  } else {
    throw new Error(`Attempted to log a message with an invalid logType (value: ${logType})`);
  }
};
var Logger = class {
  /**
   * Gives you an instance of a Logger to capture messages according to
   * Firebase's logging scheme.
   *
   * @param name The name that the logs will be associated with
   */
  constructor(name3) {
    this.name = name3;
    this._logLevel = defaultLogLevel;
    this._logHandler = defaultLogHandler;
    this._userLogHandler = null;
    instances.push(this);
  }
  get logLevel() {
    return this._logLevel;
  }
  set logLevel(val) {
    if (!(val in LogLevel)) {
      throw new TypeError(`Invalid value "${val}" assigned to \`logLevel\``);
    }
    this._logLevel = val;
  }
  // Workaround for setter/getter having to be the same type.
  setLogLevel(val) {
    this._logLevel = typeof val === "string" ? levelStringToEnum[val] : val;
  }
  get logHandler() {
    return this._logHandler;
  }
  set logHandler(val) {
    if (typeof val !== "function") {
      throw new TypeError("Value assigned to `logHandler` must be a function");
    }
    this._logHandler = val;
  }
  get userLogHandler() {
    return this._userLogHandler;
  }
  set userLogHandler(val) {
    this._userLogHandler = val;
  }
  /**
   * The functions below are all based on the `console` interface
   */
  debug(...args) {
    this._userLogHandler && this._userLogHandler(this, LogLevel.DEBUG, ...args);
    this._logHandler(this, LogLevel.DEBUG, ...args);
  }
  log(...args) {
    this._userLogHandler && this._userLogHandler(this, LogLevel.VERBOSE, ...args);
    this._logHandler(this, LogLevel.VERBOSE, ...args);
  }
  info(...args) {
    this._userLogHandler && this._userLogHandler(this, LogLevel.INFO, ...args);
    this._logHandler(this, LogLevel.INFO, ...args);
  }
  warn(...args) {
    this._userLogHandler && this._userLogHandler(this, LogLevel.WARN, ...args);
    this._logHandler(this, LogLevel.WARN, ...args);
  }
  error(...args) {
    this._userLogHandler && this._userLogHandler(this, LogLevel.ERROR, ...args);
    this._logHandler(this, LogLevel.ERROR, ...args);
  }
};

// node_modules/idb/build/wrap-idb-value.js
var instanceOfAny = (object, constructors) => constructors.some((c) => object instanceof c);
var idbProxyableTypes;
var cursorAdvanceMethods;
function getIdbProxyableTypes() {
  return idbProxyableTypes || (idbProxyableTypes = [
    IDBDatabase,
    IDBObjectStore,
    IDBIndex,
    IDBCursor,
    IDBTransaction
  ]);
}
function getCursorAdvanceMethods() {
  return cursorAdvanceMethods || (cursorAdvanceMethods = [
    IDBCursor.prototype.advance,
    IDBCursor.prototype.continue,
    IDBCursor.prototype.continuePrimaryKey
  ]);
}
var cursorRequestMap = /* @__PURE__ */ new WeakMap();
var transactionDoneMap = /* @__PURE__ */ new WeakMap();
var transactionStoreNamesMap = /* @__PURE__ */ new WeakMap();
var transformCache = /* @__PURE__ */ new WeakMap();
var reverseTransformCache = /* @__PURE__ */ new WeakMap();
function promisifyRequest(request) {
  const promise = new Promise((resolve, reject) => {
    const unlisten = () => {
      request.removeEventListener("success", success);
      request.removeEventListener("error", error);
    };
    const success = () => {
      resolve(wrap(request.result));
      unlisten();
    };
    const error = () => {
      reject(request.error);
      unlisten();
    };
    request.addEventListener("success", success);
    request.addEventListener("error", error);
  });
  promise.then((value) => {
    if (value instanceof IDBCursor) {
      cursorRequestMap.set(value, request);
    }
  }).catch(() => {
  });
  reverseTransformCache.set(promise, request);
  return promise;
}
function cacheDonePromiseForTransaction(tx) {
  if (transactionDoneMap.has(tx))
    return;
  const done = new Promise((resolve, reject) => {
    const unlisten = () => {
      tx.removeEventListener("complete", complete);
      tx.removeEventListener("error", error);
      tx.removeEventListener("abort", error);
    };
    const complete = () => {
      resolve();
      unlisten();
    };
    const error = () => {
      reject(tx.error || new DOMException("AbortError", "AbortError"));
      unlisten();
    };
    tx.addEventListener("complete", complete);
    tx.addEventListener("error", error);
    tx.addEventListener("abort", error);
  });
  transactionDoneMap.set(tx, done);
}
var idbProxyTraps = {
  get(target, prop, receiver) {
    if (target instanceof IDBTransaction) {
      if (prop === "done")
        return transactionDoneMap.get(target);
      if (prop === "objectStoreNames") {
        return target.objectStoreNames || transactionStoreNamesMap.get(target);
      }
      if (prop === "store") {
        return receiver.objectStoreNames[1] ? void 0 : receiver.objectStore(receiver.objectStoreNames[0]);
      }
    }
    return wrap(target[prop]);
  },
  set(target, prop, value) {
    target[prop] = value;
    return true;
  },
  has(target, prop) {
    if (target instanceof IDBTransaction && (prop === "done" || prop === "store")) {
      return true;
    }
    return prop in target;
  }
};
function replaceTraps(callback) {
  idbProxyTraps = callback(idbProxyTraps);
}
function wrapFunction(func) {
  if (func === IDBDatabase.prototype.transaction && !("objectStoreNames" in IDBTransaction.prototype)) {
    return function(storeNames, ...args) {
      const tx = func.call(unwrap(this), storeNames, ...args);
      transactionStoreNamesMap.set(tx, storeNames.sort ? storeNames.sort() : [storeNames]);
      return wrap(tx);
    };
  }
  if (getCursorAdvanceMethods().includes(func)) {
    return function(...args) {
      func.apply(unwrap(this), args);
      return wrap(cursorRequestMap.get(this));
    };
  }
  return function(...args) {
    return wrap(func.apply(unwrap(this), args));
  };
}
function transformCachableValue(value) {
  if (typeof value === "function")
    return wrapFunction(value);
  if (value instanceof IDBTransaction)
    cacheDonePromiseForTransaction(value);
  if (instanceOfAny(value, getIdbProxyableTypes()))
    return new Proxy(value, idbProxyTraps);
  return value;
}
function wrap(value) {
  if (value instanceof IDBRequest)
    return promisifyRequest(value);
  if (transformCache.has(value))
    return transformCache.get(value);
  const newValue = transformCachableValue(value);
  if (newValue !== value) {
    transformCache.set(value, newValue);
    reverseTransformCache.set(newValue, value);
  }
  return newValue;
}
var unwrap = (value) => reverseTransformCache.get(value);

// node_modules/idb/build/index.js
function openDB(name3, version2, { blocked, upgrade, blocking, terminated } = {}) {
  const request = indexedDB.open(name3, version2);
  const openPromise = wrap(request);
  if (upgrade) {
    request.addEventListener("upgradeneeded", (event) => {
      upgrade(wrap(request.result), event.oldVersion, event.newVersion, wrap(request.transaction), event);
    });
  }
  if (blocked) {
    request.addEventListener("blocked", (event) => blocked(
      // Casting due to https://github.com/microsoft/TypeScript-DOM-lib-generator/pull/1405
      event.oldVersion,
      event.newVersion,
      event
    ));
  }
  openPromise.then((db) => {
    if (terminated)
      db.addEventListener("close", () => terminated());
    if (blocking) {
      db.addEventListener("versionchange", (event) => blocking(event.oldVersion, event.newVersion, event));
    }
  }).catch(() => {
  });
  return openPromise;
}
var readMethods = ["get", "getKey", "getAll", "getAllKeys", "count"];
var writeMethods = ["put", "add", "delete", "clear"];
var cachedMethods = /* @__PURE__ */ new Map();
function getMethod(target, prop) {
  if (!(target instanceof IDBDatabase && !(prop in target) && typeof prop === "string")) {
    return;
  }
  if (cachedMethods.get(prop))
    return cachedMethods.get(prop);
  const targetFuncName = prop.replace(/FromIndex$/, "");
  const useIndex = prop !== targetFuncName;
  const isWrite = writeMethods.includes(targetFuncName);
  if (
    // Bail if the target doesn't exist on the target. Eg, getAll isn't in Edge.
    !(targetFuncName in (useIndex ? IDBIndex : IDBObjectStore).prototype) || !(isWrite || readMethods.includes(targetFuncName))
  ) {
    return;
  }
  const method = async function(storeName, ...args) {
    const tx = this.transaction(storeName, isWrite ? "readwrite" : "readonly");
    let target2 = tx.store;
    if (useIndex)
      target2 = target2.index(args.shift());
    return (await Promise.all([
      target2[targetFuncName](...args),
      isWrite && tx.done
    ]))[0];
  };
  cachedMethods.set(prop, method);
  return method;
}
replaceTraps((oldTraps) => ({
  ...oldTraps,
  get: (target, prop, receiver) => getMethod(target, prop) || oldTraps.get(target, prop, receiver),
  has: (target, prop) => !!getMethod(target, prop) || oldTraps.has(target, prop)
}));

// node_modules/@firebase/app/dist/esm/index.esm.js
var PlatformLoggerServiceImpl = class {
  constructor(container) {
    this.container = container;
  }
  // In initial implementation, this will be called by installations on
  // auth token refresh, and installations will send this string.
  getPlatformInfoString() {
    const providers = this.container.getProviders();
    return providers.map((provider) => {
      if (isVersionServiceProvider(provider)) {
        const service = provider.getImmediate();
        return `${service.library}/${service.version}`;
      } else {
        return null;
      }
    }).filter((logString) => logString).join(" ");
  }
};
function isVersionServiceProvider(provider) {
  const component = provider.getComponent();
  return component?.type === "VERSION";
}
var name$q = "@firebase/app";
var version$1 = "0.16.2";
var logger = new Logger("@firebase/app");
var name$p = "@firebase/app-compat";
var name$o = "@firebase/analytics-compat";
var name$n = "@firebase/analytics";
var name$m = "@firebase/app-check-compat";
var name$l = "@firebase/app-check";
var name$k = "@firebase/auth";
var name$j = "@firebase/auth-compat";
var name$i = "@firebase/database";
var name$h = "@firebase/data-connect";
var name$g = "@firebase/database-compat";
var name$f = "@firebase/functions";
var name$e = "@firebase/functions-compat";
var name$d = "@firebase/installations";
var name$c = "@firebase/installations-compat";
var name$b = "@firebase/messaging";
var name$a = "@firebase/messaging-compat";
var name$9 = "@firebase/performance";
var name$8 = "@firebase/performance-compat";
var name$7 = "@firebase/remote-config";
var name$6 = "@firebase/remote-config-compat";
var name$5 = "@firebase/storage";
var name$4 = "@firebase/storage-compat";
var name$3 = "@firebase/firestore";
var name$2 = "@firebase/ai";
var name$1 = "@firebase/firestore-compat";
var name = "firebase";
var DEFAULT_ENTRY_NAME2 = "[DEFAULT]";
var PLATFORM_LOG_STRING = {
  [name$q]: "fire-core",
  [name$p]: "fire-core-compat",
  [name$n]: "fire-analytics",
  [name$o]: "fire-analytics-compat",
  [name$l]: "fire-app-check",
  [name$m]: "fire-app-check-compat",
  [name$k]: "fire-auth",
  [name$j]: "fire-auth-compat",
  [name$i]: "fire-rtdb",
  [name$h]: "fire-data-connect",
  [name$g]: "fire-rtdb-compat",
  [name$f]: "fire-fn",
  [name$e]: "fire-fn-compat",
  [name$d]: "fire-iid",
  [name$c]: "fire-iid-compat",
  [name$b]: "fire-fcm",
  [name$a]: "fire-fcm-compat",
  [name$9]: "fire-perf",
  [name$8]: "fire-perf-compat",
  [name$7]: "fire-rc",
  [name$6]: "fire-rc-compat",
  [name$5]: "fire-gcs",
  [name$4]: "fire-gcs-compat",
  [name$3]: "fire-fst",
  [name$1]: "fire-fst-compat",
  [name$2]: "fire-vertex",
  "fire-js": "fire-js",
  // Platform identifier for JS SDK.
  [name]: "fire-js-all"
};
var _apps = /* @__PURE__ */ new Map();
var _serverApps = /* @__PURE__ */ new Map();
var _components = /* @__PURE__ */ new Map();
function _addComponent(app, component) {
  try {
    app.container.addComponent(component);
  } catch (e) {
    logger.debug(`Component ${component.name} failed to register with FirebaseApp ${app.name}`, e);
  }
}
function _registerComponent(component) {
  const componentName = component.name;
  if (_components.has(componentName)) {
    logger.debug(`There were multiple attempts to register component ${componentName}.`);
    return false;
  }
  _components.set(componentName, component);
  for (const app of _apps.values()) {
    _addComponent(app, component);
  }
  for (const serverApp of _serverApps.values()) {
    _addComponent(serverApp, component);
  }
  return true;
}
function _getProvider(app, name3) {
  const heartbeatController = app.container.getProvider("heartbeat").getImmediate({ optional: true });
  if (heartbeatController) {
    void heartbeatController.triggerHeartbeat();
  }
  return app.container.getProvider(name3);
}
function _isFirebaseServerApp(obj) {
  if (obj === null || obj === void 0) {
    return false;
  }
  return obj.settings !== void 0;
}
var ERRORS = {
  [
    "no-app"
    /* AppError.NO_APP */
  ]: "No Firebase App '{$appName}' has been created - call initializeApp() first",
  [
    "bad-app-name"
    /* AppError.BAD_APP_NAME */
  ]: "Illegal App name: '{$appName}'",
  [
    "duplicate-app"
    /* AppError.DUPLICATE_APP */
  ]: "Firebase App named '{$appName}' already exists with different {$mismatchedParam}. Existing: '{$oldValue}'. New: '{$newValue}'.",
  [
    "app-deleted"
    /* AppError.APP_DELETED */
  ]: "Firebase App named '{$appName}' already deleted",
  [
    "server-app-deleted"
    /* AppError.SERVER_APP_DELETED */
  ]: "Firebase Server App has been deleted",
  [
    "no-options"
    /* AppError.NO_OPTIONS */
  ]: "Need to provide options, when not being deployed to hosting via source.",
  [
    "invalid-app-argument"
    /* AppError.INVALID_APP_ARGUMENT */
  ]: "firebase.{$appName}() takes either no argument or a Firebase App instance.",
  [
    "invalid-log-argument"
    /* AppError.INVALID_LOG_ARGUMENT */
  ]: "First argument to `onLog` must be null or a function.",
  [
    "idb-open"
    /* AppError.IDB_OPEN */
  ]: "Error thrown when opening IndexedDB. Original error: {$originalErrorMessage}.",
  [
    "idb-get"
    /* AppError.IDB_GET */
  ]: "Error thrown when reading from IndexedDB. Original error: {$originalErrorMessage}.",
  [
    "idb-set"
    /* AppError.IDB_WRITE */
  ]: "Error thrown when writing to IndexedDB. Original error: {$originalErrorMessage}.",
  [
    "idb-delete"
    /* AppError.IDB_DELETE */
  ]: "Error thrown when deleting from IndexedDB. Original error: {$originalErrorMessage}.",
  [
    "finalization-registry-not-supported"
    /* AppError.FINALIZATION_REGISTRY_NOT_SUPPORTED */
  ]: "FirebaseServerApp deleteOnDeref field defined but the JS runtime does not support FinalizationRegistry.",
  [
    "invalid-server-app-environment"
    /* AppError.INVALID_SERVER_APP_ENVIRONMENT */
  ]: "FirebaseServerApp is not for use in browser environments."
};
var ERROR_FACTORY = new ErrorFactory("app", "Firebase", ERRORS);
var FirebaseAppImpl = class {
  constructor(options, config, container) {
    this._isDeleted = false;
    this._options = { ...options };
    this._config = { ...config };
    this._name = config.name;
    this._automaticDataCollectionEnabled = config.automaticDataCollectionEnabled;
    this._container = container;
    this.container.addComponent(new Component(
      "app",
      () => this,
      "PUBLIC"
      /* ComponentType.PUBLIC */
    ));
  }
  get automaticDataCollectionEnabled() {
    this.checkDestroyed();
    return this._automaticDataCollectionEnabled;
  }
  set automaticDataCollectionEnabled(val) {
    this.checkDestroyed();
    this._automaticDataCollectionEnabled = val;
  }
  get name() {
    this.checkDestroyed();
    return this._name;
  }
  get options() {
    this.checkDestroyed();
    return this._options;
  }
  get config() {
    this.checkDestroyed();
    return this._config;
  }
  get container() {
    return this._container;
  }
  get isDeleted() {
    return this._isDeleted;
  }
  set isDeleted(val) {
    this._isDeleted = val;
  }
  /**
   * This function will throw an Error if the App has already been deleted -
   * use before performing API actions on the App.
   */
  checkDestroyed() {
    if (this.isDeleted) {
      throw ERROR_FACTORY.create("app-deleted", { appName: this._name });
    }
  }
};
function initializeApp(_options, rawConfig = {}) {
  let options = _options;
  if (typeof rawConfig !== "object") {
    const name4 = rawConfig;
    rawConfig = { name: name4 };
  }
  const config = {
    name: DEFAULT_ENTRY_NAME2,
    automaticDataCollectionEnabled: true,
    ...rawConfig
  };
  const name3 = config.name;
  if (typeof name3 !== "string" || !name3) {
    throw ERROR_FACTORY.create("bad-app-name", {
      appName: String(name3)
    });
  }
  options || (options = getDefaultAppConfig());
  if (!options) {
    throw ERROR_FACTORY.create(
      "no-options"
      /* AppError.NO_OPTIONS */
    );
  }
  const existingApp = _apps.get(name3);
  if (existingApp) {
    if (!deepEqual(options, existingApp.options)) {
      throw ERROR_FACTORY.create("duplicate-app", {
        appName: name3,
        mismatchedParam: "options",
        oldValue: JSON.stringify(existingApp.options),
        newValue: JSON.stringify(options)
      });
    } else if (!deepEqual(config, existingApp.config)) {
      throw ERROR_FACTORY.create("duplicate-app", {
        appName: name3,
        mismatchedParam: "config",
        oldValue: JSON.stringify(existingApp.config),
        newValue: JSON.stringify(config)
      });
    } else {
      return existingApp;
    }
  }
  const container = new ComponentContainer(name3);
  for (const component of _components.values()) {
    container.addComponent(component);
  }
  const newApp = new FirebaseAppImpl(options, config, container);
  _apps.set(name3, newApp);
  return newApp;
}
function getApp(name3 = DEFAULT_ENTRY_NAME2) {
  const app = _apps.get(name3);
  if (!app && name3 === DEFAULT_ENTRY_NAME2 && getDefaultAppConfig()) {
    return initializeApp();
  }
  if (!app) {
    throw ERROR_FACTORY.create("no-app", { appName: name3 });
  }
  return app;
}
function registerVersion(libraryKeyOrName, version2, variant) {
  let library = PLATFORM_LOG_STRING[libraryKeyOrName] ?? libraryKeyOrName;
  if (variant) {
    library += `-${variant}`;
  }
  const libraryMismatch = library.match(/\s|\//);
  const versionMismatch = version2.match(/\s|\//);
  if (libraryMismatch || versionMismatch) {
    const warning = [
      `Unable to register library "${library}" with version "${version2}":`
    ];
    if (libraryMismatch) {
      warning.push(`library name "${library}" contains illegal characters (whitespace or "/")`);
    }
    if (libraryMismatch && versionMismatch) {
      warning.push("and");
    }
    if (versionMismatch) {
      warning.push(`version name "${version2}" contains illegal characters (whitespace or "/")`);
    }
    logger.warn(warning.join(" "));
    return;
  }
  _registerComponent(new Component(
    `${library}-version`,
    () => ({ library, version: version2 }),
    "VERSION"
    /* ComponentType.VERSION */
  ));
}
var DB_NAME = "firebase-heartbeat-database";
var DB_VERSION = 1;
var STORE_NAME = "firebase-heartbeat-store";
var dbPromise = null;
function getDbPromise() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade: (db, oldVersion) => {
        switch (oldVersion) {
          case 0:
            try {
              db.createObjectStore(STORE_NAME);
            } catch (e) {
              console.warn(e);
            }
        }
      }
    }).catch((e) => {
      throw ERROR_FACTORY.create("idb-open", {
        originalErrorMessage: e.message
      });
    });
  }
  return dbPromise;
}
async function readHeartbeatsFromIndexedDB(app) {
  try {
    const db = await getDbPromise();
    const tx = db.transaction(STORE_NAME);
    const result = await tx.objectStore(STORE_NAME).get(computeKey(app));
    await tx.done;
    return result;
  } catch (e) {
    if (e instanceof FirebaseError) {
      logger.warn(e.message);
    } else {
      const idbGetError = ERROR_FACTORY.create("idb-get", {
        originalErrorMessage: e?.message
      });
      logger.warn(idbGetError.message);
    }
  }
}
async function writeHeartbeatsToIndexedDB(app, heartbeatObject) {
  try {
    const db = await getDbPromise();
    const tx = db.transaction(STORE_NAME, "readwrite");
    const objectStore = tx.objectStore(STORE_NAME);
    await objectStore.put(heartbeatObject, computeKey(app));
    await tx.done;
  } catch (e) {
    if (e instanceof FirebaseError) {
      logger.warn(e.message);
    } else {
      const idbGetError = ERROR_FACTORY.create("idb-set", {
        originalErrorMessage: e?.message
      });
      logger.warn(idbGetError.message);
    }
  }
}
function computeKey(app) {
  return `${app.name}!${app.options.appId}`;
}
var MAX_HEADER_BYTES = 1024;
var MAX_NUM_STORED_HEARTBEATS = 30;
var HeartbeatServiceImpl = class {
  constructor(container) {
    this.container = container;
    this._heartbeatsCache = null;
    const app = this.container.getProvider("app").getImmediate();
    this._storage = new HeartbeatStorageImpl(app);
    this._heartbeatsCachePromise = this._storage.read().then((result) => {
      this._heartbeatsCache = result;
      return result;
    });
  }
  /**
   * Called to report a heartbeat. The function will generate
   * a HeartbeatsByUserAgent object, update heartbeatsCache, and persist it
   * to IndexedDB.
   * Note that we only store one heartbeat per day. So if a heartbeat for today is
   * already logged, subsequent calls to this function in the same day will be ignored.
   */
  async triggerHeartbeat() {
    try {
      const platformLogger = this.container.getProvider("platform-logger").getImmediate();
      const agent = platformLogger.getPlatformInfoString();
      const date = getUTCDateString();
      if (this._heartbeatsCache?.heartbeats == null) {
        this._heartbeatsCache = await this._heartbeatsCachePromise;
        if (this._heartbeatsCache?.heartbeats == null) {
          return;
        }
      }
      if (this._heartbeatsCache.lastSentHeartbeatDate === date || this._heartbeatsCache.heartbeats.some((singleDateHeartbeat) => singleDateHeartbeat.date === date)) {
        return;
      } else {
        this._heartbeatsCache.heartbeats.push({ date, agent });
        if (this._heartbeatsCache.heartbeats.length > MAX_NUM_STORED_HEARTBEATS) {
          const earliestHeartbeatIdx = getEarliestHeartbeatIdx(this._heartbeatsCache.heartbeats);
          this._heartbeatsCache.heartbeats.splice(earliestHeartbeatIdx, 1);
        }
      }
      return this._storage.overwrite(this._heartbeatsCache);
    } catch (e) {
      logger.warn(e);
    }
  }
  /**
   * Returns a base64 encoded string which can be attached to the heartbeat-specific header directly.
   * It also clears all heartbeats from memory as well as in IndexedDB.
   *
   * NOTE: Consuming product SDKs should not send the header if this method
   * returns an empty string.
   */
  async getHeartbeatsHeader() {
    try {
      if (this._heartbeatsCache === null) {
        await this._heartbeatsCachePromise;
      }
      if (this._heartbeatsCache?.heartbeats == null || this._heartbeatsCache.heartbeats.length === 0) {
        return "";
      }
      const date = getUTCDateString();
      const { heartbeatsToSend, unsentEntries } = extractHeartbeatsForHeader(this._heartbeatsCache.heartbeats);
      const headerString = base64urlEncodeWithoutPadding(JSON.stringify({ version: 2, heartbeats: heartbeatsToSend }));
      this._heartbeatsCache.lastSentHeartbeatDate = date;
      if (unsentEntries.length > 0) {
        this._heartbeatsCache.heartbeats = unsentEntries;
        await this._storage.overwrite(this._heartbeatsCache);
      } else {
        this._heartbeatsCache.heartbeats = [];
        void this._storage.overwrite(this._heartbeatsCache);
      }
      return headerString;
    } catch (e) {
      logger.warn(e);
      return "";
    }
  }
};
function getUTCDateString() {
  const today = /* @__PURE__ */ new Date();
  return today.toISOString().substring(0, 10);
}
function extractHeartbeatsForHeader(heartbeatsCache, maxSize = MAX_HEADER_BYTES) {
  const heartbeatsToSend = [];
  let unsentEntries = heartbeatsCache.slice();
  for (const singleDateHeartbeat of heartbeatsCache) {
    const heartbeatEntry = heartbeatsToSend.find((hb) => hb.agent === singleDateHeartbeat.agent);
    if (!heartbeatEntry) {
      heartbeatsToSend.push({
        agent: singleDateHeartbeat.agent,
        dates: [singleDateHeartbeat.date]
      });
      if (countBytes(heartbeatsToSend) > maxSize) {
        heartbeatsToSend.pop();
        break;
      }
    } else {
      heartbeatEntry.dates.push(singleDateHeartbeat.date);
      if (countBytes(heartbeatsToSend) > maxSize) {
        heartbeatEntry.dates.pop();
        break;
      }
    }
    unsentEntries = unsentEntries.slice(1);
  }
  return {
    heartbeatsToSend,
    unsentEntries
  };
}
var HeartbeatStorageImpl = class {
  constructor(app) {
    this.app = app;
    this._canUseIndexedDBPromise = this.runIndexedDBEnvironmentCheck();
  }
  async runIndexedDBEnvironmentCheck() {
    if (!isIndexedDBAvailable()) {
      return false;
    } else {
      return validateIndexedDBOpenable().then(() => true).catch(() => false);
    }
  }
  /**
   * Read all heartbeats.
   */
  async read() {
    const canUseIndexedDB = await this._canUseIndexedDBPromise;
    if (!canUseIndexedDB) {
      return { heartbeats: [] };
    } else {
      const idbHeartbeatObject = await readHeartbeatsFromIndexedDB(this.app);
      if (idbHeartbeatObject?.heartbeats) {
        return idbHeartbeatObject;
      } else {
        return { heartbeats: [] };
      }
    }
  }
  // overwrite the storage with the provided heartbeats
  async overwrite(heartbeatsObject) {
    const canUseIndexedDB = await this._canUseIndexedDBPromise;
    if (!canUseIndexedDB) {
      return;
    } else {
      const existingHeartbeatsObject = await this.read();
      return writeHeartbeatsToIndexedDB(this.app, {
        lastSentHeartbeatDate: heartbeatsObject.lastSentHeartbeatDate ?? existingHeartbeatsObject.lastSentHeartbeatDate,
        heartbeats: heartbeatsObject.heartbeats
      });
    }
  }
  // add heartbeats
  async add(heartbeatsObject) {
    const canUseIndexedDB = await this._canUseIndexedDBPromise;
    if (!canUseIndexedDB) {
      return;
    } else {
      const existingHeartbeatsObject = await this.read();
      return writeHeartbeatsToIndexedDB(this.app, {
        lastSentHeartbeatDate: heartbeatsObject.lastSentHeartbeatDate ?? existingHeartbeatsObject.lastSentHeartbeatDate,
        heartbeats: [
          ...existingHeartbeatsObject.heartbeats,
          ...heartbeatsObject.heartbeats
        ]
      });
    }
  }
};
function countBytes(heartbeatsCache) {
  return base64urlEncodeWithoutPadding(
    // heartbeatsCache wrapper properties
    JSON.stringify({ version: 2, heartbeats: heartbeatsCache })
  ).length;
}
function getEarliestHeartbeatIdx(heartbeats) {
  if (heartbeats.length === 0) {
    return -1;
  }
  let earliestHeartbeatIdx = 0;
  let earliestHeartbeatDate = heartbeats[0].date;
  for (let i = 1; i < heartbeats.length; i++) {
    if (heartbeats[i].date < earliestHeartbeatDate) {
      earliestHeartbeatDate = heartbeats[i].date;
      earliestHeartbeatIdx = i;
    }
  }
  return earliestHeartbeatIdx;
}
function registerCoreComponents(variant) {
  _registerComponent(new Component(
    "platform-logger",
    (container) => new PlatformLoggerServiceImpl(container),
    "PRIVATE"
    /* ComponentType.PRIVATE */
  ));
  _registerComponent(new Component(
    "heartbeat",
    (container) => new HeartbeatServiceImpl(container),
    "PRIVATE"
    /* ComponentType.PRIVATE */
  ));
  registerVersion(name$q, version$1, variant);
  registerVersion(name$q, version$1, "esm2020");
  registerVersion("fire-js", "");
}
registerCoreComponents("");

// node_modules/@firebase/functions/dist/esm/index.esm.js
var LONG_TYPE = "type.googleapis.com/google.protobuf.Int64Value";
var UNSIGNED_LONG_TYPE = "type.googleapis.com/google.protobuf.UInt64Value";
function mapValues(o, f) {
  const result = {};
  for (const key in o) {
    if (o.hasOwnProperty(key)) {
      result[key] = f(o[key]);
    }
  }
  return result;
}
function encode(data) {
  if (data == null) {
    return null;
  }
  if (data instanceof Number) {
    data = data.valueOf();
  }
  if (typeof data === "number" && isFinite(data)) {
    return data;
  }
  if (data === true || data === false) {
    return data;
  }
  if (Object.prototype.toString.call(data) === "[object String]") {
    return data;
  }
  if (data instanceof Date) {
    return data.toISOString();
  }
  if (Array.isArray(data)) {
    return data.map((x) => encode(x));
  }
  if (typeof data === "function" || typeof data === "object") {
    return mapValues(data, (x) => encode(x));
  }
  throw new Error("Data cannot be encoded in JSON: " + data);
}
function decode(json) {
  if (json == null) {
    return json;
  }
  if (json["@type"]) {
    switch (json["@type"]) {
      case LONG_TYPE:
      // Fall through and handle this the same as unsigned.
      case UNSIGNED_LONG_TYPE: {
        const value = Number(json["value"]);
        if (isNaN(value)) {
          throw new Error("Data cannot be decoded from JSON: " + json);
        }
        return value;
      }
      default: {
        throw new Error("Data cannot be decoded from JSON: " + json);
      }
    }
  }
  if (Array.isArray(json)) {
    return json.map((x) => decode(x));
  }
  if (typeof json === "function" || typeof json === "object") {
    return mapValues(json, (x) => decode(x));
  }
  return json;
}
var FUNCTIONS_TYPE = "functions";
var errorCodeMap = {
  OK: "ok",
  CANCELLED: "cancelled",
  UNKNOWN: "unknown",
  INVALID_ARGUMENT: "invalid-argument",
  DEADLINE_EXCEEDED: "deadline-exceeded",
  NOT_FOUND: "not-found",
  ALREADY_EXISTS: "already-exists",
  PERMISSION_DENIED: "permission-denied",
  UNAUTHENTICATED: "unauthenticated",
  RESOURCE_EXHAUSTED: "resource-exhausted",
  FAILED_PRECONDITION: "failed-precondition",
  ABORTED: "aborted",
  OUT_OF_RANGE: "out-of-range",
  UNIMPLEMENTED: "unimplemented",
  INTERNAL: "internal",
  UNAVAILABLE: "unavailable",
  DATA_LOSS: "data-loss"
};
var FunctionsError = class _FunctionsError extends FirebaseError {
  /**
   * Constructs a new instance of the `FunctionsError` class.
   */
  constructor(code, message, details, url) {
    super(`${FUNCTIONS_TYPE}/${code}`, message || "", url != null ? { url } : void 0);
    this.details = details;
    Object.setPrototypeOf(this, _FunctionsError.prototype);
  }
};
function codeForHTTPStatus(status) {
  if (status >= 200 && status < 300) {
    return "ok";
  }
  switch (status) {
    case 0:
      return "internal";
    case 400:
      return "invalid-argument";
    case 401:
      return "unauthenticated";
    case 403:
      return "permission-denied";
    case 404:
      return "not-found";
    case 409:
      return "aborted";
    case 429:
      return "resource-exhausted";
    case 499:
      return "cancelled";
    case 500:
      return "internal";
    case 501:
      return "unimplemented";
    case 503:
      return "unavailable";
    case 504:
      return "deadline-exceeded";
  }
  return "unknown";
}
function _errorForResponse(httpStatus, bodyJSON, url) {
  let code = codeForHTTPStatus(httpStatus);
  let description = code;
  let details = void 0;
  try {
    const errorJSON = bodyJSON && bodyJSON.error;
    if (errorJSON) {
      const statusText = errorJSON.status;
      if (typeof statusText === "string") {
        if (!errorCodeMap[statusText]) {
          return new FunctionsError("internal", `Unknown backend error status: ${statusText} [${httpStatus}]`, void 0, url);
        }
        code = errorCodeMap[statusText];
        description = `Backend error status: ${statusText}`;
      }
      const message = errorJSON.message;
      if (typeof message === "string") {
        description = message;
      }
      details = errorJSON.details;
      if (details !== void 0) {
        details = decode(details);
      }
    }
  } catch (e) {
  }
  if (code === "ok") {
    return null;
  }
  return new FunctionsError(code, `${description} [${httpStatus}]`, details, url);
}
var ContextProvider = class {
  constructor(app, authProvider, messagingProvider, appCheckProvider) {
    this.app = app;
    this.auth = null;
    this.messaging = null;
    this.appCheck = null;
    this.serverAppAppCheckToken = null;
    if (_isFirebaseServerApp(app) && app.settings.appCheckToken) {
      this.serverAppAppCheckToken = app.settings.appCheckToken;
    }
    this.auth = authProvider.getImmediate({ optional: true });
    this.messaging = messagingProvider.getImmediate({
      optional: true
    });
    if (!this.auth) {
      authProvider.get().then((auth2) => this.auth = auth2, () => {
      });
    }
    if (!this.messaging) {
      messagingProvider.get().then((messaging) => this.messaging = messaging, () => {
      });
    }
    if (!this.appCheck) {
      appCheckProvider?.get().then((appCheck) => this.appCheck = appCheck, () => {
      });
    }
  }
  async getAuthToken() {
    if (!this.auth) {
      return void 0;
    }
    try {
      const token = await this.auth.getToken();
      return token?.accessToken;
    } catch (e) {
      return void 0;
    }
  }
  async getMessagingToken() {
    if (!this.messaging || !("Notification" in self) || Notification.permission !== "granted") {
      return void 0;
    }
    try {
      return await this.messaging.getToken();
    } catch (e) {
      return void 0;
    }
  }
  async getAppCheckToken(limitedUseAppCheckTokens) {
    if (this.serverAppAppCheckToken) {
      return this.serverAppAppCheckToken;
    }
    if (this.appCheck) {
      const result = limitedUseAppCheckTokens ? await this.appCheck.getLimitedUseToken() : await this.appCheck.getToken();
      if (result.error) {
        return null;
      }
      return result.token;
    }
    return null;
  }
  async getContext(limitedUseAppCheckTokens) {
    const authToken = await this.getAuthToken();
    const messagingToken = await this.getMessagingToken();
    const appCheckToken = await this.getAppCheckToken(limitedUseAppCheckTokens);
    return { authToken, messagingToken, appCheckToken };
  }
};
var DEFAULT_REGION = "us-central1";
var responseLineRE = /^data: (.*?)(?:\n|$)/;
function failAfter(millis) {
  let timer = null;
  return {
    promise: new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new FunctionsError("deadline-exceeded", "deadline-exceeded"));
      }, millis);
    }),
    cancel: () => {
      if (timer) {
        clearTimeout(timer);
      }
    }
  };
}
var FunctionsService = class {
  /**
   * Creates a new Functions service for the given app.
   * @param app - The FirebaseApp to use.
   */
  constructor(app, authProvider, messagingProvider, appCheckProvider, regionOrCustomDomain = DEFAULT_REGION, fetchImpl = (...args) => fetch(...args)) {
    this.app = app;
    this.fetchImpl = fetchImpl;
    this.emulatorOrigin = null;
    this.contextProvider = new ContextProvider(app, authProvider, messagingProvider, appCheckProvider);
    this.cancelAllRequests = new Promise((resolve) => {
      this.deleteService = () => {
        return Promise.resolve(resolve());
      };
    });
    try {
      const url = new URL(regionOrCustomDomain);
      this.customDomain = url.origin + (url.pathname === "/" ? "" : url.pathname);
      this.region = DEFAULT_REGION;
    } catch (e) {
      this.customDomain = null;
      this.region = regionOrCustomDomain;
    }
  }
  _delete() {
    return this.deleteService();
  }
  /**
   * Returns the URL for a callable with the given name.
   * @param name - The name of the callable.
   * @internal
   */
  _url(name3) {
    const projectId = this.app.options.projectId;
    if (this.emulatorOrigin !== null) {
      const origin = this.emulatorOrigin;
      return `${origin}/${projectId}/${this.region}/${name3}`;
    }
    if (this.customDomain !== null) {
      return `${this.customDomain}/${name3}`;
    }
    return `https://${this.region}-${projectId}.cloudfunctions.net/${name3}`;
  }
};
function connectFunctionsEmulator$1(functionsInstance, host, port) {
  const useSsl = isCloudWorkstation(host);
  functionsInstance.emulatorOrigin = `http${useSsl ? "s" : ""}://${host}:${port}`;
  if (useSsl) {
    void pingServer(functionsInstance.emulatorOrigin + "/backends");
  }
}
function httpsCallable$1(functionsInstance, name3, options) {
  const callable = (data) => {
    return call(functionsInstance, name3, data, options || {});
  };
  callable.stream = (data, options2) => {
    return stream(functionsInstance, name3, data, options2);
  };
  return callable;
}
function getCredentials(functionsInstance) {
  return functionsInstance.emulatorOrigin && isCloudWorkstation(functionsInstance.emulatorOrigin) ? "include" : void 0;
}
async function postJSON(url, body, headers, fetchImpl, functionsInstance) {
  headers["Content-Type"] = "application/json";
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers,
      credentials: getCredentials(functionsInstance)
    });
  } catch (e) {
    return {
      status: 0,
      json: null
    };
  }
  let json = null;
  try {
    json = await response.json();
  } catch (e) {
  }
  return {
    status: response.status,
    json
  };
}
async function makeAuthHeaders(functionsInstance, options) {
  const headers = {};
  const context = await functionsInstance.contextProvider.getContext(options.limitedUseAppCheckTokens);
  if (context.authToken) {
    headers["Authorization"] = "Bearer " + context.authToken;
  }
  if (context.messagingToken) {
    headers["Firebase-Instance-ID-Token"] = context.messagingToken;
  }
  if (context.appCheckToken !== null) {
    headers["X-Firebase-AppCheck"] = context.appCheckToken;
  }
  return headers;
}
function call(functionsInstance, name3, data, options) {
  const url = functionsInstance._url(name3);
  return callAtURL(functionsInstance, url, data, options);
}
async function callAtURL(functionsInstance, url, data, options) {
  data = encode(data);
  const body = { data };
  const headers = await makeAuthHeaders(functionsInstance, options);
  const timeout = options.timeout || 7e4;
  const failAfterHandle = failAfter(timeout);
  const response = await Promise.race([
    postJSON(url, body, headers, functionsInstance.fetchImpl, functionsInstance),
    failAfterHandle.promise,
    functionsInstance.cancelAllRequests
  ]);
  failAfterHandle.cancel();
  if (!response) {
    throw new FunctionsError("cancelled", "Firebase Functions instance was deleted.");
  }
  const error = _errorForResponse(response.status, response.json, url);
  if (error) {
    throw error;
  }
  if (!response.json) {
    throw new FunctionsError("internal", "Response is not valid JSON object.", void 0, url);
  }
  let responseData = response.json.data;
  if (typeof responseData === "undefined") {
    responseData = response.json.result;
  }
  if (typeof responseData === "undefined") {
    throw new FunctionsError("internal", "Response is missing data field.", void 0, url);
  }
  const decodedData = decode(responseData);
  return { data: decodedData };
}
function stream(functionsInstance, name3, data, options) {
  const url = functionsInstance._url(name3);
  return streamAtURL(functionsInstance, url, data, options || {});
}
async function streamAtURL(functionsInstance, url, data, options) {
  data = encode(data);
  const body = { data };
  const headers = await makeAuthHeaders(functionsInstance, options);
  headers["Content-Type"] = "application/json";
  headers["Accept"] = "text/event-stream";
  let response;
  try {
    response = await functionsInstance.fetchImpl(url, {
      method: "POST",
      body: JSON.stringify(body),
      headers,
      signal: options?.signal,
      credentials: getCredentials(functionsInstance)
    });
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      const error2 = new FunctionsError("cancelled", "Request was cancelled.");
      return {
        data: Promise.reject(error2),
        stream: {
          [Symbol.asyncIterator]() {
            return {
              next() {
                return Promise.reject(error2);
              }
            };
          }
        }
      };
    }
    const error = _errorForResponse(0, null, url);
    return {
      data: Promise.reject(error),
      // Return an empty async iterator
      stream: {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return Promise.reject(error);
            }
          };
        }
      }
    };
  }
  let resultResolver;
  let resultRejecter;
  const resultPromise = new Promise((resolve, reject) => {
    resultResolver = resolve;
    resultRejecter = reject;
  });
  options?.signal?.addEventListener("abort", () => {
    const error = new FunctionsError("cancelled", "Request was cancelled.");
    resultRejecter(error);
  });
  const reader = response.body.getReader();
  const rstream = createResponseStream(reader, resultResolver, resultRejecter, options?.signal, url);
  return {
    stream: {
      [Symbol.asyncIterator]() {
        const rreader = rstream.getReader();
        return {
          async next() {
            const { value, done } = await rreader.read();
            return { value, done };
          },
          async return() {
            await rreader.cancel();
            return { done: true, value: void 0 };
          }
        };
      }
    },
    data: resultPromise
  };
}
function createResponseStream(reader, resultResolver, resultRejecter, signal, url) {
  const processLine = (line, controller) => {
    const match = line.match(responseLineRE);
    if (!match) {
      return;
    }
    const data = match[1];
    try {
      const jsonData = JSON.parse(data);
      if ("result" in jsonData) {
        resultResolver(decode(jsonData.result));
        return;
      }
      if ("message" in jsonData) {
        controller.enqueue(decode(jsonData.message));
        return;
      }
      if ("error" in jsonData) {
        const error = _errorForResponse(0, jsonData, url);
        controller.error(error);
        resultRejecter(error);
        return;
      }
    } catch (error) {
      if (error instanceof FunctionsError) {
        controller.error(error);
        resultRejecter(error);
        return;
      }
    }
  };
  const decoder = new TextDecoder();
  return new ReadableStream({
    start(controller) {
      let currentText = "";
      return pump();
      async function pump() {
        if (signal?.aborted) {
          const error = new FunctionsError("cancelled", "Request was cancelled");
          controller.error(error);
          resultRejecter(error);
          return Promise.resolve();
        }
        try {
          const { value, done } = await reader.read();
          if (done) {
            if (currentText.trim()) {
              processLine(currentText.trim(), controller);
            }
            controller.close();
            return;
          }
          if (signal?.aborted) {
            const error = new FunctionsError("cancelled", "Request was cancelled");
            controller.error(error);
            resultRejecter(error);
            await reader.cancel();
            return;
          }
          currentText += decoder.decode(value, { stream: true });
          const lines = currentText.split("\n");
          currentText = lines.pop() || "";
          for (const line of lines) {
            if (line.trim()) {
              processLine(line.trim(), controller);
            }
          }
          return pump();
        } catch (error) {
          const functionsError = error instanceof FunctionsError ? error : _errorForResponse(0, null, url);
          controller.error(functionsError);
          resultRejecter(functionsError);
        }
      }
    },
    cancel() {
      return reader.cancel();
    }
  });
}
var name2 = "@firebase/functions";
var version = "0.14.0";
var AUTH_INTERNAL_NAME = "auth-internal";
var APP_CHECK_INTERNAL_NAME = "app-check-internal";
var MESSAGING_INTERNAL_NAME = "messaging-internal";
function registerFunctions(variant) {
  const factory = (container, { instanceIdentifier: regionOrCustomDomain }) => {
    const app = container.getProvider("app").getImmediate();
    const authProvider = container.getProvider(AUTH_INTERNAL_NAME);
    const messagingProvider = container.getProvider(MESSAGING_INTERNAL_NAME);
    const appCheckProvider = container.getProvider(APP_CHECK_INTERNAL_NAME);
    return new FunctionsService(app, authProvider, messagingProvider, appCheckProvider, regionOrCustomDomain);
  };
  _registerComponent(new Component(
    FUNCTIONS_TYPE,
    factory,
    "PUBLIC"
    /* ComponentType.PUBLIC */
  ).setMultipleInstances(true));
  registerVersion(name2, version, variant);
  registerVersion(name2, version, "esm2020");
}
function getFunctions(app = getApp(), regionOrCustomDomain = DEFAULT_REGION) {
  const functionsProvider = _getProvider(getModularInstance(app), FUNCTIONS_TYPE);
  const functionsInstance = functionsProvider.getImmediate({
    identifier: regionOrCustomDomain
  });
  const emulator = getDefaultEmulatorHostnameAndPort("functions");
  if (emulator) {
    connectFunctionsEmulator(functionsInstance, ...emulator);
  }
  return functionsInstance;
}
function connectFunctionsEmulator(functionsInstance, host, port) {
  connectFunctionsEmulator$1(getModularInstance(functionsInstance), host, port);
}
function httpsCallable(functionsInstance, name3, options) {
  return httpsCallable$1(getModularInstance(functionsInstance), name3, options);
}
registerFunctions();

// src/lib/regionalCallable.ts
var UNAVAILABLE_MS = 10 * 6e4;
var spInstances = /* @__PURE__ */ new WeakMap();
var confirmedNearby = /* @__PURE__ */ new Set();
var unavailableUntil = /* @__PURE__ */ new Map();
var nearbyInstance = (primary) => {
  let found = spInstances.get(primary);
  if (!found) {
    found = getFunctions(primary.app, CALLABLE_PRIMARY_REGION);
    spInstances.set(primary, found);
  }
  return found;
};
var routesNearby = (functionsInstance, name3) => isDualRegionCallable(name3) && functionsInstance.region === CALLABLE_FALLBACK_REGION && !functionsInstance.emulatorOrigin;
var isMissingFunctionError = (error) => {
  const e = error || {};
  return e.code === "functions/not-found" && e.details === void 0 && /^not-found \[404\]$/i.test(String(e.message || "").trim());
};
var isNetworkLevelError = (error) => {
  const e = error || {};
  return e.code === "functions/internal" && e.details === void 0 && /^internal \[0\]$/i.test(String(e.message || "").trim());
};
var mayFallBack = (name3, error) => {
  if (isMissingFunctionError(error)) return true;
  if (!isNetworkLevelError(error) || confirmedNearby.has(name3)) return false;
  return typeof navigator === "undefined" || navigator.onLine !== false;
};
function httpsCallable2(functionsInstance, name3, options) {
  const legacy = httpsCallable(functionsInstance, name3, options);
  if (!routesNearby(functionsInstance, name3)) return legacy;
  const nearby = httpsCallable(nearbyInstance(functionsInstance), name3, options);
  const call2 = async (data) => {
    if ((unavailableUntil.get(name3) || 0) > Date.now()) return legacy(data);
    try {
      const result = await nearby(data);
      confirmedNearby.add(name3);
      unavailableUntil.delete(name3);
      return result;
    } catch (error) {
      if (!mayFallBack(name3, error)) throw error;
      unavailableUntil.set(name3, Date.now() + UNAVAILABLE_MS);
      return legacy(data);
    }
  };
  return Object.assign(call2, { stream: legacy.stream });
}

// src/lib/warmPolicy.ts
var WARM_INTERVAL_MS = 10 * 6e4;
var shouldWarm = (c) => c.online && !c.hidden && c.signedIn && !c.tearingDown && c.now - c.lastWarmAt >= WARM_INTERVAL_MS;

// src/lib/warmCallables.ts
var lastWarmAt = 0;
function warmHotCallables(now = Date.now()) {
  try {
    if (!shouldWarm({
      now,
      lastWarmAt,
      online: typeof navigator === "undefined" || navigator.onLine !== false,
      hidden: typeof document !== "undefined" && document.hidden,
      signedIn: !!auth.currentUser?.uid,
      tearingDown: isAuthTeardownActive()
    })) return false;
    lastWarmAt = now;
    for (const name3 of WARMABLE_CALLABLES) {
      void httpsCallable2(functions, name3, { timeout: 15e3 })({ __warm: true }).catch(() => void 0);
    }
    return true;
  } catch {
    return false;
  }
}

// src/services/operationOutbox.ts
var operationOutbox = globalThis.__supervisor520.operationOutbox;
var OPERATION_OUTBOX_CHANGED = "operation-change";
var reconcileOperationOutboxNativeState = async () => {
};
var setOperationPendingTripReader = () => {
};

// src/lib/connectivity.ts
var isDefinitelyOffline = () => typeof navigator !== "undefined" && navigator.onLine === false;
var isConnectivityError = (error) => {
  const value = error;
  const code = String(value?.code || "").toLowerCase();
  const message = String(value?.message || value || "").toLowerCase();
  return isDefinitelyOffline() || ["unavailable", "deadline-exceeded", "network-request-failed", "failed-precondition", "storage/retry-limit-exceeded"].some((token) => code.includes(token)) || ["network", "offline", "internet", "connection", "conex\xE3o", "conexao", "rede", "failed to fetch"].some((token) => message.includes(token));
};

// src/lib/offlineTripQueue.ts
var getOfflineTrips = () => [];
var removeOfflineTrip = () => {
};
var markOfflineTripFailed = () => {
};
var setOfflineTripStatus = () => {
};
var recoverInterruptedOfflineTrips = () => {
};
var retryOfflineTrip = () => false;

// src/services/sync/SyncEngine.ts
var syncEngine = globalThis.__supervisor520.engine;

// src/application/trip/TripRegistrationService.ts
var TripRegistrationService = { register: (t) => t };

// src/lib/tripTombstones.ts
var isTripTombstoned = () => false;

// src/lib/CanonicalTripUpdateEvent.ts
var CANONICAL_TRIP_UPDATED = "canonical-updated";

// src/services/offline/OfflineDatabase.ts
var OfflineDatabase = class {
  static storageKey = "qa-journal";
};

// src/services/syncManager.ts
var queuedUserId = (item) => String(item.payload?.driverId || item.payload?.motoristaId || item.payload?.userId || "").trim();
var operationId = (item) => String(item.jobId || item.payload?.jobId || "").trim();
var SyncManager = class {
  static {
    this.running = false;
  }
  static {
    this.retryDelayMs = 750;
  }
  static {
    this.canonicalInitialized = false;
  }
  static {
    this.canonicalFlight = null;
  }
  static {
    this.canonicalDirty = false;
  }
  static configure(sender, scopeResolver) {
    this.sender = sender;
    this.scopeResolver = scopeResolver;
  }
  static async synchronizeCanonicalTrips() {
    return this.syncPendingTrips();
  }
  static getPendingRegistrationIds(jobId) {
    const uid = auth.currentUser?.uid;
    if (!uid || !jobId) return [];
    const ids = /* @__PURE__ */ new Set();
    for (const item of syncEngine.getPending()) {
      const trip = item.trip;
      const id = String(trip.canonicalTripId || trip.tripId || "");
      if ((!item.operation || item.operation === "UPSERT") && ["PENDING_SYNC", "SYNCING"].includes(item.state) && trip.driverId === uid && String(trip.jobId || "") === jobId && !trip.deleted && !isTripTombstoned(id)) ids.add(id);
    }
    for (const item of getOfflineTrips()) {
      const payload = item.payload || {};
      const id = String(payload.canonicalTripId || payload.tripId || payload.clientRequestId || payload.idempotencyKey || item.id);
      if (queuedUserId(item) === uid && operationId(item) === jobId && !["FAILED", "VALIDATED"].includes(item.status) && !syncEngine.getResult(id) && !isTripTombstoned(id)) ids.add(id);
    }
    return [...ids];
  }
  static getPendingRegistrationCount(jobId) {
    return this.getPendingRegistrationIds(jobId).length;
  }
  static async retryTripRegistration(id) {
    let retried = await syncEngine.retryRegistration(id);
    if (!retried) {
      const legacy = getOfflineTrips().find((item) => item.id === id);
      if (!legacy || queuedUserId(legacy) !== auth.currentUser?.uid || isTripTombstoned(id)) return false;
      retried = retryOfflineTrip(id);
    }
    if (retried) void this.syncPendingTrips().catch((error) => console.warn("N\xE3o foi poss\xEDvel concluir a nova tentativa de envio.", error));
    return retried;
  }
  /**
   * Older profile/print records use nvu.offline.trip.queue.v2. Move every
   * usable non-terminal record into the canonical ACK-controlled queue and
   * remove it only after remote confirmation. Failed legacy records are kept
   * until the driver requests a retry; migration never resets a canonical failure.
   */
  static async migrateLegacyQueueAndSync() {
    const uid = auth.currentUser?.uid;
    const pending = getOfflineTrips().filter(
      (item) => uid && queuedUserId(item) === uid && !["VALIDATED", "FAILED"].includes(item.status)
    );
    for (const item of pending) {
      const payload = item.payload || {};
      const stableId = String(payload.canonicalTripId || payload.tripId || payload.clientRequestId || payload.idempotencyKey || item.id).trim();
      if (!stableId) continue;
      if (syncEngine.getResult(stableId) || isTripTombstoned(stableId)) continue;
      try {
        await syncEngine.enqueue(TripRegistrationService.register({
          ...payload,
          id: stableId,
          canonicalTripId: stableId,
          tripId: stableId,
          jobId: payload.jobId || item.jobId,
          operationId: payload.jobId || item.jobId,
          driverId: payload.driverId || payload.motoristaId || payload.userId,
          status: "PENDING_SYNC"
        }));
      } catch (error) {
        markOfflineTripFailed(item.id, error, { retryable: false });
      }
    }
    const result = await syncEngine.synchronize();
    for (const item of pending) {
      const payload = item.payload || {};
      const stableId = String(payload.canonicalTripId || payload.tripId || payload.clientRequestId || payload.idempotencyKey || item.id).trim();
      if (stableId && syncEngine.getResult(stableId)?.state === "SERVER_CONFIRMED") {
        removeOfflineTrip(item.id);
      }
    }
    return result;
  }
  static scheduleRetry(delayMs = this.retryDelayMs) {
    if (this.retryTimer || typeof window === "undefined" || navigator.onLine === false) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = void 0;
      void this.syncPendingTrips();
    }, delayMs);
  }
  static initialize() {
    if (typeof window === "undefined" || this.canonicalInitialized) return;
    recoverInterruptedOfflineTrips();
    this.canonicalInitialized = true;
    const resume = () => {
      void this.syncPendingTrips().catch((error) => console.warn("[NVU] Sincroniza\xE7\xE3o ser\xE1 retomada", error));
    };
    const resumeNewCanonicalCommand = () => {
      if (isAuthTeardownActive() || !auth.currentUser?.uid || navigator.onLine === false) return;
      void syncEngine.synchronize().catch((error) => console.warn("[NVU] Envio preservado para nova tentativa", error));
      resume();
    };
    setOperationPendingTripReader((_uid, jobId) => this.getPendingRegistrationIds(jobId));
    window.addEventListener("online", resume);
    const sendOperationCommandsNow = () => {
      if (isAuthTeardownActive() || !auth.currentUser?.uid || navigator.onLine === false) return;
      try {
        const now = Date.now();
        const ready = (kind) => operationOutbox.pending().some((entry) => entry.kind === kind && entry.state === "PENDING" && entry.retryAt <= now);
        for (const kind of ["start", "finish"])
          if (ready(kind)) void operationOutbox.synchronize(kind).catch((error) => console.warn("[NVU] Comando salvo ser\xE1 reenviado", error));
      } catch (error) {
        console.warn("[NVU] Fila de comandos ser\xE1 retomada", error);
      }
    };
    window.addEventListener(OPERATION_OUTBOX_CHANGED, () => {
      sendOperationCommandsNow();
      resume();
    });
    window.addEventListener("nvu-canonical-trip-updated", resume);
    window.addEventListener(CANONICAL_TRIP_UPDATED, resume);
    window.addEventListener("storage", (event) => {
      if (event.key === OfflineDatabase.storageKey) resume();
    });
    window.addEventListener("nvu-canonical-trip-queued", resumeNewCanonicalCommand);
    window.addEventListener("nvu-offline-trip-queued", resume);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) {
        resume();
        warmHotCallables();
      }
    });
    window.addEventListener("online", () => {
      warmHotCallables();
    });
    onAuthStateChanged(auth, () => {
      resume();
      warmHotCallables();
    });
    window.setInterval(() => {
      if (!document.hidden && navigator.onLine !== false && auth.currentUser?.uid) {
        try {
          if (operationOutbox.pending().some((entry) => entry.state !== "REJECTED")) resume();
        } catch {
        }
      }
    }, 5e3);
    if (navigator.onLine !== false) resume();
  }
  static async syncPendingTrips(sender = this.sender) {
    if (!sender) {
      if (isAuthTeardownActive() || !auth.currentUser?.uid || typeof navigator !== "undefined" && navigator.onLine === false) return;
      if (this.canonicalFlight) {
        this.canonicalDirty = true;
        return this.canonicalFlight;
      }
      const uid = auth.currentUser?.uid;
      const task = Promise.resolve().then(async () => {
        let result;
        do {
          this.canonicalDirty = false;
          await reconcileOperationOutboxNativeState();
          if (isAuthTeardownActive() || auth.currentUser?.uid !== uid) break;
          await operationOutbox.synchronize("start");
          await reconcileOperationOutboxNativeState();
          if (isAuthTeardownActive() || auth.currentUser?.uid !== uid) break;
          result = await this.migrateLegacyQueueAndSync();
          if (isAuthTeardownActive() || auth.currentUser?.uid !== uid) break;
          await operationOutbox.synchronize("finish");
          await reconcileOperationOutboxNativeState();
        } while (this.canonicalDirty && auth.currentUser?.uid === uid && navigator.onLine !== false);
        return result;
      });
      this.canonicalFlight = task;
      const release = () => {
        this.canonicalFlight = null;
        if (auth.currentUser?.uid && auth.currentUser.uid !== uid && !isAuthTeardownActive())
          void this.syncPendingTrips().catch((error) => console.warn("[NVU] Sincroniza\xE7\xE3o ser\xE1 retomada", error));
      };
      void task.then(release, (error) => {
        release();
        console.warn("[NVU] Sincroniza\xE7\xE3o local ser\xE1 retomada", error);
      });
      return task;
    }
    if (this.running || typeof navigator !== "undefined" && navigator.onLine === false) return;
    const scopeUserId = String(this.scopeResolver?.() || "").trim();
    if (this.scopeResolver && !scopeUserId) return;
    const scopedQueue = getOfflineTrips().filter((item) => !scopeUserId || !queuedUserId(item) || queuedUserId(item) === scopeUserId);
    const pending = scopedQueue.filter((item) => item.status === "PENDING_SYNC");
    if (!pending.length) return;
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = void 0;
    }
    this.running = true;
    window.dispatchEvent(new CustomEvent("nvu-offline-sync-start", { detail: { count: pending.length } }));
    let synced = 0;
    try {
      for (const item of pending) {
        try {
          setOfflineTripStatus(item.id, "UPLOADING");
          const result = await sender(item) || {};
          setOfflineTripStatus(item.id, "SERVER_RECEIVED");
          setOfflineTripStatus(item.id, "VALIDATION_PENDING");
          if (result?.validated === true) {
            setOfflineTripStatus(item.id, "VALIDATED");
            removeOfflineTrip(item.id);
            window.dispatchEvent(new CustomEvent("nvu-offline-trip-validated", { detail: { id: item.id, jobId: item.jobId || item.payload?.jobId, tripId: result.tripId || "", totalDeliveries: Number(item.totalDeliveries || 0) } }));
            synced += 1;
          } else {
            markOfflineTripFailed(item.id, new Error("SERVER_VALIDATION_NOT_CONFIRMED"), { retryable: true });
          }
        } catch (error) {
          const code = String(error?.code || "").toLowerCase();
          const retryable = navigator.onLine === false || isConnectivityError(error) && !code.includes("failed-precondition");
          markOfflineTripFailed(item.id, error, { retryable });
        }
      }
    } finally {
      this.running = false;
      const remainingQueue = getOfflineTrips().filter((item) => !scopeUserId || !queuedUserId(item) || queuedUserId(item) === scopeUserId);
      const remaining = remainingQueue.filter((item) => item.status !== "VALIDATED").length;
      window.dispatchEvent(new CustomEvent("nvu-offline-sync-finish", { detail: { synced, remaining } }));
      if (remainingQueue.some((item) => item.status === "PENDING_SYNC") && navigator.onLine !== false) {
        this.scheduleRetry(this.retryDelayMs);
        this.retryDelayMs = Math.min(this.retryDelayMs * 2, 5 * 6e4);
      } else if (remaining === 0) this.retryDelayMs = 750;
    }
  }
};
export {
  SyncManager
};
/*! Bundled license information:

@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/logger/dist/esm/index.esm.js:
@firebase/functions/dist/esm/index.esm.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/util/dist/node-esm/index.node.esm.js:
  (**
   * @license
   * Copyright 2022 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@firebase/util/dist/node-esm/index.node.esm.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
  (**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@firebase/util/dist/node-esm/index.node.esm.js:
@firebase/component/dist/esm/index.esm.js:
@firebase/app/dist/esm/index.esm.js:
@firebase/app/dist/esm/index.esm.js:
@firebase/app/dist/esm/index.esm.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@firebase/util/dist/node-esm/index.node.esm.js:
  (**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@firebase/util/dist/node-esm/index.node.esm.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
  (**
   * @license
   * Copyright 2025 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@firebase/app/dist/esm/index.esm.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
  (**
   * @license
   * Copyright 2023 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@firebase/app/dist/esm/index.esm.js:
  (**
   * @license
   * Copyright 2021 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
  (**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@firebase/functions/dist/esm/index.esm.js:
  (**
   * @license
   * Copyright 2017 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
  (**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)

@firebase/functions/dist/esm/index.esm.js:
  (**
   * @license
   * Copyright 2019 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
  (**
   * @license
   * Copyright 2020 Google LLC
   *
   * Licensed under the Apache License, Version 2.0 (the "License");
   * you may not use this file except in compliance with the License.
   * You may obtain a copy of the License at
   *
   *   http://www.apache.org/licenses/LICENSE-2.0
   *
   * Unless required by applicable law or agreed to in writing, software
   * distributed under the License is distributed on an "AS IS" BASIS,
   * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   * See the License for the specific language governing permissions and
   * limitations under the License.
   *)
*/
