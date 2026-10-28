/*
 * WH_KEYBOARD_LL on its own thread, with a real GetMessage loop.
 *
 * v0.1.2 injected the probe with koffi keybd_event.async (libuv pool) and
 * pumped PeekMessageW / MsgWaitForMultipleObjects through a synchronous koffi
 * call on the Electron main thread. That call sits on koffi's private stack.
 * If Windows delivers the hook on that thread, the callback is nested inside
 * koffi. If Windows delivers it on the injector thread, koffi forwards it with
 * napi_call_threadsafe_function and blocks until the main thread drains the
 * queue — which it cannot do while it is stuck inside the koffi pump. The
 * probe flag stayed false, install() unhooked, and a lock was never shown.
 *
 * This thread installs the hook and blocks in GetMessageW. The probe key is
 * injected with SendInput from a second thread. The hook procedure recognizes
 * that key in native code and returns 1 without entering JS, so the main
 * thread may wait. Real keys call back into JS only after install has returned
 * to the event loop.
 *
 * Mouse / trackpad are never hooked.
 */

#include <node_api.h>

#ifdef _WIN32

#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#include <windows.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define PROBE_VK 0xE8u
#define PROBE_EXTRA 0x4242424Bu

typedef char hook_input_size_ok[(sizeof(INPUT) == 40) ? 1 : -1];
typedef char hook_extra_offset_ok[(offsetof(INPUT, ki.dwExtraInfo) == 24) ? 1 : -1];

typedef struct KeyMsg {
  int phase;
  uint32_t vk;
  int swallow;
  volatile LONG refs;
  HANDLE done;
} KeyMsg;

static HHOOK g_hook = NULL;
static HANDLE g_thread = NULL;
static HANDLE g_ready = NULL;
static DWORD g_thread_id = 0;
static int g_hmod_kind = 0;
static int g_last_error = 0;
static volatile LONG g_probing = 0;
static volatile LONG g_probe_seen = 0;
static volatile LONG g_proc_entered = 0;
static volatile LONG g_last_vk = 0;
static volatile LONG g_last_flags = 0;
static volatile LONGLONG g_last_extra = 0;
static volatile LONG g_locked = 0;
static int g_send_input_count = 0;
static char g_inject_method[32] = "none";
static int g_probe_elapsed_ms = 0;
static napi_threadsafe_function g_tsfn = NULL;

static LONG atomic_read(volatile LONG *value) {
  return InterlockedCompareExchange((LONG volatile *)value, 0, 0);
}

static int is_probe_event(const KBDLLHOOKSTRUCT *kb) {
  if (kb->dwExtraInfo == (ULONG_PTR)PROBE_EXTRA) return 1;
  if (kb->vkCode == PROBE_VK &&
      (kb->flags & (LLKHF_INJECTED | LLKHF_LOWER_IL_INJECTED)) != 0) {
    return 1;
  }
  if (kb->vkCode == PROBE_VK) return 1;
  return 0;
}

static void release_msg(KeyMsg *km) {
  if (InterlockedDecrement(&km->refs) == 0) {
    if (km->done) CloseHandle(km->done);
    free(km);
  }
}

static void call_js(napi_env env, napi_value js_cb, void *context, void *data) {
  KeyMsg *km = (KeyMsg *)data;
  (void)context;
  if (km == NULL) return;
  km->swallow = 0;
  if (env != NULL && js_cb != NULL) {
    napi_value global;
    napi_value phase;
    napi_value vk;
    napi_value result;
    napi_value argv[2];
    napi_valuetype result_type;
    const char *phase_name = km->phase ? "up" : "down";
    napi_get_global(env, &global);
    napi_create_string_utf8(env, phase_name, NAPI_AUTO_LENGTH, &phase);
    napi_create_uint32(env, km->vk, &vk);
    argv[0] = phase;
    argv[1] = vk;
    if (napi_call_function(env, global, js_cb, 2, argv, &result) == napi_ok) {
      bool swallow = false;
      napi_typeof(env, result, &result_type);
      if (result_type == napi_boolean &&
          napi_get_value_bool(env, result, &swallow) == napi_ok && swallow) {
        km->swallow = 1;
      }
    } else {
      napi_value exception;
      napi_get_and_clear_last_exception(env, &exception);
    }
  }
  if (km->done) SetEvent(km->done);
  release_msg(km);
}

