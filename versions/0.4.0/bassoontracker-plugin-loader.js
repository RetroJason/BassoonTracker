// bassoontracker-plugin-loader.js
// Loads the BassoonTracker minified bundle, patches plugin init to call Input.init(), then evaluates it.
(function(){
  var originalSrc = 'scripts/audio/external/BassoonTracker/versions/0.4.0/bassoontracker-min.js';
  function loadAndPatch(){
    return fetch(originalSrc, { credentials: 'same-origin' })
      .then(function(res){ if(!res.ok) throw new Error('Failed to fetch BassoonTracker'); return res.text(); })
      .then(function(text){
  // Do not force Input.init during preLoad; we'll initialize input after the plugin canvas is ready.
  // Avoid modifying BassoonTracker's internal layout constants; let the host control positioning via CSS.
        // Disable standalone auto-init on DOMContentLoaded
        try {
          text = text.replace(
            '!Host.customConfig&&document.addEventListener&&document.addEventListener("DOMContentLoaded",Main.init)',
            '/* auto-init disabled for plugin host */ false'
          );
        } catch (_) { /* ignore */ }
        // Evaluate in global scope
        // Provide a safe HostBridge stub so Host.init() doesn't crash.
        try {
          if (typeof window !== 'undefined') {
            // Only create if not already present
            if (!window.HostBridge) {
              window.HostBridge = {
                // Called by Host.init(); keep it a no-op.
                init: function() {},
                // Host reads these flags if present.
                useUrlParams: false,
                useDropbox: false,
                showInternalMenu: false,
                useWebWorkers: true,
                useInitialLoad: true,
                // Signal to bundle that host provides custom config (disables autoBoot paths)
                customConfig: true,
                // Do NOT override getBaseUrl here; let Host fall back to Settings.baseUrl set via initPlugin
                // Optional helper for remote URL can be empty
                getRemoteUrl: function(){ return ''; }
              };
            } else {
              // Ensure required fields exist on an existing object
              if (typeof window.HostBridge.init !== 'function') window.HostBridge.init = function(){};
              window.HostBridge.customConfig = true;
              // Remove any stale getBaseUrl so Host falls back to Settings.baseUrl
              try { delete window.HostBridge.getBaseUrl; } catch (_) {}
            }
          }
        } catch (_) {}
        (0, eval)(text);
        // If the bundle exposes BassoonTracker as a factory (function), instantiate it now
        try {
          if (typeof window.BassoonTracker === 'function') {
            window.BassoonTracker = window.BassoonTracker();
          }
        } catch (e) {
          console.error('[BassoonTracker loader] Failed to instantiate BassoonTracker:', e);
        }
      });
  }
  if (typeof window !== 'undefined') {
    loadAndPatch().catch(function(err){ console.error('[BassoonTracker loader] Error:', err); });
  }
})();
