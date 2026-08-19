# Renderer acceptance checklist

- Open the app and verify the runtime page loads configuration, status, and logs through the preload API.
- Click Start and Stop; buttons are disabled while transitioning and show the returned runtime state.
- Toggle a rule; the change calls `saveConfig` and is reflected after reload.
- Search rules and logs; sensitive local variable keys display masked values.
- Use Settings to import and export a legacy directory without exposing Node APIs in the renderer.