static LRESULT CALLBACK low_level_proc(int nCode, WPARAM wParam, LPARAM lParam) {
  KBDLLHOOKSTRUCT *kb;
  UINT msg;
  int phase;
  KeyMsg *km;
  DWORD wait;
  int swallow;
  napi_status status;

  if (nCode < 0 || g_hook == NULL) {
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
  }
  kb = (KBDLLHOOKSTRUCT *)lParam;
  if (kb == NULL) {
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
  }

  InterlockedIncrement(&g_proc_entered);
  InterlockedExchange(&g_last_vk, (LONG)kb->vkCode);
  InterlockedExchange(&g_last_flags, (LONG)kb->flags);
  InterlockedExchange64(&g_last_extra, (LONGLONG)kb->dwExtraInfo);

  if (atomic_read(&g_probing)) {
    if (is_probe_event(kb)) {
      InterlockedExchange(&g_probe_seen, 1);
      return 1;
    }
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
  }

  msg = (UINT)wParam;
  phase = -1;
  if (msg == WM_KEYDOWN || msg == WM_SYSKEYDOWN) phase = 0;
  else if (msg == WM_KEYUP || msg == WM_SYSKEYUP) phase = 1;
  if (phase < 0 || g_tsfn == NULL) {
    if (atomic_read(&g_locked)) return 1;
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
  }

  km = (KeyMsg *)calloc(1, sizeof(KeyMsg));
  if (km == NULL) {
    if (atomic_read(&g_locked)) return 1;
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
  }
  km->phase = phase;
  km->vk = (uint32_t)kb->vkCode;
  km->swallow = 0;
  km->refs = 2;
  km->done = CreateEventW(NULL, TRUE, FALSE, NULL);
  if (km->done == NULL) {
    free(km);
    if (atomic_read(&g_locked)) return 1;
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
  }

  status = napi_call_threadsafe_function(g_tsfn, km, napi_tsfn_blocking);
  if (status != napi_ok) {
    release_msg(km);
    release_msg(km);
    if (atomic_read(&g_locked)) return 1;
    return CallNextHookEx(g_hook, nCode, wParam, lParam);
  }

  /* JS is fast and must not wait on this thread. 200ms keeps Windows from
   * treating the hook as hung (LowLevelHooksTimeout) if the main thread is
   * busy. On timeout, fail closed only while locked. */
  wait = WaitForSingleObject(km->done, 200);
  swallow = (wait == WAIT_OBJECT_0) ? km->swallow : (atomic_read(&g_locked) ? 1 : 0);
  release_msg(km);
  if (swallow) return 1;
  return CallNextHookEx(g_hook, nCode, wParam, lParam);
}

static DWORD WINAPI hook_thread(LPVOID param) {
  int kind = (int)(INT_PTR)param;
  HMODULE module = NULL;
  MSG warmup;
  MSG msg;

  PeekMessageW(&warmup, NULL, WM_USER, WM_USER, PM_NOREMOVE);
  if (kind == 1) {
    if (!GetModuleHandleExW(
          GET_MODULE_HANDLE_EX_FLAG_FROM_ADDRESS | GET_MODULE_HANDLE_EX_FLAG_UNCHANGED_REFCOUNT,
          (LPCWSTR)(ULONG_PTR)low_level_proc,
          &module)) {
      module = NULL;
      kind = 0;
    }
  } else if (kind == 2) {
    module = GetModuleHandleW(NULL);
  }
  g_hmod_kind = kind;
  g_hook = SetWindowsHookExW(WH_KEYBOARD_LL, low_level_proc, module, 0);
  g_last_error = g_hook ? 0 : (int)GetLastError();
  g_thread_id = GetCurrentThreadId();
  if (g_ready) SetEvent(g_ready);
  if (g_hook == NULL) return 1;

  while (GetMessageW(&msg, NULL, 0, 0) > 0) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  if (g_hook) {
    UnhookWindowsHookEx(g_hook);
    g_hook = NULL;
  }
  return 0;
}

