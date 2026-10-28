{
  "targets": [
    {
      "target_name": "hook_thread",
      "sources": ["hook_thread.c"],
      "defines": ["NAPI_VERSION=8"],
      "conditions": [
        ["OS=='win'", {
          "libraries": ["user32.lib"]
        }]
      ]
    }
  ]
}