static DWORD WINAPI inject_thread(LPVOID param) {
  INPUT inputs[2];
  UINT sent;
  (void)param;
  memset(inputs, 0, sizeof(inputs));
  inputs[0].type = INPUT_KEYBOARD;
  inputs[0].ki.wVk = (WORD)PROBE_VK;
  inputs[0].ki.dwExtraInfo = (ULONG_PTR)PROBE_EXTRA;
  inputs[1].type = INPUT_KEYBOARD;
  inputs[1].ki.wVk = (WORD)PROBE_VK;
  inputs[1].ki.dwFlags = KEYEVENTF_KEYUP;
  inputs[1].ki.dwExtraInfo = (ULONG_PTR)PROBE_EXTRA;
  sent = SendInput(2, inputs, (int)sizeof(INPUT));
  g_send_input_count = (int)sent;
  if (sent == 2) {
    strcpy(g_inject_method, "SendInput");
    return 0;
  }
  keybd_event((BYTE)PROBE_VK, 0, 0, (ULONG_PTR)PROBE_EXTRA);
  keybd_event((BYTE)PROBE_VK, 0, KEYEVENTF_KEYUP, (ULONG_PTR)PROBE_EXTRA);
  strcpy(g_inject_method, "keybd_event");
  return 0;
}

static void stop_thread(void) {
  HANDLE thread;
  DWORD thread_id;
  InterlockedExchange(&g_probing, 0);
  thread = g_thread;
  thread_id = g_thread_id;
  g_thread = NULL;
  g_thread_id = 0;
  if (thread_id) PostThreadMessageW(thread_id, WM_QUIT, 0, 0);
  if (thread) {
    WaitForSingleObject(thread, 2000);
    CloseHandle(thread);
  }
  if (g_hook) {
    UnhookWindowsHookEx(g_hook);
    g_hook = NULL;
  }
}

static const char *hmod_name(int kind) {
  if (kind == 1) return "addon";
  if (kind == 2) return "exe";
  return "null";
}

static int kind_from_js(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv;
  char buf[16];
  size_t len = 0;
  napi_get_cb_info(env, info, &argc, &argv, NULL, NULL);
  if (argc < 1) return 0;
  buf[0] = 0;
  napi_get_value_string_utf8(env, argv, buf, sizeof(buf), &len);
  if (strcmp(buf, "addon") == 0) return 1;
  if (strcmp(buf, "exe") == 0) return 2;
  return 0;
}

static void set_str(napi_env env, napi_value obj, const char *key, const char *val) {
  napi_value v;
  napi_create_string_utf8(env, val ? val : "", NAPI_AUTO_LENGTH, &v);
  napi_set_named_property(env, obj, key, v);
}

static void set_i32(napi_env env, napi_value obj, const char *key, int val) {
  napi_value v;
  napi_create_int32(env, val, &v);
  napi_set_named_property(env, obj, key, v);
}

static void set_bool(napi_env env, napi_value obj, const char *key, int val) {
  napi_value v;
  napi_get_boolean(env, val ? true : false, &v);
  napi_set_named_property(env, obj, key, v);
}

static void extra_hex(char *out, size_t out_len, LONGLONG extra) {
  unsigned long long value = (unsigned long long)extra;
  snprintf(out, out_len, "0x%llx", value);
}

static napi_value Start(napi_env env, napi_callback_info info) {
  int kind;
  napi_value obj;
  kind = kind_from_js(env, info);
  stop_thread();
  if (g_ready == NULL) g_ready = CreateEventW(NULL, TRUE, FALSE, NULL);
  ResetEvent(g_ready);
  InterlockedExchange(&g_proc_entered, 0);
  InterlockedExchange(&g_probe_seen, 0);
  InterlockedExchange(&g_last_vk, 0);
  InterlockedExchange(&g_last_flags, 0);
  InterlockedExchange64(&g_last_extra, 0);
  g_send_input_count = 0;
  strcpy(g_inject_method, "none");
  g_thread = CreateThread(NULL, 0, hook_thread, (LPVOID)(INT_PTR)kind, 0, NULL);
  if (g_thread == NULL) {
    g_last_error = (int)GetLastError();
    napi_create_object(env, &obj);
    set_bool(env, obj, "ok", 0);
    set_i32(env, obj, "lastError", g_last_error);
    set_str(env, obj, "hMod", hmod_name(kind));
    return obj;
  }
  WaitForSingleObject(g_ready, 2000);
  napi_create_object(env, &obj);
  set_bool(env, obj, "ok", g_hook != NULL);
  set_i32(env, obj, "lastError", g_last_error);
  set_str(env, obj, "hMod", hmod_name(g_hmod_kind));
  set_i32(env, obj, "threadId", (int)g_thread_id);
  return obj;
}

static napi_value Probe(napi_env env, napi_callback_info info) {
  LONG before;
  HANDLE worker;
  ULONGLONG t0;
  napi_value obj;
  char hex[32];
  int delta;
  int seen;
  (void)info;
  before = atomic_read(&g_proc_entered);
  InterlockedExchange(&g_probe_seen, 0);
  g_send_input_count = 0;
  strcpy(g_inject_method, "none");
  t0 = GetTickCount64();
  if (g_hook == NULL) {
    napi_create_object(env, &obj);
    set_bool(env, obj, "proven", 0);
    set_bool(env, obj, "probeSeen", 0);
    set_i32(env, obj, "procEntered", (int)before);
    set_i32(env, obj, "procDelta", 0);
    set_i32(env, obj, "lastVk", 0);
    set_i32(env, obj, "lastFlags", 0);
    set_str(env, obj, "lastExtra", "0");
    set_i32(env, obj, "sendInputCount", 0);
    set_str(env, obj, "injectMethod", "none");
    set_i32(env, obj, "yields", 0);
    set_str(env, obj, "pump", "GetMessage");
    set_i32(env, obj, "elapsedMs", 0);
    return obj;
  }
  InterlockedExchange(&g_probing, 1);
  worker = CreateThread(NULL, 0, inject_thread, NULL, 0, NULL);
  if (worker) {
    /* Win10 1709+ caps LowLevelHooksTimeout at 1000ms. Wait past that so
     * SendInput has returned before the caller unhooks. */
    WaitForSingleObject(worker, 1200);
    CloseHandle(worker);
  }
  InterlockedExchange(&g_probing, 0);
  g_probe_elapsed_ms = (int)(GetTickCount64() - t0);
  seen = atomic_read(&g_probe_seen) ? 1 : 0;
  delta = (int)(atomic_read(&g_proc_entered) - before);
  extra_hex(hex, sizeof(hex), InterlockedCompareExchange64(&g_last_extra, 0, 0));
  napi_create_object(env, &obj);
  set_bool(env, obj, "proven", seen || delta > 0);
  set_bool(env, obj, "probeSeen", seen);
  set_i32(env, obj, "procEntered", (int)atomic_read(&g_proc_entered));
  set_i32(env, obj, "procDelta", delta);
  set_i32(env, obj, "lastVk", (int)atomic_read(&g_last_vk));
  set_i32(env, obj, "lastFlags", (int)atomic_read(&g_last_flags));
  set_str(env, obj, "lastExtra", hex);
  set_i32(env, obj, "sendInputCount", g_send_input_count);
  set_str(env, obj, "injectMethod", g_inject_method);
  set_i32(env, obj, "yields", 0);
  set_str(env, obj, "pump", "GetMessage");
  set_i32(env, obj, "elapsedMs", g_probe_elapsed_ms);
  return obj;
}

static napi_value Stop(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  stop_thread();
  return NULL;
}

static napi_value SetHandler(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv;
  napi_value name;
  napi_valuetype type;
  napi_status status;
  napi_get_cb_info(env, info, &argc, &argv, NULL, NULL);
  if (argc < 1) {
    napi_throw_type_error(env, NULL, "handler required");
    return NULL;
  }
  napi_typeof(env, argv, &type);
  if (type != napi_function) {
    napi_throw_type_error(env, NULL, "handler must be a function");
    return NULL;
  }
  if (g_tsfn) {
    napi_release_threadsafe_function(g_tsfn, napi_tsfn_release);
    g_tsfn = NULL;
  }
  napi_create_string_utf8(env, "baobao-hook", NAPI_AUTO_LENGTH, &name);
  status = napi_create_threadsafe_function(
    env, argv, NULL, name, 0, 1, NULL, NULL, NULL, call_js, &g_tsfn);
  if (status != napi_ok) {
    napi_throw_error(env, NULL, "create threadsafe function failed");
    return NULL;
  }
  napi_unref_threadsafe_function(env, g_tsfn);
  return NULL;
}

static napi_value SetLocked(napi_env env, napi_callback_info info) {
  size_t argc = 1;
  napi_value argv;
  bool locked = false;
  napi_get_cb_info(env, info, &argc, &argv, NULL, NULL);
  if (argc >= 1) napi_get_value_bool(env, argv, &locked);
  InterlockedExchange(&g_locked, locked ? 1 : 0);
  return NULL;
}

static napi_value IsAlive(napi_env env, napi_callback_info info) {
  napi_value result;
  int alive = 0;
  (void)info;
  if (g_thread && g_hook && WaitForSingleObject(g_thread, 0) == WAIT_TIMEOUT) alive = 1;
  napi_get_boolean(env, alive ? true : false, &result);
  return result;
}

static napi_value Stats(napi_env env, napi_callback_info info) {
  napi_value obj;
  char hex[32];
  (void)info;
  extra_hex(hex, sizeof(hex), InterlockedCompareExchange64(&g_last_extra, 0, 0));
  napi_create_object(env, &obj);
  set_i32(env, obj, "procEntered", (int)atomic_read(&g_proc_entered));
  set_bool(env, obj, "probeSeen", atomic_read(&g_probe_seen) ? 1 : 0);
  set_i32(env, obj, "lastVk", (int)atomic_read(&g_last_vk));
  set_i32(env, obj, "lastFlags", (int)atomic_read(&g_last_flags));
  set_str(env, obj, "lastExtra", hex);
  set_str(env, obj, "hMod", hmod_name(g_hmod_kind));
  set_str(env, obj, "injectMethod", g_inject_method);
  set_i32(env, obj, "sendInputCount", g_send_input_count);
  set_str(env, obj, "pump", "GetMessage");
  return obj;
}

#else

static napi_value Unsupported(napi_env env, napi_callback_info info) {
  napi_value obj;
  napi_value ok;
  napi_value detail;
  (void)info;
  napi_create_object(env, &obj);
  napi_get_boolean(env, false, &ok);
  napi_create_string_utf8(env, "宝宝锁的键盘钩子只支持 Windows。", NAPI_AUTO_LENGTH, &detail);
  napi_set_named_property(env, obj, "ok", ok);
  napi_set_named_property(env, obj, "detail", detail);
  return obj;
}

static napi_value IsAlive(napi_env env, napi_callback_info info) {
  napi_value result;
  (void)info;
  napi_get_boolean(env, false, &result);
  return result;
}

static napi_value Noop(napi_env env, napi_callback_info info) {
  (void)env;
  (void)info;
  return NULL;
}

#endif

static void export_fn(napi_env env, napi_value exports, const char *name, napi_callback cb) {
  napi_value fn;
  napi_create_function(env, name, NAPI_AUTO_LENGTH, cb, NULL, &fn);
  napi_set_named_property(env, exports, name, fn);
}

static napi_value Init(napi_env env, napi_value exports) {
#ifdef _WIN32
  export_fn(env, exports, "start", Start);
  export_fn(env, exports, "probe", Probe);
  export_fn(env, exports, "stop", Stop);
  export_fn(env, exports, "setHandler", SetHandler);
  export_fn(env, exports, "setLocked", SetLocked);
  export_fn(env, exports, "isAlive", IsAlive);
  export_fn(env, exports, "stats", Stats);
#else
  export_fn(env, exports, "start", Unsupported);
  export_fn(env, exports, "probe", Unsupported);
  export_fn(env, exports, "stop", Noop);
  export_fn(env, exports, "setHandler", Noop);
  export_fn(env, exports, "setLocked", Noop);
  export_fn(env, exports, "isAlive", IsAlive);
  export_fn(env, exports, "stats", Unsupported);
#endif
  return exports;
}

NAPI_MODULE(NODE_GYP_MODULE_NAME, Init)
